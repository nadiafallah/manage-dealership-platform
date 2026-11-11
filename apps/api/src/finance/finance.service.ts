import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, ne, notInArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  FINANCE_GATE_LABELS,
  type CaseFinance,
  type FinanceApproval,
  type FinanceDecisionInput,
  type FinanceGateReason,
  type FinancePaymentInput,
  type FinanceSharesInput,
  type ProposeFinanceInput,
  type SettlementPayment,
  type SettlementPaymentInput,
} from '@manage/shared';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../auth/auth.types';
import { CasesService } from '../cases/cases.service';
import { AppError, notFound, versionConflict } from '../common/errors';
import { DATABASE, type DatabaseHandle, type DbOrTx } from '../db/database';
import { assessments, caseFinance, casePayments, cases, financialApprovals, partRequests, users } from '../db/schema';


const proposedByUser = alias(users, 'finance_proposed_by');
const decidedByUser = alias(users, 'finance_decided_by');
const paidByUser = alias(users, 'finance_paid_by');

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** The advance / exception / cashier flow is switched off (spec sections 3 and 9); old rows stay readable. */
export const financeFlowRetired = () =>
  new AppError(HttpStatus.GONE, 'FINANCE_FLOW_RETIRED', 'روال پیشنهاد، تأیید و دریافت پیش‌پرداخت حذف شده است؛ تصمیم پیش‌پرداخت را روی هشدار هزینهٔ همان پرونده ثبت کنید. فاکتور و دریافت در سامانهٔ حسابداری ثبت می‌شود.');

// Sources that are bought for the case; stock and customer parts are not purchases.
export const PURCHASE_SOURCES = ['company', 'external', 'insurer_supplier'];

export interface GateResult {
  open: boolean;
  reason: FinanceGateReason;
  exceptionId?: string;
}

interface GateInputs {
  coverageType: string;
  estimateRial: number;
  customerShareRial: number | null;
  paid: { coversEstimateRial: number }[];
  exceptions: { id: string; amountRial: number; spentRial: number }[];
}

/** Customer share used by the gate: recorded value, otherwise derived from the coverage. */
export function customerShareOf(coverageType: string, recorded: number | null | undefined, estimateRial: number) {
  if (recorded !== null && recorded !== undefined) return { value: recorded, derived: false };
  if (coverageType === 'personal') return { value: estimateRial, derived: true };
  if (coverageType === 'golden_card' || coverageType === 'insurance') return { value: 0, derived: true };
  return { value: null, derived: true };
}

/**
 * Purchase gate. Only part purchases are held; documentation, planning, stock
 * reservation and repair work continue. A paid advance covers the estimate it
 * was approved for: a supplement that raises the estimate closes the gate
 * again until a new advance (or an exception) is approved.
 */
export function evaluateGate(g: GateInputs, purchaseRial: number): GateResult {
  const share = customerShareOf(g.coverageType, g.customerShareRial, g.estimateRial);
  if (share.value === null) return { open: false, reason: 'shares_unknown' };
  if (share.value === 0) {
    if (g.coverageType === 'personal' && g.estimateRial === 0) return { open: false, reason: 'no_estimate' };
    return { open: true, reason: 'no_customer_share' };
  }
  const covered = Math.max(0, ...g.paid.map((p) => p.coversEstimateRial));
  if (g.paid.length && covered >= g.estimateRial) return { open: true, reason: 'advance_paid' };
  const exception = g.exceptions.find((e) => e.amountRial - e.spentRial >= purchaseRial);
  if (exception) return { open: true, reason: 'exception', exceptionId: exception.id };
  return { open: false, reason: g.paid.length ? 're_approval_required' : 'advance_missing' };
}

@Injectable()
export class FinanceService {
  constructor(
    @Inject(DATABASE) private readonly handle: DatabaseHandle,
    private readonly audit: AuditService,
    private readonly cases: CasesService,
  ) {}

  private get db() {
    return this.handle.db;
  }

  // ---------------------------------------------------------------- commands

  async setShares(actor: Actor, caseId: string, input: FinanceSharesInput): Promise<CaseFinance> {
    const tenantId = actor.user.tenantId;
    await this.db.transaction(async (tx) => {
      await this.cases.loadForWrite(tx, tenantId, caseId);
      const [current] = await tx.select().from(caseFinance).where(eq(caseFinance.caseId, caseId));
      const values = {
        customerShareRial: input.customerShareRial,
        insurerShareRial: input.insurerShareRial,
        companyShareRial: input.companyShareRial,
        note: input.note ?? null,
      };
      let row: typeof caseFinance.$inferSelect | undefined;
      if (!current) {
        [row] = await tx
          .insert(caseFinance)
          .values({ caseId, tenantId, ...values, updatedBy: actor.user.id, isTest: actor.user.isTestTenant })
          .returning();
      } else {
        if (input.expectedVersion !== current.version) throw versionConflict(current.version);
        [row] = await tx
          .update(caseFinance)
          .set({ ...values, updatedAt: new Date(), updatedBy: actor.user.id, version: current.version + 1 })
          .where(and(eq(caseFinance.caseId, caseId), eq(caseFinance.version, current.version)))
          .returning();
        if (!row) throw versionConflict();
      }
      await this.audit.record(tx, actor, {
        entityType: 'finance',
        entityId: caseId,
        caseId,
        action: 'finance.shares_set',
        reason: input.note ?? null,
        before: current
          ? {
              customerShareRial: current.customerShareRial,
              insurerShareRial: current.insurerShareRial,
              companyShareRial: current.companyShareRial,
            }
          : null,
        after: {
          customerShareRial: values.customerShareRial,
          insurerShareRial: values.insurerShareRial,
          companyShareRial: values.companyShareRial,
        },
        snapshot: { version: row!.version, row: row! },
      });
    });
    return this.summary(actor, caseId);
  }

  /** Retired (spec section 9): the expert records the advance decision on the cost alert instead. */
  async propose(_actor: Actor, _caseId: string, _input: ProposeFinanceInput): Promise<CaseFinance> {
    throw financeFlowRetired();
  }

  /** Retired: the service manager no longer approves advances (spec section 9). */
  async decide(_actor: Actor, _id: string, _input: FinanceDecisionInput): Promise<CaseFinance> {
    throw financeFlowRetired();
  }

  /** Retired: there is no cashier confirmation any more (spec section 3). */
  async confirmPayment(_actor: Actor, _id: string, _input: FinancePaymentInput): Promise<CaseFinance> {
    throw financeFlowRetired();
  }

  /** Retired: the official invoice and payments are recorded in the accounting system, outside Manage (spec decision 3). */
  async recordPayment(_actor: Actor, _caseId: string, _input: SettlementPaymentInput): Promise<CaseFinance> {
    throw financeFlowRetired();
  }

  // ------------------------------------------------------------------- gate

  /** Purchase gate for a case, evaluated inside the caller's transaction. */
  async gate(tx: DbOrTx, tenantId: string, caseId: string, purchaseRial: number): Promise<GateResult> {
    return evaluateGate(await this.gateInputs(tx, tenantId, caseId), purchaseRial);
  }

  private async gateInputs(db: DbOrTx, tenantId: string, caseId: string): Promise<GateInputs> {
    const [kase] = await db
      .select({ coverageType: cases.coverageType })
      .from(cases)
      .where(and(eq(cases.id, caseId), eq(cases.tenantId, tenantId)));
    if (!kase) throw notFound('پرونده');
    const [shares] = await db.select().from(caseFinance).where(eq(caseFinance.caseId, caseId));
    const approvals = await db
      .select()
      .from(financialApprovals)
      .where(and(eq(financialApprovals.caseId, caseId), inArray(financialApprovals.status, ['approved', 'paid'])));
    const spent = await this.spentByException(
      db,
      approvals.filter((a) => a.kind === 'exception').map((a) => a.id),
    );
    const estimate=await this.estimateOf(db,tenantId,caseId);
    const share=customerShareOf(kase.coverageType,shares?.customerShareRial,estimate).value;
    const receipts=await db.select({amount:casePayments.amountRial}).from(casePayments).where(and(eq(casePayments.caseId,caseId),eq(casePayments.tenantId,tenantId)));
    const collected=receipts.reduce((sum,r)=>sum+r.amount,0);
    return {
      coverageType: kase.coverageType,
      estimateRial: await this.estimateOf(db, tenantId, caseId),
      customerShareRial: shares?.customerShareRial ?? null,
      paid: [...approvals.filter((a) => a.kind === 'advance' && a.status === 'paid'),...(share!==null&&share>0&&collected>=share?[{coversEstimateRial:estimate}]:[])],
      exceptions: approvals
        .filter((a) => a.kind === 'exception' && a.status === 'approved')
        .map((a) => ({ id: a.id, amountRial: a.amountRial, spentRial: spent.get(a.id) ?? 0 })),
    };
  }

  /** Approved amount of the current final assessment version (total while authorization is pending). */
  async estimateOf(db: DbOrTx, tenantId: string, caseId: string): Promise<number> {
    const [a] = await db
      .select({ parts: assessments.partsRial, labour: assessments.labourRial, approved: assessments.approvedRial })
      .from(assessments)
      .where(and(eq(assessments.tenantId, tenantId), eq(assessments.caseId, caseId), eq(assessments.status, 'final')))
      .orderBy(desc(assessments.versionNo))
      .limit(1);
    return a ? (a.approved ?? a.parts + a.labour) : 0;
  }

  private async spentByException(db: DbOrTx, ids: string[]): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const rows = await db
      .select({
        id: partRequests.financeExceptionId,
        spent: sql<number>`coalesce(sum(${partRequests.quantity} * ${partRequests.unitPriceRial}), 0)::bigint`,
      })
      .from(partRequests)
      .where(and(inArray(partRequests.financeExceptionId, ids), ne(partRequests.status, 'cancelled')))
      .groupBy(partRequests.financeExceptionId);
    return new Map(rows.map((r) => [r.id!, Number(r.spent)]));
  }

  // ----------------------------------------------------------------- queries

  async summary(actor: Actor, caseId: string): Promise<CaseFinance> {
    return this.summaryOn(this.db, actor.user.tenantId, caseId);
  }

  /** Finance summary read through `db` (a transaction when called by the financial close). */
  async summaryOn(db: DbOrTx, tenantId: string, caseId: string): Promise<CaseFinance> {
    const [kase] = await db
      .select({ coverageType: cases.coverageType })
      .from(cases)
      .where(and(eq(cases.id, caseId), eq(cases.tenantId, tenantId)));
    if (!kase) throw notFound('پرونده');
    const inputs = await this.gateInputs(db, tenantId, caseId);
    const gate = evaluateGate(inputs, 0);
    const [shares] = await db.select().from(caseFinance).where(eq(caseFinance.caseId, caseId));
    const share = customerShareOf(kase.coverageType, shares?.customerShareRial, inputs.estimateRial);

    const rows = await db
      .select({
        a: financialApprovals,
        proposedByName: proposedByUser.displayName,
        decidedByName: decidedByUser.displayName,
        paidByName: paidByUser.displayName,
      })
      .from(financialApprovals)
      .innerJoin(proposedByUser, eq(proposedByUser.id, financialApprovals.proposedBy))
      .leftJoin(decidedByUser, eq(decidedByUser.id, financialApprovals.decidedBy))
      .leftJoin(paidByUser, eq(paidByUser.id, financialApprovals.paymentConfirmedBy))
      .where(and(eq(financialApprovals.tenantId, tenantId), eq(financialApprovals.caseId, caseId)))
      .orderBy(asc(financialApprovals.proposedAt));
    const spent = await this.spentByException(
      db,
      rows.filter((r) => r.a.kind === 'exception').map((r) => r.a.id),
    );
    const approvals: FinanceApproval[] = rows.map(({ a, proposedByName, decidedByName, paidByName }) => ({
      id: a.id,
      kind: a.kind as FinanceApproval['kind'],
      status: a.status as FinanceApproval['status'],
      amountRial: a.amountRial,
      coversEstimateRial: a.coversEstimateRial,
      spentRial: spent.get(a.id) ?? 0,
      reason: a.reason,
      proposedAt: a.proposedAt.toISOString(),
      proposedBy: { id: a.proposedBy, displayName: proposedByName },
      decidedAt: iso(a.decidedAt),
      decidedBy: a.decidedBy ? { id: a.decidedBy, displayName: decidedByName! } : null,
      decisionNote: a.decisionNote,
      paidAt: iso(a.paidAt),
      paymentRef: a.paymentRef,
      paymentConfirmedBy: a.paymentConfirmedBy ? { id: a.paymentConfirmedBy, displayName: paidByName! } : null,
      version: a.version,
    }));
    const paymentRows = await db
      .select({ p: casePayments, recordedByName: users.displayName })
      .from(casePayments)
      .innerJoin(users, eq(users.id, casePayments.recordedBy))
      .where(and(eq(casePayments.tenantId, tenantId), eq(casePayments.caseId, caseId)))
      .orderBy(asc(casePayments.paidAt));
    const payments: SettlementPayment[] = paymentRows.map(({ p, recordedByName }) => ({
      id: p.id,
      amountRial: p.amountRial,
      paymentRef: p.paymentRef,
      paidAt: p.paidAt.toISOString(),
      note: p.note,
      recordedBy: { id: p.recordedBy, displayName: recordedByName },
    }));
    const paidRial =
      approvals.filter((a) => a.status === 'paid').reduce((s, a) => s + a.amountRial, 0) +
      payments.reduce((s, p) => s + p.amountRial, 0);

    const [purchases] = await db
      .select({ total: sql<number>`coalesce(sum(${partRequests.quantity} * ${partRequests.unitPriceRial}), 0)::bigint` })
      .from(partRequests)
      .where(
        and(
          eq(partRequests.caseId, caseId),
          inArray(partRequests.source, PURCHASE_SOURCES),
          notInArray(partRequests.status, ['needed', 'cancelled']),
        ),
      );

    return {
      caseId,
      estimateRial: inputs.estimateRial,
      shares: {
        customerShareRial: shares?.customerShareRial ?? null,
        insurerShareRial: shares?.insurerShareRial ?? null,
        companyShareRial: shares?.companyShareRial ?? null,
        note: shares?.note ?? null,
        version: shares?.version ?? null,
      },
      customerShareRial: share.value,
      customerShareDerived: share.derived,
      paidRial,
      balanceRial: share.value === null ? null : Math.max(0, share.value - paidRial),
      purchasesRial: Number(purchases?.total ?? 0),
      gate: { open: gate.open, reason: gate.reason, message: FINANCE_GATE_LABELS[gate.reason] },
      approvals,
      payments,
    };
  }
}
