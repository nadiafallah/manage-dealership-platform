import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  EMDAD_ARRIVED_CATEGORIES, NON_CONSUMPTION_REASONS, SPECIAL_AID_FINAL_STATES,
  AID_DEADLINE_LABELS, CONTACT_OUTCOME_LABELS, NON_CONSUMPTION_LABELS, SPECIAL_AID_ITEM_STATE_LABELS, SPECIAL_AID_QUEUES, aidDeadline, appointmentInstant, autoLinkedAppointments, dossierQueue, effectiveRelation, isContactFailed, isUnreached, openArrivalSince, TECHNICAL_REASONS, allowedItemActions, daysBetween, dossierTasks, endOfNextWorkingDay, failedAttemptDays, isGuestOnlyViewer, isWorkingDay, maskPersonName, maskPhone, maskVehicleId, nextItemState,
  parseProcurementCode, assessmentCodeOf, shortVehicleName, unansweredStreak, vehicleHeadName, worstDeadline, tehranDay,
  type AidContactFacts, type AidItemFacts, type AppointmentRelation, type ContactInput, type DossierSearchInput, type ItemActionInput, type NonConsumptionInput,
  type NonConsumptionReason, type Paged, type Permission, type PostponeInput, type SpecialAidContact, type SpecialAidDossier, type SpecialAidDossierRow,
  type SpecialAidItem, type SpecialAidItemState, type SpecialAidSummary, type SpecialAidFunnel, type SpecialAidSupplyRow, type SpecialAidTask, type SpecialAidTodayEntry,
  type ReplacementInput, type SpecialAidVehicle, type SupplySearchInput,
} from '@manage/shared';
import { calendarAt } from '../workshop/work-calendar';
import { SpecialAidRecordsService } from './special-aid-records.service';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../auth/auth.types';
import { badRequest, conflict, forbidden, notFound, versionConflict } from '../common/errors';
import { newId } from '../common/ids';
import { DATABASE, type DatabaseHandle, type DbOrTx } from '../db/database';
import {
  auditEvents, cases, customers, emdadRequestEvents, emdadRequests, notifications, referenceEntries, specialAidAdmissions, specialAidAppointmentLinks, specialAidContacts, specialAidDossiers,
  specialAidGroups, specialAidItems, stockReservations, stockSnapshotItems, stockSnapshots, tenants, users, vehicles,
} from '../db/schema';
import { parseReportDate, reportQuantity } from '../daily-reports/emdad-parts';
import type { EmdadOfficial } from '../daily-reports/report-rows';
import { safeCell } from '../daily-reports/safe-cell';
import { snapshotInfo } from '../daily-reports/stock.service';
import { notifyUsers, usersWithRole } from '../parts/part-notify';
import { writeSheet, writeWorkbook } from '../parts/xlsx';
import { idKey, isAidVehicleKey, isNonUniqueAdmission } from '../vehicle-import/vehicle-sheet';

type ItemRow = typeof specialAidItems.$inferSelect;
const withoutTasks = <T extends { tasks: unknown }>(r: T): Omit<T, 'tasks'> => { const copy: Partial<T> = { ...r }; delete copy.tasks; return copy as Omit<T, 'tasks'>; };
/** What a guest may search by: the masked chassis and name, never the full values (spec 29.7). */
const guestSearchKey = (l: { dossier: { vin: string }; vehicle: SpecialAidVehicle; items: SpecialAidItem[] }) =>
  idKey([maskVehicleId(l.dossier.vin), l.vehicle.customerName ? maskPersonName(l.vehicle.customerName) : '', l.vehicle.plate, l.vehicle.model, ...l.items.flatMap((x) => [x.emdadNo, x.admissionNo, x.assessmentCode, x.procurementCode, x.description])].filter(Boolean).join(' '));
type RequestRow = typeof emdadRequests.$inferSelect;
const ARRIVED = EMDAD_ARRIVED_CATEGORIES as readonly string[];
const HOLD_ACTIVE = ['reserved', 'issued'];
export const BACKFILL_HOLD_NOTE = 'این قطعه در گزارش‌های پیش از ثبت در این بخش «رسیده» بوده و شاید مدت‌ها پیش مصرف شده باشد؛ رزرو خودکار نمی‌شود. اگر هنوز برای همین خودرو در انبار است، رزرو را دستی انجام دهید.';
/** A pending request without an observed status change for this many days counts as stalled in purchasing. */
const SPECIAL_AID_STALLED_DAYS = 14;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const off = (r: RequestRow) => (r.official ?? {}) as Partial<EmdadOfficial>;

interface Loaded {
  dossier: typeof specialAidDossiers.$inferSelect;
  items: SpecialAidItem[];
  facts: AidItemFacts[];
  contacts: SpecialAidContact[];
  groups: SpecialAidDossier['groups'];
  admissions: SpecialAidDossier['admissions'];
  vehicle: SpecialAidVehicle;
  search: string;
  /** The dealership's working days (workshop calendar with recorded holidays). */
  isWorkingDay: (day: string) => boolean;
  /** An appointment of the vehicle in the imported ISACO report is linked (operator or automatically, spec 29.3). */
  linkedAppointment: boolean;
}
type Row = SpecialAidDossierRow & { tasks: SpecialAidTask[] };
/** A call (or the arrival announcement) that was due before today and is still not made. */
const overdueCall = (tasks: readonly SpecialAidTask[]) => tasks.some((t) => (t.section === 'calls' || t.kind === 'inform_arrival') && t.overdue && !t.postponed);

/**
 * «پیگیری امداد ویژه» (spec section 25). Reads the official special-aid rows kept by the
 * daily reports (never a second import) and keeps the internal follow-up beside them:
 * one dossier per valid VIN, independent admissions, part states, contacts and groups.
 * Lines linked to an accident case stay with the parts desk (read only here).
 */
@Injectable()
export class SpecialAidService {
  private readonly log = new Logger(SpecialAidService.name);
  constructor(@Inject(DATABASE) private readonly handle: DatabaseHandle, private readonly audit: AuditService, private readonly records: SpecialAidRecordsService) {}
  private get db() { return this.handle.db; }
  private need(actor: Actor, p: Permission) { if (!actor.user.permissions.has(p)) throw forbidden(); }

  // ------------------------------------------------------------------ sync from the official rows

  /**
   * Creates and refreshes dossiers, admissions and part lines from the stored official rows.
   * Idempotent: a repeated or concurrent run changes nothing. With `autoHold` (after a
   * published report, by its publisher) an arrived part of a vehicle without an accident case
   * is held for its VIN when the exact 10-digit code, the confirmed quantity and stock exist.
   */
  async sync(actor: Actor, opts: { autoHold?: boolean } = {}) {
    return this.db.transaction(async (tx) => {
      const tenantId = actor.user.tenantId;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`special-aid:${tenantId}`}))`);
      const result = { dossiers: 0, admissions: 0, items: 0, statusChanges: 0, arrived: 0, held: 0, holdReview: 0, invalidVin: 0, reconciled: 0, cardsMatched: 0, notified: 0 };
      const rows = await tx.select({ r: emdadRequests, i: specialAidItems, dVin: specialAidDossiers.vin, aKey: specialAidAdmissions.admissionKey }).from(emdadRequests)
        .leftJoin(specialAidItems, eq(specialAidItems.requestId, emdadRequests.id))
        .leftJoin(specialAidDossiers, eq(specialAidDossiers.id, specialAidItems.dossierId))
        .leftJoin(specialAidAdmissions, eq(specialAidAdmissions.id, specialAidItems.admissionId))
        .where(eq(emdadRequests.tenantId, tenantId))
        .orderBy(emdadRequests.id);
      const dossierIds = new Map<string, string>();
      // Vehicles with a part that arrived in this run (not a line already arrived before the module saw it).
      const arrivals = new Map<string, { vin: string; count: number }>();
      const arrivedIn = (dossierId: string, vin: string) => { const e = arrivals.get(dossierId) ?? { vin, count: 0 }; e.count += 1; arrivals.set(dossierId, e); };
      for (const { r, i, dVin, aKey } of rows) {
        const vin = idKey(r.chassis ?? '');
        // Each admission number of the VIN is its own admission; a non-unique placeholder is none.
        const admKey = r.admissionNo && !isNonUniqueAdmission(r.admissionNo) ? idKey(r.admissionNo) : '';
        if (i && i.observedCategory === r.statusCategory && dVin === vin && (aKey ?? '') === admKey) continue;
        // An invalid VIN never opens a dossier (review queue); an existing line is not moved onto it.
        if (!isAidVehicleKey(vin)) { if (!i) result.invalidVin += 1; continue; }
        let dossierId = i && dVin === vin ? i.dossierId : dossierIds.get(vin);
        if (!dossierId) {
          const inserted = await tx.insert(specialAidDossiers).values({ id: newId(), tenantId, vin, isTest: actor.user.isTestTenant }).onConflictDoNothing().returning({ id: specialAidDossiers.id });
          if (inserted.length) result.dossiers += 1;
          const [d] = await tx.select({ id: specialAidDossiers.id }).from(specialAidDossiers).where(and(eq(specialAidDossiers.tenantId, tenantId), eq(specialAidDossiers.vin, vin)));
          dossierId = d!.id;
          dossierIds.set(vin, dossierId);
        }
        // A corrected VIN or admission number in a later report moves the line; history stays in the audit.
        const moved = !!i && i.dossierId !== dossierId;
        let admissionId = i && !moved && (aKey ?? '') === admKey ? i.admissionId : null;
        if (!admissionId && admKey) {
          const ins = await tx.insert(specialAidAdmissions).values({ id: newId(), tenantId, dossierId, admissionKey: admKey, admissionNo: r.admissionNo!.trim(), admissionDate: off(r).admissionDate || null }).onConflictDoNothing().returning({ id: specialAidAdmissions.id });
          if (ins.length) result.admissions += 1;
          const [a] = await tx.select({ id: specialAidAdmissions.id }).from(specialAidAdmissions).where(and(eq(specialAidAdmissions.tenantId, tenantId), eq(specialAidAdmissions.dossierId, dossierId), eq(specialAidAdmissions.admissionKey, admKey)));
          admissionId = a!.id;
        }
        if (i && (moved || i.admissionId !== admissionId)) {
          await tx.update(specialAidItems).set({ dossierId, admissionId, groupId: moved ? null : i.groupId, updatedAt: new Date(), version: i.version + 1 }).where(and(eq(specialAidItems.id, i.id), eq(specialAidItems.version, i.version)));
          await this.audit.record(tx, actor, { entityType: 'special_aid', entityId: i.id, action: 'special_aid.reconciled', before: { vin: dVin, admissionKey: aKey ?? null, dossierId: i.dossierId }, after: { vin, admissionKey: admKey || null, dossierId } });
          result.reconciled += 1;
          i.version += 1; i.dossierId = dossierId; i.admissionId = admissionId;
          if (i.observedCategory === r.statusCategory) continue;
        }
        const arrived = ARRIVED.includes(r.statusCategory);
        if (!i) {
          // First sight of this line in the module: the status was observed at its last change in the reports.
          const [ev] = (await tx.execute(sql`select max(report_at) as at from ${emdadRequestEvents} where request_id = ${r.id} and changes ? 'emdadStatus'`) as unknown as { rows: { at: string | Date | null }[] }).rows;
          const observed = ev?.at ? new Date(ev.at) : r.lastReportAt;
          // A line that had already arrived in earlier reports (before the module saw it) may have been
          // installed long ago: it is never held automatically. Only a line that is new in the report
          // being published, or that turns «arrived» in a later report, is held automatically.
          const backfill = arrived && !(opts.autoHold && r.firstImportId === r.lastImportId);
          await tx.insert(specialAidItems).values({
            id: newId(), tenantId, dossierId, admissionId, requestId: r.id, state: arrived ? 'arrived' : 'pending', observedCategory: r.statusCategory,
            statusObservedAt: observed, arrivalObservedAt: arrived ? observed : null, isTest: actor.user.isTestTenant,
            holdNote: backfill ? BACKFILL_HOLD_NOTE : null,
          }).onConflictDoNothing();
          result.items += 1;
          if (arrived) result.arrived += 1;
          if (arrived && !backfill) arrivedIn(dossierId, vin);
          continue;
        }
        const patch: Partial<ItemRow> = { updatedAt: new Date(), version: i.version + 1 };
        if (i.observedCategory !== r.statusCategory) {
          patch.observedCategory = r.statusCategory;
          patch.statusObservedAt = r.lastReportAt;
          result.statusChanges += 1;
          if (arrived && i.state === 'pending') { patch.state = 'arrived'; patch.arrivalObservedAt = i.arrivalObservedAt ?? r.lastReportAt; result.arrived += 1; arrivedIn(i.dossierId, vin); }
        }
        await tx.update(specialAidItems).set(patch).where(and(eq(specialAidItems.id, i.id), eq(specialAidItems.version, i.version)));
        if (patch.state || patch.observedCategory) await this.audit.record(tx, actor, { entityType: 'special_aid', entityId: i.id, action: 'special_aid.status_observed', before: { category: i.observedCategory, state: i.state }, after: { category: r.statusCategory, state: patch.state ?? i.state, reportAt: r.lastReportAt.toISOString() } });
      }
      if (opts.autoHold) {
        const candidates = await tx.select({ i: specialAidItems, r: emdadRequests }).from(specialAidItems).innerJoin(emdadRequests, eq(emdadRequests.id, specialAidItems.requestId))
          .where(and(eq(specialAidItems.tenantId, tenantId), eq(specialAidItems.state, 'arrived'), isNull(emdadRequests.partRequestId), isNull(specialAidItems.holdNote)));
        for (const c of candidates) {
          const held = await this.placeHold(tx, actor, c.i, c.r);
          if (held.ok) result.held += 1; else result.holdReview += 1;
        }
      }
      // «وقتی قطعه رسید» (owner, 2026-11-28): the special-aid operators are told to invite the customer,
      // once per vehicle and day. The appointment itself is booked in ISACO, never in Manage.
      if (arrivals.size) {
        const operators = await usersWithRole(tx, tenantId, ['special_aid_operator']);
        const day = tehranDay(new Date());
        for (const [dossierId, a] of arrivals) {
          await notifyUsers(tx, tenantId, operators, { kind: 'special_aid.arrived', category: 'special_aid', title: `قطعهٔ امداد ویژه رسید · شاسی ${a.vin}`, body: `${a.count > 1 ? `${a.count} قطعه رسید. ` : ''}مشتری را تا پایان روز کاری بعد خبر و دعوت کنید؛ نوبت در سامانهٔ نوبت‌دهی کسب‌وکار ثبت می‌شود و منیج آن را از گزارش نوبت به پرونده وصل می‌کند.`, link: `/special-aid/vehicles/${dossierId}`, dedupeKey: `special-aid:arrived:${dossierId}:${day}` });
        }
        result.notified = arrivals.size;
      }
      // New admissions may identify archived cards that did not match before.
      result.cardsMatched = await this.records.retryCards(tx, tenantId);
      return result;
    });
  }

  /** Holds the exact procurement code for the VIN (never more than confirmed and available). */
  private async placeHold(tx: DbOrTx, actor: Actor, item: ItemRow, r: RequestRow, choice?: { fullStockCode?: string; locationAddress?: string }): Promise<{ ok: boolean; note: string | null }> {
    const tenantId = actor.user.tenantId;
    const o = off(r);
    const code = parseProcurementCode(choice?.fullStockCode ?? o.fullCode);
    const quantity = reportQuantity(o, 'specialQuantity');
    const fail = async (note: string) => {
      await tx.update(specialAidItems).set({ holdNote: note, updatedAt: new Date(), version: item.version + 1 }).where(and(eq(specialAidItems.id, item.id), eq(specialAidItems.version, item.version)));
      item.version += 1; item.holdNote = note;
      return { ok: false, note };
    };
    if (!code) return fail('کد تدارکاتی ۱۰ رقمی در گزارش نیست؛ کد و محل را از موجودی انتخاب کنید.');
    if (choice?.fullStockCode && assessmentCodeOf(code) !== assessmentCodeOf(o.fullCode || o.partCode)) throw badRequest('SPECIAL_AID_CODE_MISMATCH', '۸ رقم اول کد انتخابی با کد اختصاصی این قطعه یکی نیست');
    if (!quantity) return fail('تعداد اختصاصی گزارش خالی یا نامعتبر است؛ تعداد رسیده نیازمند بررسی است.');
    const [snap] = await tx.select().from(stockSnapshots).where(and(eq(stockSnapshots.tenantId, tenantId), eq(stockSnapshots.status, 'active')));
    if (!snap) return fail('گزارش موجودی ثبت نشده است؛ پس از ثبت گزارش موجودی دوباره رزرو کنید.');
    if (!snapshotInfo(snap).reservable) return fail('دامنه و معنای گزارش موجودی هنوز توسط مالک تأیید نشده است؛ رزرو فعال نیست.');
    const options = await tx.select({ loc: stockSnapshotItems.locationAddress, qty: stockSnapshotItems.quantity, sale: stockSnapshotItems.salePrice, avg: stockSnapshotItems.avgPrice }).from(stockSnapshotItems)
      .where(and(eq(stockSnapshotItems.snapshotId, snap.id), eq(stockSnapshotItems.tenantId, tenantId), eq(stockSnapshotItems.fullStockCode, code), choice?.locationAddress !== undefined ? eq(stockSnapshotItems.locationAddress, choice.locationAddress) : undefined));
    if (!options.length) return fail(`کد ${code} در گزارش موجودی فعال نیست؛ پس از گزارش موجودی بعدی دوباره بررسی کنید.`);
    const free: { loc: string; left: number; sale: string | null; avg: string | null }[] = [];
    for (const opt of options) {
      // Same lock key and availability rule as every other reservation of this code and location.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`stock:${tenantId}:${code}:${opt.loc}`}))`);
      const [s] = (await tx.execute(sql`select (${opt.qty}::numeric - coalesce((select sum(quantity) from stock_reservations where tenant_id = ${tenantId} and full_stock_code = ${code} and location_address = ${opt.loc} and (status = 'reserved' or (status = 'issued' and reflected_at is null))), 0))::text as left`) as unknown as { rows: { left: string }[] }).rows;
      const left = Math.floor(Number(s?.left ?? 0));
      if (left > 0) free.push({ loc: opt.loc, left, sale: opt.sale, avg: opt.avg });
    }
    if (!free.length) return fail(`موجودی قابل رزرو کد ${code} صفر است؛ قطعه رسیده ولی در گزارش موجودی آزاد نیست.`);
    const covering = free.filter((f) => f.left >= quantity);
    if (!choice?.locationAddress && covering.length !== 1 && free.length > 1) return fail('این کد در چند محل موجود است؛ محل را انتخاب کنید.');
    const pick = covering[0] ?? free[0]!;
    const take = Math.min(quantity, pick.left);
    const id = newId();
    await tx.insert(stockReservations).values({ id, tenantId, caseId: null, partRequestId: null, specialAidItemId: item.id, fullStockCode: code, locationAddress: pick.loc, quantity: String(take), snapshotId: snap.id, unitSalePrice: pick.sale, unitAvgPrice: pick.avg, currency: snap.currency, reservedBy: actor.user.id, isTest: actor.user.isTestTenant });
    const note = take < quantity ? `فقط ${take} از ${quantity} عدد رزرو شد؛ مانده در موجودی آزاد نیست.` : null;
    const [saved] = await tx.update(specialAidItems).set({ state: 'reserved', holdNote: note, updatedAt: new Date(), version: item.version + 1 }).where(and(eq(specialAidItems.id, item.id), eq(specialAidItems.version, item.version))).returning();
    if (!saved) throw versionConflict();
    item.version = saved.version; item.state = 'reserved';
    await this.audit.record(tx, actor, { entityType: 'special_aid', entityId: item.id, action: 'special_aid.held', after: { reservationId: id, fullStockCode: code, locationAddress: pick.loc, quantity: take, confirmed: quantity, snapshotId: snap.id }, snapshot: { version: saved.version, row: saved } });
    return { ok: true, note };
  }

  // ------------------------------------------------------------------ read model

  private async load(tenantId: string, dossierIds?: string[], canSeePhone = false, now = new Date()): Promise<Loaded[]> {
    if (dossierIds && !dossierIds.length) return [];
    const dossiers = await this.db.select().from(specialAidDossiers).where(and(eq(specialAidDossiers.tenantId, tenantId), dossierIds ? inArray(specialAidDossiers.id, dossierIds) : undefined));
    if (!dossiers.length) return [];
    const ids = dossiers.map((d) => d.id);
    const [itemRows, holds, admissions, contacts, groups, appointmentRows, appointmentLinks] = await Promise.all([
      this.db.select({ i: specialAidItems, r: emdadRequests, caseNumber: cases.caseNumber }).from(specialAidItems).innerJoin(emdadRequests, eq(emdadRequests.id, specialAidItems.requestId)).leftJoin(cases, eq(cases.id, emdadRequests.caseId))
        .where(and(eq(specialAidItems.tenantId, tenantId), inArray(specialAidItems.dossierId, ids))).orderBy(specialAidItems.createdAt, specialAidItems.id),
      this.db.select({ id: stockReservations.id, itemId: stockReservations.specialAidItemId }).from(stockReservations).innerJoin(specialAidItems, eq(specialAidItems.id, stockReservations.specialAidItemId))
        .where(and(eq(stockReservations.tenantId, tenantId), inArray(specialAidItems.dossierId, ids), inArray(stockReservations.status, HOLD_ACTIVE))),
      this.db.select().from(specialAidAdmissions).where(and(eq(specialAidAdmissions.tenantId, tenantId), inArray(specialAidAdmissions.dossierId, ids))).orderBy(specialAidAdmissions.createdAt),
      this.db.select({ c: specialAidContacts, byName: users.displayName }).from(specialAidContacts).innerJoin(users, eq(users.id, specialAidContacts.createdBy)).where(and(eq(specialAidContacts.tenantId, tenantId), inArray(specialAidContacts.dossierId, ids))).orderBy(specialAidContacts.createdAt),
      this.db.select().from(specialAidGroups).where(and(eq(specialAidGroups.tenantId, tenantId), inArray(specialAidGroups.dossierId, ids))),
      // Appointments of these vehicles in the imported ISACO list, and the operators' decisions on them (spec 29.3).
      this.db.select({ id: referenceEntries.id, vin: referenceEntries.lookupKey, data: referenceEntries.data }).from(referenceEntries)
        .where(and(eq(referenceEntries.tenantId, tenantId), eq(referenceEntries.kind, 'appointments'), inArray(referenceEntries.lookupKey, dossiers.map((d) => d.vin)))),
      this.db.select({ dossierId: specialAidAppointmentLinks.dossierId, entryId: specialAidAppointmentLinks.entryId, relation: specialAidAppointmentLinks.relation }).from(specialAidAppointmentLinks)
        .where(and(eq(specialAidAppointmentLinks.tenantId, tenantId), inArray(specialAidAppointmentLinks.dossierId, ids))),
    ]);
    const holdOf = new Map(holds.map((h) => [h.itemId!, h.id]));
    const calendar = (await calendarAt(this.db, tenantId, now.toISOString())).calendar;
    // The same few hundred days are asked for every part: one answer per day.
    const workingDays = new Map<string, boolean>();
    const working = (day: string) => { let w = workingDays.get(day); if (w === undefined) { w = isWorkingDay(day, calendar); workingDays.set(day, w); } return w; };
    const replacedBy = new Map(itemRows.filter((x) => x.i.replacesItemId).map((x) => [x.i.replacesItemId!, x.i.id]));
    const vehicleOf = await this.vehicles(tenantId, dossiers.map((d) => d.vin), canSeePhone);
    return dossiers.map((dossier) => {
      const mine = itemRows.filter((x) => x.i.dossierId === dossier.id);
      const items: SpecialAidItem[] = mine.map(({ i, r, caseNumber }) => {
        const o = off(r);
        const accident = r.partRequestId && r.matchStatus === 'matched' ? r.caseId : null;
        const receivedAt = iso(parseReportDate(o.receivedInWarehouseAt));
        const state = i.state as SpecialAidItemState;
        return {
          id: i.id, requestId: r.id, admissionId: i.admissionId, admissionNo: r.admissionNo, emdadNo: r.emdadNo,
          assessmentCode: assessmentCodeOf(o.partCode) ?? assessmentCodeOf(o.initialCode) ?? (o.partCode || null), procurementCode: o.fullCode || null,
          description: o.specialDescription || o.supplyDescription || null, quantity: o.specialQuantity || null,
          officialStatus: o.emdadStatus ?? '', officialCategory: r.statusCategory, officialRegisteredAt: iso(parseReportDate(o.emdadRegisteredAt)),
          receivedAt, arrivalObservedAt: iso(i.arrivalObservedAt), statusObservedAt: iso(i.statusObservedAt),
          state, allowedActions: accident ? [] : allowedItemActions(state),
          informedAt: iso(i.informedAt), groupId: i.groupId, nonConsumptionReason: i.nonConsumptionReason as NonConsumptionReason | null, nonConsumptionNote: i.nonConsumptionNote, requestingStation: i.requestingStation,
          holdId: holdOf.get(i.id) ?? null, holdNote: i.holdNote, accidentCaseId: accident, accidentCaseNumber: accident ? caseNumber : null,
          replacesItemId: i.replacesItemId, replacedByItemId: replacedBy.get(i.id) ?? null,
          deadline: aidDeadline({ state, receivedAt, arrivalObservedAt: iso(i.arrivalObservedAt), officialCancelled: r.statusCategory === 'cancelled' }, now, working),
          version: i.version,
        };
      });
      const facts: AidItemFacts[] = items.map((x) => ({ id: x.id, state: x.state, receivedAt: x.receivedAt, arrivalObservedAt: x.arrivalObservedAt, informedAt: x.informedAt, groupId: x.groupId, officialCancelled: x.officialCategory === 'cancelled', registeredAt: x.officialRegisteredAt }));
      // An appointment on or after the earliest waiting arrival: the operator's decision, otherwise the automatic link.
      const since = openArrivalSince(facts);
      const decided = new Map(appointmentLinks.filter((x) => x.dossierId === dossier.id).map((x) => [x.entryId, x.relation as AppointmentRelation]));
      const appts = appointmentRows.filter((a) => a.vin === dossier.vin).map((a) => { const data = a.data as Record<string, string | undefined>; return { id: a.id, at: appointmentInstant(data.appointmentDate, data.appointmentTime), relation: decided.get(a.id) ?? null }; });
      const auto = autoLinkedAppointments(appts, since);
      const linkedAppointment = !!since && appts.some((a) => a.at && tehranDay(a.at) >= tehranDay(since) && effectiveRelation(a, auto) === 'related');
      const myAdmissions = admissions.filter((a) => a.dossierId === dossier.id).map((a) => ({ id: a.id, admissionNo: a.admissionNo, admissionDate: a.admissionDate, itemCount: items.filter((x) => x.admissionId === a.id).length }));
      const vehicle = vehicleOf.get(dossier.vin) ?? { customerName: null, phone: null, model: null, plate: null };
      return {
        dossier, items, facts, admissions: myAdmissions, vehicle, isWorkingDay: working, linkedAppointment,
        contacts: contacts.filter((c) => c.c.dossierId === dossier.id).map(({ c, byName }) => ({ id: c.id, outcome: c.outcome as SpecialAidContact['outcome'], note: c.note, promisedAt: iso(c.promisedAt), itemIds: c.itemIds, byName, at: c.createdAt.toISOString() })),
        groups: groups.filter((g) => g.dossierId === dossier.id).map((g) => ({ id: g.id, label: g.label, decision: g.decision as 'wait' | 'partial' | null, itemIds: items.filter((x) => x.groupId === g.id).map((x) => x.id), version: g.version })).filter((g) => g.itemIds.length),
        search: idKey([dossier.vin, vehicle.customerName, vehicle.plate, vehicle.model, ...items.flatMap((x) => [x.emdadNo, x.admissionNo, x.assessmentCode, x.procurementCode, x.description])].filter(Boolean).join(' ')),
      };
    });
  }

  /** Customer name, model and plate from the reception records of the VIN, otherwise from an accident case. */
  private async vehicles(tenantId: string, vins: string[], canSeePhone: boolean): Promise<Map<string, SpecialAidVehicle>> {
    const out = new Map<string, SpecialAidVehicle>();
    if (!vins.length) return out;
    const refs = await this.db.select({ key: referenceEntries.lookupKey, data: referenceEntries.data }).from(referenceEntries)
      .where(and(eq(referenceEntries.tenantId, tenantId), eq(referenceEntries.kind, 'customers'), inArray(referenceEntries.lookupKey, vins))).orderBy(desc(referenceEntries.updatedAt));
    for (const r of refs) {
      if (out.has(r.key)) continue;
      const d = r.data as Record<string, string | undefined>;
      out.set(r.key, { customerName: d.fullName ?? null, phone: canSeePhone ? d.phone ?? null : maskPhone(d.phone ?? null), model: d.model ? vehicleHeadName(d.model) || d.model : null, fullModel: d.model ? [d.model, d.trim].filter(Boolean).join(' ') : null, plate: d.plate ?? null });
    }
    const missing = vins.filter((v) => !out.has(v));
    if (missing.length) {
      const own = await this.db.select({ vin: vehicles.vin, brand: vehicles.brand, model: vehicles.model, plate: vehicles.plate, name: customers.fullName, phone: customers.phone }).from(vehicles)
        .leftJoin(cases, eq(cases.vehicleId, vehicles.id)).leftJoin(customers, eq(customers.id, cases.customerId))
        .where(and(eq(vehicles.tenantId, tenantId), inArray(vehicles.vin, missing))).orderBy(desc(cases.admittedAt));
      for (const v of own) if (v.vin && !out.has(v.vin)) out.set(v.vin, { customerName: v.name, phone: canSeePhone ? v.phone : maskPhone(v.phone), model: shortVehicleName(v.brand, v.model) || null, fullModel: [v.brand, v.model].filter(Boolean).join(' ') || null, plate: v.plate });
    }
    return out;
  }

  private row(l: Loaded, now: Date): Row {
    const tasks = dossierTasks(this.factsOf(l), now);
    const active = tasks.filter((t) => !t.postponed);
    const live = new Set(l.items.filter((i) => !SPECIAL_AID_FINAL_STATES.includes(i.state) && i.officialCategory !== 'cancelled').map((i) => i.id));
    return {
      id: l.dossier.id, vin: l.dossier.vin, vehicle: l.vehicle, admissionCount: l.admissions.length,
      arrived: l.items.filter((i) => i.state !== 'pending' && i.officialCategory !== 'cancelled').length,
      pending: l.items.filter((i) => i.state === 'pending' && i.officialCategory !== 'cancelled').length,
      actionCount: active.length, urgent: active.some((t) => t.urgent), nextTask: active[0] ?? null,
      deadline: worstDeadline(l.items.map((i) => i.deadline)),
      // A failed contact matters only while a part still needs the customer.
      contactFailed: live.size > 0 && isContactFailed(l.contacts),
      lastContactAt: l.contacts.map((c) => c.at).sort().at(-1) ?? null,
      version: l.dossier.version, tasks,
    };
  }
  private factsOf(l: Loaded) {
    return { items: l.facts, contacts: l.contacts.map((c): AidContactFacts => ({ at: c.at, outcome: c.outcome, promisedAt: c.promisedAt, itemIds: c.itemIds })), groups: l.groups, postponedUntil: iso(l.dossier.postponedUntil), attendedAt: iso(l.dossier.attendedAt), isWorkingDay: l.isWorkingDay };
  }

  async list(actor: Actor, q: DossierSearchInput): Promise<Paged<SpecialAidDossierRow>> {
    this.need(actor, 'special_aid.read');
    const now = new Date();
    const term = q.q ? idKey(q.q) : '';
    // A guest searches only what a guest can see (spec 29.7): the full chassis or name never confirms a dossier.
    const masked = isGuestOnlyViewer(actor.user.roles, actor.user.isOwner);
    const rows = (await this.load(actor.user.tenantId, undefined, actor.user.permissions.has('customer.pii.read')))
      .filter((l) => !term || (masked ? guestSearchKey(l) : l.search).includes(term))
      .map((l) => ({ l, r: this.row(l, now) }))
      .filter(({ l, r }) => q.view === 'all' || (q.view === 'action' && r.actionCount > 0) || (q.view === 'arrived' && r.arrived > 0) || (q.view === 'pending' && r.pending > 0)
        || (q.view === 'review' && l.items.some((i) => !!i.holdNote))
        // The four queues of the reconstruction scenario (owner 2026-11-25).
        || ((SPECIAL_AID_QUEUES as readonly string[]).includes(q.view) && dossierQueue(l.facts, l.contacts, { linkedAppointment: l.linkedAppointment }) === q.view)
        // Colours of the 20-working-day deadline, overdue calls and failed contacts (management report links).
        || ((q.view === 'yellow' || q.view === 'red' || q.view === 'expired') && r.deadline?.level === q.view)
        || (q.view === 'calls_overdue' && overdueCall(r.tasks)) || (q.view === 'contact_failed' && r.contactFailed))
      .sort((a, b) => Number(b.r.urgent) - Number(a.r.urgent) || b.r.actionCount - a.r.actionCount || b.l.dossier.updatedAt.getTime() - a.l.dossier.updatedAt.getTime());
    const items = rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize).map(({ r }) => withoutTasks(r));
    return { items, total: rows.length, page: q.page, pageSize: q.pageSize };
  }

  /**
   * «کارهای امروز» (owner, 2026-11-28): due calls, newly arrived parts to invite and yellow/red dossiers,
   * one entry per vehicle; each task says which of the three parts it belongs to. Parts whose deadline
   * has ended are listed for the one-click release (spec 29.2).
   */
  async today(actor: Actor): Promise<SpecialAidTodayEntry[]> {
    this.need(actor, 'special_aid.read');
    const now = new Date();
    return (await this.load(actor.user.tenantId, undefined, actor.user.permissions.has('customer.pii.read'), now))
      .map((l) => ({ l, r: this.row(l, now) })).filter(({ r }) => r.tasks.some((t) => !t.postponed))
      .sort((a, b) => Number(b.r.urgent) - Number(a.r.urgent) || (a.r.nextTask?.dueAt ?? '').localeCompare(b.r.nextTask?.dueAt ?? ''))
      .map(({ l, r: { tasks, ...dossier } }) => ({
        dossier, tasks: tasks.filter((t) => !t.postponed),
        releasable: l.items.filter((i) => i.deadline?.level === 'expired' && i.allowedActions.includes('release'))
          .map((i) => ({ id: i.id, version: i.version, description: i.description, code: i.procurementCode ?? i.assessmentCode, endsAt: i.deadline!.endsAt })),
      }));
  }

  async get(actor: Actor, id: string): Promise<SpecialAidDossier> {
    this.need(actor, 'special_aid.read');
    const now = new Date();
    const [l] = await this.load(actor.user.tenantId, [id], actor.user.permissions.has('customer.pii.read'), now);
    if (!l) throw notFound('پروندهٔ امداد ویژه');
    const { tasks, ...row } = this.row(l, now);
    const tenantId = actor.user.tenantId;
    const canAppointments = actor.user.permissions.has('reference.appointments.read');
    const [appointments, cards, feedback] = await Promise.all([
      canAppointments ? this.records.appointmentsOf(tenantId, l.dossier.id, l.dossier.vin, l.dossier.attendedAt, now, openArrivalSince(l.facts)) : Promise.resolve({ appointments: [], state: 'no_report' as const }),
      this.records.cardsOf(tenantId, l.dossier.id),
      actor.user.permissions.has('special_aid.warn') || actor.user.permissions.has('special_aid.report') ? this.records.feedback(actor, { dossierId: l.dossier.id }) : Promise.resolve([]),
    ]);
    return {
      ...row, tasks, admissions: l.admissions, items: l.items, contacts: [...l.contacts].reverse(), groups: l.groups, postponedUntil: iso(l.dossier.postponedUntil), postponeReason: l.dossier.postponeReason,
      failedAttemptDays: failedAttemptDays(this.factsOf(l).contacts), unansweredStreak: unansweredStreak(l.contacts), appointments: appointments.appointments, appointmentState: appointments.state, cards, feedback,
    };
  }

  // ------------------------------------------------------------------ operator actions

  private async lockDossier(tx: DbOrTx, actor: Actor, id: string, expectedVersion?: number) {
    const [d] = await tx.select().from(specialAidDossiers).where(and(eq(specialAidDossiers.id, id), eq(specialAidDossiers.tenantId, actor.user.tenantId))).for('update');
    if (!d) throw notFound('پروندهٔ امداد ویژه');
    if (expectedVersion !== undefined && d.version !== expectedVersion) throw versionConflict(d.version);
    return d;
  }
  private async bump(tx: DbOrTx, d: typeof specialAidDossiers.$inferSelect, patch: Partial<typeof specialAidDossiers.$inferInsert> = {}) {
    const [saved] = await tx.update(specialAidDossiers).set({ ...patch, updatedAt: new Date(), version: d.version + 1 }).where(and(eq(specialAidDossiers.id, d.id), eq(specialAidDossiers.version, d.version))).returning();
    if (!saved) throw versionConflict();
    return saved;
  }
  private async itemsOf(tx: DbOrTx, actor: Actor, dossierId: string, ids: string[]) {
    const rows = await tx.select().from(specialAidItems).where(and(eq(specialAidItems.tenantId, actor.user.tenantId), eq(specialAidItems.dossierId, dossierId), inArray(specialAidItems.id, ids))).for('update');
    if (rows.length !== new Set(ids).size) throw badRequest('SPECIAL_AID_ITEMS', 'قطعه‌های انتخاب‌شده متعلق به همین خودرو نیستند');
    return rows;
  }

  /** One customer call for the vehicle, covering the chosen parts. Two unanswered calls in a row are a failed contact; management is told once. */
  async contact(actor: Actor, id: string, input: ContactInput) {
    this.need(actor, 'special_aid.operate');
    await this.db.transaction(async (tx) => {
      const d = await this.lockDossier(tx, actor, id, input.expectedVersion);
      const items = await this.itemsOf(tx, actor, id, input.itemIds);
      const now = new Date();
      const contactId = newId();
      await tx.insert(specialAidContacts).values({ id: contactId, tenantId: actor.user.tenantId, dossierId: id, outcome: input.outcome, note: input.note || null, promisedAt: input.promisedAt ? new Date(input.promisedAt) : null, itemIds: input.itemIds, createdBy: actor.user.id, isTest: actor.user.isTestTenant });
      if (!isUnreached(input.outcome)) {
        for (const i of items.filter((x) => !x.informedAt && x.state !== 'pending')) await tx.update(specialAidItems).set({ informedAt: now, updatedAt: now, version: i.version + 1 }).where(and(eq(specialAidItems.id, i.id), eq(specialAidItems.version, i.version)));
      }
      const all = (await tx.select({ at: specialAidContacts.createdAt, outcome: specialAidContacts.outcome }).from(specialAidContacts).where(and(eq(specialAidContacts.tenantId, actor.user.tenantId), eq(specialAidContacts.dossierId, id))))
        .map((c) => ({ at: c.at.toISOString(), outcome: c.outcome as ContactInput['outcome'], itemIds: [] }));
      const failed = failedAttemptDays(all);
      const streak = unansweredStreak(all);
      const patch: Partial<typeof specialAidDossiers.$inferInsert> = {};
      if (!isUnreached(input.outcome) && d.postponedUntil) { patch.postponedUntil = null; patch.postponeReason = null; }
      // «تماس ناموفق» (spec 29.5): the second unanswered call in a row; one notice per streak.
      if (isContactFailed(all) && !d.escalatedAt) {
        patch.escalatedAt = now;
        const managers = await usersWithRole(tx, actor.user.tenantId, ['service_manager']);
        const owners = await tx.select({ id: users.id }).from(users).where(and(eq(users.tenantId, actor.user.tenantId), eq(users.isOwner, true), eq(users.isActive, true)));
        await notifyUsers(tx, actor.user.tenantId, [...managers, ...owners.map((o) => o.id)], { kind: 'special_aid.escalation', urgent: true, category: 'special_aid', title: `تماس ناموفق: دو تماس بی‌پاسخ · شاسی ${d.vin}`, body: 'مشتری دو بار پشت سر هم پاسخ نداد؛ پیگیری مدیریتی لازم است. تماس ده‌روزه ادامه دارد و در پایان مهلت ۲۰ روز کاری قطعه برای آزادسازی علامت می‌خورد.', link: `/special-aid/vehicles/${id}`, dedupeKey: `special-aid:escalation:${id}:${tehranDay(now)}` });
      }
      if (!isUnreached(input.outcome)) patch.escalatedAt = null;
      const saved = await this.bump(tx, d, patch);
      await this.audit.record(tx, actor, { entityType: 'special_aid', entityId: id, action: 'special_aid.contact', after: { contactId, outcome: input.outcome, items: input.itemIds, promisedAt: input.promisedAt ?? null, failedAttemptDays: failed, unansweredStreak: streak, contactFailed: isContactFailed(all) }, snapshot: { version: saved.version, row: saved } });
    });
    return this.get(actor, id);
  }

  /** Moves the next call; compliance deadlines and age flags keep their original dates. */
  async postpone(actor: Actor, id: string, input: PostponeInput) {
    this.need(actor, 'special_aid.operate');
    const until = new Date(input.until);
    if (until.getTime() <= Date.now()) throw badRequest('SPECIAL_AID_POSTPONE_PAST', 'تاریخ تعویق باید بعد از امروز باشد');
    if (daysBetween(new Date(), until) > 60) throw badRequest('SPECIAL_AID_POSTPONE_LONG', 'پیگیری را بیش از ۶۰ روز نمی‌توان به تعویق انداخت');
    await this.db.transaction(async (tx) => {
      const d = await this.lockDossier(tx, actor, id, input.expectedVersion);
      const saved = await this.bump(tx, d, { postponedUntil: until, postponeReason: input.reason });
      await this.audit.record(tx, actor, { entityType: 'special_aid', entityId: id, action: 'special_aid.postponed', reason: input.reason, before: { postponedUntil: iso(d.postponedUntil) }, after: { postponedUntil: until.toISOString() }, snapshot: { version: saved.version, row: saved } });
    });
    return this.get(actor, id);
  }

  /** The customer came in (closes a promised visit; part states are recorded separately). */
  async attended(actor: Actor, id: string, expectedVersion: number) {
    this.need(actor, 'special_aid.operate');
    await this.db.transaction(async (tx) => {
      const d = await this.lockDossier(tx, actor, id, expectedVersion);
      const saved = await this.bump(tx, d, { attendedAt: new Date(), postponedUntil: null, postponeReason: null });
      await this.audit.record(tx, actor, { entityType: 'special_aid', entityId: id, action: 'special_aid.attended', snapshot: { version: saved.version, row: saved } });
    });
    return this.get(actor, id);
  }

  async itemAction(actor: Actor, itemId: string, input: ItemActionInput) {
    this.need(actor, input.action === 'release' ? 'special_aid.release' : 'special_aid.operate');
    const dossierId = await this.db.transaction(async (tx) => {
      const tenantId = actor.user.tenantId;
      const [i] = await tx.select().from(specialAidItems).where(and(eq(specialAidItems.id, itemId), eq(specialAidItems.tenantId, tenantId))).for('update');
      if (!i) throw notFound('قطعهٔ امداد ویژه');
      if (i.version !== input.expectedVersion) throw versionConflict(i.version);
      const [r] = await tx.select().from(emdadRequests).where(and(eq(emdadRequests.id, i.requestId), eq(emdadRequests.tenantId, tenantId)));
      if (r!.partRequestId && r!.matchStatus === 'matched') throw badRequest('SPECIAL_AID_ACCIDENT_LINE', 'این قطعه به پروندهٔ تصادفی وصل است؛ رزرو و تحویل آن در میز قطعات انجام می‌شود');
      const from = i.state as SpecialAidItemState;
      const to = nextItemState(from, input.action);
      if (!to) throw badRequest('SPECIAL_AID_ACTION', 'این اقدام در وضعیت فعلی قطعه مجاز نیست');
      const [hold] = await tx.select().from(stockReservations).where(and(eq(stockReservations.tenantId, tenantId), eq(stockReservations.specialAidItemId, i.id), inArray(stockReservations.status, HOLD_ACTIVE))).for('update');
      const now = new Date();
      if (input.action === 'reserve') {
        if (hold) throw conflict('SPECIAL_AID_HELD', 'این قطعه از قبل برای همین خودرو رزرو است');
        const res = await this.placeHold(tx, actor, i, r!, { fullStockCode: input.fullStockCode, locationAddress: input.locationAddress });
        if (!res.ok) throw badRequest('SPECIAL_AID_HOLD_FAILED', res.note ?? 'رزرو انجام نشد');
        return i.dossierId;
      }
      // An arrived part that Manage could not hold is released without a hold to free.
      if (input.action === 'deliver' || (input.action === 'release' && from !== 'arrived')) {
        if (!hold) throw badRequest('SPECIAL_AID_NO_HOLD', 'رزرو فعالی برای این قطعه نیست');
      }
      // The release records where the part stood on its 20-working-day deadline (spec 29.2: one click at the end).
      let deadline: { level: string; day: number; endsAt: string } | null = null;
      if (input.action === 'release') {
        const calendar = (await calendarAt(tx, tenantId, now.toISOString())).calendar;
        const dl = aidDeadline({ state: from, receivedAt: iso(parseReportDate(off(r!).receivedInWarehouseAt)), arrivalObservedAt: iso(i.arrivalObservedAt) }, now, (day) => isWorkingDay(day, calendar));
        deadline = dl ? { level: dl.level, day: dl.day, endsAt: dl.endsAt } : null;
      }
      // Installed completes the consumption once: an issued hold stops lowering the usable quantity
      // (the business report shows the consumption from now on). Leaving the warehouse alone never does.
      if (input.action === 'installed' && hold && (hold.status !== 'issued' || hold.reflectedAt)) throw badRequest('SPECIAL_AID_NOT_ISSUED', 'قطعه هنوز از انبار تحویل کارگاه نشده یا مصرف آن قبلاً ثبت شده است');
      const snap = input.action === 'installed' && hold ? (await tx.select({ id: stockSnapshots.id }).from(stockSnapshots).where(and(eq(stockSnapshots.tenantId, tenantId), eq(stockSnapshots.status, 'active'))))[0] : undefined;
      if (hold) {
        const holdPatch: Partial<typeof stockReservations.$inferInsert> =
          input.action === 'deliver' ? { status: 'issued', issuedAt: now, issuedBy: actor.user.id }
          : input.action === 'installed' ? { reflectedAt: now, reflectedBy: actor.user.id, reflectedSnapshotId: snap?.id ?? null }
          : input.action === 'return_to_stock_hold' ? { status: 'reserved', issuedAt: null, issuedBy: null }
          : input.action === 'release' ? { status: 'released', closedAt: now, closedBy: actor.user.id, reason: input.reason ?? null }
          : {};
        if (Object.keys(holdPatch).length) {
          const [h] = await tx.update(stockReservations).set({ ...holdPatch, updatedAt: now, version: hold.version + 1 }).where(and(eq(stockReservations.id, hold.id), eq(stockReservations.version, hold.version))).returning();
          if (!h) throw versionConflict();
        }
      }
      const [saved] = await tx.update(specialAidItems).set({ state: to, updatedAt: now, version: i.version + 1 }).where(and(eq(specialAidItems.id, i.id), eq(specialAidItems.version, i.version))).returning();
      if (!saved) throw versionConflict();
      await this.audit.record(tx, actor, { entityType: 'special_aid', entityId: i.id, action: `special_aid.${input.action}`, reason: input.reason ?? null, before: { state: from }, after: { state: to, reservationId: hold?.id ?? null, consumed: input.action === 'installed' && !!hold, ...(input.action === 'release' ? { deadline } : {}) }, snapshot: { version: saved.version, row: saved } });
      return i.dossierId;
    });
    return this.get(actor, dossierId);
  }

  /** Why the part was not used. Never releases or changes the hold. */
  async nonConsumption(actor: Actor, itemId: string, input: NonConsumptionInput) {
    this.need(actor, 'special_aid.operate');
    const dossierId = await this.db.transaction(async (tx) => {
      const [i] = await tx.select().from(specialAidItems).where(and(eq(specialAidItems.id, itemId), eq(specialAidItems.tenantId, actor.user.tenantId))).for('update');
      if (!i) throw notFound('قطعهٔ امداد ویژه');
      if (i.version !== input.expectedVersion) throw versionConflict(i.version);
      if (i.state === 'installed' && input.reason) throw badRequest('SPECIAL_AID_INSTALLED', 'قطعهٔ نصب‌شده علت مصرف‌نشدن ندارد');
      const now = new Date();
      const [saved] = await tx.update(specialAidItems).set({ nonConsumptionReason: input.reason, nonConsumptionNote: input.note || null, requestingStation: input.reason ? input.requestingStation?.trim() || null : null, nonConsumptionBy: input.reason ? actor.user.id : null, nonConsumptionAt: input.reason ? now : null, updatedAt: now, version: i.version + 1 })
        .where(and(eq(specialAidItems.id, i.id), eq(specialAidItems.version, i.version))).returning();
      if (!saved) throw versionConflict();
      await this.audit.record(tx, actor, { entityType: 'special_aid', entityId: i.id, action: 'special_aid.non_consumption', before: { reason: i.nonConsumptionReason, note: i.nonConsumptionNote, requestingStation: i.requestingStation }, after: { reason: input.reason, note: input.note ?? null, requestingStation: input.reason ? input.requestingStation?.trim() || null : null }, snapshot: { version: saved.version, row: saved } });
      return i.dossierId;
    });
    return this.get(actor, dossierId);
  }

  /** Links the corrected request to the earlier one of the same vehicle; both stay in history. */
  async replacement(actor: Actor, itemId: string, input: ReplacementInput) {
    this.need(actor, 'special_aid.operate');
    const dossierId = await this.db.transaction(async (tx) => {
      const [i] = await tx.select().from(specialAidItems).where(and(eq(specialAidItems.id, itemId), eq(specialAidItems.tenantId, actor.user.tenantId))).for('update');
      if (!i) throw notFound('قطعهٔ امداد ویژه');
      if (i.version !== input.expectedVersion) throw versionConflict(i.version);
      if (input.replacesItemId) {
        if (input.replacesItemId === i.id) throw badRequest('SPECIAL_AID_REPLACEMENT', 'یک درخواست جایگزین خودش نیست');
        const [old] = await this.itemsOf(tx, actor, i.dossierId, [input.replacesItemId]);
        if (old!.replacesItemId === i.id) throw badRequest('SPECIAL_AID_REPLACEMENT', 'این دو درخواست برعکس به هم وصل شده‌اند');
        const [taken] = await tx.select({ id: specialAidItems.id }).from(specialAidItems).where(and(eq(specialAidItems.tenantId, actor.user.tenantId), eq(specialAidItems.replacesItemId, input.replacesItemId)));
        if (taken && taken.id !== i.id) throw badRequest('SPECIAL_AID_REPLACEMENT', 'درخواست قبلی به جایگزین دیگری وصل است');
      }
      const [saved] = await tx.update(specialAidItems).set({ replacesItemId: input.replacesItemId, updatedAt: new Date(), version: i.version + 1 }).where(and(eq(specialAidItems.id, i.id), eq(specialAidItems.version, i.version))).returning();
      if (!saved) throw versionConflict();
      await this.audit.record(tx, actor, { entityType: 'special_aid', entityId: i.id, action: 'special_aid.replacement_linked', before: { replacesItemId: i.replacesItemId }, after: { replacesItemId: input.replacesItemId }, snapshot: { version: saved.version, row: saved } });
      return i.dossierId;
    });
    return this.get(actor, dossierId);
  }

  async group(actor: Actor, id: string, input: { itemIds: string[]; label?: string }) {
    this.need(actor, 'special_aid.operate');
    await this.db.transaction(async (tx) => {
      const d = await this.lockDossier(tx, actor, id);
      const items = await this.itemsOf(tx, actor, id, input.itemIds);
      if (items.some((i) => i.groupId)) throw badRequest('SPECIAL_AID_GROUPED', 'یکی از قطعه‌ها از قبل در گروه دیگری است؛ ابتدا آن گروه را باز کنید');
      const groupId = newId();
      await tx.insert(specialAidGroups).values({ id: groupId, tenantId: actor.user.tenantId, dossierId: id, label: input.label || null, createdBy: actor.user.id });
      for (const i of items) await tx.update(specialAidItems).set({ groupId, updatedAt: new Date(), version: i.version + 1 }).where(and(eq(specialAidItems.id, i.id), eq(specialAidItems.version, i.version)));
      const saved = await this.bump(tx, d);
      await this.audit.record(tx, actor, { entityType: 'special_aid', entityId: id, action: 'special_aid.grouped', after: { groupId, items: input.itemIds, label: input.label ?? null }, snapshot: { version: saved.version, row: saved } });
    });
    return this.get(actor, id);
  }

  async groupDecision(actor: Actor, groupId: string, input: { decision: 'wait' | 'partial' | null; expectedVersion: number; dissolve?: boolean }) {
    this.need(actor, 'special_aid.operate');
    const dossierId = await this.db.transaction(async (tx) => {
      const [g] = await tx.select().from(specialAidGroups).where(and(eq(specialAidGroups.id, groupId), eq(specialAidGroups.tenantId, actor.user.tenantId))).for('update');
      if (!g) throw notFound('گروه قطعات');
      if (g.version !== input.expectedVersion) throw versionConflict(g.version);
      const [saved] = await tx.update(specialAidGroups).set({ decision: input.dissolve ? g.decision : input.decision, updatedAt: new Date(), version: g.version + 1 }).where(and(eq(specialAidGroups.id, g.id), eq(specialAidGroups.version, g.version))).returning();
      if (!saved) throw versionConflict();
      if (input.dissolve) await tx.update(specialAidItems).set({ groupId: null, updatedAt: new Date(), version: sql`${specialAidItems.version} + 1` }).where(and(eq(specialAidItems.tenantId, actor.user.tenantId), eq(specialAidItems.groupId, g.id)));
      await this.audit.record(tx, actor, { entityType: 'special_aid', entityId: g.dossierId, action: input.dissolve ? 'special_aid.group_dissolved' : 'special_aid.group_decision', before: { decision: g.decision }, after: { groupId, decision: input.decision }, snapshot: { version: saved.version, row: saved } });
      return g.dossierId;
    });
    return this.get(actor, dossierId);
  }

  // ------------------------------------------------------------------ supply follow-up and reports

  async supply(actor: Actor, q: SupplySearchInput): Promise<Paged<SpecialAidSupplyRow>> {
    this.need(actor, 'special_aid.supply');
    const now = new Date();
    const rows = await this.db.select({ i: specialAidItems, r: emdadRequests, vin: specialAidDossiers.vin }).from(specialAidItems)
      .innerJoin(emdadRequests, eq(emdadRequests.id, specialAidItems.requestId)).innerJoin(specialAidDossiers, eq(specialAidDossiers.id, specialAidItems.dossierId))
      .where(and(eq(specialAidItems.tenantId, actor.user.tenantId), eq(specialAidItems.state, 'pending'))).orderBy(specialAidItems.statusObservedAt);
    const term = q.q ? idKey(q.q) : '';
    const list = rows.map(({ i, r, vin }): SpecialAidSupplyRow => {
      const o = off(r);
      const registered = parseReportDate(o.emdadRegisteredAt);
      return { itemId: i.id, dossierId: i.dossierId, vin, emdadNo: r.emdadNo, admissionNo: r.admissionNo, assessmentCode: assessmentCodeOf(o.partCode) ?? (o.partCode || null), procurementCode: o.fullCode || null, description: o.specialDescription || o.supplyDescription || null, officialStatus: o.emdadStatus ?? '', officialCategory: r.statusCategory, registeredAt: iso(registered), statusObservedAt: iso(i.statusObservedAt), idleDays: i.statusObservedAt ? Math.max(0, daysBetween(i.statusObservedAt, now)) : null };
    }).filter((x) => x.officialCategory !== 'cancelled' && x.officialCategory !== 'supplied_by_dealer'
      && (!term || idKey([x.vin, x.emdadNo, x.assessmentCode, x.procurementCode, x.description, x.admissionNo].filter(Boolean).join(' ')).includes(term))
      && (!q.status || x.officialCategory === q.status)
      && (!q.requestedFrom || (!!x.registeredAt && x.registeredAt >= q.requestedFrom)) && (!q.requestedTo || (!!x.registeredAt && x.registeredAt <= q.requestedTo))
      && (q.minIdleDays === undefined || (x.idleDays ?? 0) >= q.minIdleDays))
      .sort((a, b) => (b.idleDays ?? 0) - (a.idleDays ?? 0));
    return { items: list.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), total: list.length, page: q.page, pageSize: q.pageSize };
  }

  /** Excel for the company: official text and dates kept apart from Manage's observation dates. */
  async supplyExport(actor: Actor, q: SupplySearchInput) {
    const all = (await this.supply(actor, { ...q, page: 1, pageSize: 200 }));
    const items = [...all.items];
    for (let page = 2; items.length < all.total && page <= 100; page++) items.push(...(await this.supply(actor, { ...q, page, pageSize: 200 })).items);
    const day = (v: string | null) => (v ? tehranDay(v) : '');
    return writeSheet('پیگیری تأمین امداد ویژه', [
      ['شمارهٔ امداد ویژه', 'شاسی (VIN)', 'پذیرش', 'کد اختصاصی', 'کد تدارکاتی', 'شرح', 'وضعیت رسمی (متن گزارش)', 'تاریخ ثبت امداد (رسمی)', 'نخستین مشاهدهٔ این وضعیت در منیج', 'روز بدون تغییر مشاهده‌شده'],
      ...items.map((x) => [safeCell(x.emdadNo ?? ''), safeCell(x.vin), safeCell(x.admissionNo ?? ''), safeCell(x.assessmentCode ?? ''), safeCell(x.procurementCode ?? ''), safeCell(x.description ?? ''), safeCell(x.officialStatus), day(x.registeredAt), day(x.statusObservedAt), x.idleDays ?? '']),
    ]);
  }

  /**
   * Inspection file of one vehicle (reconstruction scenario, owner 2026-11-25) for Iran Khodro
   * inspectors: every part with its official and internal dates and state, every contact, and the
   * audit trail of the dossier and its parts with time and user. No phone number is written.
   */
  async inspectionExport(actor: Actor, id: string): Promise<{ vin: string; bytes: Uint8Array }> {
    const d = await this.get(actor, id);
    const day = (v: string | null | undefined) => (v ? tehranDay(v) : '');
    const at = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '');
    const cell = (v: string | null | undefined) => safeCell(v ?? '');
    const history = await this.db.select({ at: auditEvents.occurredAt, action: auditEvents.action, entityId: auditEvents.entityId, reason: auditEvents.reason, by: users.displayName }).from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorUserId))
      .where(and(eq(auditEvents.tenantId, actor.user.tenantId), eq(auditEvents.entityType, 'special_aid'), inArray(auditEvents.entityId, [d.id, ...d.items.map((i) => i.id)])))
      .orderBy(asc(auditEvents.occurredAt));
    const partName = new Map(d.items.map((i) => [i.id, [i.description, i.assessmentCode].filter(Boolean).join(' · ')]));
    const bytes = writeWorkbook([
      { name: 'قطعات', rows: [
        ['شاسی (VIN)', 'شمارهٔ امداد ویژه', 'پذیرش', 'کد اختصاصی', 'کد تدارکاتی', 'شرح', 'تعداد', 'وضعیت رسمی', 'ثبت رسمی', 'رسید انبار (رسمی)', 'نخستین مشاهدهٔ رسیدن', 'اطلاع به مشتری', 'وضعیت داخلی', 'علت مصرف‌نشدن', 'توضیح', 'جایگاه درخواست‌دهنده', 'پروندهٔ تصادفی'],
        ...d.items.map((i) => [cell(d.vin), cell(i.emdadNo), cell(i.admissionNo), cell(i.assessmentCode), cell(i.procurementCode), cell(i.description), cell(i.quantity), cell(i.officialStatus), day(i.officialRegisteredAt), day(i.receivedAt), day(i.arrivalObservedAt), day(i.informedAt),
          SPECIAL_AID_ITEM_STATE_LABELS[i.state] ?? i.state, i.nonConsumptionReason ? NON_CONSUMPTION_LABELS[i.nonConsumptionReason] : '', cell(i.nonConsumptionNote), cell(i.requestingStation), cell(i.accidentCaseNumber)]),
      ] },
      { name: 'تماس‌ها', rows: [
        ['زمان', 'کاربر', 'نتیجه', 'قطعه‌ها', 'زمان قول مراجعه', 'یادداشت'],
        ...[...d.contacts].reverse().map((c) => [at(c.at), cell(c.byName), CONTACT_OUTCOME_LABELS[c.outcome] ?? c.outcome, cell(c.itemIds.map((x) => partName.get(x) ?? '').filter(Boolean).join('، ')), at(c.promisedAt), cell(c.note)]),
      ] },
      { name: 'سابقه', rows: [
        ['زمان', 'کاربر', 'اقدام', 'قطعه', 'علت'],
        ...history.map((h) => [at(h.at), cell(h.by ?? 'سامانه'), h.action, cell(partName.get(h.entityId) ?? ''), cell(h.reason)]),
      ] },
    ]);
    return { vin: d.vin, bytes };
  }

  async summary(actor: Actor, period: { from?: string; to?: string } = {}): Promise<SpecialAidSummary> {
    this.need(actor, 'special_aid.report');
    const now = new Date();
    const loaded = await this.load(actor.user.tenantId, undefined, false, now);
    const items = loaded.flatMap((l) => l.items).filter((i) => i.officialCategory !== 'cancelled');
    const reasons = Object.fromEntries(NON_CONSUMPTION_REASONS.map((r) => [r, 0])) as Record<NonConsumptionReason, number>;
    for (const i of items) if (i.nonConsumptionReason) reasons[i.nonConsumptionReason] += 1;
    const supplyDays = items.map((i) => (i.receivedAt && i.officialRegisteredAt ? daysBetween(i.officialRegisteredAt, i.receivedAt) : null)).filter((x): x is number => x != null && x >= 0);
    // Contact compliance: arrived parts whose first announcement was due; on time = by the end of the next working day.
    const working = loaded[0]?.isWorkingDay;
    let due = 0, onTime = 0;
    for (const i of items) {
      const start = i.receivedAt ?? i.arrivalObservedAt;
      if (!start || i.state === 'pending') continue;
      const deadline = endOfNextWorkingDay(start, working).toISOString();
      if (deadline > now.toISOString() && !i.informedAt) continue;
      due += 1;
      if (i.informedAt && i.informedAt <= deadline) onTime += 1;
    }
    const stalled = loaded.flatMap((l) => l.items).filter((i) => i.state === 'pending' && !['cancelled', 'supplied_by_dealer'].includes(i.officialCategory) && !!i.statusObservedAt && daysBetween(i.statusObservedAt, now) >= SPECIAL_AID_STALLED_DAYS).length;
    const fb = await this.records.openFeedbackCounts(actor.user.tenantId);
    const weekKey = (v: string) => { const d = new Date(tehranDay(v)); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 1) % 7)); return d.toISOString().slice(0, 10); };
    const weeks = new Map<string, { week: string; registered: number; arrived: number; installed: number }>();
    const bucket = (v: string | null, k: 'registered' | 'arrived' | 'installed') => { if (!v || daysBetween(v, now) > 7 * 8) return; const w = weekKey(v); const e = weeks.get(w) ?? { week: w, registered: 0, arrived: 0, installed: 0 }; e[k] += 1; weeks.set(w, e); };
    for (const i of items) { bucket(i.officialRegisteredAt, 'registered'); bucket(i.receivedAt ?? i.arrivalObservedAt, 'arrived'); }
    // Dossier colours of the 20-working-day deadline, overdue calls and failed contacts (owner, 2026-11-28).
    const rows = loaded.map((l) => this.row(l, now));
    const colour = (level: 'yellow' | 'red' | 'expired') => rows.filter((r) => r.deadline?.level === level).length;
    return {
      total: items.length,
      pending: items.filter((i) => i.state === 'pending').length,
      deadline: { yellow: colour('yellow'), red: colour('red'), expired: colour('expired') },
      overdueCalls: rows.filter((r) => overdueCall(r.tasks)).length,
      contactFailed: rows.filter((r) => r.contactFailed).length,
      arrivedUnused: items.filter((i) => ['arrived', 'reserved', 'delivered', 'installation_pending', 'not_installed'].includes(i.state)).length,
      reserved: items.filter((i) => !!i.holdId).length,
      released: items.filter((i) => i.state === 'released').length,
      installed: items.filter((i) => i.state === 'installed').length,
      reasons,
      contactCompliance: { due, onTime },
      averageSupplyDays: supplyDays.length ? Math.round((supplyDays.reduce((a, b) => a + b, 0) / supplyDays.length) * 10) / 10 : null,
      unresolvedTechnical: items.filter((i) => i.nonConsumptionReason && TECHNICAL_REASONS.includes(i.nonConsumptionReason) && !SPECIAL_AID_FINAL_STATES.includes(i.state)).length,
      weekly: [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week)),
      stalledSupply: stalled,
      feedbackOpen: fb.open,
      warningsIssued: fb.warnings,
      funnel: this.funnel(loaded, period),
    };
  }

  /**
   * Customer (vehicle) and part funnels. A part belongs to the period by its official registration
   * day (Tehran); a vehicle when at least one of its parts does. Cancelled requests are left out.
   */
  private funnel(loaded: Loaded[], period: { from?: string; to?: string }): SpecialAidFunnel {
    const inPeriod = (i: SpecialAidItem) => {
      if (i.officialCategory === 'cancelled') return false;
      const day = i.officialRegisteredAt ? tehranDay(i.officialRegisteredAt) : null;
      if (!period.from && !period.to) return true;
      if (!day) return false;
      return (!period.from || day >= period.from) && (!period.to || day <= period.to);
    };
    const arrivedState = (i: SpecialAidItem) => i.state !== 'pending';
    const openArrived = (i: SpecialAidItem) => ['arrived', 'reserved', 'delivered', 'installation_pending', 'not_installed'].includes(i.state);
    const c = { registered: 0, arrived: 0, informed: 0, invited: 0, attended: 0, installed: 0, releasedNoShow: 0, arrivedNotInformed: 0, pastDeadlineNoVisit: 0 };
    const p = { requested: 0, pending: 0, arrived: 0, installed: 0, releasedToOthers: 0, arrivedOpen: 0 };
    for (const l of loaded) {
      const items = l.items.filter(inPeriod);
      if (!items.length) continue;
      const ids = new Set(items.map((i) => i.id));
      const contacts = l.contacts.filter((x) => x.itemIds.some((id) => ids.has(id)));
      const installed = items.some((i) => i.state === 'installed');
      const attended = !!l.dossier.attendedAt || installed || items.some((i) => ['delivered', 'installation_pending'].includes(i.state));
      c.registered += 1;
      if (items.some(arrivedState)) c.arrived += 1;
      if (items.some((i) => i.informedAt) || contacts.some((x) => !isUnreached(x.outcome))) c.informed += 1;
      if (contacts.some((x) => x.outcome === 'appointment_coordinated' || x.outcome === 'promised_visit')) c.invited += 1;
      if (attended) c.attended += 1;
      if (installed) c.installed += 1;
      if (!attended && items.some((i) => i.state === 'released')) c.releasedNoShow += 1;
      const open = items.filter(openArrived);
      if (open.some((i) => !i.informedAt)) c.arrivedNotInformed += 1;
      if (!attended && open.some((i) => i.deadline?.level === 'expired')) c.pastDeadlineNoVisit += 1;
      for (const i of items) {
        p.requested += 1;
        if (i.state === 'pending') p.pending += 1; else p.arrived += 1;
        if (i.state === 'installed') p.installed += 1;
        if (i.state === 'released') p.releasedToOthers += 1;
        if (openArrived(i)) p.arrivedOpen += 1;
      }
    }
    return { period: { from: period.from ?? null, to: period.to ?? null }, customers: c, parts: p };
  }

  /**
   * «پایان مهلت» (spec 29.2): when the 20th working day of a waiting part has ended, the special-aid
   * operators and system administrators are told once per vehicle and deadline day. Nothing is released
   * here: the release stays one click of an authorized person. Only deadlines that ended in the last
   * few days are announced, so old parts never flood the bell; they stay visible in «کارهای امروز».
   */
  async deadlineSweep(now = new Date()): Promise<number> {
    let sent = 0;
    for (const t of await this.db.select({ id: tenants.id }).from(tenants)) {
      const calendar = (await calendarAt(this.db, t.id, now.toISOString())).calendar;
      if (!isWorkingDay(tehranDay(now), calendar)) continue;
      const due = (await this.load(t.id, undefined, false, now)).map((l) => ({ l, items: l.items.filter((i) => i.deadline?.level === 'expired' && now.getTime() - Date.parse(i.deadline.endsAt) < 4 * 86_400_000) })).filter((x) => x.items.length);
      if (!due.length) continue;
      await this.db.transaction(async (tx) => {
        const recipients = await usersWithRole(tx, t.id, ['special_aid_operator', 'system_admin']);
        for (const { l, items } of due) {
          const day = tehranDay(items.map((i) => i.deadline!.endsAt).sort()[0]!);
          const notice = {
            kind: 'special_aid.deadline', urgent: true, category: 'special_aid', link: `/special-aid/vehicles/${l.dossier.id}`, dedupeKey: `special-aid:deadline:${l.dossier.id}:${day}`,
            title: `${AID_DEADLINE_LABELS.expired} · شاسی ${l.dossier.vin}`,
            body: `${items.length > 1 ? `${items.length} قطعهٔ` : 'قطعهٔ'} این خودرو ۲۰ روز کاری پس از رسیدن هنوز تعیین تکلیف نشده؛ با یک کلیک برای مشتری دیگر آزاد کنید یا علت را ثبت کنید. آزادسازی خودکار انجام نمی‌شود.`,
          };
          const rows = recipients.map((userId) => ({ id: newId(), tenantId: t.id, userId, ...notice }));
          if (rows.length) sent += (await tx.insert(notifications).values(rows).onConflictDoNothing().returning({ id: notifications.id })).length;
        }
      });
    }
    return sent;
  }

  /** Called after an Emdad report was published (its own transaction; the report stays published). */
  async afterEmdadPublished(actor: Actor) {
    try { return await this.sync(actor, { autoHold: true }); }
    catch (e) { this.log.error({ err: e instanceof Error ? e.message : String(e) }, 'special-aid sync after publish failed'); return null; }
  }
}

