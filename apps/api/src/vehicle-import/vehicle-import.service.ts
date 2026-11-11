import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import {
  VEHICLE_IMPORT_OUTCOMES,
  VEHICLE_IMPORT_OUTCOME_LABELS,
  formatJalali,
  normalizePersian,
  searchKey,
  toJalaliParts,
  type CaseProvenance,
  type CaseStage,
  type CoverageType,
  type CreateCaseInput,
  normalizeRoles,
  type Role,
  type UpdateCaseInput,
  type VehicleImport,
  type VehicleImportChange,
  type VehicleImportDecisions,
  type VehicleImportInput,
  type VehicleImportMessage,
  type VehicleImportOutcome,
} from '@manage/shared';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../auth/auth.types';
import { CasesService, type CaseImportFields } from '../cases/cases.service';
import { AppError, badRequest, conflict, notFound } from '../common/errors';
import { newId } from '../common/ids';
import { DATABASE, type DatabaseHandle } from '../db/database';
import { cases, customers, departments, tasks, users, vehicleImportRows, vehicleImports, vehicles } from '../db/schema';
import { writeSheet } from '../parts/xlsx';
import { TasksService } from '../tasks/tasks.service';
import {
  formatSheetDate,
  idKey,
  isFullVin,
  isNonUniqueAdmission,
  normalizeCaseNumber,
  parseCoverage,
  parseSheetDate,
  parseSheetTime,
  parseStage,
  parseVehicleWorkbook,
  SheetError,
  toInstant,
  type ColumnKey,
  type SheetDate,
} from './vehicle-sheet';

const MAX_ROWS = 1000;
const RESPONSIBLE_ROLES: Role[] = ['accident_expert', 'service_manager'];
// Stages reached only through their own workflow (QC/technical close, handover).
const WORKFLOW_ONLY: CaseStage[] = ['ready_for_delivery', 'delivered'];

type Values = Partial<Record<ColumnKey, string>>;
interface RowInput {
  rowNo: number;
  source: Record<string, string>;
  values: Values;
}
interface Plan {
  rowNo: number;
  source: Record<string, string>;
  values: Values;
  outcome: VehicleImportOutcome;
  identity: string | null;
  caseId: string | null;
  caseNumber: string | null;
  changes: VehicleImportChange[];
  messages: VehicleImportMessage[];
  create?: { input: CreateCaseInput; extra: CaseImportFields };
  update?: { caseId: string; version: number; input: Omit<UpdateCaseInput, 'expectedVersion'>; extra: CaseImportFields; stage?: CaseStage };
  task?: { departmentId: string; title: string; importRef: string };
}

const emptyCounts = () =>
  Object.fromEntries(VEHICLE_IMPORT_OUTCOMES.map((o) => [o, 0])) as Record<VehicleImportOutcome, number>;
const countOf = (plans: { outcome: VehicleImportOutcome }[]) => {
  const c = emptyCounts();
  for (const p of plans) c[p.outcome] += 1;
  return c;
};
const tehranDay = (d: Date) => {
  const p = toJalaliParts(d);
  return `${p.jy}/${String(p.jm).padStart(2, '0')}/${String(p.jd).padStart(2, '0')}`;
};
/** Same text after Persian normalization (digits, letter variants, spacing), as stored values are normalized. */
const same = (file: string, stored: string | null | undefined) => normalizePersian(file) === normalizePersian(stored ?? '');
const short = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 12);

/**
 * Import of the existing-vehicles sheet. Preview first (nothing written to
 * cases), then apply, which re-evaluates every row against the current data.
 * Matching uses only unique identifiers: Manage case number, full VIN,
 * admission card number, the sheet's chassis number. Owner name or row number
 * never decide a match. Empty cells never clear existing values.
 */
@Injectable()
export class VehicleImportService {
  constructor(
    @Inject(DATABASE) private readonly handle: DatabaseHandle,
    private readonly audit: AuditService,
    private readonly cases: CasesService,
    private readonly tasks: TasksService,
  ) {}

  private get db() {
    return this.handle.db;
  }

  // ---------------------------------------------------------------- commands

  async preview(actor: Actor, input: VehicleImportInput): Promise<VehicleImport> {
    const data = Buffer.from(input.fileBase64, 'base64');
    let sheet;
    try {
      sheet = parseVehicleWorkbook(new Uint8Array(data));
    } catch (e) {
      throw badRequest('IMPORT_FILE_INVALID', e instanceof SheetError ? e.message : 'فایل اکسل خوانده نشد');
    }
    if (!sheet.rows.length) throw badRequest('IMPORT_EMPTY', 'در برگه خودروها ردیفی برای ورود پیدا نشد');
    if (sheet.rows.length > MAX_ROWS) {
      throw badRequest('IMPORT_TOO_LARGE', `حداکثر ${MAX_ROWS} ردیف در هر فایل پذیرفته می‌شود`);
    }
    const rows: RowInput[] = sheet.rows.map((r) => ({
      rowNo: r.rowNo,
      source: r.source,
      values: Object.fromEntries(
        (Object.keys(sheet.columns) as ColumnKey[]).map((k) => [k, r.get(k)]).filter(([, v]) => v),
      ),
    }));
    const plans = await this.plan(actor, rows, input.decisions);
    const id = newId();
    await this.db.transaction(async (tx) => {
      await tx.insert(vehicleImports).values({
        id,
        tenantId: actor.user.tenantId,
        fileName: input.fileName,
        fileSha256: createHash('sha256').update(data).digest('hex'),
        sheetName: sheet.sheetName,
        headerRow: sheet.headerRow,
        decisions: input.decisions,
        counts: countOf(plans),
        blankRows: sheet.blankRows,
        unmappedColumns: sheet.unmappedColumns,
        isTest: actor.user.isTestTenant,
        createdBy: actor.user.id,
      });
      await tx.insert(vehicleImportRows).values(
        plans.map((p) => ({
          id: newId(),
          importId: id,
          tenantId: actor.user.tenantId,
          rowNo: p.rowNo,
          outcome: p.outcome,
          source: p.source,
          values: p.values,
          identity: p.identity,
          caseId: p.caseId,
          caseNumber: p.caseNumber,
          changes: p.changes,
          messages: p.messages,
          isTest: actor.user.isTestTenant,
        })),
      );
    });
    return this.get(actor, id);
  }

  /**
   * Applies a preview. Each row is written in its own transaction(s) and its
   * result recorded right away, so a failure stops only that row; the import
   * is then "partial" and re-importing the file continues without duplicates.
   */
  async apply(actor: Actor, importId: string): Promise<VehicleImport> {
    const tenantId = actor.user.tenantId;
    const [claimed] = await this.db
      .update(vehicleImports)
      .set({ status: 'applying' })
      .where(and(eq(vehicleImports.id, importId), eq(vehicleImports.tenantId, tenantId), eq(vehicleImports.status, 'preview')))
      .returning();
    if (!claimed) {
      const [exists] = await this.db
        .select({ status: vehicleImports.status })
        .from(vehicleImports)
        .where(and(eq(vehicleImports.id, importId), eq(vehicleImports.tenantId, tenantId)));
      if (!exists) throw notFound('ورود اکسل');
      throw conflict('IMPORT_NOT_PREVIEW', 'این پیش‌نمایش قبلاً ثبت شده است؛ برای ورود دوباره، فایل را دوباره بارگذاری کنید');
    }
    const stored = await this.db
      .select()
      .from(vehicleImportRows)
      .where(eq(vehicleImportRows.importId, importId))
      .orderBy(vehicleImportRows.rowNo);
    const plans = await this.plan(
      actor,
      stored.map((r) => ({ rowNo: r.rowNo, source: r.source as Record<string, string>, values: r.values as Values })),
      claimed.decisions as VehicleImportDecisions,
    );

    let failed = 0;
    for (const p of plans) {
      if (p.outcome === 'new' || p.outcome === 'update') {
        try {
          const done = await this.applyRow(actor, p, claimed.fileName);
          p.caseId = done.id;
          p.caseNumber = done.caseNumber;
        } catch (e) {
          failed += 1;
          p.outcome = 'error';
          p.messages.push({
            level: 'error',
            text: `ثبت این ردیف ناموفق بود: ${e instanceof AppError ? errorText(e) : 'خطای داخلی؛ ردیف‌های دیگر ثبت شدند و می‌توانید دوباره تلاش کنید'}`,
          });
        }
      }
      await this.db
        .update(vehicleImportRows)
        .set({ outcome: p.outcome, identity: p.identity, caseId: p.caseId, caseNumber: p.caseNumber, changes: p.changes, messages: p.messages })
        .where(and(eq(vehicleImportRows.importId, importId), eq(vehicleImportRows.rowNo, p.rowNo)));
    }

    const counts = countOf(plans);
    await this.db.transaction(async (tx) => {
      await tx
        .update(vehicleImports)
        .set({ status: failed ? 'partial' : 'applied', counts, appliedAt: new Date(), appliedBy: actor.user.id })
        .where(eq(vehicleImports.id, importId));
      await this.audit.record(tx, actor, {
        entityType: 'case',
        entityId: importId,
        action: 'vehicle_import.applied',
        reason: claimed.fileName,
        after: { counts, failed },
      });
    });
    return this.get(actor, importId);
  }

  private async applyRow(actor: Actor, p: Plan, fileName: string): Promise<{ id: string; caseNumber: string }> {
    const reason = `ورود اکسل «${fileName}» ردیف ${p.rowNo}`;
    let id: string;
    let caseNumber: string;
    if (p.create) {
      try {
        const created = await this.cases.create(actor, p.create.input, p.create.extra);
        id = created.id;
        caseNumber = created.caseNumber;
      } catch (e) {
        // A case with this identity already exists (e.g. an interrupted earlier apply): never create a second one.
        const [existing] = p.identity
          ? await this.db
              .select({ id: cases.id, caseNumber: cases.caseNumber })
              .from(cases)
              .where(and(eq(cases.tenantId, actor.user.tenantId), eq(cases.importKey, p.identity)))
          : [];
        if (!existing) throw e;
        id = existing.id;
        caseNumber = existing.caseNumber;
        p.outcome = 'unchanged';
        p.messages.push({ level: 'info', text: 'پرونده این ردیف قبلاً ساخته شده بود؛ پرونده دوم ساخته نشد' });
      }
    } else {
      const u = p.update!;
      id = u.caseId;
      caseNumber = p.caseNumber!;
      let version = u.version;
      if (Object.keys(u.input).length || Object.keys(u.extra).length) {
        version = (await this.cases.update(actor, id, { ...u.input, expectedVersion: version, reason }, u.extra)).version;
      }
      if (u.stage) await this.cases.changeStage(actor, id, { stage: u.stage, expectedVersion: version, note: reason });
    }
    if (p.task) {
      const [exists] = await this.db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.caseId, id), eq(tasks.importRef, p.task.importRef)));
      if (!exists) {
        await this.tasks.create(actor, id, { departmentId: p.task.departmentId, title: p.task.title, weight: 1 }, p.task.importRef);
      }
    }
    return { id, caseNumber };
  }

  // -------------------------------------------------------------- planning

  private async plan(actor: Actor, rows: RowInput[], decisions: VehicleImportDecisions): Promise<Plan[]> {
    const tenantId = actor.user.tenantId;
    const people = await this.db
      .select({ id: users.id, displayName: users.displayName, roles: users.roles })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.isActive, true)));
    const responsible = people.filter((u) => normalizeRoles(u.roles).some((r) => RESPONSIBLE_ROLES.includes(r)));
    const units = await this.db
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(and(eq(departments.tenantId, tenantId), eq(departments.isActive, true)));

    const plans = rows.map((r) => this.readRow(r));

    // Duplicates inside the file, per unique identifier.
    const keyed: [string, (p: Plan) => string | null][] = [
      ['شماره پرونده Manage', (p) => (p.values.caseNumber ? normalizeCaseNumber(p.values.caseNumber) : null)],
      ['VIN', (p) => (p.values.vin ? idKey(p.values.vin) : null)],
      ['شماره کارت پذیرش', (p) => admissionKeyOf(p.values.admissionNo)],
      ['شماره شاسی', (p) => (p.values.chassis ? idKey(p.values.chassis) : null)],
    ];
    for (const [label, keyOf] of keyed) {
      const groups = new Map<string, Plan[]>();
      for (const p of plans) {
        const k = keyOf(p);
        if (k) groups.set(k, [...(groups.get(k) ?? []), p]);
      }
      for (const group of groups.values()) {
        if (group.length < 2) continue;
        for (const p of group) {
          if (p.outcome !== 'error') p.outcome = 'duplicate';
          p.messages.push({
            level: 'error',
            text: `${label} تکراری در ردیف‌های ${group.map((g) => g.rowNo).join('، ')}؛ هر خودرو فقط یک ردیف داشته باشد`,
          });
        }
      }
    }

    for (const p of plans) {
      if (p.outcome !== 'new') continue; // 'new' = still open after the file-only checks
      await this.matchRow(p, tenantId, decisions, responsible, units);
    }
    return plans;
  }

  /** File-only checks: formats, identifiers and what is kept without a destination. */
  private readRow(r: RowInput): Plan {
    const v = r.values;
    const p: Plan = { ...r, outcome: 'new', identity: null, caseId: null, caseNumber: null, changes: [], messages: [] };
    const err = (text: string) => {
      p.outcome = 'error';
      p.messages.push({ level: 'error', text });
    };
    if (v.admissionNo && isNonUniqueAdmission(v.admissionNo)) {
      p.messages.push({ level: 'info', text: `«${v.admissionNo}» شماره پذیرش یکتا نیست و برای تطبیق استفاده نمی‌شود` });
    }
    if (v.chassis && !isFullVin(idKey(v.chassis))) {
      p.messages.push({ level: 'info', text: 'شماره شاسی ثبت‌شده VIN کامل نیست؛ فقط به‌عنوان شاسی ثبت‌شده نگهداری می‌شود' });
    }
    if (v.vin && !isFullVin(idKey(v.vin))) err('VIN کامل نامعتبر است (۱۷ نویسه، بدون I، O و Q)');
    if (v.caseNumber && !/^AC-\d{4}-\d{4,}$/.test(normalizeCaseNumber(v.caseNumber))) err('شماره پرونده Manage قالب معتبر ندارد (مثل AC-1405-0012)');
    if (v.admittedDate && parseSheetDate(v.admittedDate) === 'invalid') err('تاریخ پذیرش قابل خواندن نیست (مثل ۱۴۰۵/۰۸/۰۵)');
    if (v.admittedTime && parseSheetTime(v.admittedTime) === 'invalid') err('ساعت پذیرش قابل خواندن نیست (مثل ۰۸:۳۰)');
    if (v.deadlineDate && parseSheetDate(v.deadlineDate) === 'invalid') err('موعد تحویل قابل خواندن نیست');
    if (v.deadlineTime && parseSheetTime(v.deadlineTime) === 'invalid') err('ساعت موعد تحویل قابل خواندن نیست');
    if (v.stage && parseStage(v.stage) === 'invalid') err(`وضعیت فعلی تعمیر «${v.stage}» با مراحل Manage مطابقت ندارد`);
    if (v.coverageType && parseCoverage(v.coverageType) === 'invalid') err(`نوع پوشش «${v.coverageType}» شناخته نشد`);
    const vin = v.vin && isFullVin(idKey(v.vin)) ? idKey(v.vin) : null;
    const adm = admissionKeyOf(v.admissionNo);
    const chs = v.chassis ? idKey(v.chassis) : null;
    p.identity = vin ? `vin:${vin}` : adm ? `adm:${adm}` : chs ? `chs:${chs}` : null;
    const kept = (['blocker', 'blockingPart', 'partsStatus', 'authStatus', 'financeStatus', 'lastFollowUp', 'notes', 'extraNote'] as const).filter(
      (k) => v[k],
    );
    if (kept.length) {
      p.messages.push({
        level: 'info',
        text: 'توضیحات، مانع، قطعه، مجوز و وضعیت مالی فایل در سابقه ورود همین پرونده حفظ می‌شوند؛ زمان واقعی بروز ساخته نمی‌شود و ثبت مانع یا قطعه از بخش مربوط انجام شود',
      });
    }
    return p;
  }

  private async matchRow(
    p: Plan,
    tenantId: string,
    decisions: VehicleImportDecisions,
    responsible: { id: string; displayName: string }[],
    units: { id: string; name: string }[],
  ) {
    const v = p.values;
    const vin = v.vin ? idKey(v.vin) : null;
    const adm = admissionKeyOf(v.admissionNo);
    const chs = v.chassis ? idKey(v.chassis) : null;
    const review = (text: string) => {
      p.outcome = 'needs_review';
      p.messages.push({ level: 'warning', text });
    };

    // Candidates: by case number, or by unique identifiers (never by name or row number).
    let target: typeof cases.$inferSelect | undefined;
    if (v.caseNumber) {
      [target] = await this.db
        .select()
        .from(cases)
        .where(and(eq(cases.tenantId, tenantId), eq(cases.caseNumber, normalizeCaseNumber(v.caseNumber))));
      if (!target) {
        p.outcome = 'error';
        p.messages.push({ level: 'error', text: `پرونده ${v.caseNumber} در این نمایندگی پیدا نشد` });
        return;
      }
    }
    const keys = [vin && `vin:${vin}`, adm && `adm:${adm}`, chs && `chs:${chs}`].filter((k): k is string => !!k);
    const conditions = [
      keys.length ? inArray(cases.importKey, keys) : undefined,
      adm ? eq(cases.admissionNoKey, adm) : undefined,
      vin ? eq(vehicles.vin, vin) : undefined,
    ].filter((c) => !!c);
    const found = conditions.length
      ? await this.db
          .selectDistinct({ c: cases })
          .from(cases)
          .innerJoin(vehicles, eq(vehicles.id, cases.vehicleId))
          .where(and(eq(cases.tenantId, tenantId), or(...conditions)))
      : [];
    const others = found.map((f) => f.c).filter((c) => c.id !== target?.id);
    if (target && others.length) {
      review(`شناسه‌های این ردیف با پرونده دیگری (${others.map((c) => c.caseNumber).join('، ')}) هم مطابقت دارد`);
      return;
    }
    if (!target && others.length > 1) {
      review(`چند پرونده با شناسه‌های این ردیف مطابقت دارد: ${others.map((c) => c.caseNumber).join('، ')}`);
      return;
    }
    target ??= others[0];

    // Values that are the same for create and update.
    const date = v.admittedDate ? (parseSheetDate(v.admittedDate) as SheetDate) : null;
    const time = v.admittedTime ? (parseSheetTime(v.admittedTime) as string) : null;
    // Format errors were rejected in readRow, so these parses are valid here.
    const coverage = v.coverageType ? (parseCoverage(v.coverageType) as CoverageType) : null;
    const stage = v.stage ? (parseStage(v.stage) as CaseStage) : null;
    let responsibleId: string | null = null;
    if (v.responsible) {
      const hits = responsible.filter((u) => searchKey(u.displayName) === searchKey(v.responsible!));
      if (hits.length === 1) responsibleId = hits[0]!.id;
      else {
        p.messages.push({
          level: 'warning',
          text: hits.length
            ? `چند حساب با نام «${v.responsible}» هست؛ مسئول خالی ماند`
            : `مسئول «${v.responsible}» بین حساب‌های مجاز Manage پیدا نشد؛ مسئول خالی ماند`,
        });
      }
    }
    let deadline: Date | null = null;
    if (v.deadlineDate) {
      const dd = parseSheetDate(v.deadlineDate) as SheetDate;
      const dt = v.deadlineTime ? (parseSheetTime(v.deadlineTime) as string) : null;
      if (decisions.deadlineAs === 'none') {
        p.messages.push({ level: 'info', text: 'موعد تحویل فایل ثبت نشد (نوع موعد انتخاب نشده)؛ در سابقه ورود حفظ شد' });
      } else if (!dt) {
        p.messages.push({ level: 'warning', text: 'موعد تحویل ساعت ندارد؛ ساعت ساخته نمی‌شود و موعد ثبت نشد' });
      } else deadline = toInstant(dd, dt);
    }
    let task: Plan['task'];
    if (v.nextAction) {
      const unit = v.unit ? units.find((u) => searchKey(u.name) === searchKey(v.unit!)) : undefined;
      if (unit) {
        task = { departmentId: unit.id, title: v.nextAction.slice(0, 200), importRef: '' };
      } else {
        p.messages.push({
          level: 'warning',
          text: v.unit ? `واحد «${v.unit}» در Manage پیدا نشد؛ وظیفه «اقدام بعدی» ساخته نشد` : 'واحد درگیر خالی است؛ وظیفه «اقدام بعدی» ساخته نشد',
        });
      }
    }
    const set = (field: string, from: string | null, to: string | null) => p.changes.push({ field, from, to });

    if (!target) {
      // ---- new legacy case
      if (!p.identity) {
        p.outcome = 'incomplete';
        p.messages.push({ level: 'error', text: 'شناسه یکتا ندارد؛ شماره پذیرش معتبر، شماره شاسی یا VIN لازم است' });
        return;
      }
      if (!date) {
        p.outcome = 'incomplete';
        p.messages.push({ level: 'error', text: 'تاریخ پذیرش نامعلوم است؛ بدون تاریخ واقعی پرونده ساخته نمی‌شود و تصمیم مسئول لازم است' });
      } else if (!time && !decisions.dateWithoutTime) {
        p.outcome = 'incomplete';
        p.messages.push({
          level: 'error',
          text: 'ساعت پذیرش نامعلوم است؛ برای ثبت فقط تاریخ، گزینه «ثبت تاریخ پذیرش بدون ساعت» را انتخاب کنید',
        });
      }
      if (!stage) {
        p.outcome = 'incomplete';
        p.messages.push({ level: 'error', text: 'وضعیت فعلی تعمیر خالی است؛ مرحله حدس زده نمی‌شود' });
      } else if (stage === 'delivered') {
        p.outcome = 'error';
        p.messages.push({ level: 'error', text: 'پرونده جدید نمی‌تواند «تحویل‌شده» ثبت شود؛ تحویل از روند تحویل خودرو ثبت می‌شود' });
      }
      if (p.outcome !== 'new') return;
      const admittedAt = toInstant(date!, time ?? '00:00');
      if (admittedAt.getTime() > Date.now()) {
        p.outcome = 'error';
        p.messages.push({ level: 'error', text: 'تاریخ پذیرش در آینده است' });
        return;
      }
      if (!time) p.messages.push({ level: 'info', text: 'فقط تاریخ پذیرش ثبت می‌شود؛ ساعت «نامعلوم» نمایش داده می‌شود' });
      if (stage === 'ready_for_delivery') {
        p.messages.push({ level: 'warning', text: 'پرونده «آماده تحویل» بدون کنترل کیفیت و بستن فنی ثبت‌شده در Manage است؛ پیش از تحویل، روند QC انجام شود' });
      }
      p.create = {
        input: {
          customer: v.owner ? { fullName: v.owner } : undefined,
          vehicle: { model: v.model || undefined, plate: v.plate || undefined, vin: vin ?? undefined },
          admittedAt: admittedAt.toISOString(),
          coverageType: coverage ?? 'unknown',
          coverageNotes: v.coverageText || undefined,
          responsibleUserId: responsibleId ?? undefined,
          stage: stage!,
          isLegacyEntry: true,
          ...(deadline && decisions.deadlineAs === 'forecast' ? { forecastDeliveryAt: deadline.toISOString() } : {}),
          ...(deadline && decisions.deadlineAs === 'official' ? { officialDeadlineAt: deadline.toISOString() } : {}),
        },
        extra: {
          admissionNo: v.admissionNo || null,
          admissionNoKey: adm,
          admittedAtPrecision: time ? 'minute' : 'date',
          origin: 'excel_import',
          importKey: p.identity,
          chassisRef: v.chassis || null,
        },
      };
      set('تاریخ پذیرش', null, time ? `${formatSheetDate(date!)} ${time}` : `${formatSheetDate(date!)} (ساعت نامعلوم)`);
      set('مرحله', null, v.stage!);
      if (v.owner) set('نام مالک', null, v.owner);
      if (v.model) set('خودرو', null, v.model);
      if (v.plate) set('پلاک', null, v.plate);
      if (vin) set('VIN', null, vin);
      if (v.admissionNo) set('شماره کارت پذیرش', null, v.admissionNo);
      if (v.chassis) set('شاسی ثبت‌شده', null, v.chassis);
      set('نوع پوشش', null, coverage ? v.coverageType! : 'نامشخص');
      if (responsibleId) set('مسئول', null, v.responsible!);
      if (deadline) set(decisions.deadlineAs === 'official' ? 'مهلت رسمی' : 'پیش‌بینی تحویل', null, formatJalali(deadline.toISOString(), { time: true }));
      if (task) {
        task.importRef = `${p.identity}:next:${short(searchKey(task.title) + task.departmentId)}`;
        set('وظیفه', null, `${v.unit}: ${task.title}`);
        p.task = task;
      }
      return;
    }

    // ---- existing case: read its current state and version first
    p.caseId = target.id;
    p.caseNumber = target.caseNumber;
    if (target.status !== 'open') {
      review('پرونده تحویل یا بسته شده است و از ورود اکسل تغییر نمی‌کند');
      return;
    }
    const [veh] = await this.db.select().from(vehicles).where(eq(vehicles.id, target.vehicleId));
    const [cust] = target.customerId ? await this.db.select().from(customers).where(eq(customers.id, target.customerId)) : [];
    if (date && tehranDay(target.admittedAt) !== formatSheetDate(date)) {
      review(`تاریخ پذیرش فایل (${formatSheetDate(date)}) با پرونده (${tehranDay(target.admittedAt)}) متفاوت است؛ تغییر زمان پذیرش با دلیل و از خود پرونده انجام شود`);
    }
    if (vin && veh?.vin && veh.vin !== vin) review('VIN فایل با VIN ثبت‌شده پرونده متفاوت است');
    if (adm && target.admissionNoKey && target.admissionNoKey !== adm) review('شماره کارت پذیرش فایل با پرونده متفاوت است');
    if (p.outcome === 'needs_review') return;

    const input: Omit<UpdateCaseInput, 'expectedVersion'> = {};
    const extra: CaseImportFields = {};
    const vehicle: NonNullable<UpdateCaseInput['vehicle']> = {};
    if (v.owner && !same(v.owner, cust?.fullName)) {
      input.customer = { fullName: v.owner };
      set('نام مالک', cust?.fullName ?? null, v.owner);
    }
    if (v.model && !same(v.model, veh?.model)) {
      vehicle.model = v.model;
      set('خودرو', veh?.model ?? null, v.model);
    }
    if (v.plate && !same(v.plate, veh?.plate)) {
      vehicle.plate = v.plate;
      set('پلاک', veh?.plate ?? null, v.plate);
    }
    if (vin && !veh?.vin) {
      vehicle.vin = vin;
      set('VIN', null, vin);
    }
    if (Object.keys(vehicle).length) input.vehicle = vehicle;
    if (v.chassis && !veh?.chassisRef) {
      extra.chassisRef = v.chassis;
      set('شاسی ثبت‌شده', null, v.chassis);
    }
    if (v.admissionNo && !target.admissionNo) {
      extra.admissionNo = v.admissionNo;
      extra.admissionNoKey = adm;
      set('شماره کارت پذیرش', null, v.admissionNo);
    }
    if (p.identity && !target.importKey) extra.importKey = p.identity;
    if (coverage && coverage !== target.coverageType) {
      input.coverageType = coverage;
      set('نوع پوشش', target.coverageType, v.coverageType!);
    }
    if (v.coverageText && !target.coverageNotes) {
      input.coverageNotes = v.coverageText;
      set('توضیح پوشش', null, v.coverageText);
    }
    if (responsibleId && responsibleId !== target.responsibleUserId) {
      input.responsibleUserId = responsibleId;
      set('مسئول', null, v.responsible!);
    }
    if (deadline) {
      const field = decisions.deadlineAs === 'official' ? 'officialDeadlineAt' : 'forecastDeliveryAt';
      const current = target[field];
      if (!current || current.getTime() !== deadline.getTime()) {
        input[field] = deadline.toISOString();
        set(field === 'officialDeadlineAt' ? 'مهلت رسمی' : 'پیش‌بینی تحویل', current ? formatJalali(current.toISOString(), { time: true }) : null, formatJalali(deadline.toISOString(), { time: true }));
      }
    }
    let stageChange: CaseStage | undefined;
    if (stage && stage !== target.stage) {
      if (WORKFLOW_ONLY.includes(stage)) {
        p.messages.push({ level: 'warning', text: `تغییر مرحله به «${v.stage}» فقط از روند کنترل کیفیت، بستن فنی و تحویل ممکن است؛ مرحله تغییر نکرد` });
      } else {
        stageChange = stage;
        set('مرحله', target.stage, v.stage!);
      }
    }
    if (task) {
      task.importRef = `${p.identity ?? `case:${target.id}`}:next:${short(searchKey(task.title) + task.departmentId)}`;
      const [exists] = await this.db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.caseId, target.id), eq(tasks.importRef, task.importRef)));
      if (exists) task = undefined;
      else set('وظیفه', null, `${v.unit}: ${task.title}`);
    }
    // Nothing visible to change: no write (the identity link alone is not worth a new version).
    if (!p.changes.length) {
      p.outcome = 'unchanged';
      return;
    }
    p.outcome = 'update';
    p.update = { caseId: target.id, version: target.version, input, extra, stage: stageChange };
    p.task = task;
  }

  // ----------------------------------------------------------------- queries

  async get(actor: Actor, id: string): Promise<VehicleImport> {
    const [imp] = await this.db
      .select({ i: vehicleImports, createdByName: users.displayName })
      .from(vehicleImports)
      .innerJoin(users, eq(users.id, vehicleImports.createdBy))
      .where(and(eq(vehicleImports.id, id), eq(vehicleImports.tenantId, actor.user.tenantId)));
    if (!imp) throw notFound('ورود اکسل');
    const rows = await this.db.select().from(vehicleImportRows).where(eq(vehicleImportRows.importId, id)).orderBy(vehicleImportRows.rowNo);
    const i = imp.i;
    return {
      id: i.id,
      status: i.status as VehicleImport['status'],
      fileName: i.fileName,
      sheetName: i.sheetName,
      headerRow: i.headerRow,
      decisions: i.decisions as VehicleImport['decisions'],
      counts: { ...emptyCounts(), ...(i.counts as Record<VehicleImportOutcome, number>) },
      blankRows: i.blankRows as number[],
      unmappedColumns: i.unmappedColumns as string[],
      rows: rows.map((r) => ({
        rowNo: r.rowNo,
        outcome: r.outcome as VehicleImportOutcome,
        source: r.source as Record<string, string>,
        identity: r.identity,
        caseId: r.caseId,
        caseNumber: r.caseNumber,
        changes: r.changes as VehicleImportChange[],
        messages: r.messages as VehicleImportMessage[],
      })),
      createdAt: i.createdAt.toISOString(),
      createdBy: { id: i.createdBy, displayName: imp.createdByName },
      appliedAt: i.appliedAt ? i.appliedAt.toISOString() : null,
    };
  }

  /** Per-row result as .xlsx, including the case numbers issued by Manage. */
  async report(actor: Actor, id: string): Promise<{ fileName: string; data: Uint8Array }> {
    const imp = await this.get(actor, id);
    const header = ['ردیف فایل', 'نتیجه', 'شماره پرونده Manage', 'شماره کارت پذیرش', 'شماره شاسی ثبت‌شده', 'نام مالک', 'تغییرات', 'پیام‌ها'];
    const pick = (r: VehicleImport['rows'][number], prefix: string) =>
      Object.entries(r.source).find(([h]) => searchKey(h).startsWith(searchKey(prefix)))?.[1] ?? '';
    const rows = imp.rows.map((r) => [
      r.rowNo,
      VEHICLE_IMPORT_OUTCOME_LABELS[r.outcome],
      r.caseNumber ?? '',
      pick(r, 'شماره کارت پذیرش'),
      pick(r, 'شماره شاسی'),
      pick(r, 'نام مالک'),
      r.changes.map((c) => `${c.field}: ${c.from ?? '—'} ← ${c.to ?? '—'}`).join('؛ '),
      r.messages.map((m) => m.text).join('؛ '),
    ]);
    const title = [
      [`نتیجه ورود «${imp.fileName}» — ${imp.status === 'preview' ? 'پیش‌نمایش (ثبت نشده)' : `ثبت ${formatJalali(imp.appliedAt, { time: true })}`}`],
      [],
    ];
    return { fileName: `vehicle-import-${id.slice(0, 8)}.xlsx`, data: writeSheet('نتیجه ورود', [...title, header, ...rows]) };
  }

  async list(actor: Actor) {
    const rows = await this.db
      .select({ i: vehicleImports, createdByName: users.displayName })
      .from(vehicleImports)
      .innerJoin(users, eq(users.id, vehicleImports.createdBy))
      .where(eq(vehicleImports.tenantId, actor.user.tenantId))
      .orderBy(desc(vehicleImports.createdAt))
      .limit(20);
    return rows.map(({ i, createdByName }) => ({
      id: i.id,
      status: i.status,
      fileName: i.fileName,
      counts: i.counts,
      createdAt: i.createdAt.toISOString(),
      createdBy: { id: i.createdBy, displayName: createdByName },
      appliedAt: i.appliedAt ? i.appliedAt.toISOString() : null,
    }));
  }

  /** Import rows that created or updated this case (applied imports only). */
  async provenance(actor: Actor, caseId: string): Promise<CaseProvenance[]> {
    const rows = await this.db
      .select({ r: vehicleImportRows, i: vehicleImports, name: users.displayName })
      .from(vehicleImportRows)
      .innerJoin(vehicleImports, eq(vehicleImports.id, vehicleImportRows.importId))
      .innerJoin(users, eq(users.id, sql`coalesce(${vehicleImports.appliedBy}, ${vehicleImports.createdBy})`))
      .where(
        and(
          eq(vehicleImportRows.tenantId, actor.user.tenantId),
          eq(vehicleImportRows.caseId, caseId),
          inArray(vehicleImports.status, ['applied', 'partial']),
        ),
      )
      .orderBy(desc(vehicleImports.appliedAt));
    return rows.map(({ r, i, name }) => ({
      importId: i.id,
      fileName: i.fileName,
      rowNo: r.rowNo,
      outcome: r.outcome as VehicleImportOutcome,
      appliedAt: i.appliedAt ? i.appliedAt.toISOString() : null,
      appliedBy: { id: i.appliedBy ?? i.createdBy, displayName: name },
      source: r.source as Record<string, string>,
    }));
  }
}

function admissionKeyOf(raw: string | undefined): string | null {
  if (!raw || isNonUniqueAdmission(raw)) return null;
  return idKey(raw) || null;
}

function errorText(e: AppError): string {
  const body = e.getResponse() as { message?: string };
  return body.message ?? e.message;
}

