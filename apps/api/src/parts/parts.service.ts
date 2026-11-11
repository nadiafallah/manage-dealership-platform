import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, ne, notInArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  PART_FLOW_STATE_LABELS,
  PART_SOURCE_LABELS,
  PART_SOURCES,
  allowedPartActions,
  isPartActionAllowed,
  partActionLabel,
  partCodeKey,
  partFlowFilter,
  partFlowState,
  type PartsDeskCard,
  type PartFlowActionInput,
  type PartFlowState,
  type PriceNotice,
  type PriceNoticeResponseInput,
  assessmentDispatchLines,
  assessmentPartKey,
  toLatinDigits,
  type CreatePartInput,
  type ImportPartsInput,
  type Part,
  type PartActionInput,
  type PartImportResult,
  type PartImportRow,
  type PartSource,
  type PartsFromAssessmentInput,
} from '@manage/shared';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../auth/auth.types';
import { BlockersService } from '../blockers/blockers.service';
import { assertNotFuture, CasesService, MINUTE_TOLERANCE_MS } from '../cases/cases.service';
import { badRequest, forbidden, notFound, versionConflict } from '../common/errors';
import { newId } from '../common/ids';
import { DATABASE, type DatabaseHandle, type DbOrTx } from '../db/database';
import { assessmentItems, assessments, blockers, cases, customers, departments, emdadRequests, partPriceNotices, partRequests, partQuotes, stockReservations, tasks, users, vehicles } from '../db/schema';
import { caseAndBayRecipients, notifyUsers, partLink } from './part-notify';
import { StockService } from '../daily-reports/stock.service';
import { FinanceService, PURCHASE_SOURCES } from '../finance/finance.service';
import { readFirstSheet, XlsxError } from './xlsx';

type PartRow = typeof partRequests.$inferSelect;

const createdByUser = alias(users, 'part_created_by');
const noticeBy = alias(users, 'price_notice_by');
const noticeAnswerBy = alias(users, 'price_notice_answer_by');
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

// Column headers of the import sheet (first row). Matching ignores spaces.
export const IMPORT_COLUMNS = {
  description: 'شرح قطعه',
  partNumber: 'شماره فنی',
  quantity: 'تعداد',
  source: 'منبع',
  approvedUnitPriceRial: 'قیمت تأییدشده واحد (ریال)',
  notes: 'توضیح',
} as const;

// Source accepted as code or Persian label (with or without the parenthesis).
const SOURCE_ALIASES = new Map<string, PartSource>(
  PART_SOURCES.flatMap((s) => [
    [s, s],
    [PART_SOURCE_LABELS[s], s],
    [PART_SOURCE_LABELS[s].replace(/\s*\(.*\)$/, ''), s],
  ]),
);
const squash = (s: string) => s.replace(/[\s‌]+/g, '');
const numberOf = (s: string) => (s === '' ? NaN : Number(toLatinDigits(s).replace(/[,٬\s]/g, '')));

const invalidTransition = (status: string) =>
  badRequest('INVALID_TRANSITION', `این اقدام در وضعیت فعلی قطعه (${status}) ممکن نیست`);

/**
 * Technical needs can be sent before finalization. Only outside-market buying
 * requires the exact recorded quote approval; purchase/payment controls remain.
 * Removed, rejected or changed needs require review. Handover to the repair
 * unit resolves "part not arrived" blockers that name the part.
 */
@Injectable()
export class PartsService {
  constructor(
    @Inject(DATABASE) private readonly handle: DatabaseHandle,
    private readonly audit: AuditService,
    private readonly cases: CasesService,
    private readonly blockers: BlockersService,
    private readonly finance: FinanceService,
    private readonly stock: StockService,
  ) {}

  private get db() {
    return this.handle.db;
  }

  async create(actor: Actor, caseId: string, input: CreatePartInput): Promise<Part> {
    const id = await this.db.transaction(async (tx) => {
      const tenantId = actor.user.tenantId;
      await this.loadOpenCase(tx, tenantId, caseId);
      // Anti-duplicate (spec section 5): the same technical code never makes a second row;
      // while the line is still undecided its quantity is raised instead.
      const key = partCodeKey(input.partNumber);
      const same = key ? (await this.activeCodes(tx, tenantId, caseId)).get(key) : undefined;
      if (same) {
        if (partFlowState(same) !== 'needed') {
          throw badRequest('DUPLICATE_PART_CODE', `این کد فنی از قبل در فهرست است («${same.description}») و تأمین آن در جریان است؛ ردیف تازه ساخته نشد`, { partId: same.id });
        }
        const p = await this.loadForWrite(tx, tenantId, same.id, same.version);
        const add = input.quantity ?? 1;
        await this.finishFlow(tx, actor, p, { quantity: p.quantity + add }, 'part.quantity_increased', 'همان کد فنی دوباره ثبت شد؛ تعداد همان قلم افزایش یافت', 'needed', { quantity: p.quantity });
        return p.id;
      }
      return (await this.insert(tx, actor, caseId, { ...input, assessmentItemId: null }, null)).id;
    });
    return this.get(actor, id);
  }

  /** Dispatch technical needs; market-price authorization is a separate purchase action. */
  async fromAssessment(actor: Actor, caseId: string, input: PartsFromAssessmentInput): Promise<Part[]> {
    const tenantId = actor.user.tenantId;
    await this.db.transaction(async (tx) => {
      let kase=await this.loadOpenCase(tx, tenantId, caseId);
      const versions=await tx.select().from(assessments).where(and(eq(assessments.tenantId,tenantId),eq(assessments.caseId,caseId))).orderBy(desc(assessments.versionNo));
      const current=versions.find(a=>a.status==='draft'||a.status==='final');
      if(!current)throw badRequest('NO_FINAL_ASSESSMENT','کارشناسی برای این پرونده ثبت نشده است');
      if(input.assessmentId&&input.assessmentId!==current.id)throw badRequest('ASSESSMENT_CHANGED','نسخه کارشناسی تغییر کرده است؛ صفحه را تازه کنید');
      if(input.expectedVersion&&input.expectedVersion!==current.version)throw versionConflict(current.version);
      const all=await tx.select().from(assessmentItems).where(and(eq(assessmentItems.tenantId,tenantId),inArray(assessmentItems.assessmentId,versions.map(a=>a.id))));
      const items=all.filter(i=>i.assessmentId===current.id);
      const existing = await tx
        .select()
        .from(partRequests)
        .where(and(eq(partRequests.tenantId,tenantId),eq(partRequests.caseId, caseId), ne(partRequests.status, 'cancelled')));
      const lines=assessmentDispatchLines(items as Parameters<typeof assessmentDispatchLines>[0],all as Parameters<typeof assessmentDispatchLines>[1],existing as Parameters<typeof assessmentDispatchLines>[2]);
      const selected=input.itemIds?new Set(input.itemIds):null;
      if(selected&&[...selected].some(id=>!lines.some(l=>l.itemId===id)))throw badRequest('ASSESSMENT_ITEM_INVALID','قلم انتخابی متعلق به کارشناسی فعلی نیست');
      const chosen=lines.filter(l=>!selected||selected.has(l.itemId));
      if(selected&&chosen.some(l=>l.state==='review'||l.state==='excluded'))throw badRequest('ASSESSMENT_ITEM_REVIEW','بعضی اقلام انتخابی نیازمند اصلاح یا بررسی‌اند؛ هیچ قطعه‌ای ارسال نشد');
      const todo=chosen.filter(l=>l.state==='ready');
      if(current.authorizationStatus==='pending'&&current.blockerId){
        const [oldBlocker]=await tx.select().from(blockers).where(and(eq(blockers.id,current.blockerId),eq(blockers.tenantId,tenantId),eq(blockers.caseId,caseId)));
        if(oldBlocker&&!oldBlocker.resolvedAt)await this.blockers.close(tx,actor,oldBlocker,new Date(),'اجرای روال جدید: ثبت کارشناسی و ارسال قطعه نیازمند مجوز خرید نیست');
        const [updated]=await tx.update(assessments).set({authorizationStatus:'not_required',version:current.version+1,updatedAt:new Date()}).where(and(eq(assessments.id,current.id),eq(assessments.tenantId,tenantId),eq(assessments.version,current.version))).returning();
        if(!updated)throw versionConflict();
        await this.audit.record(tx,actor,{entityType:'assessment',entityId:current.id,caseId,action:'assessment.requirement_updated',before:{authorizationStatus:current.authorizationStatus},after:{authorizationStatus:'not_required'},snapshot:{version:updated.version,row:updated}});
      }

      if (!todo.length&&!selected) {
        throw badRequest('NOTHING_TO_REQUEST', 'قلم تعویضیِ تازه یا افزایش تعداد قابل ارسالی وجود ندارد');
      }
      for (const line of todo) {
        const item=items.find(i=>i.id===line.itemId)!;
        await this.insert(
          tx,
          actor,
          caseId,
          {
            description: item.description,
            partNumber: item.partNumber,
            quantity: line.quantity,
            source: input.source ?? 'company',
            approvedUnitPriceRial: item.unitPriceRial,
            notes: null,
            assessmentItemId: line.rootId,
          },
          'از کارشناسی',
        );
      }
      if(todo.length&&['reception','assessment','awaiting_approval'].includes(kase.stage))kase=await this.cases.applyStage(tx,actor,kase,{stage:'awaiting_parts'},'ارسال اقلام کارشناسی به قطعات و تأمین');
    });
    return this.list(actor, caseId);
  }

  async importSheet(actor: Actor, caseId: string, input: ImportPartsInput): Promise<PartImportResult> {
    const parsed = parseImport(Buffer.from(input.fileBase64, 'base64'));
    const errors = parsed.errors;
    if (input.dryRun || errors.length) {
      // A file with errors is never imported partly.
      if (!input.dryRun) throw badRequest('IMPORT_INVALID', 'فایل خطا دارد و هیچ ردیفی وارد نشد', errors);
      await this.cases.detail(actor, caseId);
      const { fresh, duplicates } = this.splitDuplicates(parsed.rows, await this.activeCodes(this.db, actor.user.tenantId, caseId));
      return { dryRun: true, rows: fresh, errors, created: 0, duplicates };
    }
    let result: { fresh: PartImportRow[]; duplicates: PartImportRow[] } = { fresh: [], duplicates: [] };
    await this.db.transaction(async (tx) => {
      await this.loadOpenCase(tx, actor.user.tenantId, caseId);
      result = this.splitDuplicates(parsed.rows, await this.activeCodes(tx, actor.user.tenantId, caseId));
      for (const r of result.fresh) {
        await this.insert(tx, actor, caseId, { ...r, assessmentItemId: null }, `ورود از اکسل، ردیف ${r.row}`);
      }
    });
    return { dryRun: false, rows: result.fresh, errors: [], created: result.fresh.length, duplicates: result.duplicates };
  }

  /** Technical codes of the active lines of a case (spec section 5: anti-duplicate). */
  private async activeCodes(db: DbOrTx, tenantId: string, caseId: string) {
    const rows = await db
      .select({ id: partRequests.id, partNumber: partRequests.partNumber, status: partRequests.status, source: partRequests.source, consumedAt: partRequests.consumedAt, version: partRequests.version, description: partRequests.description })
      .from(partRequests)
      .where(and(eq(partRequests.tenantId, tenantId), eq(partRequests.caseId, caseId), notInArray(partRequests.status, ['cancelled', 'returned'])));
    const out = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const key = partCodeKey(r.partNumber);
      if (key && !r.consumedAt && !out.has(key)) out.set(key, r);
    }
    return out;
  }

  private splitDuplicates(rows: PartImportRow[], existing: Map<string, unknown>) {
    const seen = new Set(existing.keys());
    const fresh: PartImportRow[] = [];
    const duplicates: PartImportRow[] = [];
    for (const r of rows) {
      const key = partCodeKey(r.partNumber);
      if (key && seen.has(key)) duplicates.push(r);
      else {
        if (key) seen.add(key);
        fresh.push(r);
      }
    }
    return { fresh, duplicates };
  }

  async act(actor: Actor, id: string, input: PartActionInput): Promise<Part> {
    const at = input.at ? new Date(input.at) : new Date();
    assertNotFuture(at, 'زمان ثبت‌شده نمی‌تواند در آینده باشد');
    await this.db.transaction((tx) => this.actIn(tx, actor, id, input, at));
    return this.get(actor, id);
  }

  async actIn(tx: DbOrTx, actor: Actor, id: string, input: PartActionInput, at = new Date(), receivedByTechnician = false) {
    const tenantId = actor.user.tenantId;
    const p = await this.loadForWrite(tx, tenantId, id, input.expectedVersion);
    let patch: Partial<PartRow> = {};
    let action = `part.${input.action}`;
    let before: Record<string, unknown> | null = null;

    switch (input.action) {
      case 'check_stock':
        if (p.status !== 'needed') throw invalidTransition(p.status);
        patch = { inStock: input.inStock!, stockCheckedAt: at };
        action = 'part.stock_checked';
        break;
      case 'reserve':
        if (p.status !== 'needed') throw invalidTransition(p.status);
        if (p.inStock !== true) {
          throw badRequest('NOT_IN_STOCK', 'رزرو فقط پس از ثبت موجودی در انبار ممکن است');
        }
        patch = { status: 'reserved', source: 'stock', reservedAt: at };
        action = 'part.reserved';
        break;
      case 'order':
        patch = await this.orderPatch(tx, tenantId, p, input, at);
        action = 'part.ordered';
        break;
      case 'update_eta':
        if (p.status !== 'ordered') throw invalidTransition(p.status);
        before = { etaAt: iso(p.etaAt) };
        patch = { etaAt: new Date(input.etaAt!) };
        action = 'part.eta_changed';
        break;
      case 'receive':
        if (p.status !== 'ordered') throw invalidTransition(p.status);
        if (p.orderedAt && at.getTime() < p.orderedAt.getTime() - MINUTE_TOLERANCE_MS) {
          throw badRequest('INVALID_TIME', 'زمان رسید نمی‌تواند قبل از سفارش باشد');
        }
        patch = {
          status: input.inspection === 'ok' ? 'received' : 'rejected',
          receivedAt: at,
          receiptDocNo: input.receiptDocNo ?? null,
          inspection: input.inspection!,
          inspectionNote: input.note ?? null,
        };
        action = input.inspection === 'ok' ? 'part.received' : 'part.rejected';
        break;
      case 'hand_over': {
        if (p.status !== 'received' && p.status !== 'reserved') throw invalidTransition(p.status);
        if (input.departmentId) await this.assertDepartment(tx, tenantId, input.departmentId);
        const salePriceRial = input.salePriceRial ?? p.salePriceRial ?? p.unitPriceRial;
        if (salePriceRial === null) throw badRequest('PART_SALE_PRICE_REQUIRED', 'قیمت فروش این قطعه را وارد کنید');
        const reservations = await tx.select().from(stockReservations).where(and(
          eq(stockReservations.tenantId, tenantId), eq(stockReservations.partRequestId, id), eq(stockReservations.status, 'reserved'),
        )).orderBy(asc(stockReservations.id));
        for (const r of reservations) {
          await this.stock.actIn(tx, actor, r.id, { action: 'issue', expectedVersion: r.version }, receivedByTechnician);
        }
        patch = {
          salePriceRial,
          handedOverBy: actor.user.id,
          status: 'handed_over',
          handedOverAt: at,
          handedOverDepartmentId: input.departmentId ?? null,
          recipientName: input.recipientName!,
        };
        action = receivedByTechnician ? 'part.picked_up' : 'part.handed_over';
        break;
      }
      case 'cancel': {
        if (p.status === 'handed_over' || p.status === 'cancelled') throw invalidTransition(p.status);
        const reservations = await tx.select().from(stockReservations).where(and(
          eq(stockReservations.tenantId, tenantId), eq(stockReservations.partRequestId, id), eq(stockReservations.status, 'reserved'),
        )).orderBy(asc(stockReservations.id));
        for (const r of reservations) {
          await this.stock.actIn(tx, actor, r.id, { action: 'release', expectedVersion: r.version, reason: input.note! });
        }
        patch = { status: 'cancelled', cancelledAt: at, cancelReason: input.note! };
        action = 'part.cancelled';
        break;
      }
    }

    if (input.salePriceRial !== undefined) patch.salePriceRial = input.salePriceRial;
    if (input.action === 'order' && patch.unitPriceRial != null && input.salePriceRial === undefined) {
      patch.salePriceRial = patch.unitPriceRial;
    }
    const saved = await this.save(tx, p, patch);
    const after: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) after[k] = v instanceof Date ? v.toISOString() : v;
    await this.audit.record(tx, actor, {
      entityType: 'part',
      entityId: p.id,
      caseId: p.caseId,
      action,
      reason: input.note ?? null,
      occurredAt: at,
      before: before ?? { status: p.status },
      after: { description: p.description, ...after },
      snapshot: { version: saved.version, row: saved },
    });

    if (input.action === 'hand_over') {
      const waiting = await tx
        .select()
        .from(blockers)
        .where(and(eq(blockers.tenantId, tenantId), eq(blockers.partRequestId, p.id), isNull(blockers.resolvedAt)));
      for (const b of waiting) {
        await this.blockers.closeAndRelease(tx, actor, b, at, `تحویل قطعه «${p.description}» به واحد تعمیر`);
      }
    }
    return saved;
  }

  // ------------------------------------------------------- unified list (spec 7)

  /** Latest official Emdad category linked to each line (by match or by request number). */
  private async emdadByPart(db: DbOrTx, tenantId: string, partIds: string[]) {
    const out = new Map<string, { requestNo: string | null; category: string; statusText: string | null; reportAt: string }>();
    if (!partIds.length) return out;
    const rows = await db
      .select({ partId: emdadRequests.partRequestId, requestNo: emdadRequests.requestNo, category: emdadRequests.statusCategory, official: emdadRequests.official, at: emdadRequests.lastReportAt })
      .from(emdadRequests)
      .where(and(eq(emdadRequests.tenantId, tenantId), inArray(emdadRequests.partRequestId, partIds)))
      .orderBy(asc(emdadRequests.lastReportAt));
    for (const r of rows) {
      const official = (r.official ?? {}) as { emdadStatus?: string };
      out.set(r.partId!, { requestNo: r.requestNo, category: r.category, statusText: official.emdadStatus ?? null, reportAt: r.at.toISOString() });
    }
    return out;
  }

  /**
   * One action of the unified list. The state machine of spec section 7 is
   * enforced here, on the server: an action that is not valid in the current
   * state is refused with a stable code and a Persian message.
   */
  async flow(actor: Actor, id: string, input: PartFlowActionInput): Promise<Part> {
    if (!actor.user.permissions.has('part.manage')) throw forbidden('تعیین تکلیف، رزرو، لغو و قیمت قطعه کار مسئول قطعات است');
    await this.db.transaction(async (tx) => {
      const tenantId = actor.user.tenantId;
      const p = await this.loadForWrite(tx, tenantId, id, input.expectedVersion);
      const emdad = (await this.emdadByPart(tx, tenantId, [p.id])).get(p.id);
      const state = partFlowState({ status: p.status, source: p.source, consumedAt: p.consumedAt, emdadCategory: emdad?.category });
      if (!isPartActionAllowed(state, input.action)) {
        throw badRequest('PART_ACTION_NOT_ALLOWED', `«${partActionLabel(state, input.action)}» در وضعیت «${PART_FLOW_STATE_LABELS[state]}» مجاز نیست`, { state, allowed: allowedPartActions(state) });
      }
      const now = new Date();
      let patch: Partial<PartRow> = {};
      let action = `part.${input.action}`;
      switch (input.action) {
        case 'reserve': {
          // From «تأمین توسط نمایندگی» the line first returns to an open need.
          let row = p;
          if (state === 'dealer_supply') row = await this.save(tx, p, { status: 'needed' });
          const reservationId = await this.stock.reserveIn(tx, actor, { partRequestId: row.id, snapshotId: input.snapshotId, fullStockCode: input.fullStockCode, locationAddress: input.locationAddress, quantity: String(row.quantity), confirm: true });
          const [r] = await tx.select({ unitSalePrice: stockReservations.unitSalePrice }).from(stockReservations).where(eq(stockReservations.id, reservationId));
          const fromStock = r?.unitSalePrice != null ? Math.round(Number(r.unitSalePrice)) : null;
          patch = { status: 'reserved', source: 'stock', reservedAt: now, inStock: true, salePriceRial: input.saleUnitRial ?? row.salePriceRial ?? fromStock };
          action = 'part.reserved';
          await this.finishFlow(tx, actor, row, patch, action, null, state);
          await this.notifyReady(tx, actor, row);
          return;
        }
        case 'emdad':
          patch = { status: 'ordered', source: 'company', orderRef: input.requestNo, orderedAt: input.requestedAt ? new Date(input.requestedAt) : now, supplier: null, etaAt: null, firstEtaAt: null };
          action = 'part.emdad_requested';
          await this.finishFlow(tx, actor, p, patch, action, input.requestedCode ? `کد اختصاصی درخواستی: ${input.requestedCode}` : null, state);
          return;
        case 'market': {
          // Payer authorization (golden card / insurance) is recorded by the expert; it never blocks (spec principle 7).
          const gate = await this.finance.gate(tx, tenantId, p.caseId, input.purchaseUnitRial * p.quantity);
          const eta = input.etaAt ? new Date(input.etaAt) : null;
          patch = { status: 'ordered', source: 'external', supplier: input.supplier, unitPriceRial: input.purchaseUnitRial, salePriceRial: input.saleUnitRial, orderedAt: now, etaAt: eta, firstEtaAt: p.firstEtaAt ?? eta, orderRef: null, financeBasis: gate.reason, financeExceptionId: gate.exceptionId ?? null };
          action = 'part.market_ordered';
          await this.finishFlow(tx, actor, p, patch, action, null, state);
          return;
        }
        case 'receive':
          patch = { status: 'received', receivedAt: now, receiptDocNo: input.receiptDocNo ?? null, inspection: 'ok', inspectionNote: null };
          action = 'part.received';
          await this.finishFlow(tx, actor, p, patch, action, null, state);
          await this.notifyReady(tx, actor, p);
          return;
        case 'hand_over': {
          let departmentId = input.departmentId ?? null;
          if (input.taskId) {
            const [t] = await tx.select({ id: tasks.id, departmentId: tasks.departmentId }).from(tasks).where(and(eq(tasks.id, input.taskId), eq(tasks.tenantId, tenantId), eq(tasks.caseId, p.caseId)));
            if (!t) throw badRequest('PART_TARGET_INVALID', 'جایگاه انتخاب‌شده به این پرونده تعلق ندارد');
            departmentId = t.departmentId;
          }
          await this.actIn(tx, actor, id, { action: 'hand_over', expectedVersion: p.version, recipientName: input.recipientName, departmentId, salePriceRial: input.saleUnitRial }, now);
          return;
        }
        case 'cancel':
          await this.actIn(tx, actor, id, { action: 'cancel', expectedVersion: p.version, note: input.reason }, now);
          await this.closeNotices(tx, p.id);
          return;
        case 'return': {
          // Back to usable stock: the issued reservation stops lowering it (spec section 7).
          const issued = await tx.select().from(stockReservations).where(and(eq(stockReservations.tenantId, tenantId), eq(stockReservations.partRequestId, p.id), eq(stockReservations.status, 'issued')));
          for (const r of issued) {
            await tx.update(stockReservations).set({ status: 'returned', closedAt: now, closedBy: actor.user.id, reason: input.reason, updatedAt: now, version: r.version + 1 }).where(and(eq(stockReservations.id, r.id), eq(stockReservations.version, r.version)));
            await this.audit.record(tx, actor, { entityType: 'part', entityId: p.id, caseId: p.caseId, action: 'stock.returned', reason: input.reason, before: { reservationId: r.id, status: 'issued' }, after: { reservationId: r.id, status: 'returned' } });
          }
          patch = { status: 'returned', returnedAt: now, returnReason: input.reason };
          action = 'part.returned';
          await this.finishFlow(tx, actor, p, patch, action, input.reason, state);
          await this.closeNotices(tx, p.id);
          return;
        }
        case 'set_price':
          // Free and silent (spec decision 6): only the audit trail records it.
          await this.finishFlow(tx, actor, p, { salePriceRial: input.saleUnitRial }, 'part.price_changed', null, state, { salePriceRial: p.salePriceRial });
          return;
        case 'announce_price': {
          await this.finishFlow(tx, actor, p, { salePriceRial: input.saleUnitRial }, 'part.price_announced', input.note ?? null, state, { salePriceRial: p.salePriceRial });
          await this.closeNotices(tx, p.id);
          const noticeId = newId();
          await tx.insert(partPriceNotices).values({ id: noticeId, tenantId, caseId: p.caseId, partRequestId: p.id, saleUnitRial: input.saleUnitRial, note: input.note ?? null, announcedBy: actor.user.id, isTest: actor.user.isTestTenant });
          const [kase] = await tx.select({ responsibleUserId: cases.responsibleUserId }).from(cases).where(and(eq(cases.id, p.caseId), eq(cases.tenantId, tenantId)));
          await notifyUsers(tx, tenantId, [kase?.responsibleUserId], {
            kind: 'price_notice',
            title: `اعلام قیمت: ${p.description}`,
            body: `${input.saleUnitRial.toLocaleString('fa-IR')} ریال${input.note ? ` — ${input.note}` : ''}. تأیید کنید یا دستور دیگری بدهید؛ کار متوقف نمی‌شود.`,
            link: partLink(p.caseId, p.id),
            dedupeKey: `price_notice:${noticeId}`,
          });
          return;
        }
      }
    });
    return this.get(actor, id);
  }

  private async finishFlow(tx: DbOrTx, actor: Actor, p: PartRow, patch: Partial<PartRow>, action: string, reason: string | null, state: PartFlowState, before?: Record<string, unknown>) {
    const saved = await this.save(tx, p, patch);
    const after: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) after[k] = v instanceof Date ? v.toISOString() : v;
    await this.audit.record(tx, actor, {
      entityType: 'part',
      entityId: p.id,
      caseId: p.caseId,
      action,
      reason,
      before: before ?? { status: p.status, flowState: state },
      after: { description: p.description, ...after },
      snapshot: { version: saved.version, row: saved },
    });
    return saved;
  }

  /** «قطعه آماده است، تحویل بگیرید»: the case's expert and the technicians of its open steps. */
  private async notifyReady(tx: DbOrTx, actor: Actor, p: PartRow) {
    const to = (await caseAndBayRecipients(tx, actor.user.tenantId, p.caseId)).filter((u) => u !== actor.user.id);
    await notifyUsers(tx, actor.user.tenantId, to, { kind: 'part_ready', title: `قطعه آماده است: ${p.description}`, body: 'قطعه آمادهٔ تحویل به جایگاه است؛ تحویل بگیرید.', link: partLink(p.caseId, p.id), dedupeKey: `part_ready:${p.id}:${p.version}` });
  }

  /** An open announcement is superseded by a new one, a cancellation or a return. */
  private async closeNotices(tx: DbOrTx, partId: string) {
    await tx.update(partPriceNotices).set({ response: 'superseded', respondedAt: new Date() }).where(and(eq(partPriceNotices.partRequestId, partId), isNull(partPriceNotices.response)));
  }

  /** The accident expert confirms an announced price or gives another instruction (never blocks). */
  async respondPriceNotice(actor: Actor, noticeId: string, input: PriceNoticeResponseInput): Promise<PriceNotice> {
    const tenantId = actor.user.tenantId;
    await this.db.transaction(async (tx) => {
      const [n] = await tx.select().from(partPriceNotices).where(and(eq(partPriceNotices.id, noticeId), eq(partPriceNotices.tenantId, tenantId))).for('update');
      if (!n) throw notFound('اعلام قیمت');
      if (n.version !== input.expectedVersion) throw versionConflict(n.version);
      if (n.response) throw badRequest('PRICE_NOTICE_CLOSED', 'به این اعلام قیمت قبلاً پاسخ داده شده یا اعلام تازه‌تری جای آن را گرفته است');
      const now = new Date();
      await tx.update(partPriceNotices).set({ response: input.response, instruction: input.instruction ?? null, respondedBy: actor.user.id, respondedAt: now, version: n.version + 1 }).where(eq(partPriceNotices.id, n.id));
      await this.audit.record(tx, actor, { entityType: 'part', entityId: n.partRequestId, caseId: n.caseId, action: 'part.price_notice_answered', after: { noticeId: n.id, saleUnitRial: n.saleUnitRial, response: input.response, instruction: input.instruction ?? null } });
      const [p] = await tx.select({ description: partRequests.description }).from(partRequests).where(eq(partRequests.id, n.partRequestId));
      await notifyUsers(tx, tenantId, [n.announcedBy], {
        kind: 'price_notice_answer',
        title: `پاسخ کارشناس به قیمت «${p?.description ?? 'قطعه'}»`,
        body: input.response === 'approved' ? 'قیمت تأیید شد.' : `دستور: ${input.instruction}`,
        link: partLink(n.caseId, n.partRequestId),
        dedupeKey: `price_notice_answer:${n.id}`,
      });
    });
    const [notice] = await this.notices(this.db, tenantId, { id: noticeId });
    return notice!;
  }

  /** The parts clerk's desk: open vehicles with undecided, in-progress or ready lines, oldest need first. */
  async desk(actor: Actor): Promise<PartsDeskCard[]> {
    const tenantId = actor.user.tenantId;
    const rows = await this.db
      .select({ p: partRequests, c: { id: cases.id, caseNumber: cases.caseNumber, admissionNo: cases.admissionNo, coverageType: cases.coverageType, admittedAt: cases.admittedAt }, plate: vehicles.plate, model: vehicles.model, customer: customers.fullName })
      .from(partRequests)
      .innerJoin(cases, eq(cases.id, partRequests.caseId))
      .innerJoin(vehicles, eq(vehicles.id, cases.vehicleId))
      .leftJoin(customers, eq(customers.id, cases.customerId))
      .where(and(eq(partRequests.tenantId, tenantId), eq(cases.status, 'open'), notInArray(partRequests.status, ['cancelled', 'returned', 'handed_over'])));
    const emdad = await this.emdadByPart(this.db, tenantId, rows.map((r) => r.p.id));
    const cards = new Map<string, PartsDeskCard>();
    for (const { p, c, plate, model, customer } of rows) {
      const state = partFlowState({ status: p.status, source: p.source, consumedAt: p.consumedAt, emdadCategory: emdad.get(p.id)?.category });
      const f = partFlowFilter(state);
      if (!f) continue;
      const card = cards.get(c.id) ?? { caseId: c.id, caseNumber: c.caseNumber, admissionNo: c.admissionNo, plate, vehicleLabel: model ?? '', customerName: customer, coverageType: c.coverageType, admittedAt: c.admittedAt.toISOString(), counts: { undecided: 0, in_progress: 0, ready: 0, delivered: 0 }, dealerSupply: 0, oldestUndecidedAt: null };
      card.counts[f] += 1;
      if (state === 'dealer_supply') card.dealerSupply += 1;
      if (state === 'needed' && (!card.oldestUndecidedAt || p.createdAt.toISOString() < card.oldestUndecidedAt)) card.oldestUndecidedAt = p.createdAt.toISOString();
      cards.set(c.id, card);
    }
    const rank = (k: PartsDeskCard) => (k.counts.undecided || k.dealerSupply ? 0 : k.counts.ready ? 1 : 2);
    return [...cards.values()].sort((a, b) => rank(a) - rank(b) || (a.oldestUndecidedAt ?? a.admittedAt).localeCompare(b.oldestUndecidedAt ?? b.admittedAt));
  }

  /** Open announcements with their case, for the accident expert (spec section 7: «اعلام قیمت»). */
  async openNotices(actor: Actor, caseId?: string) {
    const tenantId = actor.user.tenantId;
    const parts = await this.db
      .select({ id: partRequests.id, caseId: partRequests.caseId, description: partRequests.description, quantity: partRequests.quantity, caseNumber: cases.caseNumber })
      .from(partPriceNotices)
      .innerJoin(partRequests, eq(partRequests.id, partPriceNotices.partRequestId))
      .innerJoin(cases, eq(cases.id, partRequests.caseId))
      .where(and(eq(partPriceNotices.tenantId, tenantId), isNull(partPriceNotices.response), eq(cases.status, 'open'), caseId ? eq(cases.id, caseId) : undefined));
    const notices = await this.notices(this.db, tenantId, { partIds: parts.map((p) => p.id), openOnly: true });
    return notices.map((n) => ({ ...n, part: parts.find((p) => p.id === n.partId)! }));
  }

  async notices(db: DbOrTx, tenantId: string, where: { id?: string; partIds?: string[]; openOnly?: boolean }): Promise<PriceNotice[]> {
    if (where.partIds && !where.partIds.length) return [];
    const rows = await db
      .select({ n: partPriceNotices, by: noticeBy.displayName, answerBy: noticeAnswerBy.displayName })
      .from(partPriceNotices)
      .innerJoin(noticeBy, eq(noticeBy.id, partPriceNotices.announcedBy))
      .leftJoin(noticeAnswerBy, eq(noticeAnswerBy.id, partPriceNotices.respondedBy))
      .where(and(
        eq(partPriceNotices.tenantId, tenantId),
        where.id ? eq(partPriceNotices.id, where.id) : undefined,
        where.partIds ? inArray(partPriceNotices.partRequestId, where.partIds) : undefined,
        where.openOnly ? isNull(partPriceNotices.response) : undefined,
      ))
      .orderBy(asc(partPriceNotices.announcedAt));
    return rows.map(({ n, by, answerBy }) => ({
      id: n.id,
      partId: n.partRequestId,
      saleUnitRial: n.saleUnitRial,
      note: n.note,
      announcedBy: { id: n.announcedBy, displayName: by },
      announcedAt: n.announcedAt.toISOString(),
      response: n.response === 'approved' || n.response === 'instruction' ? n.response : null,
      instruction: n.instruction,
      respondedBy: n.respondedBy ? { id: n.respondedBy, displayName: answerBy ?? '' } : null,
      respondedAt: iso(n.respondedAt),
      version: n.version,
    }));
  }

  // ----------------------------------------------------------------- queries

  async list(actor: Actor, caseId: string): Promise<Part[]> {
    await this.cases.detail(actor, caseId); // tenant check + 404
    return this.load(actor.user.tenantId, eq(partRequests.caseId, caseId));
  }

  async get(actor: Actor, id: string): Promise<Part> {
    const [p] = await this.load(actor.user.tenantId, eq(partRequests.id, id));
    if (!p) throw notFound('قطعه');
    return p;
  }

  private async load(tenantId: string, where: ReturnType<typeof eq>): Promise<Part[]> {
    const rows = await this.db
      .select({ p: partRequests, d: departments, createdByName: createdByUser.displayName })
      .from(partRequests)
      .innerJoin(createdByUser, eq(createdByUser.id, partRequests.createdBy))
      .leftJoin(departments, eq(departments.id, partRequests.handedOverDepartmentId))
      .where(and(eq(partRequests.tenantId, tenantId), where))
      .orderBy(asc(partRequests.createdAt), asc(partRequests.id));
    const now = Date.now();
    const ids = rows.map((r) => r.p.id);
    const [emdad, openNotices, roots] = await Promise.all([
      this.emdadByPart(this.db, tenantId, ids),
      this.notices(this.db, tenantId, { partIds: ids, openOnly: true }),
      this.rootVersions(tenantId, rows.map((r) => r.p.assessmentItemId).filter((x): x is string => !!x)),
    ]);
    // «الحاقیه»: the root line was first written in a supplement, or an earlier row of the same root exists.
    const firstOfRoot = new Map<string, string>();
    for (const { p } of rows) if (p.assessmentItemId && !firstOfRoot.has(p.assessmentItemId)) firstOfRoot.set(p.assessmentItemId, p.id);
    return rows.map(({ p, d, createdByName }) => {
      const e = emdad.get(p.id) ?? null;
      const flowState = partFlowState({ status: p.status, source: p.source, consumedAt: p.consumedAt, emdadCategory: e?.category });
      return {
      flowState,
      allowedActions: allowedPartActions(flowState),
      fromSupplement: !!p.assessmentItemId && ((roots.get(p.assessmentItemId) ?? 1) > 1 || firstOfRoot.get(p.assessmentItemId) !== p.id),
      consumedAt: iso(p.consumedAt),
      returnedAt: iso(p.returnedAt),
      returnReason: p.returnReason,
      emdad: e,
      priceNotice: openNotices.filter((n) => n.partId === p.id).at(-1) ?? null,
      id: p.id,
      caseId: p.caseId,
      assessmentItemId: p.assessmentItemId,
      description: p.description,
      partNumber: p.partNumber,
      quantity: p.quantity,
      source: p.source as Part['source'],
      status: p.status as Part['status'],
      inStock: p.inStock,
      stockCheckedAt: iso(p.stockCheckedAt),
      reservedAt: iso(p.reservedAt),
      approvedUnitPriceRial: p.approvedUnitPriceRial,
      unitPriceRial: p.unitPriceRial,
      salePriceRial: p.salePriceRial,
      priceApprovalRef: p.priceApprovalRef,
      priceApprovedBy: p.priceApprovedBy,
      supplier: p.supplier,
      orderRef: p.orderRef,
      orderedAt: iso(p.orderedAt),
      etaAt: iso(p.etaAt),
      firstEtaAt: iso(p.firstEtaAt),
      receivedAt: iso(p.receivedAt),
      receiptDocNo: p.receiptDocNo,
      inspection: p.inspection as Part['inspection'],
      inspectionNote: p.inspectionNote,
      handedOverAt: iso(p.handedOverAt),
      handedOverDepartment: d ? { id: d.id, name: d.name } : null,
      recipientName: p.recipientName,
      cancelledAt: iso(p.cancelledAt),
      cancelReason: p.cancelReason,
      financeBasis: p.financeBasis as Part['financeBasis'],
      notes: p.notes,
      createdAt: p.createdAt.toISOString(),
      createdBy: { id: p.createdBy, displayName: createdByName },
      overdue: p.status === 'ordered' && !!p.etaAt && p.etaAt.getTime() < now,
      version: p.version,
    };
    });
  }

  /** Version number of the assessment where each root line was first written. */
  private async rootVersions(tenantId: string, rootIds: string[]) {
    const out = new Map<string, number>();
    if (!rootIds.length) return out;
    const rows = await this.db
      .select({ id: assessmentItems.id, versionNo: assessments.versionNo })
      .from(assessmentItems)
      .innerJoin(assessments, eq(assessments.id, assessmentItems.assessmentId))
      .where(and(eq(assessmentItems.tenantId, tenantId), inArray(assessmentItems.id, [...new Set(rootIds)])));
    for (const r of rows) out.set(r.id, r.versionNo);
    return out;
  }

  // ---------------------------------------------------------------- helpers

  private async orderPatch(
    tx: DbOrTx,
    tenantId: string,
    p: PartRow,
    input: PartActionInput,
    at: Date,
  ): Promise<Partial<PartRow>> {
    if (p.status !== 'needed' && p.status !== 'rejected') throw invalidTransition(p.status);
    const source = input.source ?? (p.source as PartSource);
    if (source === 'stock') throw badRequest('USE_RESERVE', 'قطعه انبار با «رزرو» ثبت می‌شود، نه سفارش');

    // A removed/rejected or changed technical need cannot be ordered. Pending
    // assessment authorization is historical metadata, not a company-order gate.
    if (p.assessmentItemId) {
      const lines = (await this.authorizedLines(tx, tenantId, p.caseId)) ?? [];
      const line = lines.find((l) => l.root === p.assessmentItemId);
      if (!line || line.item.approvalStatus==='rejected' || line.item.action!=='replace' || assessmentPartKey(line.item)!==assessmentPartKey(p)) {
        throw badRequest('ASSESSMENT_ITEM_REVIEW', 'این نیاز در کارشناسی فعلی حذف، رد یا تغییر کرده است؛ پیش از سفارش بررسی کنید');
      }
      const requests=await tx.select().from(partRequests).where(and(eq(partRequests.tenantId,tenantId),eq(partRequests.caseId,p.caseId),ne(partRequests.status,'cancelled')));
      const key=assessmentPartKey(line.item);
      if(lines.filter(l=>l.item.action==='replace'&&assessmentPartKey(l.item)===key).length>1||requests.filter(r=>r.assessmentItemId===line.root||assessmentPartKey(r)===key).reduce((n,r)=>n+r.quantity,0)>line.item.quantity)throw badRequest('ASSESSMENT_ITEM_REVIEW','تعداد نیازهای ارسال‌شده یا کدهای تکراری با کارشناسی فعلی سازگار نیست؛ پیش از خرید بررسی کنید');
    }

    const etaAt = input.etaAt ? new Date(input.etaAt) : null;
    const common = {
      status: 'ordered',
      source,
      supplier: input.supplier ?? null,
      orderRef: input.orderRef ?? null,
      orderedAt: at,
      etaAt,
      firstEtaAt: p.firstEtaAt ?? etaAt,
      // A re-order after a wrong/defective part starts a fresh receipt.
      receivedAt: null,
      inspection: null,
      inspectionNote: null,
      receiptDocNo: null,
    } satisfies Partial<PartRow>;

    if (!PURCHASE_SOURCES.includes(source)) {
      // Customer-supplied part: nothing is bought.
      return { ...common, unitPriceRial: null, financeBasis: 'not_purchase', financeExceptionId: null };
    }
    if (input.unitPriceRial === undefined) {
      throw badRequest('PRICE_REQUIRED', 'برای سفارش خرید، قیمت واحد قطعه را وارد کنید');
    }
    const unitPrice = input.unitPriceRial;
    const aboveApproved = p.approvedUnitPriceRial !== null && unitPrice > p.approvedUnitPriceRial;
    // Owner rule (2026-11-05): the parts clerk prices freely. A recorded payer
    // approval is needed only when golden card or insurance pays and the
    // outside-market price exceeds the assessment-approved unit price (or no
    // approved price exists to compare with).
    const kase=source==='external'?await this.loadOpenCase(tx,tenantId,p.caseId):null;
    const payerPays=kase?.coverageType==='golden_card'||kase?.coverageType==='insurance';
    const needsMarketApproval=source==='external'&&payerPays&&(p.approvedUnitPriceRial===null||unitPrice>p.approvedUnitPriceRial);
    const quotes=await tx.select().from(partQuotes).where(and(eq(partQuotes.partId,p.id),eq(partQuotes.tenantId,tenantId))).orderBy(desc(partQuotes.createdAt),desc(partQuotes.id));
    const latest=quotes[0];
    const quote=needsMarketApproval?latest:latest?.status==='approved'?latest:undefined;
    if(needsMarketApproval) {
      const payer=kase!.coverageType==='golden_card'?'golden_card':'insurer';
      if(quote&&quote.source!==payer)throw badRequest('MARKET_APPROVAL_REQUIRED','پوشش پرونده تغییر کرده است؛ تأیید پرداخت‌کننده فعلی لازم است');
      if(!quote || quote.status!=='approved' || quote.unitPriceRial!==unitPrice || quote.quantity!==p.quantity || quote.supplier!==(input.supplier??'') || quote.validUntil<new Date()) {
        throw badRequest(aboveApproved?'PRICE_ABOVE_APPROVED':'MARKET_APPROVAL_REQUIRED','قیمت بالاتر از مبلغ تأییدشدهٔ کارت طلایی یا بیمه است؛ کارشناس تصادفات باید تأیید پرداخت‌کننده را برای همین مبلغ، تعداد و فروشنده ثبت کند');
      }
      if(quote.decidedAt && at<quote.decidedAt)throw badRequest('ORDER_BEFORE_APPROVAL','زمان خرید نمی‌تواند پیش از تأیید قیمت باشد');
    }
    // Owner rule (2026-11-05): money never blocks a purchase. The finance state
    // is recorded and surfaces as an alert to the accident coordinator instead.
    const gate = await this.finance.gate(tx, tenantId, p.caseId, unitPrice * p.quantity);
    return {
      ...common,
      unitPriceRial: unitPrice,
      priceApprovalRef: quote?.reference ?? input.priceApprovalRef ?? null,
      priceApprovedBy: quote?.approver ?? input.priceApprovedBy ?? null,
      financeBasis: gate.reason,
      financeExceptionId: gate.exceptionId ?? null,
    };
  }

  /**
   * Current draft/final technical lines with original lineage. The legacy
   * approved flag means non-rejected technical eligibility, not buying approval.
   */
  async authorizedLines(tx: DbOrTx, tenantId: string, caseId: string) {
    const versions = await tx
      .select({ id: assessments.id, status: assessments.status })
      .from(assessments)
      .where(and(eq(assessments.tenantId, tenantId), eq(assessments.caseId, caseId)))
      .orderBy(desc(assessments.versionNo));
    const current = versions.find((v) => v.status === 'draft'||v.status === 'final');
    if (!current) return null;
    const all = await tx
      .select()
      .from(assessmentItems)
      .where(
        inArray(
          assessmentItems.assessmentId,
          versions.map((v) => v.id),
        ),
      );
    const byId = new Map(all.map((i) => [i.id, i]));
    const rootOf = (id: string): string => {
      let item = byId.get(id);
      while (item?.originItemId && byId.has(item.originItemId)) item = byId.get(item.originItemId);
      return item?.id ?? id;
    };
    return all
      .filter((i) => i.assessmentId === current.id)
      .map((item) => ({ item, root: rootOf(item.id), approved: item.approvalStatus !== 'rejected' }));
  }

  private async insert(
    tx: DbOrTx,
    actor: Actor,
    caseId: string,
    input: Omit<CreatePartInput, 'quantity'> & { quantity?: number; assessmentItemId: string | null },
    reason: string | null,
  ): Promise<PartRow> {
    const id = newId();
    const [row] = await tx
      .insert(partRequests)
      .values({
        id,
        tenantId: actor.user.tenantId,
        caseId,
        assessmentItemId: input.assessmentItemId,
        description: input.description,
        partNumber: input.partNumber ?? null,
        quantity: input.quantity ?? 1,
        source: input.source,
        approvedUnitPriceRial: input.approvedUnitPriceRial ?? null,
        notes: input.notes ?? null,
        createdBy: actor.user.id,
        isTest: actor.user.isTestTenant,
      })
      .returning();
    await this.audit.record(tx, actor, {
      entityType: 'part',
      entityId: id,
      caseId,
      action: 'part.created',
      reason,
      after: { description: row!.description, quantity: row!.quantity, source: row!.source },
      snapshot: { version: 1, row: row! },
    });
    return row!;
  }

  private async loadOpenCase(tx: DbOrTx, tenantId: string, caseId: string) {
    const kase = await this.cases.loadForWrite(tx, tenantId, caseId);
    if (kase.stage === 'delivered') throw badRequest('CASE_DELIVERED', 'پرونده تحویل شده است');
    return kase;
  }

  private async loadForWrite(tx: DbOrTx, tenantId: string, id: string, expectedVersion: number): Promise<PartRow> {
    const [p] = await tx
      .select()
      .from(partRequests)
      .where(and(eq(partRequests.id, id), eq(partRequests.tenantId, tenantId))).for('update');
    if (!p) throw notFound('قطعه');
    if (p.version !== expectedVersion) throw versionConflict(p.version);
    await this.cases.loadForWrite(tx, tenantId, p.caseId);
    return p;
  }

  private async save(tx: DbOrTx, p: PartRow, patch: Partial<PartRow>): Promise<PartRow> {
    const [row] = await tx
      .update(partRequests)
      .set({ ...patch, updatedAt: new Date(), version: p.version + 1 })
      .where(and(eq(partRequests.id, p.id),eq(partRequests.tenantId,p.tenantId), eq(partRequests.version, p.version)))
      .returning();
    if (!row) throw versionConflict();
    return row;
  }

  private async assertDepartment(tx: DbOrTx, tenantId: string, departmentId: string) {
    const [d] = await tx
      .select({ isActive: departments.isActive })
      .from(departments)
      .where(and(eq(departments.id, departmentId), eq(departments.tenantId, tenantId)));
    if (!d || !d.isActive) throw badRequest('INVALID_DEPARTMENT', 'واحد انتخاب‌شده معتبر نیست');
  }
}

/** Validates the import sheet; every row is checked so the user sees all errors at once. */
export function parseImport(data: Uint8Array): { rows: PartImportRow[]; errors: { row: number; message: string }[] } {
  let grid: string[][];
  try {
    grid = readFirstSheet(data);
  } catch (err) {
    const message = err instanceof XlsxError ? err.message : 'فایل اکسل خوانده نشد';
    return { rows: [], errors: [{ row: 0, message }] };
  }
  const header = (grid[0] ?? []).map(squash);
  const col = Object.fromEntries(
    Object.entries(IMPORT_COLUMNS).map(([key, title]) => [key, header.indexOf(squash(title))]),
  ) as Record<keyof typeof IMPORT_COLUMNS, number>;
  if (col.description < 0 || col.source < 0) {
    return {
      rows: [],
      errors: [{ row: 1, message: `ستون‌های «${IMPORT_COLUMNS.description}» و «${IMPORT_COLUMNS.source}» در ردیف اول لازم است` }],
    };
  }

  const rows: PartImportRow[] = [];
  const errors: { row: number; message: string }[] = [];
  const cell = (r: string[], key: keyof typeof IMPORT_COLUMNS) => (col[key] >= 0 ? (r[col[key]] ?? '').trim() : '');
  grid.slice(1).forEach((r, i) => {
    const rowNo = i + 2;
    if (!r.some((v) => v)) return;
    const problems: string[] = [];
    const description = cell(r, 'description');
    if (!description) problems.push('شرح قطعه خالی است');
    if (description.length > 300) problems.push('شرح قطعه بیش از ۳۰۰ نویسه است');
    const source = SOURCE_ALIASES.get(cell(r, 'source')) ?? SOURCE_ALIASES.get(cell(r, 'source').toLowerCase());
    if (!source) problems.push(`منبع «${cell(r, 'source')}» شناخته نشد`);
    const qtyText = cell(r, 'quantity');
    const quantity = qtyText ? numberOf(qtyText) : 1;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) problems.push('تعداد باید عدد صحیح ۱ تا ۹۹۹ باشد');
    const priceText = cell(r, 'approvedUnitPriceRial');
    const price = priceText ? numberOf(priceText) : null;
    if (price !== null && (!Number.isInteger(price) || price < 0 || price > 1_000_000_000_000)) {
      problems.push('قیمت باید عدد صحیح ریالی باشد');
    }
    if (problems.length) {
      errors.push({ row: rowNo, message: problems.join('؛ ') });
      return;
    }
    rows.push({
      row: rowNo,
      description,
      partNumber: cell(r, 'partNumber') || null,
      quantity,
      source: source!,
      approvedUnitPriceRial: price,
      notes: cell(r, 'notes') || null,
    });
  });
  if (!rows.length && !errors.length) errors.push({ row: 2, message: 'ردیفی برای ورود پیدا نشد' });
  return { rows, errors };
}
