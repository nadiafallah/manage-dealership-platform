import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import {
  daysInShop, normalizeLaborCode, receptionDayStats, searchKey, shortVehicleName, TEHRAN_OFFSET_MINUTES,
  type ReceptionDayStats, type ReceptionSettings, type ReceptionSettingsInput,
  type ReceptionDetail, type ReceptionEvent, type ReceptionEventKind, type ReceptionExternalState, type ReceptionExternalUpdateInput, type ReceptionExternalWork as ExternalWorkView, type ReceptionExternalWorkInput, type ReceptionList, type ReceptionSearchInput,
} from '@manage/shared';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../auth/auth.types';
import { badRequest, conflict, notFound, versionConflict } from '../common/errors';
import { newId } from '../common/ids';
import { APP_CONFIG, type AppConfig } from '../config';
import { DATABASE, type DatabaseHandle, type DbOrTx } from '../db/database';
import { cases, externalContractors, pulseConnections, tenants, receptionDefects, receptionDocuments, receptionEvents, receptionExternalWork, receptionNotes, receptionParts, receptionRepairs, receptions, users } from '../db/schema';
import { CARD } from './kasb-protocol';
import { cleanText, kasbInstant } from './kasb-table';
import { cardDescription, tehranMidnight } from './pulse-map';

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const MAX_INVOICE = 3 * 1024 * 1024;
const DAY_MS = 86_400_000;
/** Start of a Tehran calendar day (YYYY-MM-DD) as an instant; Iran has no daylight saving time. */
const tehranDayStart = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - TEHRAN_OFFSET_MINUTES * 60_000);
const tehranDayKey = (at: Date) => new Date(at.getTime() + TEHRAN_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);

/**
 * «پذیرش و ترخیص» (spec section 26): reception folders read by Manage Pulse. Everything that
 * comes from کسب‌وکار is read only; Manage adds only work outside the dealership and notes.
 * Behind the server flag PULSE_ENABLED; while it is off the module answers «not active».
 */
@Injectable()
export class ReceptionService {
  constructor(
    @Inject(DATABASE) private readonly handle: DatabaseHandle,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.handle.db;
  }
  private ensureActive() {
    if (!this.cfg.PULSE_ENABLED) throw badRequest('RECEPTION_DISABLED', 'بخش پذیرش و ترخیص هنوز روی این سرور فعال نشده است.');
  }

  async search(actor: Actor, input: ReceptionSearchInput): Promise<ReceptionList> {
    this.ensureActive();
    const tenantId = actor.user.tenantId;
    const conds = [eq(receptions.tenantId, tenantId)];
    if (input.view === 'today') conds.push(gte(receptions.admittedAt, tehranMidnight(new Date())));
    if (input.view === 'open') conds.push(eq(receptions.isOpen, true));
    if (input.view === 'released') conds.push(eq(receptions.isOpen, false));
    const key = input.q ? searchKey(input.q).replace(/~/g, '') : '';
    if (key) conds.push(sql`${receptions.searchText} like ${`%${escapeLike(key)}%`} escape '\\'`);
    // «مانده از دیروز / پریروز / ۳ روز و بیشتر»: admission day on the Tehran calendar.
    if (input.stay) {
      const today = tehranMidnight(new Date()).getTime();
      if (input.stay === '3plus') conds.push(lt(receptions.admittedAt, new Date(today - 2 * DAY_MS)));
      else {
        const back = Number(input.stay);
        conds.push(gte(receptions.admittedAt, new Date(today - back * DAY_MS)), lt(receptions.admittedAt, new Date(today - (back - 1) * DAY_MS)));
      }
    }
    if (input.from) conds.push(gte(receptions.admittedAt, tehranDayStart(input.from)));
    if (input.to) conds.push(lt(receptions.admittedAt, new Date(tehranDayStart(input.to).getTime() + DAY_MS)));
    const where = and(...conds);
    const [{ n: total }] = (await this.db.select({ n: count() }).from(receptions).where(where)) as [{ n: number }];
    const partsCount = sql<number>`(select count(*)::int from ${receptionParts} p where p.reception_id = ${receptions.id} and p.removed_at is null)`;
    const rows = await this.db
      .select({ r: receptions, caseNumber: cases.caseNumber, partsCount })
      .from(receptions)
      .leftJoin(cases, eq(cases.id, receptions.caseId))
      .where(where)
      .orderBy(input.view === 'released' ? sql`${receptions.releasedAt} desc nulls last` : sql`${receptions.admittedAt} desc nulls last`, desc(receptions.kasbRcd))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize);
    const [conn] = await this.db.select({ lastReadAt: pulseConnections.lastReadAt }).from(pulseConnections).where(eq(pulseConnections.tenantId, tenantId));
    const now = Date.now();
    return {
      items: rows.map(({ r, caseNumber, partsCount: parts }) => ({
        id: r.id,
        admissionNo: r.admissionNo,
        plate: r.plate,
        vehicleName: r.productName || r.modelName ? shortVehicleName(r.productName, r.productName ?? r.modelName) : null,
        customerName: r.customerName,
        statusText: r.statusText ?? r.statusCode,
        isOpen: r.isOpen,
        admittedAt: iso(r.admittedAt),
        releasedAt: iso(r.releasedAt),
        daysIn: r.admittedAt ? daysInShop(r.admittedAt.toISOString(), r.isOpen ? now : (r.releasedAt ?? new Date(now)).getTime()) : null,
        partsCount: Number(parts ?? 0),
        caseId: r.caseId,
        caseNumber: caseNumber ?? null,
      })),
      total: Number(total),
      page: input.page,
      pageSize: input.pageSize,
      lastReadAt: iso(conn?.lastReadAt),
    };
  }

  /** Labour codes of periodic service and oil change kept in the dealership settings. */
  async settings(actor: Actor): Promise<ReceptionSettings> {
    const [t] = await this.db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, actor.user.tenantId));
    const codes = (t?.settings as Record<string, unknown> | undefined)?.receptionServiceLaborCodes;
    return { serviceLaborCodes: Array.isArray(codes) ? codes.filter((c): c is string => typeof c === 'string') : [] };
  }

  async saveSettings(actor: Actor, input: ReceptionSettingsInput): Promise<ReceptionSettings> {
    const codes = [...new Set(input.serviceLaborCodes.map(normalizeLaborCode).filter(Boolean))];
    await this.db.transaction(async (tx) => {
      const [t] = await tx.select().from(tenants).where(eq(tenants.id, actor.user.tenantId)).for('update');
      const before = (t!.settings ?? {}) as Record<string, unknown>;
      const after: Record<string, unknown> = { ...before, receptionServiceLaborCodes: codes };
      await tx.update(tenants).set({ settings: after }).where(eq(tenants.id, actor.user.tenantId));
      await this.audit.record(tx, actor, { entityType: 'tenant', entityId: actor.user.tenantId, action: 'settings.reception_service_codes_updated', before: { receptionServiceLaborCodes: before.receptionServiceLaborCodes ?? [] }, after: { receptionServiceLaborCodes: codes } });
    });
    return this.settings(actor);
  }

  /**
   * Daily statistics (scenario 2026-11-25): receptions admitted on one Tehran day, split into
   * repair / periodic service / no labour yet, overall and per receptionist as written in کسب‌وکار.
   */
  async stats(actor: Actor, date?: string): Promise<ReceptionDayStats> {
    this.ensureActive();
    const tenantId = actor.user.tenantId;
    const day = date ?? tehranDayKey(new Date());
    const start = tehranDayStart(day);
    const rows = await this.db.select({ id: receptions.id, receptionist: receptions.receptionist }).from(receptions)
      .where(and(eq(receptions.tenantId, tenantId), gte(receptions.admittedAt, start), lt(receptions.admittedAt, new Date(start.getTime() + DAY_MS))));
    const lines = rows.length
      ? await this.db.select({ receptionId: receptionRepairs.receptionId, code: receptionRepairs.code }).from(receptionRepairs)
        .where(and(eq(receptionRepairs.tenantId, tenantId), inArray(receptionRepairs.receptionId, rows.map((r) => r.id)), isNull(receptionRepairs.removedAt)))
      : [];
    const codesOf = new Map<string, (string | null)[]>();
    for (const l of lines) codesOf.set(l.receptionId, [...(codesOf.get(l.receptionId) ?? []), l.code]);
    const { serviceLaborCodes } = await this.settings(actor);
    return receptionDayStats(day, rows.map((r) => ({ receptionist: r.receptionist, codes: codesOf.get(r.id) ?? [] })), serviceLaborCodes);
  }

  private async load(tx: DbOrTx, tenantId: string, id: string) {
    const [row] = await tx.select().from(receptions).where(and(eq(receptions.tenantId, tenantId), eq(receptions.id, id)));
    if (!row) throw notFound('پذیرش');
    return row;
  }

  async detail(actor: Actor, id: string): Promise<ReceptionDetail> {
    this.ensureActive();
    const tenantId = actor.user.tenantId;
    const r = await this.load(this.db, tenantId, id);
    const official = r.official ?? {};
    const [parts, repairs, defects, works, docs, notes, events] = await Promise.all([
      this.db.select().from(receptionParts).where(eq(receptionParts.receptionId, id)).orderBy(asc(receptionParts.firstSeenAt), asc(receptionParts.kasbLineId)),
      this.db.select().from(receptionRepairs).where(eq(receptionRepairs.receptionId, id)).orderBy(asc(receptionRepairs.firstSeenAt), asc(receptionRepairs.kasbLineId)),
      this.db.select().from(receptionDefects).where(eq(receptionDefects.receptionId, id)).orderBy(asc(receptionDefects.firstSeenAt), asc(receptionDefects.kasbLineId)),
      this.db.select({ w: receptionExternalWork, by: users.displayName }).from(receptionExternalWork).leftJoin(users, eq(users.id, receptionExternalWork.createdBy)).where(and(eq(receptionExternalWork.tenantId, tenantId), eq(receptionExternalWork.receptionId, id))).orderBy(desc(receptionExternalWork.sentAt)),
      this.db.select({ id: receptionDocuments.id, workId: receptionDocuments.externalWorkId, fileName: receptionDocuments.fileName, mime: receptionDocuments.mime, size: receptionDocuments.size }).from(receptionDocuments).where(and(eq(receptionDocuments.tenantId, tenantId), eq(receptionDocuments.receptionId, id))).orderBy(asc(receptionDocuments.createdAt)),
      this.db.select({ n: receptionNotes, by: users.displayName }).from(receptionNotes).leftJoin(users, eq(users.id, receptionNotes.createdBy)).where(and(eq(receptionNotes.tenantId, tenantId), eq(receptionNotes.receptionId, id))).orderBy(desc(receptionNotes.createdAt)),
      this.db.select({ e: receptionEvents, by: users.displayName }).from(receptionEvents).leftJoin(users, eq(users.id, receptionEvents.actorUserId)).where(and(eq(receptionEvents.tenantId, tenantId), eq(receptionEvents.receptionId, id))).orderBy(desc(receptionEvents.occurredAt)).limit(300),
    ]);
    const [linked] = r.caseId ? await this.db.select({ id: cases.id, caseNumber: cases.caseNumber, status: cases.status }).from(cases).where(and(eq(cases.tenantId, tenantId), eq(cases.id, r.caseId))) : [];
    const goldType = cleanText(official[CARD.goldType]), goldId = cleanText(official[CARD.goldId]), goldExpires = cleanText(official[CARD.goldExpires]);
    const exitEstimate = kasbInstant(official[CARD.exitEstDate], official[CARD.exitEstTime]);
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : v != null && /^\d+(\.\d+)?$/.test(String(v)) ? Math.round(Number(v)) : null);
    return {
      id: r.id,
      version: r.version,
      admissionNo: r.admissionNo,
      cardNo: r.cardNo ?? r.kasbRcd,
      plate: r.plate,
      isOpen: r.isOpen,
      statusCode: r.statusCode,
      statusText: r.statusText,
      firstSeenAt: r.firstSeenAt.toISOString(),
      lastSeenAt: r.lastSeenAt.toISOString(),
      vehicle: {
        shortName: r.productName || r.modelName ? shortVehicleName(r.productName, r.productName ?? r.modelName) : null,
        fullModel: r.modelName,
        productCode: r.productCode,
        modelCode: r.modelCode,
        color: r.color,
        chassis: r.chassis,
        vin: r.vin,
        engineNo: r.engineNo,
        entranceKm: r.entranceKm,
        deliveredOn: cleanText(official[CARD.deliveredOn]),
        goldCard: goldType || goldId ? { type: goldType, id: goldId, expires: goldExpires } : null,
        accident: cleanText(official[CARD.accident]),
      },
      customer: {
        name: r.customerName,
        phone: r.customerPhone,
        mobile: r.customerMobile,
        nationalId: r.customerNationalId,
        address: r.customerAddress,
        delivererName: r.delivererName,
        delivererMobile: r.delivererMobile,
      },
      admission: {
        admittedAt: iso(r.admittedAt),
        entryType: cleanText(official[CARD.entryType]),
        recordType: cleanText(official[CARD.recType]),
        station: r.station,
        receptionist: r.receptionist,
        exitEstimate: iso(exitEstimate),
        releasedAt: iso(r.releasedAt),
        description: cardDescription(official),
        warrantyStatus: cleanText(official[CARD.warrantyStatus]),
        costEstimateRial: num(official[CARD.costEstimate]),
        finalCostRial: num(official[CARD.finalCost]),
      },
      defects: defects.map((d) => ({ id: d.id, lineId: d.kasbLineId, customerText: d.customerText, expertText: d.expertText, state: d.state, type: d.type, removedAt: iso(d.removedAt) })),
      repairs: repairs.map((x) => ({ id: x.id, lineId: x.kasbLineId, code: x.code, description: x.description, state: x.state, finalPriceRial: x.finalPriceRial, warranty: x.warranty, removedAt: iso(x.removedAt) })),
      parts: parts.map((p) => ({ id: p.id, lineId: p.kasbLineId, name: p.name, code: p.code, qtyRequested: p.qtyRequested, qtyFinal: p.qtyFinal, unitPriceRial: p.unitPriceRial, state: p.state, specialAid: p.specialAid, warranty: p.warranty, rejectReason: p.rejectReason, removedAt: iso(p.removedAt) })),
      externalWork: works.map(({ w, by }) => this.workView(w, by ?? null, docs.filter((d) => d.workId === w.id))),
      notes: notes.map(({ n, by }) => ({ id: n.id, text: n.text, createdAt: n.createdAt.toISOString(), createdByName: by ?? null })),
      events: events.map(({ e, by }) => eventView(e, by ?? null)),
      case: linked && linked.status !== 'deleted' ? { id: linked.id, caseNumber: linked.caseNumber } : null,
      linkState: r.linkState as ReceptionDetail['linkState'],
    };
  }

  private workView(w: typeof receptionExternalWork.$inferSelect, by: string | null, docs: { id: string; fileName: string; mime: string; size: number }[]): ExternalWorkView {
    return {
      id: w.id, contractorId: w.contractorId, contractorName: w.contractorName ?? '—', description: w.description, sentAt: w.sentAt.toISOString(), doneAt: iso(w.doneAt),
      amountRial: w.amountRial, status: w.status as ReceptionExternalState, note: w.note, cancelReason: w.cancelReason,
      invoices: docs.map((d) => ({ id: d.id, fileName: d.fileName, mime: d.mime, size: d.size })), createdByName: by, version: w.version,
    };
  }

  /** Active outside contractors of the dealership for the picker (name and specialty only). */
  async contractors(actor: Actor) {
    this.ensureActive();
    return this.db.select({ id: externalContractors.id, name: externalContractors.name, specialty: externalContractors.specialty }).from(externalContractors)
      .where(and(eq(externalContractors.tenantId, actor.user.tenantId), eq(externalContractors.active, true))).orderBy(asc(externalContractors.name));
  }

  /** The contractor's own name when one is chosen, otherwise the free-text name. */
  private async contractorName(tx: DbOrTx, tenantId: string, input: { contractorId?: string | null; contractorName?: string }) {
    if (!input.contractorId) return { contractorId: null, contractorName: input.contractorName!.trim() };
    const [c] = await tx.select({ id: externalContractors.id, name: externalContractors.name }).from(externalContractors).where(and(eq(externalContractors.tenantId, tenantId), eq(externalContractors.id, input.contractorId)));
    if (!c) throw badRequest('CONTRACTOR_NOT_FOUND', 'انجام‌دهندهٔ انتخاب‌شده پیدا نشد.');
    return { contractorId: c.id, contractorName: c.name };
  }

  private async event(tx: DbOrTx, actor: Actor, receptionId: string, kind: ReceptionEventKind, data: Record<string, unknown>) {
    await tx.insert(receptionEvents).values({ id: newId(), tenantId: actor.user.tenantId, receptionId, kind, data, actorUserId: actor.user.id, isTest: actor.user.isTestTenant });
  }

  async addExternalWork(actor: Actor, receptionId: string, input: ReceptionExternalWorkInput): Promise<ReceptionDetail> {
    this.ensureActive();
    await this.db.transaction(async (tx) => {
      const r = await this.load(tx, actor.user.tenantId, receptionId);
      const who = await this.contractorName(tx, actor.user.tenantId, input);
      const id = newId();
      const row = { id, tenantId: actor.user.tenantId, receptionId: r.id, ...who, description: input.description, sentAt: new Date(input.sentAt), amountRial: input.amountRial ?? null, note: input.note || null, status: 'sent', createdBy: actor.user.id, isTest: actor.user.isTestTenant };
      await tx.insert(receptionExternalWork).values(row);
      await this.event(tx, actor, r.id, 'external_added', { description: input.description, contractor: who.contractorName });
      await this.audit.record(tx, actor, { entityType: 'reception', entityId: id, caseId: r.caseId, action: 'reception.external_work_added', after: { receptionId: r.id, contractor: who.contractorName, description: input.description, amountRial: row.amountRial }, snapshot: { version: 1, row: { ...row, sentAt: row.sentAt.toISOString() } } });
    });
    return this.detail(actor, receptionId);
  }

  private async loadWork(tx: DbOrTx, tenantId: string, id: string, expectedVersion: number) {
    const [w] = await tx.select().from(receptionExternalWork).where(and(eq(receptionExternalWork.tenantId, tenantId), eq(receptionExternalWork.id, id)));
    if (!w) throw notFound('کار خارج از نمایندگی');
    if (w.version !== expectedVersion) throw versionConflict(w.version);
    return w;
  }

  async updateExternalWork(actor: Actor, id: string, input: ReceptionExternalUpdateInput): Promise<ReceptionDetail> {
    this.ensureActive();
    const receptionId = await this.db.transaction(async (tx) => {
      const w = await this.loadWork(tx, actor.user.tenantId, id, input.expectedVersion);
      if (w.status === 'cancelled') throw conflict('EXTERNAL_WORK_CANCELLED', 'کار لغوشده ویرایش نمی‌شود.');
      const who = await this.contractorName(tx, actor.user.tenantId, input);
      const next = {
        ...who, description: input.description, sentAt: new Date(input.sentAt), amountRial: input.amountRial ?? null, note: input.note || null, status: input.status,
        doneAt: input.status === 'done' ? (input.doneAt ? new Date(input.doneAt) : w.doneAt ?? new Date()) : null,
      };
      await tx.update(receptionExternalWork).set({ ...next, updatedBy: actor.user.id, updatedAt: new Date(), version: w.version + 1 }).where(eq(receptionExternalWork.id, w.id));
      const r = await this.load(tx, actor.user.tenantId, w.receptionId);
      await this.event(tx, actor, w.receptionId, 'external_updated', { description: input.description, status: input.status });
      await this.audit.record(tx, actor, { entityType: 'reception', entityId: w.id, caseId: r.caseId, action: 'reception.external_work_updated', before: { status: w.status, amountRial: w.amountRial, description: w.description }, after: { status: next.status, amountRial: next.amountRial, description: next.description }, snapshot: { version: w.version + 1, row: { ...w, ...next, version: w.version + 1 } } });
      return w.receptionId;
    });
    return this.detail(actor, receptionId);
  }

  async cancelExternalWork(actor: Actor, id: string, expectedVersion: number, reason: string): Promise<ReceptionDetail> {
    this.ensureActive();
    const receptionId = await this.db.transaction(async (tx) => {
      const w = await this.loadWork(tx, actor.user.tenantId, id, expectedVersion);
      if (w.status === 'cancelled') throw conflict('EXTERNAL_WORK_CANCELLED', 'این کار قبلاً لغو شده است.');
      await tx.update(receptionExternalWork).set({ status: 'cancelled', cancelReason: reason, updatedBy: actor.user.id, updatedAt: new Date(), version: w.version + 1 }).where(eq(receptionExternalWork.id, w.id));
      const r = await this.load(tx, actor.user.tenantId, w.receptionId);
      await this.event(tx, actor, w.receptionId, 'external_cancelled', { description: w.description, reason });
      await this.audit.record(tx, actor, { entityType: 'reception', entityId: w.id, caseId: r.caseId, action: 'reception.external_work_cancelled', reason, before: { status: w.status }, after: { status: 'cancelled' }, snapshot: { version: w.version + 1, row: { ...w, status: 'cancelled', cancelReason: reason, version: w.version + 1 } } });
      return w.receptionId;
    });
    return this.detail(actor, receptionId);
  }

  /** Invoice image of an external work (PDF, JPEG or PNG up to 3 MB; the same file twice is kept once). */
  async uploadInvoice(actor: Actor, workId: string, input: { expectedVersion: number; fileName: string; mime: 'application/pdf' | 'image/jpeg' | 'image/png'; dataBase64: string }): Promise<ReceptionDetail> {
    this.ensureActive();
    const bytes = Buffer.from(input.dataBase64, 'base64');
    const magic = input.mime === 'application/pdf' ? bytes.subarray(0, 5).toString() === '%PDF-' : input.mime === 'image/png' ? bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' : bytes.subarray(0, 3).toString('hex') === 'ffd8ff';
    if (!magic || bytes.length > MAX_INVOICE) throw badRequest('DOCUMENT_INVALID', 'فقط PDF یا تصویر معتبر تا ۳ مگابایت بارگذاری کنید');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const receptionId = await this.db.transaction(async (tx) => {
      const w = await this.loadWork(tx, actor.user.tenantId, workId, input.expectedVersion);
      if (w.status === 'cancelled') throw conflict('EXTERNAL_WORK_CANCELLED', 'برای کار لغوشده فاکتور بارگذاری نمی‌شود.');
      const [old] = await tx.select({ id: receptionDocuments.id }).from(receptionDocuments).where(and(eq(receptionDocuments.tenantId, actor.user.tenantId), eq(receptionDocuments.externalWorkId, w.id), eq(receptionDocuments.sha256, sha256)));
      if (old) return w.receptionId;
      const docId = newId();
      const fileName = input.fileName.replace(/[\\/\r\n]/g, '_');
      await tx.insert(receptionDocuments).values({ id: docId, tenantId: actor.user.tenantId, receptionId: w.receptionId, externalWorkId: w.id, fileName, mime: input.mime, sha256, dataBase64: bytes.toString('base64'), size: bytes.length, createdBy: actor.user.id, isTest: actor.user.isTestTenant });
      await tx.update(receptionExternalWork).set({ updatedBy: actor.user.id, updatedAt: new Date(), version: w.version + 1 }).where(eq(receptionExternalWork.id, w.id));
      await this.audit.record(tx, actor, { entityType: 'reception', entityId: docId, action: 'reception.invoice_uploaded', after: { externalWorkId: w.id, fileName, sha256 } });
      return w.receptionId;
    });
    return this.detail(actor, receptionId);
  }

  async invoice(actor: Actor, documentId: string) {
    this.ensureActive();
    const [row] = await this.db.select().from(receptionDocuments).where(and(eq(receptionDocuments.tenantId, actor.user.tenantId), eq(receptionDocuments.id, documentId)));
    if (!row) throw notFound('فاکتور');
    return row;
  }

  async addNote(actor: Actor, receptionId: string, text: string): Promise<ReceptionDetail> {
    this.ensureActive();
    await this.db.transaction(async (tx) => {
      const r = await this.load(tx, actor.user.tenantId, receptionId);
      const id = newId();
      await tx.insert(receptionNotes).values({ id, tenantId: actor.user.tenantId, receptionId: r.id, text, createdBy: actor.user.id, isTest: actor.user.isTestTenant });
      await this.event(tx, actor, r.id, 'note', { text: text.slice(0, 200) });
      await this.audit.record(tx, actor, { entityType: 'reception', entityId: id, caseId: r.caseId, action: 'reception.note_added', after: { receptionId: r.id } });
    });
    return this.detail(actor, receptionId);
  }
}

function eventView(e: typeof receptionEvents.$inferSelect, actorName: string | null): ReceptionEvent {
  const d = (e.data ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => (v == null || v === '' ? null : String(v));
  const part = [s(d.name), s(d.code)].filter(Boolean).join(' · ');
  const text = (() => {
    switch (e.kind) {
      case 'created': return s(d.status) ? `وضعیت: ${s(d.status)}` : null;
      case 'status': return `${s(d.from) ?? '—'} ← ${s(d.to) ?? '—'}`;
      case 'part_added': case 'part_removed': case 'part_restored': return part || null;
      case 'part_changed': return [part, s(d.to) && `وضعیت: ${s(d.to)}`, s(d.rejectReason) && `علت رد: ${s(d.rejectReason)}`].filter(Boolean).join(' · ') || null;
      case 'external_added': return [s(d.contractor), s(d.description)].filter(Boolean).join(' · ') || null;
      case 'external_updated': return s(d.description);
      case 'external_cancelled': return [s(d.description), s(d.reason) && `علت: ${s(d.reason)}`].filter(Boolean).join(' · ') || null;
      case 'note': return s(d.text);
      default: return null;
    }
  })();
  return { id: e.id, kind: e.kind as ReceptionEventKind, at: e.occurredAt.toISOString(), text, actorName };
}

