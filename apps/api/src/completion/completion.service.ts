import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  COMPLETION_ISSUE_LABELS,
  QC_CHECK_LABELS,
  type CaseCompletion,
  type CaseFinance,
  type CloseState,
  type CompletionIssue,
  type CompletionIssueCode,
  type DeliveryInput,
  type FinancialCloseInput,
  type QcCheck,
  type QcInspection,
  type RecipientRelation,
  type RecordQcInput,
  type TechnicalCloseInput,
} from '@manage/shared';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../auth/auth.types';
import { assertNotFuture, CasesService, MINUTE_TOLERANCE_MS } from '../cases/cases.service';
import { badRequest, notFound } from '../common/errors';
import { newId } from '../common/ids';
import { DATABASE, type DatabaseHandle, type DbOrTx } from '../db/database';
import { assessments, blockers, cases, departments, partRequests, qcInspections, tasks, users } from '../db/schema';
import { FinanceService } from '../finance/finance.service';
import { StockService } from '../daily-reports/stock.service';
import { PartsService } from '../parts/parts.service';

type CaseRow = typeof cases.$inferSelect;
type QcRow = typeof qcInspections.$inferSelect;

const issue = (code: CompletionIssueCode, extra: Omit<CompletionIssue, 'code' | 'message'> = {}): CompletionIssue => ({
  code,
  message: COMPLETION_ISSUE_LABELS[code],
  ...extra,
});
const blocking = (issues: CompletionIssue[]) => issues.filter((i) => !i.warning);
const listOf = (issues: CompletionIssue[]) => issues.map((i) => i.message).join('؛ ');
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

interface Evaluation {
  kase: CaseRow;
  qc: QcRow[];
  technicalIssues: CompletionIssue[];
  technicalValid: boolean;
  finance: CaseFinance;
  financialIssues: CompletionIssue[];
  financialValid: boolean;
  deliveryIssues: CompletionIssue[];
}

/**
 * Completion of a case (issue #12): QC rounds with corrective work, technical
 * close, financial close (settlement) and the handover. Technical and
 * financial close are independent gates; the handover needs both and
 * re-checks them, so anything that changed after a close is caught.
 */
@Injectable()
export class CompletionService {
  constructor(
    @Inject(DATABASE) private readonly handle: DatabaseHandle,
    private readonly audit: AuditService,
    private readonly cases: CasesService,
    private readonly parts: PartsService,
    private readonly finance: FinanceService,
    private readonly stock: StockService,
  ) {}

  private get db() {
    return this.handle.db;
  }

  // ---------------------------------------------------------------- commands

  /** One QC round. Every failed item opens a corrective activity and returns the case to repair. */
  async recordQc(actor: Actor, caseId: string, input: RecordQcInput): Promise<CaseCompletion> {
    const tenantId = actor.user.tenantId;
    const at = input.at ? new Date(input.at) : new Date();
    assertNotFuture(at, 'زمان کنترل کیفیت نمی‌تواند در آینده باشد');
    await this.db.transaction(async (tx) => {
      const kase = await this.cases.loadForWrite(tx, tenantId, caseId, input.expectedVersion);
      assertOpen(kase);
      const work = await tx
        .select({ status: tasks.status, approvedAt: tasks.approvedAt })
        .from(tasks)
        .where(eq(tasks.caseId, caseId));
      const unfinished = work.filter((t) => t.status !== 'approved').length;
      if (unfinished) {
        throw badRequest('QC_WORK_UNFINISHED', 'کنترل کیفیت پس از تأیید همه فعالیت‌ها توسط سرپرست ثبت می‌شود', {
          unapprovedTasks: unfinished,
        });
      }
      const lastApproval = Math.max(0, ...work.map((t) => t.approvedAt?.getTime() ?? 0));
      if (at.getTime() < lastApproval - MINUTE_TOLERANCE_MS) {
        throw badRequest('INVALID_TIME', 'زمان کنترل کیفیت نمی‌تواند قبل از تأیید آخرین فعالیت باشد');
      }

      const failed = input.checks.filter((c) => c.result === 'fail');
      const deptIds = [...new Set(failed.map((c) => c.departmentId!))];
      if (deptIds.length) {
        const found = await tx
          .select({ id: departments.id })
          .from(departments)
          .where(
            and(eq(departments.tenantId, tenantId), inArray(departments.id, deptIds), eq(departments.isActive, true)),
          );
        if (found.length !== deptIds.length) throw badRequest('INVALID_DEPARTMENT', 'واحد انتخاب‌شده معتبر نیست');
      }

      const [{ last }] = (await tx
        .select({ last: sql<number>`coalesce(max(${qcInspections.round}), 0)::int` })
        .from(qcInspections)
        .where(eq(qcInspections.caseId, caseId))) as [{ last: number }];
      const round = last + 1;
      const id = newId();
      const outcome = failed.length ? 'failed' : 'passed';
      const checks: QcCheck[] = input.checks.map((c) => ({
        item: c.item,
        result: c.result,
        note: c.note ?? null,
        departmentId: c.result === 'fail' ? c.departmentId! : null,
        correctiveTaskId: c.result === 'fail' ? newId() : null,
      }));
      const [row] = await tx
        .insert(qcInspections)
        .values({
          id,
          tenantId,
          caseId,
          round,
          outcome,
          checks,
          note: input.note ?? null,
          inspectedAt: at,
          inspectedBy: actor.user.id,
          isTest: actor.user.isTestTenant,
          createdAt: new Date(),
        })
        .returning();
      await this.audit.record(tx, actor, {
        entityType: 'qc',
        entityId: id,
        caseId,
        action: 'qc.recorded',
        occurredAt: at,
        reason: input.note ?? null,
        after: { round, outcome, failed: failed.map((c) => c.item) },
        snapshot: { version: 1, row: row! },
      });

      const [{ n }] = (await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(tasks)
        .where(eq(tasks.caseId, caseId))) as [{ n: number }];
      for (const [i, c] of checks.filter((x) => x.result === 'fail').entries()) {
        const title = `اصلاح پس از کنترل کیفیت (دور ${round}): ${QC_CHECK_LABELS[c.item]}`;
        const [t] = await tx
          .insert(tasks)
          .values({
            id: c.correctiveTaskId!,
            tenantId,
            caseId,
            departmentId: c.departmentId!,
            title,
            notes: c.note,
            sortOrder: n + i + 1,
            qcInspectionId: id,
            isTest: actor.user.isTestTenant,
            createdBy: actor.user.id,
          })
          .returning();
        await this.audit.record(tx, actor, {
          entityType: 'task',
          entityId: t!.id,
          caseId,
          action: 'task.created',
          reason: c.note,
          after: { departmentId: c.departmentId, title, qcInspectionId: id, dependsOn: [] },
          snapshot: { version: 1, row: { ...t!, dependsOn: [] } },
        });
      }

      if (outcome === 'failed') {
        // Corrective work reopens the case; a technical close no longer holds.
        await this.cases.applyStage(
          tx,
          actor,
          kase,
          { stage: 'in_repair', technicalClosedAt: null, technicalClosedBy: null, technicalCloseNote: null },
          `خودکار: رد کنترل کیفیت دور ${round} — کار اصلاحی`,
        );
      } else if (kase.stage !== 'quality_control' && kase.stage !== 'ready_for_delivery') {
        await this.cases.applyStage(tx, actor, kase, { stage: 'quality_control' }, `خودکار: قبولی کنترل کیفیت دور ${round}`);
      }
    });
    return this.get(actor, caseId);
  }

  async technicalClose(actor: Actor, caseId: string, input: TechnicalCloseInput): Promise<CaseCompletion> {
    await this.db.transaction(async (tx) => {
      const kase = await this.cases.loadForWrite(tx, actor.user.tenantId, caseId, input.expectedVersion);
      assertOpen(kase);
      const ev = await this.evaluate(tx, kase);
      if (ev.technicalValid) throw badRequest('ALREADY_CLOSED', 'بستن فنی قبلاً انجام شده است');
      const issues = blocking(ev.technicalIssues);
      if (issues.length) {
        throw badRequest('TECHNICAL_CLOSE_BLOCKED', `بستن فنی ممکن نیست: ${listOf(issues)}`, { issues });
      }
      await this.cases.applyPatch(
        tx,
        actor,
        kase,
        {
          stage: 'ready_for_delivery',
          technicalClosedAt: new Date(),
          technicalClosedBy: actor.user.id,
          technicalCloseNote: input.note ?? null,
        },
        'case.technical_closed',
        input.note ?? null,
      );
    });
    return this.get(actor, caseId);
  }

  /**
   * Financial close: the statement of the current final assessment is settled.
   * Invoicing and payments are recorded in the accounting system (spec decision 3),
   * so no balance or payer share is checked. The estimate at the close is kept so
   * a later supplement invalidates it.
   */
  async financialClose(actor: Actor, caseId: string, input: FinancialCloseInput): Promise<CaseCompletion> {
    await this.db.transaction(async (tx) => {
      const kase = await this.cases.loadForWrite(tx, actor.user.tenantId, caseId, input.expectedVersion);
      assertOpen(kase);
      const ev = await this.evaluate(tx, kase);
      if (ev.financialValid) throw badRequest('ALREADY_CLOSED', 'بستن مالی قبلاً انجام شده است');
      const issues = blocking(ev.financialIssues);
      if (issues.length) throw badRequest('FINANCIAL_CLOSE_BLOCKED', `بستن مالی ممکن نیست: ${listOf(issues)}`, { issues });
      await this.cases.applyPatch(
        tx,
        actor,
        kase,
        {
          financialClosedAt: new Date(),
          financialClosedBy: actor.user.id,
          financialCloseNote: input.note ?? null,
          financialCloseEstimateRial: ev.finance.estimateRial,
          financialCloseShareRial: ev.finance.customerShareRial,
          // No balance gate any more (spec decision 3); kept for the column's history.
          financialCloseWaivedRial: 0,
        },
        'case.financial_closed',
        input.note ?? null,
      );
    });
    return this.get(actor, caseId);
  }

  /** Handover to the recipient. Archives the case (status closed). */
  async deliver(actor: Actor, caseId: string, input: DeliveryInput): Promise<CaseCompletion> {
    const at = input.at ? new Date(input.at) : new Date();
    assertNotFuture(at, 'زمان تحویل نمی‌تواند در آینده باشد');
    await this.db.transaction(async (tx) => {
      const kase = await this.cases.loadForWrite(tx, actor.user.tenantId, caseId, input.expectedVersion);
      assertOpen(kase);
      const ev = await this.evaluate(tx, kase);
      if (ev.deliveryIssues.length) {
        throw badRequest('DELIVERY_GATE', `تحویل خودرو ممکن نیست: ${listOf(ev.deliveryIssues)}`, {
          issues: ev.deliveryIssues,
        });
      }
      const closedAt = Math.max(kase.technicalClosedAt!.getTime(), kase.financialClosedAt!.getTime());
      if (at.getTime() < closedAt - MINUTE_TOLERANCE_MS) {
        throw badRequest('INVALID_TIME', 'زمان تحویل نمی‌تواند قبل از بستن فنی و مالی باشد');
      }
      await this.cases.applyPatch(
        tx,
        actor,
        kase,
        {
          stage: 'delivered',
          status: 'closed',
          actualDeliveryAt: at,
          deliveredBy: actor.user.id,
          recipientName: input.recipientName,
          recipientRelation: input.recipientRelation,
          deliveryNote: input.note ?? null,
        },
        'case.delivered',
        input.note ?? null,
        at,
      );
      // «پایان کار»: the parts of this case stop lowering the usable stock (spec section 7).
      await this.stock.finishCase(tx, actor, caseId);
    });
    return this.get(actor, caseId);
  }

  // ----------------------------------------------------------------- queries

  async get(actor: Actor, caseId: string): Promise<CaseCompletion> {
    // Read without loadForWrite: a delivered case is closed but still readable.
    const [kase] = await this.db
      .select()
      .from(cases)
      .where(and(eq(cases.id, caseId), eq(cases.tenantId, actor.user.tenantId)));
    if (!kase) throw notFound('پرونده');
    const ev = await this.evaluate(this.db, kase);
    const userIds = [
      ...new Set(
        [kase.technicalClosedBy, kase.financialClosedBy, kase.deliveredBy, ...ev.qc.map((q) => q.inspectedBy)].filter(
          (x): x is string => !!x,
        ),
      ),
    ];
    const names = new Map(
      userIds.length
        ? (
            await this.db
              .select({ id: users.id, displayName: users.displayName })
              .from(users)
              .where(inArray(users.id, userIds))
          ).map((u) => [u.id, u.displayName])
        : [],
    );
    const ref = (id: string | null) => (id ? { id, displayName: names.get(id) ?? '' } : null);
    const close = (
      closedAt: Date | null,
      closedBy: string | null,
      note: string | null,
      valid: boolean,
      issues: CompletionIssue[],
    ): CloseState => ({ closedAt: iso(closedAt), closedBy: ref(closedBy), note, valid, issues });

    return {
      caseId,
      qc: ev.qc.map(
        (q): QcInspection => ({
          id: q.id,
          round: q.round,
          outcome: q.outcome as QcInspection['outcome'],
          checks: q.checks as QcCheck[],
          note: q.note,
          inspectedAt: q.inspectedAt.toISOString(),
          inspectedBy: ref(q.inspectedBy)!,
        }),
      ),
      technical: close(
        kase.technicalClosedAt,
        kase.technicalClosedBy,
        kase.technicalCloseNote,
        ev.technicalValid,
        ev.technicalIssues,
      ),
      financial: {
        ...close(kase.financialClosedAt, kase.financialClosedBy, kase.financialCloseNote, ev.financialValid, ev.financialIssues),
        waivedRial: kase.financialClosedAt ? (kase.financialCloseWaivedRial ?? 0) : null,
      },
      delivery:
        kase.stage === 'delivered' && kase.actualDeliveryAt && kase.recipientName
          ? {
              deliveredAt: kase.actualDeliveryAt.toISOString(),
              recipientName: kase.recipientName,
              recipientRelation: kase.recipientRelation as RecipientRelation,
              note: kase.deliveryNote,
              deliveredBy: ref(kase.deliveredBy)!,
            }
          : null,
      deliveryIssues: kase.stage === 'delivered' ? [] : ev.deliveryIssues,
    };
  }

  // ------------------------------------------------------------- evaluation

  private async evaluate(db: DbOrTx, kase: CaseRow): Promise<Evaluation> {
    const tenantId = kase.tenantId;
    const caseId = kase.id;
    const qc = await db
      .select()
      .from(qcInspections)
      .where(and(eq(qcInspections.tenantId, tenantId), eq(qcInspections.caseId, caseId)))
      .orderBy(asc(qcInspections.round));
    const versions = await db
      .select({ status: assessments.status, authorizationStatus: assessments.authorizationStatus })
      .from(assessments)
      .where(and(eq(assessments.tenantId, tenantId), eq(assessments.caseId, caseId)))
      .orderBy(desc(assessments.versionNo));
    const assessmentIssues: CompletionIssue[] = [];
    if (versions.some((v) => v.status === 'draft')) assessmentIssues.push(issue('assessment_draft'));
    if (versions.find((v) => v.status === 'final')?.authorizationStatus === 'pending') {
      assessmentIssues.push(issue('authorization_pending'));
    }

    // ---- technical
    const technicalIssues: CompletionIssue[] = [];
    const work = await db
      .select({ status: tasks.status, departmentId: tasks.departmentId, updatedAt: tasks.updatedAt })
      .from(tasks)
      .where(eq(tasks.caseId, caseId));
    const unapproved = work.filter((t) => t.status !== 'approved').length;
    if (unapproved) technicalIssues.push(issue('tasks_unapproved', { count: unapproved }));
    const [{ open }] = (await db
      .select({ open: sql<number>`count(*)::int` })
      .from(blockers)
      .where(and(eq(blockers.caseId, caseId), isNull(blockers.resolvedAt)))) as [{ open: number }];
    if (open) technicalIssues.push(issue('open_blockers', { count: open }));
    technicalIssues.push(...assessmentIssues);

    const parts = await db
      .select({ status: partRequests.status, root: partRequests.assessmentItemId })
      .from(partRequests)
      .where(eq(partRequests.caseId, caseId));
    const openParts = parts.filter((p) => p.status !== 'handed_over' && p.status !== 'cancelled').length;
    if (openParts) technicalIssues.push(issue('parts_open', { count: openParts }));
    const lines = (await this.parts.authorizedLines(db, tenantId, caseId)) ?? [];
    const installed = new Set(parts.filter((p) => p.status === 'handed_over').map((p) => p.root));
    const missing = lines.filter((l) => l.approved && l.item.action === 'replace' && !installed.has(l.root)).length;
    if (missing) technicalIssues.push(issue('lines_without_part', { count: missing }));
    // Labour reconciliation is advisory: departments are a coarse match for assessment lines.
    const doneDepts = new Set(work.filter((t) => t.status === 'approved').map((t) => t.departmentId));
    const labourDepts = new Set(
      lines
        .filter((l) => l.approved && l.item.labourRial > 0 && l.item.labourDepartmentId)
        .map((l) => l.item.labourDepartmentId!)
        .filter((d) => !doneDepts.has(d)),
    );
    if (labourDepts.size) technicalIssues.push(issue('labour_without_task', { count: labourDepts.size, warning: true }));

    const latest = qc.at(-1);
    // Any activity touched after the round was recorded (reopened, re-approved,
    // added) needs a new round. Both times come from the application clock.
    const lastChange = Math.max(0, ...work.map((t) => t.updatedAt.getTime()));
    if (!latest) technicalIssues.push(issue('qc_missing'));
    else if (latest.outcome === 'failed') technicalIssues.push(issue('qc_failed'));
    else if (lastChange > latest.createdAt.getTime()) technicalIssues.push(issue('qc_stale'));
    // A close made before the latest QC round must be confirmed again.
    const technicalValid =
      !!kase.technicalClosedAt &&
      !!latest &&
      kase.technicalClosedAt.getTime() >= latest.createdAt.getTime() &&
      blocking(technicalIssues).length === 0;

    // ---- financial
    // Spec decision 3: the official invoice and payments live in the accounting
    // system. Manage only checks that the final statement is settled on the
    // current assessment; payer shares and the customer balance never block.
    const finance = await this.finance.summaryOn(db, tenantId, caseId);
    const financialIssues: CompletionIssue[] = [];
    if (!versions.some((v) => v.status === 'final')) financialIssues.push(issue('no_final_assessment'));
    financialIssues.push(...assessmentIssues);
    const financialValid =
      !!kase.financialClosedAt &&
      finance.estimateRial === kase.financialCloseEstimateRial &&
      blocking(financialIssues).length === 0;

    const deliveryIssues: CompletionIssue[] = [];
    if (!technicalValid) deliveryIssues.push(issue('technical_not_closed'));
    if (!financialValid) deliveryIssues.push(issue('financial_not_closed'));

    return { kase, qc, technicalIssues, technicalValid, finance, financialIssues, financialValid, deliveryIssues };
  }
}

function assertOpen(kase: CaseRow) {
  if (kase.stage === 'delivered' || kase.status !== 'open') {
    throw badRequest('CASE_DELIVERED', 'پرونده تحویل یا بسته شده است');
  }
}
