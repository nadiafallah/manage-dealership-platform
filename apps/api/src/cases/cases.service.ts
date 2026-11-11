import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, like, ne, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  CASE_STAGES,
  currentJalaliYear,
  repairDayPlan,
  maskPhone,
  normalizePersian,
  normalizePhone,
  normalizeVin,
  searchKey,
  type Blocker,
  type CaseDetail,
  type CaseListItem,
  type CaseListQuery,
  type CaseStage,
  type CaseStatus,
  type CaseTransferInput,
  type ChangeStageInput,
  type CoverageType,
  type CreateCaseInput,
  type Paged,
  normalizeRoles,
  type Role,
  type Task,
  type UpdateCaseInput,
} from '@manage/shared';
import { AuditService, diff } from '../audit/audit.service';
import type { Actor } from '../auth/auth.types';
import { badRequest, notFound, versionConflict } from '../common/errors';
import { newId } from '../common/ids';
import { DATABASE, type DatabaseHandle, type DbOrTx } from '../db/database';
import {calendarAt} from '../workshop/work-calendar';
import {
  blockers,
  caseCounters,
  cases,
  customers,
  departments,
  taskDependencies,
  tasks,
  users,
  vehicles,
} from '../db/schema';
import { buildSearchText, computeMissingFields, formatCaseNumber } from './case-rules';
import { recordInitialResponsibility, recordResponsibilityChange } from './responsibility';
import { requireSupportReason } from '../auth/support-reason';
import {idKey,isNonUniqueAdmission} from '../vehicle-import/vehicle-sheet';

type CaseRow = typeof cases.$inferSelect;

/** Fields only the vehicle import sets (not part of the public case contract). */
export interface CaseImportFields {
  admissionNo?: string | null;
  admissionNoKey?: string | null;
  admittedAtPrecision?: 'minute' | 'date';
  origin?: 'excel_import';
  importKey?: string | null;
  chassisRef?: string | null;
}
type VehicleInput = NonNullable<CreateCaseInput['vehicle']>;
type CustomerInput = NonNullable<CreateCaseInput['customer']>;

const RESPONSIBLE_ROLES: Role[] = ['accident_expert', 'system_admin'];
/** "Transfer case" chooses among active accident experts only (not the support account). */
const TRANSFER_ROLES: Role[] = ['accident_expert'];
const FUTURE_TOLERANCE_MS = 10 * 60_000;
// The UI records times to the minute; ordering checks accept that precision.
export const MINUTE_TOLERANCE_MS = 60_000;

const responsibleUser = alias(users, 'responsible_user');
const createdByUser = alias(users, 'created_by_user');
const approvedByUser = alias(users, 'approved_by_user');
const recordedByUser = alias(users, 'recorded_by_user');
const resolvedByUser = alias(users, 'resolved_by_user');

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const toDate = (v: string | null | undefined) => (v == null ? null : new Date(v));

export function assertNotFuture(value: Date | null | undefined, message: string): void {
  if (value && value.getTime() > Date.now() + FUTURE_TOLERANCE_MS) {
    throw badRequest('FUTURE_TIMESTAMP', message);
  }
}

/** SQL fragments shared by the case list filters and the dashboard. */
export const caseSql = {
  active: and(eq(cases.status, 'open'), ne(cases.stage, 'delivered'))!,
  commitment: sql`coalesce(${cases.officialDeadlineAt}, ${cases.forecastDeliveryAt})`,
  hasOpenBlocker: sql`exists (select 1 from blockers b where b.case_id = ${cases.id} and b.resolved_at is null)`,
  openBlockers: sql<number>`(select count(*)::int from blockers b where b.case_id = ${cases.id} and b.resolved_at is null)`,
  // Weighted progress: sum of weights of completed tasks / total weight.
  progress: sql<number>`(select coalesce(round(100.0 * sum(case when t.status in ('done','approved') then t.weight else 0 end) / nullif(sum(t.weight), 0)), 0)::int from tasks t where t.case_id = ${cases.id})`,
};

export const flagConditions: Record<string, () => SQL> = {
  overdue: () => and(caseSql.active, sql`${caseSql.commitment} < now()`)!,
  due_soon: () =>
    and(
      caseSql.active,
      sql`${caseSql.commitment} >= now() and ${caseSql.commitment} < now() + interval '48 hours'`,
    )!,
  blocked: () => and(caseSql.active, caseSql.hasOpenBlocker)!,
  needs_completion: () => and(caseSql.active, sql`cardinality(${cases.missingFields}) > 0`)!,
  unassigned: () => and(caseSql.active, isNull(cases.responsibleUserId))!,
  ready: () => and(eq(cases.status, 'open'), eq(cases.stage, 'ready_for_delivery'))!,
  legacy: () => and(caseSql.active, eq(cases.isLegacyEntry, true))!,
  awaiting_authorization: () =>
    and(
      caseSql.active,
      sql`exists (select 1 from part_quotes q where q.case_id = ${cases.id} and q.tenant_id = ${cases.tenantId} and q.status = 'pending')`,
    )!,
  parts_overdue: () =>
    and(
      caseSql.active,
      sql`exists (select 1 from part_requests p where p.case_id = ${cases.id} and p.status = 'ordered' and p.eta_at < now())`,
    )!,
  parts_to_order: () =>
    and(
      caseSql.active,
      sql`exists (select 1 from part_requests p where p.case_id = ${cases.id} and p.status in ('needed', 'rejected'))`,
    )!,
  // Official deadline and internal forecast are reported separately (docs/REPORTS_FA.md).
  overdue_official: () => and(caseSql.active, sql`${cases.officialDeadlineAt} < now()`)!,
  overdue_forecast: () => and(caseSql.active, sql`${cases.forecastDeliveryAt} < now()`)!,
  // Neither an official deadline nor a forecast: not late, just without a due date.
  no_deadline: () => and(caseSql.active, isNull(cases.officialDeadlineAt), isNull(cases.forecastDeliveryAt))!,
  // Waiting for the manager's decision or for the cashier to confirm an approved advance.
  finance_pending: () =>
    and(
      caseSql.active,
      sql`exists (select 1 from financial_approvals f where f.case_id = ${cases.id} and (f.status = 'proposed' or (f.kind = 'advance' and f.status = 'approved')))`,
    )!,
};

@Injectable()
export class CasesService {
  constructor(
    @Inject(DATABASE) private readonly handle: DatabaseHandle,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.handle.db;
  }

  // ---------------------------------------------------------------- commands

  async create(actor: Actor, input: CreateCaseInput, extra: CaseImportFields = {}): Promise<CaseDetail> {
    const tenantId = actor.user.tenantId;
    const admittedAt = new Date(input.admittedAt);
    assertNotFuture(admittedAt, 'زمان پذیرش نمی‌تواند در آینده باشد');
    if (input.stage === 'delivered') {
      throw badRequest('INVALID_STAGE', 'پرونده جدید نمی‌تواند در مرحله «تحویل‌شده» ثبت شود');
    }
    if (input.responsibleUserId) await this.assertAssignable(this.db, tenantId, input.responsibleUserId);

    const id = newId();
    await this.db.transaction(async (tx) => {
      const repairPlan=input.repairDurationDays!==undefined?repairDayPlan(input.admittedAt,input.repairDurationDays,await calendarAt(tx,tenantId,input.admittedAt)):null;
      let vehicle = await this.upsertVehicle(tx, actor, input.vehicle ?? {}, null);
      if (extra.chassisRef && !vehicle.chassisRef) vehicle = await this.setChassisRef(tx, vehicle, extra.chassisRef);
      const customer = await this.upsertCustomer(tx, actor, input.customer ?? {}, null);
      const year = currentJalaliYear();
      const caseNumber = formatCaseNumber(year, await this.nextCaseSeq(tx, tenantId, year));

      const values = {
        id,
        tenantId,
        caseNumber,
        vehicleId: vehicle.id,
        customerId: customer?.id ?? null,
        admittedAt,
        odometerKm: input.odometerKm ?? null,
        damageDescription: input.damageDescription ?? null,
        vehicleLocation: input.vehicleLocation ?? null,
        coverageType: input.coverageType,
        goldenCardFileNo: input.goldenCardFileNo ?? null,
        insurerName: input.insurerName ?? null,
        insuranceClaimNo: input.insuranceClaimNo ?? null,
        coverageNotes: input.coverageNotes ?? null,
        responsibleUserId: input.responsibleUserId ?? null,
        stage: input.stage ?? 'reception',
        officialDeadlineAt: toDate(input.officialDeadlineAt),
        forecastDeliveryAt: repairPlan?new Date(repairPlan.endAt):toDate(input.forecastDeliveryAt),
        repairPlan,
        isLegacyEntry: input.isLegacyEntry ?? false,
        admissionNo: extra.admissionNo ?? input.admissionNo ?? null,
        admissionNoKey: extra.admissionNoKey ?? (input.admissionNo&&!isNonUniqueAdmission(input.admissionNo)?idKey(input.admissionNo):null),
        admittedAtPrecision: extra.admittedAtPrecision ?? 'minute',
        origin: extra.origin ?? 'manual',
        importKey: extra.importKey ?? null,
        isTest: actor.user.isTestTenant,
        createdBy: actor.user.id,
        updatedBy: actor.user.id,
      };
      const derived = this.derive(values, vehicle, customer);
      const [row] = await tx
        .insert(cases)
        .values({ ...values, ...derived })
        .returning();
      await recordInitialResponsibility(tx, actor, row!);
      await this.audit.record(tx, actor, {
        entityType: 'case',
        entityId: id,
        caseId: id,
        action: 'case.created',
        after: {
          caseNumber,
          coverageType: values.coverageType,
          stage: values.stage,
          admittedAt: admittedAt.toISOString(),
          isLegacyEntry: values.isLegacyEntry,
          ...(extra.origin ? { origin: extra.origin, admissionNo: values.admissionNo, admittedAtPrecision: values.admittedAtPrecision } : {}),
        },
        snapshot: { version: 1, row: row! },
      });
    });
    return this.detail(actor, id);
  }

  async update(actor: Actor, id: string, input: UpdateCaseInput, extra: CaseImportFields = {}): Promise<CaseDetail> {
    const tenantId = actor.user.tenantId;
    await this.db.transaction(async (tx) => {
      const current = await this.loadForWrite(tx, tenantId, id, input.expectedVersion);

      const admittedAt = input.admittedAt === undefined ? undefined : new Date(input.admittedAt);
      const deadline = input.officialDeadlineAt === undefined ? undefined : toDate(input.officialDeadlineAt);
      const sensitive =
        (admittedAt !== undefined && admittedAt.getTime() !== current.admittedAt.getTime()) ||
        (deadline !== undefined && iso(deadline) !== iso(current.officialDeadlineAt));
      if (sensitive && !input.reason) {
        throw badRequest('REASON_REQUIRED', 'برای تغییر مهلت رسمی یا زمان پذیرش، ذکر دلیل الزامی است');
      }
      if (admittedAt) assertNotFuture(admittedAt, 'زمان پذیرش نمی‌تواند در آینده باشد');
      if (input.responsibleUserId) await this.assertAssignable(tx, tenantId, input.responsibleUserId);

      if (input.vehicle) await this.upsertVehicle(tx, actor, input.vehicle, current);
      if (extra.chassisRef) {
        const [v] = await tx.select().from(vehicles).where(eq(vehicles.id, current.vehicleId));
        if (v && !v.chassisRef) await this.setChassisRef(tx, v, extra.chassisRef);
      }
      let customerId = current.customerId;
      if (input.customer) {
        customerId = (await this.upsertCustomer(tx, actor, input.customer, current))?.id ?? customerId;
      }

      const patch: Partial<CaseRow> = {};
      const simple = [
        'odometerKm',
        'damageDescription',
        'vehicleLocation',
        'coverageType',
        'goldenCardFileNo',
        'insurerName',
        'insuranceClaimNo',
        'coverageNotes',
        'responsibleUserId',
        'isLegacyEntry',
      ] as const;
      for (const key of simple) {
        if (input[key] !== undefined) (patch as any)[key] = input[key];
      }
      if (admittedAt !== undefined) patch.admittedAt = admittedAt;
      if (deadline !== undefined) patch.officialDeadlineAt = deadline;
      if (input.forecastDeliveryAt !== undefined) patch.forecastDeliveryAt = toDate(input.forecastDeliveryAt);
      if(input.repairDurationDays!==undefined){
        if(current.repairPlan&&!input.reason)throw badRequest('REASON_REQUIRED','برای تغییر مدت برنامه تعمیر، دلیل را بنویسید');
        const start=(admittedAt??current.admittedAt).toISOString();
        patch.repairPlan=repairDayPlan(start,input.repairDurationDays,current.repairPlan?.calendar??await calendarAt(tx,tenantId,start));
        patch.forecastDeliveryAt=new Date(patch.repairPlan.endAt);
      }
      if (customerId !== current.customerId) patch.customerId = customerId;
      // A system administrator correcting an already recorded value writes a reason (filling an empty field does not need one).
      if ((Object.keys(patch) as (keyof CaseRow)[]).some((k) => isCorrection(current[k], patch[k]))) requireSupportReason(actor, input.reason);
      if(input.admissionNo!==undefined){patch.admissionNo=input.admissionNo;patch.admissionNoKey=input.admissionNo&&!isNonUniqueAdmission(input.admissionNo)?idKey(input.admissionNo):null;}
      if (extra.admissionNo !== undefined) patch.admissionNo = extra.admissionNo;
      if (extra.admissionNoKey !== undefined) patch.admissionNoKey = extra.admissionNoKey;
      if (extra.importKey !== undefined && !current.importKey) patch.importKey = extra.importKey;

      const [updated] = await tx
        .update(cases)
        .set({ ...patch, updatedAt: new Date(), updatedBy: actor.user.id, version: current.version + 1 })
        .where(and(eq(cases.id, id), eq(cases.version, current.version)))
        .returning();
      if (!updated) throw versionConflict();
      if ('responsibleUserId' in patch) {
        await recordResponsibilityChange(tx, actor, current, updated.responsibleUserId, updated.updatedAt, 'update', input.reason ?? null);
      }

      const fields = Object.keys(patch);
      const changes = diff(pick(current, fields), pick(updated, fields));
      const finalRow = await this.refreshDerived(tx, id);
      await this.audit.record(tx, actor, {
        entityType: 'case',
        entityId: id,
        caseId: id,
        action: 'case.updated',
        reason: input.reason ?? null,
        before: changes?.before ?? null,
        after: changes?.after ?? null,
        snapshot: { version: updated.version, row: finalRow },
      });
    });
    return this.detail(actor, id);
  }

  /**
   * Hands a case to another active accident coordinator. The current period is
   * closed and a new one opened; statistics follow each person's own period.
   */
  async transfer(actor: Actor, id: string, input: CaseTransferInput): Promise<CaseDetail> {
    const tenantId = actor.user.tenantId;
    await this.db.transaction(async (tx) => {
      const current = await this.loadForWrite(tx, tenantId, id, input.expectedVersion);
      if (current.responsibleUserId === input.toUserId) throw badRequest('SAME_RESPONSIBLE', 'این پرونده همین حالا با همین مسئول است');
      const [target] = await tx
        .select({ id: users.id, roles: users.roles })
        .from(users)
        .where(and(eq(users.id, input.toUserId), eq(users.tenantId, tenantId), eq(users.isActive, true)));
      if (!target || !normalizeRoles(target.roles).some((r) => TRANSFER_ROLES.includes(r))) {
        throw badRequest('INVALID_RESPONSIBLE', 'مسئول تازه باید کارشناس تصادفات فعال همین نمایندگی باشد');
      }
      const reason = input.reason?.trim() || null;
      requireSupportReason(actor, reason);
      const now = new Date();
      const [updated] = await tx
        .update(cases)
        .set({ responsibleUserId: target.id, updatedAt: now, updatedBy: actor.user.id, version: current.version + 1 })
        .where(and(eq(cases.id, id), eq(cases.version, current.version)))
        .returning();
      if (!updated) throw versionConflict();
      await recordResponsibilityChange(tx, actor, current, target.id, now, 'transfer', reason);
      const finalRow = await this.refreshDerived(tx, id);
      await this.audit.record(tx, actor, {
        entityType: 'case',
        entityId: id,
        caseId: id,
        action: 'case.transferred',
        reason,
        occurredAt: now,
        before: { responsibleUserId: current.responsibleUserId },
        after: { responsibleUserId: target.id },
        snapshot: { version: updated.version, row: finalRow },
      });
    });
    return this.detail(actor, id);
  }

  async changeStage(actor: Actor, id: string, input: ChangeStageInput): Promise<CaseDetail> {
    const tenantId = actor.user.tenantId;
    await this.db.transaction(async (tx) => {
      const current = await this.loadForWrite(tx, tenantId, id, input.expectedVersion);
      if (current.stage === input.stage) return;
      if (current.stage === 'delivered') {
        throw badRequest('CASE_DELIVERED', 'پرونده تحویل‌شده را نمی‌توان به مرحله قبل برگرداند');
      }
      // Handover and "ready for delivery" have their own gates (CompletionService).
      if (input.stage === 'delivered') {
        throw badRequest(
          'DELIVERY_GATE',
          'تحویل خودرو فقط از بخش «کنترل کیفیت و تحویل» و پس از بستن فنی و بستن مالی ثبت می‌شود',
        );
      }
      if (input.stage === 'ready_for_delivery') {
        throw badRequest('TECHNICAL_CLOSE_REQUIRED', 'پرونده با «بستن فنی» پس از قبولی کنترل کیفیت آماده تحویل می‌شود');
      }
      // Moving a case back to an earlier stage reopens recorded progress.
      if (CASE_STAGES.indexOf(input.stage) < CASE_STAGES.indexOf(current.stage as CaseStage)) requireSupportReason(actor, input.note);
      const patch: Partial<CaseRow> & { stage: CaseStage } = { stage: input.stage };
      // Moving a technically closed case back into the workflow reopens it.
      if (current.technicalClosedAt) Object.assign(patch, { technicalClosedAt: null, technicalClosedBy: null, technicalCloseNote: null });
      await this.applyStage(tx, actor, current, patch, input.note ?? null);
    });
    return this.detail(actor, id);
  }

  /** Used by TasksService to move a case into repair when work starts. */
  async applyStage(
    tx: DbOrTx,
    actor: Actor,
    current: CaseRow,
    patch: Partial<CaseRow> & { stage: CaseStage },
    reason: string | null,
  ): Promise<CaseRow> {
    const [updated] = await tx
      .update(cases)
      .set({ ...patch, updatedAt: new Date(), updatedBy: actor.user.id, version: current.version + 1 })
      .where(and(eq(cases.id, current.id), eq(cases.version, current.version)))
      .returning();
    if (!updated) throw versionConflict();
    await this.audit.record(tx, actor, {
      entityType: 'case',
      entityId: current.id,
      caseId: current.id,
      action: 'case.stage_changed',
      reason,
      before: { stage: current.stage },
      after: { stage: updated.stage },
      snapshot: { version: updated.version, row: updated },
    });
    return updated;
  }

  /**
   * Used by CompletionService: technical/financial close and handover. Audits
   * the changed fields under `action`; `stage` in the patch is audited too.
   */
  async applyPatch(
    tx: DbOrTx,
    actor: Actor,
    current: CaseRow,
    patch: Partial<CaseRow>,
    action: string,
    reason: string | null,
    occurredAt?: Date,
  ): Promise<CaseRow> {
    const [updated] = await tx
      .update(cases)
      .set({ ...patch, updatedAt: new Date(), updatedBy: actor.user.id, version: current.version + 1 })
      .where(and(eq(cases.id, current.id), eq(cases.version, current.version)))
      .returning();
    if (!updated) throw versionConflict();
    const fields = Object.keys(patch) as (keyof CaseRow)[];
    const pick = (r: CaseRow) => Object.fromEntries(fields.map((k) => [k, r[k]]));
    const changes = diff(pick(current), pick(updated));
    await this.audit.record(tx, actor, {
      entityType: 'case',
      entityId: current.id,
      caseId: current.id,
      action,
      reason,
      occurredAt,
      before: changes?.before ?? null,
      after: changes?.after ?? null,
      snapshot: { version: updated.version, row: updated },
    });
    return updated;
  }

  /** Used by AssessmentsService: a supplement moves the internal forecast (never the official deadline). */
  async applyForecast(
    tx: DbOrTx,
    actor: Actor,
    current: CaseRow,
    forecastDeliveryAt: Date,
    reason: string,
  ): Promise<CaseRow> {
    if (iso(forecastDeliveryAt) === iso(current.forecastDeliveryAt)) return current;
    const [updated] = await tx
      .update(cases)
      .set({ forecastDeliveryAt, updatedAt: new Date(), updatedBy: actor.user.id, version: current.version + 1 })
      .where(and(eq(cases.id, current.id), eq(cases.version, current.version)))
      .returning();
    if (!updated) throw versionConflict();
    await this.audit.record(tx, actor, {
      entityType: 'case',
      entityId: current.id,
      caseId: current.id,
      action: 'case.updated',
      reason,
      before: { forecastDeliveryAt: iso(current.forecastDeliveryAt) },
      after: { forecastDeliveryAt: iso(updated.forecastDeliveryAt) },
      snapshot: { version: updated.version, row: updated },
    });
    return updated;
  }

  // ----------------------------------------------------------------- queries

  async list(actor: Actor, q: CaseListQuery): Promise<Paged<CaseListItem>> {
    const conditions: SQL[] = [eq(cases.tenantId, actor.user.tenantId)];
    if (q.vehicleIdentity) {
      const identity = idKey(q.vehicleIdentity);
      if (identity.length < 6) throw badRequest('VEHICLE_IDENTITY_INVALID', 'VIN یا شماره شاسی کامل را وارد کنید');
      conditions.push(sql`exists (select 1 from vehicles vh where vh.id = ${cases.vehicleId} and vh.tenant_id = ${actor.user.tenantId}
        and (upper(regexp_replace(coalesce(vh.vin,''), '[[:space:]_./-]', '', 'g')) = ${identity}
          or upper(regexp_replace(translate(coalesce(vh.chassis_ref,''), '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'), '[[:space:]_./-]', '', 'g')) = ${identity}))`);
    }
    if (q.status !== 'all') conditions.push(eq(cases.status, q.status));
    if (q.stage) conditions.push(eq(cases.stage, q.stage));
    if (q.coverage) conditions.push(eq(cases.coverageType, q.coverage));
    if (q.responsibleUserId) conditions.push(eq(cases.responsibleUserId, q.responsibleUserId));
    if(q.stationCode)conditions.push(sql`exists (select 1 from tasks t where t.case_id = ${cases.id} and t.tenant_id = ${cases.tenantId} and t.station_snapshot->>'code' = ${q.stationCode})`);
    if (q.flag) conditions.push(flagConditions[q.flag]!());
    if (q.blockerReason) {
      conditions.push(sql`exists (select 1 from blockers b where b.case_id = ${cases.id} and b.resolved_at is null and b.reason = ${q.blockerReason})`);
    }
    if (q.q) {
      const key = searchKey(q.q).replace(/[%_\\]/g, '\\$&');
      if (key) conditions.push(like(cases.searchText, `%${key}%`));
    }
    const where = and(...conditions);

    const [{ total }] = (await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(cases)
      .where(where)) as [{ total: number }];

    const rows = await this.db
      .select({
        c: cases,
        v: vehicles,
        customerName: customers.fullName,
        responsibleName: responsibleUser.displayName,
        openBlockers: caseSql.openBlockers,
        progress: caseSql.progress,
      })
      .from(cases)
      .innerJoin(vehicles, eq(vehicles.id, cases.vehicleId))
      .leftJoin(customers, eq(customers.id, cases.customerId))
      .leftJoin(responsibleUser, eq(responsibleUser.id, cases.responsibleUserId))
      .where(where)
      .orderBy(desc(cases.admittedAt), desc(cases.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);

    return {
      items: rows.map((r) => ({
        ...this.baseItem(r.c, r.v, r.responsibleName, r.openBlockers, r.progress),
        customerName: r.customerName,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async detail(actor: Actor, id: string): Promise<CaseDetail> {
    const tenantId = actor.user.tenantId;
    const [r] = await this.db
      .select({
        c: cases,
        v: vehicles,
        cu: customers,
        responsibleName: responsibleUser.displayName,
        createdByName: createdByUser.displayName,
        openBlockers: caseSql.openBlockers,
        progress: caseSql.progress,
      })
      .from(cases)
      .innerJoin(vehicles, eq(vehicles.id, cases.vehicleId))
      .leftJoin(customers, eq(customers.id, cases.customerId))
      .leftJoin(responsibleUser, eq(responsibleUser.id, cases.responsibleUserId))
      .innerJoin(createdByUser, eq(createdByUser.id, cases.createdBy))
      .where(and(eq(cases.id, id), eq(cases.tenantId, tenantId)))
      .limit(1);
    if (!r) throw notFound('پرونده');

    const canSeePii = actor.user.permissions.has('customer.pii.read');
    const { c, v, cu } = r;
    return {
      ...this.baseItem(c, v, r.responsibleName, r.openBlockers, r.progress),
      version: c.version,
      customer: cu
        ? {
            id: cu.id,
            fullName: cu.fullName,
            phone: canSeePii ? cu.phone : maskPhone(cu.phone),
            phoneMasked: !canSeePii && !!cu.phone,
          }
        : null,
      vehicle: {
        id: v.id,
        brand: v.brand,
        model: v.model,
        trim: v.trim,
        modelYear: v.modelYear,
        plate: v.plate,
        vin: v.vin,
        color: v.color,
        chassisRef: v.chassisRef,
      },
      admissionNo: c.admissionNo,
      repairPlan:c.repairPlan,
      admittedAtPrecision: c.admittedAtPrecision as CaseDetail['admittedAtPrecision'],
      origin: c.origin as CaseDetail['origin'],
      odometerKm: c.odometerKm,
      damageDescription: c.damageDescription,
      vehicleLocation: c.vehicleLocation,
      goldenCardFileNo: c.goldenCardFileNo,
      insurerName: c.insurerName,
      insuranceClaimNo: c.insuranceClaimNo,
      coverageNotes: c.coverageNotes,
      actualDeliveryAt: iso(c.actualDeliveryAt),
      createdAt: c.createdAt.toISOString(),
      createdBy: { id: c.createdBy, displayName: r.createdByName },
      updatedAt: c.updatedAt.toISOString(),
      tasks: await this.tasksOf(tenantId, id),
      blockers: await this.blockersOf(tenantId, id),
    };
  }

  async tasksOf(tenantId: string, caseId: string): Promise<Task[]> {
    const rows = await this.db
      .select({ t: tasks, d: departments, approvedByName: approvedByUser.displayName })
      .from(tasks)
      .innerJoin(departments, eq(departments.id, tasks.departmentId))
      .leftJoin(approvedByUser, eq(approvedByUser.id, tasks.approvedBy))
      .where(and(eq(tasks.tenantId, tenantId), eq(tasks.caseId, caseId)))
      .orderBy(asc(tasks.sortOrder), asc(tasks.createdAt));
    const ids = rows.map((r) => r.t.id);
    const deps = ids.length
      ? await this.db.select().from(taskDependencies).where(inArray(taskDependencies.taskId, ids))
      : [];
    return rows.map(({ t, d, approvedByName }) => ({
      id: t.id,
      caseId: t.caseId,
      department: { id: d.id, code: d.code, name: d.name },
      title: t.title,
      technicianName: t.technicianName,
      technicianCode: t.technicianCode,
      stationId:t.stationId, stationCode:t.stationSnapshot?.code ?? null, stationName:t.stationSnapshot?.name ?? null, assignedUserId:t.assignedUserId, baselineEndAt:iso(t.baselineEndAt),
      status: t.status as Task['status'],
      plannedStartAt: iso(t.plannedStartAt),
      plannedEndAt: iso(t.plannedEndAt),
      actualStartAt: iso(t.actualStartAt),
      actualEndAt: iso(t.actualEndAt),
      approvedAt: iso(t.approvedAt),
      approvedBy: t.approvedBy ? { id: t.approvedBy, displayName: approvedByName! } : null,
      dependsOn: deps.filter((x) => x.taskId === t.id).map((x) => x.dependsOnTaskId),
      qcInspectionId: t.qcInspectionId,
      weight: t.weight,
      notes: t.notes,
      version: t.version,
    }));
  }

  async blockersOf(tenantId: string, caseId: string): Promise<Blocker[]> {
    const rows = await this.db
      .select({
        b: blockers,
        recordedByName: recordedByUser.displayName,
        resolvedByName: resolvedByUser.displayName,
      })
      .from(blockers)
      .innerJoin(recordedByUser, eq(recordedByUser.id, blockers.recordedBy))
      .leftJoin(resolvedByUser, eq(resolvedByUser.id, blockers.resolvedBy))
      .where(and(eq(blockers.tenantId, tenantId), eq(blockers.caseId, caseId)))
      .orderBy(desc(blockers.occurredAt));
    return rows.map(({ b, recordedByName, resolvedByName }) => ({
      id: b.id,
      caseId: b.caseId,
      taskId: b.taskId,
      reason: b.reason as Blocker['reason'],
      description: b.description,
      occurredAt: b.occurredAt.toISOString(),
      recordedAt: b.recordedAt.toISOString(),
      recordedBy: { id: b.recordedBy, displayName: recordedByName },
      lastFollowUpAt: iso(b.lastFollowUpAt),
      followUpCount: b.followUpCount,
      resolvedAt: iso(b.resolvedAt),
      resolvedBy: b.resolvedBy ? { id: b.resolvedBy, displayName: resolvedByName! } : null,
      resolutionNote: b.resolutionNote,
      partRequestId: b.partRequestId,
    }));
  }

  // ---------------------------------------------------------------- helpers

  /** Loads a case inside a transaction and checks tenant, version and open status. */
  async loadForWrite(tx: DbOrTx, tenantId: string, id: string, expectedVersion?: number): Promise<CaseRow> {
    const [row] = await tx
      .select()
      .from(cases)
      .where(and(eq(cases.id, id), eq(cases.tenantId, tenantId)))
      .limit(1).for('update');
    if (!row) throw notFound('پرونده');
    if (expectedVersion !== undefined && row.version !== expectedVersion) throw versionConflict(row.version);
    if (row.status !== 'open') throw badRequest('CASE_NOT_OPEN', 'این پرونده بسته یا لغو شده است');
    return row;
  }

  private baseItem(
    c: CaseRow,
    v: typeof vehicles.$inferSelect,
    responsibleName: string | null,
    openBlockers: number,
    progress: number,
  ): Omit<CaseListItem, 'customerName'> {
    return {
      id: c.id,
      caseNumber: c.caseNumber,
      admissionNo: c.admissionNo,
      stage: c.stage as CaseStage,
      status: c.status as CaseStatus,
      coverageType: c.coverageType as CoverageType,
      admittedAt: c.admittedAt.toISOString(),
      officialDeadlineAt: iso(c.officialDeadlineAt),
      forecastDeliveryAt: iso(c.forecastDeliveryAt),
      vehicleLabel: [v.brand, v.model, v.trim].filter(Boolean).join(' ') || 'خودرو (مدل نامشخص)',
      // Some manufacturer model cells include explicit engine/gearbox metadata.
      // Keep the model name before those terms; never derive it from trim.
      vehicleSummary: [v.brand, v.model?.split(/\s+(?:با\s+)?(?:موتور|گیربکس)(?=\s|[a-z0-9])/iu)[0]?.trim() || 'مدل نامشخص'].filter(Boolean).join(' '),
      plate: v.plate,
      vin: v.vin,
      responsible: c.responsibleUserId ? { id: c.responsibleUserId, displayName: responsibleName! } : null,
      openBlockers: Number(openBlockers),
      progressPercent: Number(progress),
      missingFields: c.missingFields,
      isLegacyEntry: c.isLegacyEntry,
      isTest: c.isTest,
    };
  }

  private derive(
    c: Pick<
      CaseRow,
      | 'caseNumber'
      | 'coverageType'
      | 'odometerKm'
      | 'damageDescription'
      | 'responsibleUserId'
      | 'goldenCardFileNo'
      | 'officialDeadlineAt'
      | 'insurerName'
      | 'insuranceClaimNo'
      | 'admissionNo'
    >,
    v: typeof vehicles.$inferSelect,
    cu: typeof customers.$inferSelect | null,
  ) {
    return {
      missingFields: computeMissingFields({
        coverageType: c.coverageType,
        customerName: cu?.fullName ?? null,
        customerPhone: cu?.phone ?? null,
        vehicleModel: v.model,
        plate: v.plate,
        vin: v.vin,
        odometerKm: c.odometerKm,
        damageDescription: c.damageDescription,
        responsibleUserId: c.responsibleUserId,
        goldenCardFileNo: c.goldenCardFileNo,
        officialDeadlineAt: c.officialDeadlineAt,
        insurerName: c.insurerName,
        insuranceClaimNo: c.insuranceClaimNo,
      }),
      searchText: buildSearchText([
        c.caseNumber,
        v.plate,
        v.vin,
        v.model,
        cu?.fullName,
        cu?.phone,
        c.goldenCardFileNo,
        c.insuranceClaimNo,
        c.admissionNo,
        v.chassisRef,
      ]),
    };
  }

  /** Recomputes missing_fields/search_text (derived, not versioned). */
  private async refreshDerived(tx: DbOrTx, caseId: string): Promise<CaseRow> {
    const [r] = await tx
      .select({ c: cases, v: vehicles, cu: customers })
      .from(cases)
      .innerJoin(vehicles, eq(vehicles.id, cases.vehicleId))
      .leftJoin(customers, eq(customers.id, cases.customerId))
      .where(eq(cases.id, caseId));
    const derived = this.derive(r!.c, r!.v, r!.cu);
    const [row] = await tx.update(cases).set(derived).where(eq(cases.id, caseId)).returning();
    return row!;
  }

  private async refreshCasesOf(tx: DbOrTx, by: { vehicleId?: string; customerId?: string }) {
    const cond = by.vehicleId ? eq(cases.vehicleId, by.vehicleId) : eq(cases.customerId, by.customerId!);
    const rows = await tx.select({ id: cases.id }).from(cases).where(cond);
    for (const r of rows) await this.refreshDerived(tx, r.id);
  }

  private async nextCaseSeq(tx: DbOrTx, tenantId: string, year: number): Promise<number> {
    const [r] = await tx
      .insert(caseCounters)
      .values({ tenantId, year, lastValue: 1 })
      .onConflictDoUpdate({
        target: [caseCounters.tenantId, caseCounters.year],
        set: { lastValue: sql`${caseCounters.lastValue} + 1` },
      })
      .returning({ value: caseCounters.lastValue });
    return r!.value;
  }

  private async assertAssignable(db: DbOrTx, tenantId: string, userId: string) {
    const [u] = await db
      .select({ roles: users.roles, isActive: users.isActive })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));
    if (!u || !u.isActive || !normalizeRoles(u.roles).some((r) => RESPONSIBLE_ROLES.includes(r))) {
      throw badRequest('INVALID_RESPONSIBLE', 'مسئول انتخاب‌شده معتبر نیست');
    }
  }

  /**
   * Creates or updates the vehicle of a case. On create, an existing vehicle
   * with the same VIN is reused (each visit is still a separate case) and only
   * its empty fields are filled. On update, the case's own vehicle is patched.
   */
  /** Records the admission sheet's chassis number once; it is never treated as a VIN. */
  private async setChassisRef(tx: DbOrTx, vehicle: typeof vehicles.$inferSelect, chassisRef: string) {
    const [row] = await tx
      .update(vehicles)
      .set({ chassisRef, updatedAt: new Date(), version: vehicle.version + 1 })
      .where(eq(vehicles.id, vehicle.id))
      .returning();
    return row!;
  }

  private async upsertVehicle(tx: DbOrTx, actor: Actor, input: VehicleInput, current: CaseRow | null) {
    const tenantId = actor.user.tenantId;
    const normalized = {
      brand: clean(input.brand),
      model: clean(input.model),
      trim: clean(input.trim),
      modelYear: input.modelYear,
      plate: clean(input.plate),
      vin: input.vin === undefined ? undefined : input.vin ? normalizeVin(input.vin) : null,
      color: clean(input.color),
    };

    let existing: typeof vehicles.$inferSelect | undefined;
    if (current) {
      [existing] = await tx.select().from(vehicles).where(eq(vehicles.id, current.vehicleId));
    } else if (normalized.vin) {
      [existing] = await tx
        .select()
        .from(vehicles)
        .where(and(eq(vehicles.tenantId, tenantId), eq(vehicles.vin, normalized.vin)));
    }

    if (!existing) {
      const [row] = await tx
        .insert(vehicles)
        .values({
          id: newId(),
          tenantId,
          brand: normalized.brand ?? null,
          model: normalized.model ?? null,
          trim: normalized.trim ?? null,
          modelYear: normalized.modelYear ?? null,
          plate: normalized.plate ?? null,
          vin: normalized.vin ?? null,
          color: normalized.color ?? null,
          isTest: actor.user.isTestTenant,
        })
        .returning();
      return row!;
    }

    const patch: Partial<typeof vehicles.$inferSelect> = {};
    for (const [key, value] of Object.entries(normalized)) {
      if (value === undefined) continue;
      const old = (existing as any)[key];
      // Reusing by VIN on a new case only fills gaps (plate may change hands).
      if (!current && old != null && key !== 'plate') continue;
      if (value !== old) (patch as any)[key] = value;
    }
    if (!Object.keys(patch).length) return existing;

    if (patch.vin) {
      const [clash] = await tx
        .select({ id: vehicles.id })
        .from(vehicles)
        .where(and(eq(vehicles.tenantId, tenantId), eq(vehicles.vin, patch.vin), ne(vehicles.id, existing.id)));
      if (clash) throw badRequest('VIN_EXISTS', 'این VIN برای خودروی دیگری ثبت شده است');
    }
    const [row] = await tx
      .update(vehicles)
      .set({ ...patch, updatedAt: new Date(), version: existing.version + 1 })
      .where(eq(vehicles.id, existing.id))
      .returning();
    const changes = diff(pick(existing, Object.keys(patch)), pick(row!, Object.keys(patch)));
    await this.audit.record(tx, actor, {
      entityType: 'vehicle',
      entityId: existing.id,
      caseId: current?.id ?? null,
      action: 'vehicle.updated',
      before: changes?.before,
      after: changes?.after,
      snapshot: { version: row!.version, row: row! },
    });
    await this.refreshCasesOf(tx, { vehicleId: existing.id });
    return row!;
  }

  /** Same policy as vehicles, keyed by normalized phone number. */
  private async upsertCustomer(tx: DbOrTx, actor: Actor, input: CustomerInput, current: CaseRow | null) {
    const tenantId = actor.user.tenantId;
    const fullName = clean(input.fullName);
    const phone = input.phone === undefined ? undefined : input.phone ? normalizePhone(input.phone) : null;

    let existing: typeof customers.$inferSelect | undefined;
    if (current?.customerId) {
      [existing] = await tx.select().from(customers).where(eq(customers.id, current.customerId));
    } else if (phone) {
      [existing] = await tx
        .select()
        .from(customers)
        .where(and(eq(customers.tenantId, tenantId), eq(customers.phone, phone)));
    }

    if (!existing) {
      if (!fullName && !phone) return null;
      const [row] = await tx
        .insert(customers)
        .values({
          id: newId(),
          tenantId,
          fullName: fullName ?? null,
          phone: phone ?? null,
          isTest: actor.user.isTestTenant,
        })
        .returning();
      return row!;
    }

    const patch: Partial<typeof customers.$inferSelect> = {};
    if (fullName !== undefined && fullName !== existing.fullName && (current || !existing.fullName)) {
      patch.fullName = fullName;
    }
    if (phone !== undefined && phone !== existing.phone && current) patch.phone = phone;
    if (!Object.keys(patch).length) return existing;

    const [row] = await tx
      .update(customers)
      .set({ ...patch, updatedAt: new Date(), version: existing.version + 1 })
      .where(eq(customers.id, existing.id))
      .returning();
    const changes = diff(pick(existing, Object.keys(patch)), pick(row!, Object.keys(patch)));
    await this.audit.record(tx, actor, {
      entityType: 'customer',
      entityId: existing.id,
      caseId: current?.id ?? null,
      action: 'customer.updated',
      before: changes?.before,
      after: changes?.after,
      snapshot: { version: row!.version, row: row! },
    });
    await this.refreshCasesOf(tx, { customerId: existing.id });
    return row!;
  }
}

function clean(v: string | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const n = normalizePersian(v);
  return n === '' ? null : n;
}

function pick(obj: Record<string, any>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((k) => [k, obj[k]]));
}

/** A recorded value replaced by a different one (not an empty field being filled). */
function isCorrection(before: unknown, after: unknown): boolean {
  const empty = (v: unknown) => v === null || v === undefined || v === '';
  if (empty(before)) return false;
  const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : JSON.stringify(v ?? null));
  return norm(before) !== norm(after);
}
