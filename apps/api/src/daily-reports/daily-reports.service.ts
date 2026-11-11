import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, isNull, lt, notInArray, or, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import {
  normalizePersian,
  DAILY_ROW_OUTCOME_LABELS,
  parseDecimal,
  parseJalali,
  type DailyApplyInput,
  type DailyImport,
  type DailyReportKind,
  type DailyReportsStatus,
  type DailyRowOutcome,
  type StockProfileInput,
} from '@manage/shared';
import type { Actor } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../config';
import { badRequest, conflict, forbidden, notFound, versionConflict } from '../common/errors';
import { newId } from '../common/ids';
import { DATABASE, type DatabaseHandle, type DbOrTx, type Tx } from '../db/database';
import {
  dailyReportFiles,
  dailyReportImports,
  dailyReportProfiles,
  dailyReportRows,
  emdadRequestEvents,
  emdadRequests,
  stockReservations,
  stockSnapshotItems,
  stockSnapshots,
  users,
} from '../db/schema';
import { readWorkbook, writeSheet, XlsxError } from '../parts/xlsx';
import { compareReportTimes, nextTehranDay, tehranDate } from './daily-time';
import { DailyTasksService } from './daily-tasks.service';
import { EmdadService, SETTLED_CATEGORIES } from './emdad.service';
import { applyEmdadToParts } from './emdad-parts';
import { PARSER_VERSION, emdadStatusCategory, parseEmdadSheet, parseStockSheet, type EmdadOfficial, type ParsedRow, type StockRowData } from './report-rows';
import { safeCell } from './safe-cell';
import { detectFormat, FORMAT_ERRORS, readHtmlTable, readSpreadsheetML, SpreadsheetError } from './spreadsheet-formats';
import { StockService } from './stock.service';

type ImportRow = typeof dailyReportImports.$inferSelect;
type Profile = typeof dailyReportProfiles.$inferSelect;
type StagedRow = { rowNo: number; outcome: string; rowKey: string | null; data: unknown; messages: unknown };
const BATCH = 500;
const FILE_TTL_MS = 7 * 86_400_000;
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const dec = (v: string | null | undefined) => (v == null ? null : parseDecimal(v));
const chunks = <T>(list: T[], size = BATCH) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
const cleanName = (name: string) =>
  (name.split(/[\\/]/).pop() ?? '')
    .replace(/\p{Cc}/gu, '')
    .trim()
    .slice(0, 200) || 'report';
const EMDAD_SHEET = 'گزارش امداد ویژه';
/** Fields that differ; jsonb does not keep key order, so keys are compared one by one. */
const changedFields = (before: Record<string, unknown>, after: Record<string, unknown>) =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null));

@Injectable()
export class DailyReportsService implements OnApplicationBootstrap {
  private readonly logger = new Logger('DailyReports');
  constructor(
    @Inject(DATABASE) private readonly handle: DatabaseHandle,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly audit: AuditService,
    private readonly emdad: EmdadService,
    private readonly stock: StockService,
    private readonly tasks: DailyTasksService,
  ) {}
  private get db() {
    return this.handle.db;
  }

  /** Jobs interrupted by a restart continue; files past their retention are removed (hourly). */
  onApplicationBootstrap() {
    if (this.cfg.APP_ENV === 'test') return;
    const run = () =>
      void this.recover(new Date()).catch((e: unknown) => this.logger.warn(`daily report recovery skipped: ${e instanceof Error ? e.message : 'unknown'}`));
    setInterval(run, 3_600_000).unref();
    run();
  }

  async recover(now: Date) {
    await this.expireStale(now);
    const interrupted = and(eq(dailyReportImports.status, 'parsing'), lt(dailyReportImports.createdAt, new Date(now.getTime() - 10 * 60_000)));
    await this.db.update(dailyReportImports).set({ status: 'uploaded' }).where(and(interrupted, lt(dailyReportImports.attempts, 3)));
    // Repeated interruption must not leave a job "reading" forever; the uploader can retry it.
    await this.db.update(dailyReportImports).set({ status: 'failed', error: 'پردازش فایل چند بار نیمه‌تمام ماند؛ دوباره تلاش کنید' }).where(interrupted);
    await this.db.delete(dailyReportFiles).where(lt(dailyReportFiles.expiresAt, now));
    const pending = await this.db.select({ id: dailyReportImports.id }).from(dailyReportImports).where(eq(dailyReportImports.status, 'uploaded'));
    for (const p of pending) await this.process(p.id);
  }

  private need(actor: Actor, p: 'daily_reports.upload' | 'daily_reports.apply' | 'daily_reports.settings') {
    if (!actor.user.permissions.has(p)) throw forbidden();
  }

  /** Whoever confirms a file must be able to read its preview. */
  private needPreview(actor: Actor) {
    if (!actor.user.permissions.has('daily_reports.upload') && !actor.user.permissions.has('daily_reports.apply')) throw forbidden();
  }

  // ------------------------------------------------------------- upload

  async upload(actor: Actor, kind: DailyReportKind, fileName: string, body: unknown): Promise<DailyImport & { resumed: boolean }> {
    this.need(actor, 'daily_reports.upload');
    if (!Buffer.isBuffer(body) || !body.length) throw badRequest('DAILY_FILE_EMPTY', 'فایل خالی است یا به شکل فایل (application/octet-stream) ارسال نشده است');
    const format = detectFormat(body);
    if (format === 'xls_binary' || format === 'unknown') throw badRequest('DAILY_FILE_FORMAT', FORMAT_ERRORS[format]);
    if (kind === 'stock' && format !== 'xlsx' && format !== 'html_table') throw badRequest('DAILY_FILE_KIND', 'برای موجودی انبار، گزارش موجودی کسب‌وکار (جدول با پسوند xls) یا فایل XLSX را انتخاب کنید (این فایل خروجی امداد ویژه به نظر می‌رسد)');
    if (kind === 'emdad' && format !== 'spreadsheetml') throw badRequest('DAILY_FILE_KIND', 'برای امداد ویژه، خروجی «گزارش امداد ویژه» (XML با پسوند xls) را انتخاب کنید');
    const tenantId = actor.user.tenantId;
    const hash = sha256(body);
    // The same file already waiting for confirmation is resumed, not uploaded twice.
    const [pending] = await this.db
      .select({ id: dailyReportImports.id })
      .from(dailyReportImports)
      .where(and(eq(dailyReportImports.tenantId, tenantId), eq(dailyReportImports.kind, kind), eq(dailyReportImports.fileSha256, hash), inArray(dailyReportImports.status, ['uploaded', 'parsing', 'preview', 'failed'])))
      .orderBy(desc(dailyReportImports.createdAt))
      .limit(1);
    if (pending) {
      await this.retryIfFailed(actor, pending.id);
      return { ...(await this.get(actor, pending.id)), resumed: true };
    }
    const [same] = await this.db
      .select({ id: dailyReportImports.id })
      .from(dailyReportImports)
      .where(and(eq(dailyReportImports.tenantId, tenantId), eq(dailyReportImports.kind, kind), eq(dailyReportImports.fileSha256, hash), eq(dailyReportImports.status, 'applied')))
      .orderBy(desc(dailyReportImports.appliedAt))
      .limit(1);
    const id = newId();
    await this.db.transaction(async (tx) => {
      await tx.insert(dailyReportImports).values({
        id,
        tenantId,
        kind,
        fileName: cleanName(fileName),
        fileSize: body.length,
        fileSha256: hash,
        format,
        parserVersion: PARSER_VERSION,
        diagnostics: same ? { sameAsImportId: same.id } : {},
        uploadedBy: actor.user.id,
        isTest: actor.user.isTestTenant,
      });
      await tx.insert(dailyReportFiles).values({ importId: id, data: body, expiresAt: new Date(Date.now() + FILE_TTL_MS) });
      await this.audit.record(tx, actor, { entityType: 'daily_report', entityId: id, action: 'daily_report.uploaded', after: { kind, fileSize: body.length, fileSha256: hash, format } });
    });
    this.kick(id);
    return { ...(await this.get(actor, id)), resumed: false };
  }

  private kick(id: string) {
    setImmediate(() => void this.process(id).catch((e: unknown) => this.logger.error(`daily report job failed: ${e instanceof Error ? e.message : 'unknown'}`)));
  }

  private async retryIfFailed(actor: Actor, id: string) {
    const [row] = await this.db
      .update(dailyReportImports)
      .set({ status: 'uploaded', error: null })
      .where(and(eq(dailyReportImports.id, id), eq(dailyReportImports.tenantId, actor.user.tenantId), eq(dailyReportImports.status, 'failed')))
      .returning({ id: dailyReportImports.id });
    if (row) this.kick(id);
    return !!row;
  }

  async retry(actor: Actor, id: string) {
    this.need(actor, 'daily_reports.upload');
    if (!(await this.retryIfFailed(actor, id))) throw conflict('DAILY_NOT_FAILED', 'فقط پردازش ناموفق را می‌توان دوباره اجرا کرد');
    return this.get(actor, id);
  }

  // -------------------------------------------------------------- parse job

  /** Parses the staged file into per-row outcomes. Claimed atomically, so one worker runs a job. */
  async process(id: string): Promise<void> {
    const [job] = await this.db
      .update(dailyReportImports)
      .set({ status: 'parsing', attempts: sql`${dailyReportImports.attempts} + 1`, progress: 5, error: null })
      .where(and(eq(dailyReportImports.id, id), eq(dailyReportImports.status, 'uploaded')))
      .returning();
    if (!job) return;
    try {
      const [file] = await this.db.select().from(dailyReportFiles).where(eq(dailyReportFiles.importId, id));
      if (!file) throw new SpreadsheetError('فایل اصلی دیگر در دسترس نیست؛ دوباره بارگذاری کنید');
      const diagnostics: Record<string, unknown> = { ...(job.diagnostics as object) };
      let grid: string[][];
      let sheetName: string;
      // Columns are found by normalized name (Arabic ي/ك, spaces), never by position (spec section 11).
      const isCodeHeader = (c: string) => normalizePersian(c).replace(/\s+/g, '') === 'کدکالا';
      if (job.kind === 'stock' && job.format === 'html_table') {
        const t = readHtmlTable(file.data, { headerProbe: isCodeHeader });
        Object.assign(diagnostics, t.diagnostics, { sheetNames: t.sheetNames });
        if (!t.rows.slice(0, 20).some((r) => r.some(isCodeHeader))) throw new SpreadsheetError('در جدول فایل ستون «کد کالا» پیدا نشد');
        grid = t.rows;
        sheetName = t.sheetName;
      } else if (job.kind === 'stock') {
        const sheets = readWorkbook(file.data);
        diagnostics.sheetNames = sheets.map((s) => s.name);
        const sheet = sheets.find((s) => s.rows.slice(0, 20).some((r) => r.some(isCodeHeader))) ?? null;
        if (!sheet) throw new SpreadsheetError('در هیچ برگه‌ای ستون «کد کالا» پیدا نشد');
        grid = sheet.rows;
        sheetName = sheet.name;
      } else {
        const probe = readSpreadsheetML(file.data);
        const r = probe.sheetNames.includes(EMDAD_SHEET) && probe.sheetName !== EMDAD_SHEET ? readSpreadsheetML(file.data, { sheet: EMDAD_SHEET }) : probe;
        Object.assign(diagnostics, r.diagnostics, { sheetNames: r.sheetNames });
        grid = [...r.rows()];
        sheetName = r.sheetName;
      }
      await this.progress(id, 30);
      const profile = await this.profileRow(this.db, job.tenantId, job.kind as DailyReportKind);
      let rows: ParsedRow<unknown>[];
      let headerRow: number;
      let signature: string;
      const counts: Record<string, number> = {};
      if (job.kind === 'stock') {
        const parsed = parseStockSheet(grid);
        ({ headerRow, signature } = parsed);
        diagnostics.blankRows = parsed.blankRows.length;
        diagnostics.missingColumns = parsed.missingColumns;
        counts.missing = await this.classifyStock(job.tenantId, parsed.rows);
        rows = parsed.rows;
        // Reordered rows have another hash but the same content.
        diagnostics.sameContent = !counts.missing && rows.some((r) => r.key) && rows.every((r) => !r.key || !['new', 'changed'].includes(r.outcome === 'needs_mapping' ? String((r.data as { delta?: string }).delta) : r.outcome));
      } else {
        const parsed = parseEmdadSheet(grid);
        ({ headerRow, signature } = parsed);
        diagnostics.missingColumns = parsed.missingColumns;
        Object.assign(counts, await this.classifyEmdad(job.tenantId, parsed.rows));
        rows = parsed.rows;
        diagnostics.sameContent = rows.some((r) => r.key) && rows.every((r) => !r.key || !['new', 'changed'].includes(r.outcome));
      }
      // A first file with a missing column needs the same explicit review as a changed layout.
      diagnostics.templateChanged = (!!profile?.headerSignature && profile.headerSignature !== signature) || (diagnostics.missingColumns as string[]).length > 0;
      diagnostics.headerSignature = signature;
      for (const r of rows) counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
      counts.total = rows.length;
      await this.db.delete(dailyReportRows).where(eq(dailyReportRows.importId, id));
      const batches = chunks(rows);
      for (const [n, b] of batches.entries()) {
        await this.db.insert(dailyReportRows).values(b.map((r) => ({ importId: id, rowNo: r.rowNo, outcome: r.outcome, rowKey: r.key, data: r.data as object, messages: r.messages })));
        await this.progress(id, 40 + Math.floor((55 * (n + 1)) / batches.length));
      }
      await this.db
        .update(dailyReportImports)
        .set({ status: 'preview', progress: 100, sheetName, headerRow, diagnostics, counts })
        .where(and(eq(dailyReportImports.id, id), eq(dailyReportImports.status, 'parsing')));
    } catch (e) {
      const known = e instanceof SpreadsheetError || e instanceof XlsxError || (e instanceof Error && /[؀-ۿ]/.test(e.message));
      if (!known) this.logger.error(`daily report parse failed: ${e instanceof Error ? e.message : 'unknown'}`);
      await this.db
        .update(dailyReportImports)
        .set({ status: 'failed', error: known ? (e as Error).message.slice(0, 500) : 'خواندن فایل ناموفق بود؛ دوباره تلاش کنید یا فایل را از سامانه مبدأ دوباره بگیرید' })
        .where(eq(dailyReportImports.id, id));
    }
  }

  private progress(id: string, progress: number) {
    return this.db.update(dailyReportImports).set({ progress }).where(eq(dailyReportImports.id, id));
  }

  /** new / changed / unchanged against the active snapshot; returns how many active rows are absent from the file. */
  private async classifyStock(tenantId: string, rows: ParsedRow<StockRowData>[]) {
    const active = await this.stock.active(this.db, tenantId);
    const prev = new Map<string, typeof stockSnapshotItems.$inferSelect>();
    if (active) for (const i of await this.db.select().from(stockSnapshotItems).where(eq(stockSnapshotItems.snapshotId, active.id))) if (!i.carriedFromSnapshotId) prev.set(`${i.fullStockCode}@${i.locationAddress}`, i);
    const seen = new Set<string>();
    for (const r of rows) {
      if (!r.key || !['valid', 'needs_mapping'].includes(r.outcome)) continue;
      seen.add(r.key);
      const p = prev.get(r.key);
      const d = r.data;
      const delta = !p ? 'new' : dec(p.quantity) === d.quantity && dec(p.avgPrice) === d.avgPrice && dec(p.salePrice) === d.salePrice && p.description === d.description && p.unit === d.unit ? 'unchanged' : 'changed';
      if (r.outcome === 'valid') r.outcome = delta;
      else (d as StockRowData & { delta?: string }).delta = delta;
      if (p && delta === 'changed') (d as StockRowData & { previous?: object }).previous = { quantity: dec(p.quantity), avgPrice: dec(p.avgPrice), salePrice: dec(p.salePrice) };
    }
    return [...prev.keys()].filter((k) => !seen.has(k)).length;
  }

  private async classifyEmdad(tenantId: string, rows: ParsedRow<EmdadOfficial>[]) {
    const valid = rows.filter((r) => r.outcome === 'valid' && r.key);
    const prev = new Map<string, typeof emdadRequests.$inferSelect>();
    for (const keys of chunks(valid.map((r) => r.key!), 1000)) {
      for (const e of await this.db.select().from(emdadRequests).where(and(eq(emdadRequests.tenantId, tenantId), inArray(emdadRequests.externalKey, keys)))) prev.set(e.externalKey, e);
    }
    const match = await this.emdad.matcher(this.db, tenantId, valid.map((r) => r.data));
    const counts = { matched: 0, unmatched: 0 };
    for (const r of valid) {
      const p = prev.get(r.key!);
      if (!p) {
        r.outcome = 'new';
        const m = match(r.data);
        (r.data as EmdadOfficial & { _match?: object })._match = m;
        if (m.matchStatus === 'matched') counts.matched += 1;
        else counts.unmatched += 1;
      } else {
        r.outcome = changedFields(p.official as Record<string, unknown>, r.data as unknown as Record<string, unknown>).length ? 'changed' : 'unchanged';
      }
    }
    return counts;
  }

  // ---------------------------------------------------------------- read

  async get(actor: Actor, id: string): Promise<DailyImport> {
    const [x] = await this.db
      .select({ i: dailyReportImports, name: users.displayName })
      .from(dailyReportImports)
      .leftJoin(users, eq(users.id, dailyReportImports.uploadedBy))
      .where(and(eq(dailyReportImports.id, id), eq(dailyReportImports.tenantId, actor.user.tenantId)));
    if (!x) throw notFound('بارگذاری گزارش');
    return this.toDto(x.i, x.name);
  }

  async getPreview(actor: Actor, id: string): Promise<DailyImport> {
    this.needPreview(actor);
    return this.get(actor, id);
  }

  private toDto(i: ImportRow, name: string | null): DailyImport {
    const d = i.diagnostics as Record<string, unknown>;
    return {
      id: i.id,
      kind: i.kind as DailyReportKind,
      status: i.status as DailyImport['status'],
      fileName: i.fileName,
      fileSize: i.fileSize,
      fileSha256: i.fileSha256,
      format: i.format,
      parserVersion: i.parserVersion,
      sheetName: i.sheetName,
      headerRow: i.headerRow,
      diagnostics: d,
      counts: i.counts as DailyImport['counts'],
      progress: i.progress,
      attempts: i.attempts,
      error: i.error,
      reportAt: i.reportAt?.toISOString() ?? null,
      reportAtPrecision: i.reportAtPrecision,
      uploadedBy: i.uploadedBy,
      uploadedByName: name,
      createdAt: i.createdAt.toISOString(),
      appliedAt: i.appliedAt?.toISOString() ?? null,
      templateChanged: d.templateChanged === true,
      sameAsImportId: (d.sameAsImportId as string | undefined) ?? null,
      sameContent: d.sameContent === true || !!d.sameAsImportId,
    };
  }

  async list(actor: Actor, kind?: DailyReportKind) {
    if (!actor.user.permissions.has('daily_reports.upload') && !actor.user.permissions.has('daily_reports.apply')) throw forbidden();
    const rows = await this.db
      .select({ i: dailyReportImports, name: users.displayName })
      .from(dailyReportImports)
      .leftJoin(users, eq(users.id, dailyReportImports.uploadedBy))
      .where(and(eq(dailyReportImports.tenantId, actor.user.tenantId), kind ? eq(dailyReportImports.kind, kind) : undefined))
      .orderBy(desc(dailyReportImports.createdAt))
      .limit(40);
    return rows.map((x) => this.toDto(x.i, x.name));
  }

  async rows(actor: Actor, id: string, q: { outcome?: DailyRowOutcome; page: number; pageSize: number }) {
    this.needPreview(actor);
    await this.get(actor, id);
    const where = and(eq(dailyReportRows.importId, id), q.outcome ? eq(dailyReportRows.outcome, q.outcome) : undefined);
    const [{ total }] = (await this.db.select({ total: count() }).from(dailyReportRows).where(where)) as [{ total: number }];
    const items = await this.db
      .select()
      .from(dailyReportRows)
      .where(where)
      .orderBy(asc(dailyReportRows.rowNo))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  /** Downloadable per-row result; no customer contact data, formula-safe text. */
  async report(actor: Actor, id: string) {
    this.needPreview(actor);
    const imp = await this.get(actor, id);
    const rows = await this.db.select().from(dailyReportRows).where(eq(dailyReportRows.importId, id)).orderBy(asc(dailyReportRows.rowNo));
    const pick =
      imp.kind === 'stock'
        ? (d: Record<string, unknown>) => [d.rawCode, d.fullStockCode, d.basePartNumber, d.supplySuffix, d.description, d.unit, d.locationAddress, d.quantity, d.salePrice, d.avgPrice]
        : (d: Record<string, unknown>) => [d.admissionNo, d.chassis, d.emdadNo, d.requestNo, d.initialCode, d.partCode, d.fullCode, d.emdadStatus, d.sendStatus, d.supplyQuantity];
    const head =
      imp.kind === 'stock'
        ? ['کد خام', 'کد کامل', 'کد پایه', 'پسوند', 'شرح', 'واحد', 'آدرس', 'موجودی', 'قیمت فروش', 'قیمت میانگین']
        : ['پذیرش', 'شاسی', 'شماره امداد', 'شماره درخواست', 'کد اولیه', 'کد قطعه', 'کد کامل', 'وضعیت امداد', 'وضعیت ارسال', 'تعداد تدارکاتی'];
    return writeSheet('نتیجه بررسی فایل', [
      ['ردیف فایل', 'نتیجه', 'توضیح', ...head],
      ...rows.map((r) => [r.rowNo, DAILY_ROW_OUTCOME_LABELS[r.outcome as DailyRowOutcome] ?? r.outcome, safeCell((r.messages as string[]).join(' | ')), ...pick(r.data as Record<string, unknown>).map((v) => safeCell(v == null ? '' : String(v)))]),
    ]);
  }

  async discard(actor: Actor, id: string) {
    this.need(actor, 'daily_reports.upload');
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(dailyReportImports)
        .set({ status: 'discarded' })
        .where(and(eq(dailyReportImports.id, id), eq(dailyReportImports.tenantId, actor.user.tenantId), inArray(dailyReportImports.status, ['preview', 'failed', 'uploaded'])))
        .returning();
      if (!row) throw conflict('DAILY_NOT_DISCARDABLE', 'این بارگذاری قابل کنارگذاشتن نیست');
      await tx.delete(dailyReportFiles).where(eq(dailyReportFiles.importId, id));
      await this.audit.record(tx, actor, { entityType: 'daily_report', entityId: id, action: 'daily_report.discarded' });
    });
    return this.get(actor, id);
  }

  // ---------------------------------------------------------------- apply

  async apply(actor: Actor, id: string, input: DailyApplyInput) {
    this.need(actor, 'daily_reports.apply');
    const tenantId = actor.user.tenantId;
    const now = new Date();
    const reportAt = parseJalali(input.reportDate, input.reportTime ?? '00:00');
    if (!reportAt) throw badRequest('DAILY_REPORT_DATE', 'تاریخ یا ساعت گزارش معتبر نیست');
    const precision = input.reportTime ? 'minute' : 'day';
    if (reportAt.getTime() > now.getTime() + 5 * 60_000) throw badRequest('DAILY_REPORT_FUTURE', 'تاریخ گزارش نمی‌تواند در آینده باشد');
    let result: Record<string, unknown> = {};
    await this.db.transaction(async (tx) => {
      const [job] = await tx
        .select()
        .from(dailyReportImports)
        .where(and(eq(dailyReportImports.id, id), eq(dailyReportImports.tenantId, tenantId)))
        .for('update');
      if (!job) throw notFound('بارگذاری گزارش');
      if (job.status === 'applied') throw conflict('DAILY_ALREADY_APPLIED', 'این فایل قبلاً ثبت شده است');
      if (job.status !== 'preview') throw conflict('DAILY_NOT_READY', 'فایل هنوز آماده تأیید نیست');
      const kind = job.kind as DailyReportKind;
      const diag = job.diagnostics as Record<string, unknown>;
      if (diag.templateChanged && !input.acceptTemplate) {
        throw badRequest('DAILY_TEMPLATE_CHANGED', 'ستون‌های فایل با قالب تأییدشده قبلی فرق دارد؛ پیش‌نمایش را بررسی و تغییر قالب را صریحاً تأیید کنید');
      }
      // The same content turns today's status green only on an explicit, audited statement.
      const identical = diag.sameContent === true || !!diag.sameAsImportId;
      if (identical && !input.declaredToday && tehranDate(reportAt) === tehranDate(now)) {
        throw badRequest('DAILY_SAME_CONTENT', 'محتوای این فایل با گزارش ثبت‌شده یکسان است؛ اگر واقعاً خروجی امروز و بدون تغییر است، آن را صریحاً تأیید کنید');
      }
      // One publish per dealership and report kind at a time.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`daily:${tenantId}:${kind}`}))`);
      const profile = await this.ensureProfile(tx, tenantId, kind);
      result = kind === 'stock' ? await this.publishStock(tx, actor, job, profile, reportAt, precision) : await this.syncEmdad(tx, actor, job, reportAt, precision);
      await tx
        .update(dailyReportImports)
        .set({ status: 'applied', appliedAt: now, appliedBy: actor.user.id, reportAt, reportAtPrecision: precision, reportDeclaredBy: actor.user.id, counts: { ...(job.counts as object), ...(result.counts as object) } })
        .where(eq(dailyReportImports.id, id));
      // The original bytes contain customer contact data (Emdad); only the hash is kept.
      await tx.delete(dailyReportFiles).where(eq(dailyReportFiles.importId, id));
      if (diag.headerSignature && profile.headerSignature !== diag.headerSignature) {
        await tx
          .update(dailyReportProfiles)
          .set({ headerSignature: diag.headerSignature as string, updatedBy: actor.user.id, updatedAt: now, version: profile.version + 1 })
          .where(eq(dailyReportProfiles.id, profile.id));
      }
      const task = await this.tasks.completeWith(tx, actor, kind, id, reportAt, identical, now);
      result.task = task;
      await this.audit.record(tx, actor, {
        entityType: 'daily_report',
        entityId: id,
        action: 'daily_report.applied',
        after: { kind, reportAt: reportAt.toISOString(), precision, counts: result.counts, templateAccepted: !!diag.templateChanged, identical, declaredToday: !!input.declaredToday, task },
      });
    });
    return { import: await this.get(actor, id), ...result };
  }

  private async staged(tx: DbOrTx, id: string, outcomes: string[]): Promise<StagedRow[]> {
    return tx
      .select()
      .from(dailyReportRows)
      .where(and(eq(dailyReportRows.importId, id), inArray(dailyReportRows.outcome, outcomes)))
      .orderBy(asc(dailyReportRows.rowNo));
  }

  /** Atomic publish: the new snapshot becomes active and the previous one stays as history. */
  private async publishStock(tx: Tx, actor: Actor, job: ImportRow, profile: Profile, reportAt: Date, precision: string) {
    const tenantId = actor.user.tenantId;
    const [active] = await tx
      .select()
      .from(stockSnapshots)
      .where(and(eq(stockSnapshots.tenantId, tenantId), eq(stockSnapshots.status, 'active')))
      .for('update');
    if (active && compareReportTimes({ at: reportAt, precision }, { at: active.reportedAt, precision: active.reportedAtPrecision }) < 0) {
      throw conflict('DAILY_OLDER_REPORT', 'این گزارش قدیمی‌تر از گزارش فعال موجودی است؛ اطلاعات جدیدتر با آن جایگزین نمی‌شود');
    }
    const s = profile.settings as Record<string, unknown>;
    const rows = await this.staged(tx, job.id, ['new', 'changed', 'unchanged', 'needs_mapping']);
    const snapshotId = newId();
    if (active) await tx.update(stockSnapshots).set({ status: 'superseded' }).where(eq(stockSnapshots.id, active.id));
    const items = rows.map((r) => {
      const d = r.data as StockRowData;
      return {
        id: newId(),
        snapshotId,
        tenantId,
        rowNo: r.rowNo,
        rawCode: d.rawCode,
        fullStockCode: d.fullStockCode,
        basePartNumber: d.basePartNumber,
        supplySuffix: d.supplySuffix,
        codeKind: d.codeKind,
        description: d.description,
        unit: d.unit,
        vehicleModel: d.vehicleModel,
        locationAddress: d.locationAddress,
        locationText: d.locationText,
        baseStatus: d.baseStatus,
        quantity: d.quantity,
        avgPrice: d.avgPrice,
        salePrice: d.salePrice,
      };
    });
    // A row missing from a report not confirmed as complete is not zero: its
    // last reported values are kept and labelled with their source report.
    let carried = 0;
    if (active && s.completeness !== 'full') {
      const present = new Set(items.map((i) => `${i.fullStockCode}@${i.locationAddress}`));
      const old = await tx.select().from(stockSnapshotItems).where(eq(stockSnapshotItems.snapshotId, active.id));
      for (const o of old) {
        if (present.has(`${o.fullStockCode}@${o.locationAddress}`)) continue;
        carried += 1;
        items.push({ ...o, id: newId(), snapshotId, carriedFromSnapshotId: o.carriedFromSnapshotId ?? active.id, carriedReportedAt: o.carriedReportedAt ?? active.reportedAt } as (typeof items)[number]);
      }
    }
    await tx.insert(stockSnapshots).values({
      id: snapshotId,
      tenantId,
      importId: job.id,
      reportedAt: reportAt,
      reportedAtPrecision: precision,
      scope: (s.scope as string | undefined) ?? null,
      completeness: (s.completeness as string | undefined) ?? null,
      quantityMeaning: (s.quantityMeaning as string | undefined) ?? null,
      currency: (s.currency as string | undefined) ?? null,
      taxIncluded: (s.taxIncluded as boolean | undefined) ?? null,
      itemCount: items.length,
      publishedBy: actor.user.id,
    });
    for (const b of chunks(items)) await tx.insert(stockSnapshotItems).values(b);
    const reconcile = await tx
      .select({ n: count() })
      .from(stockReservations)
      .where(and(eq(stockReservations.tenantId, tenantId), eq(stockReservations.status, 'issued'), isNull(stockReservations.reflectedAt)));
    return { snapshotId, counts: { published: items.length - carried, carried }, reconciliation: reconcile[0]?.n ?? 0 };
  }

  /** Upserts each Emdad line by its stable key; status changes never create a new request. */
  private async syncEmdad(tx: Tx, actor: Actor, job: ImportRow, reportAt: Date, precision: string) {
    const tenantId = actor.user.tenantId;
    const rows = await this.staged(tx, job.id, ['new', 'changed', 'unchanged']);
    const prev = new Map<string, typeof emdadRequests.$inferSelect>();
    for (const keys of chunks(rows.map((r) => r.rowKey!), 1000)) {
      for (const e of await tx.select().from(emdadRequests).where(and(eq(emdadRequests.tenantId, tenantId), inArray(emdadRequests.externalKey, keys))).for('update')) prev.set(e.externalKey, e);
    }
    const lastImports = [...new Set([...prev.values()].map((p) => p.lastImportId))];
    const precisionOf = new Map<string, string>();
    for (const ids of chunks(lastImports, 1000)) {
      for (const i of await tx.select({ id: dailyReportImports.id, p: dailyReportImports.reportAtPrecision }).from(dailyReportImports).where(inArray(dailyReportImports.id, ids))) precisionOf.set(i.id, i.p ?? 'minute');
    }
    const officialOf = (r: StagedRow) => {
      const o = { ...(r.data as EmdadOfficial & { _match?: unknown }) };
      delete o._match;
      return o as EmdadOfficial;
    };
    const rematch = rows.filter((r) => {
      const p = prev.get(r.rowKey!);
      return !p || (p.matchSource === 'auto' && p.matchStatus !== 'matched');
    });
    const match = await this.emdad.matcher(tx, tenantId, rematch.map(officialOf));
    const counts = { inserted: 0, updated: 0, unchanged: 0, older: 0, matched: 0 };
    const inserts: (typeof emdadRequests.$inferInsert)[] = [];
    const events: (typeof emdadRequestEvents.$inferInsert)[] = [];
    const touched: string[] = [];
    const older: number[] = [];
    for (const r of rows) {
      const o = officialOf(r);
      const p = prev.get(r.rowKey!);
      const statusCategory = emdadStatusCategory(o.emdadStatus);
      if (!p) {
        const m = match(o);
        if (m.matchStatus === 'matched') counts.matched += 1;
        const rid = newId();
        inserts.push({
          id: rid,
          tenantId,
          externalKey: r.rowKey!,
          admissionNo: o.admissionNo || null,
          chassis: o.chassis || null,
          emdadNo: o.emdadNo || null,
          requestNo: o.requestNo || null,
          initialCode: o.initialCode || null,
          official: o,
          statusCategory,
          firstImportId: job.id,
          lastImportId: job.id,
          lastReportAt: reportAt,
          ...m,
          isTest: actor.user.isTestTenant,
        });
        events.push({ id: newId(), requestId: rid, tenantId, importId: job.id, reportAt, changes: { created: true, emdadStatus: o.emdadStatus, sendStatus: o.sendStatus } });
        counts.inserted += 1;
        continue;
      }
      // An older file never reverts newer official values.
      if (compareReportTimes({ at: reportAt, precision }, { at: p.lastReportAt, precision: precisionOf.get(p.lastImportId) ?? 'minute' }) < 0) {
        older.push(r.rowNo);
        counts.older += 1;
        continue;
      }
      const base = { lastImportId: job.id, lastReportAt: reportAt, updatedAt: new Date() };
      const m = p.matchSource === 'auto' && p.matchStatus !== 'matched' ? match(o) : null;
      const matchPatch = m && (m.caseId !== p.caseId || m.matchStatus !== p.matchStatus || m.partRequestId !== p.partRequestId) ? m : null;
      const before = p.official as Record<string, unknown>;
      const changed = changedFields(before, o as unknown as Record<string, unknown>);
      if (changed.length || matchPatch) {
        await tx
          .update(emdadRequests)
          .set({ ...base, official: o, statusCategory, ...(matchPatch ?? {}), version: p.version + 1 })
          .where(eq(emdadRequests.id, p.id));
        if (changed.length) {
          events.push({ id: newId(), requestId: p.id, tenantId, importId: job.id, reportAt, changes: Object.fromEntries(changed.map((k) => [k, { from: before[k] ?? null, to: (o as unknown as Record<string, unknown>)[k] ?? null }])) });
          counts.updated += 1;
        } else counts.unchanged += 1;
        if (matchPatch?.matchStatus === 'matched') counts.matched += 1;
      } else {
        touched.push(p.id);
        counts.unchanged += 1;
      }
    }
    for (const b of chunks(inserts)) await tx.insert(emdadRequests).values(b);
    for (const b of chunks(events)) await tx.insert(emdadRequestEvents).values(b).onConflictDoNothing();
    for (const b of chunks(touched, 1000)) await tx.update(emdadRequests).set({ lastImportId: job.id, lastReportAt: reportAt }).where(inArray(emdadRequests.id, b));
    for (const b of chunks(older, 1000)) {
      await tx
        .update(dailyReportRows)
        .set({ outcome: 'older', messages: sql`${dailyReportRows.messages} || '["گزارش ثبت‌شده برای این ردیف جدیدتر است؛ مقدار قدیمی جایگزین نشد"]'::jsonb` })
        .where(and(eq(dailyReportRows.importId, job.id), inArray(dailyReportRows.rowNo, b)));
    }
    // Spec section 7: the report moves the linked part lines automatically.
    const parts = await applyEmdadToParts(tx, this.audit, actor, job.id, reportAt);
    return { counts: { ...counts, partsArrived: parts.arrived, partsDealerSupply: parts.dealerSupply, linkedByRequestNo: parts.linkedByRequestNo } };
  }

  // -------------------------------------------------------------- profiles

  private async profileRow(tx: DbOrTx, tenantId: string, kind: DailyReportKind) {
    const [p] = await tx
      .select()
      .from(dailyReportProfiles)
      .where(and(eq(dailyReportProfiles.tenantId, tenantId), eq(dailyReportProfiles.kind, kind)));
    return p ?? null;
  }

  private async ensureProfile(tx: DbOrTx, tenantId: string, kind: DailyReportKind): Promise<Profile> {
    await tx.insert(dailyReportProfiles).values({ id: newId(), tenantId, kind }).onConflictDoNothing();
    return (await this.profileRow(tx, tenantId, kind))!;
  }

  async profile(actor: Actor, kind: DailyReportKind) {
    if (!['daily_reports.settings', 'daily_reports.upload', 'stock.read', 'emdad.read'].some((p) => actor.user.permissions.has(p as never))) throw forbidden();
    const p = await this.ensureProfile(this.db, actor.user.tenantId, kind);
    return { kind, settings: p.settings, reminderTime: p.reminderTime, reminderUserId: p.reminderUserId, headerConfirmed: !!p.headerSignature, version: p.version, updatedAt: p.updatedAt.toISOString() };
  }

  /**
   * Reminder time/person need the settings permission. What the stock report
   * covers (warehouse scope, completeness, meaning of the quantity column,
   * currency and tax) is confirmed only by the owner, and also applies to the
   * active snapshot.
   */
  async updateProfile(actor: Actor, kind: DailyReportKind, input: StockProfileInput) {
    this.need(actor, 'daily_reports.settings');
    const ownerFields = (['currency', 'taxIncluded', 'completeness', 'scope', 'quantityMeaning'] as const).filter((k) => input[k] !== undefined);
    if (ownerFields.length && kind !== 'stock') throw badRequest('DAILY_PROFILE_FIELD', 'این تنظیم فقط برای گزارش موجودی است');
    if (ownerFields.length && !actor.user.isOwner) throw forbidden('تأیید دامنه انبار، کامل‌بودن، معنای موجودی و واحد پول فقط با مالک سامانه است');
    await this.db.transaction(async (tx) => {
      const p = await this.ensureProfile(tx, actor.user.tenantId, kind);
      if (p.version !== input.expectedVersion) throw versionConflict(p.version);
      if (input.reminderUserId) {
        const [u] = await tx.select({ isActive: users.isActive }).from(users).where(and(eq(users.id, input.reminderUserId), eq(users.tenantId, actor.user.tenantId)));
        if (!u?.isActive) throw badRequest('INVALID_ASSIGNEE', 'کاربر انتخاب‌شده فعال نیست');
      }
      const settings = { ...(p.settings as Record<string, unknown>) };
      for (const k of ownerFields) settings[k] = input[k] ?? null;
      if (ownerFields.length) Object.assign(settings, { confirmedBy: actor.user.id, confirmedAt: new Date().toISOString() });
      const patch = {
        settings,
        reminderTime: input.reminderTime ?? p.reminderTime,
        reminderUserId: input.reminderUserId === undefined ? p.reminderUserId : input.reminderUserId,
      };
      await tx
        .update(dailyReportProfiles)
        .set({ ...patch, updatedBy: actor.user.id, updatedAt: new Date(), version: p.version + 1 })
        .where(and(eq(dailyReportProfiles.id, p.id), eq(dailyReportProfiles.version, p.version)));
      if (ownerFields.length) {
        await tx
          .update(stockSnapshots)
          .set(Object.fromEntries(ownerFields.map((k) => [k, settings[k] ?? null])))
          .where(and(eq(stockSnapshots.tenantId, actor.user.tenantId), eq(stockSnapshots.status, 'active')));
      }
      await this.audit.record(tx, actor, {
        entityType: 'daily_report',
        entityId: p.id,
        action: 'daily_report.profile_updated',
        before: { settings: p.settings, reminderTime: p.reminderTime, reminderUserId: p.reminderUserId },
        after: patch,
        snapshot: { version: p.version + 1, row: { id: p.id, kind, ...patch } },
      });
    });
    return this.profile(actor, kind);
  }

  // ---------------------------------------------------------------- status

  /** Parts desk header: report freshness, today's tasks and follow-up counts. */
  async status(actor: Actor, now = new Date()): Promise<DailyReportsStatus> {
    const perms = actor.user.permissions;
    if (!['daily_reports.upload', 'stock.read', 'emdad.read'].some((p) => perms.has(p as never))) throw forbidden();
    const tenantId = actor.user.tenantId;
    const today = tehranDate(now);
    const last = async (kind: DailyReportKind) => {
      const [i] = await this.db
        .select()
        .from(dailyReportImports)
        .where(and(eq(dailyReportImports.tenantId, tenantId), eq(dailyReportImports.kind, kind), eq(dailyReportImports.status, 'applied')))
        .orderBy(desc(dailyReportImports.reportAt))
        .limit(1);
      return i ? { lastReportAt: i.reportAt!.toISOString(), precision: i.reportAtPrecision, appliedAt: i.appliedAt!.toISOString(), fresh: tehranDate(i.reportAt!) === today } : null;
    };
    const n = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
    const open = and(eq(emdadRequests.tenantId, tenantId), notInArray(emdadRequests.statusCategory, SETTLED_CATEGORIES), sql`coalesce(${emdadRequests.official}->>'releasedAt','') = ''`);
    const counts = { emdadOpen: 0, emdadMine: 0, emdadReview: 0, emdadDueToday: 0, reservationsActive: 0, reconciliation: 0, shortfalls: 0 };
    if (perms.has('emdad.read')) {
      counts.emdadOpen = await n(this.db.select({ n: count() }).from(emdadRequests).where(open));
      counts.emdadMine = await n(this.db.select({ n: count() }).from(emdadRequests).where(and(open, eq(emdadRequests.assigneeUserId, actor.user.id))));
      counts.emdadReview = await n(
        this.db
          .select({ n: count() })
          .from(emdadRequests)
          .where(and(eq(emdadRequests.tenantId, tenantId), or(inArray(emdadRequests.matchStatus, ['needs_review', 'ambiguous']), eq(emdadRequests.statusCategory, 'needs_interpretation')))),
      );
      counts.emdadDueToday = await n(this.db.select({ n: count() }).from(emdadRequests).where(and(open, lt(emdadRequests.dueAt, nextTehranDay(today)))));
    }
    if (perms.has('stock.read')) {
      counts.reservationsActive = await n(this.db.select({ n: count() }).from(stockReservations).where(and(eq(stockReservations.tenantId, tenantId), eq(stockReservations.status, 'reserved'))));
      counts.reconciliation = await n(
        this.db
          .select({ n: count() })
          .from(stockReservations)
          .where(and(eq(stockReservations.tenantId, tenantId), eq(stockReservations.status, 'issued'), isNull(stockReservations.reflectedAt))),
      );
      counts.shortfalls = (await this.stock.shortfallKeys(tenantId, await this.stock.active(this.db, tenantId))).size;
    }
    return {
      stock: perms.has('stock.read') || perms.has('daily_reports.upload') ? await last('stock') : null,
      emdad: perms.has('emdad.read') || perms.has('daily_reports.upload') ? await last('emdad') : null,
      tasks: await this.tasks.today(tenantId, now),
      counts,
    };
  }

  /** Not-yet-applied previews older than the retention are discarded (no data change). */
  async expireStale(now = new Date()) {
    await this.db
      .update(dailyReportImports)
      .set({ status: 'discarded' })
      .where(and(inArray(dailyReportImports.status, ['preview', 'failed']), lt(dailyReportImports.createdAt, new Date(now.getTime() - FILE_TTL_MS))));
  }
}
