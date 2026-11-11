import { and, eq, inArray, isNull, isNotNull } from 'drizzle-orm';
import { EMDAD_ARRIVED_CATEGORIES, EMDAD_DEALER_SUPPLY_CATEGORY } from '@manage/shared';
import type { AuditService } from '../audit/audit.service';
import type { Actor } from '../auth/auth.types';
import type { DbOrTx } from '../db/database';
import { cases, emdadRequests, partRequests } from '../db/schema';
import { caseAndBayRecipients, notifyUsers, partLink, usersWithRole } from '../parts/part-notify';

/**
 * Daily Emdad Vijeh report → unified parts list (spec section 7). Runs inside
 * the publish transaction of the report.
 *  1. A request with no case link is linked by its request number when exactly
 *     one open Emdad line of Manage carries that number (never overrides a manual decision).
 *  2. «وارد موجودی» / «رسید توسط نمایندگی»: the line becomes «امداد ویژه رسیده»
 *     (ready for handover); the case's expert and its bays are told.
 *  3. «تأمین توسط نمایندگی»: the parts clerks are told to price and supply it.
 */
export async function applyEmdadToParts(tx: DbOrTx, audit: AuditService, actor: Actor, importId: string, reportAt: Date) {
  const tenantId = actor.user.tenantId;
  const result = { linkedByRequestNo: 0, arrived: 0, dealerSupply: 0 };

  // 1. Link by request number.
  const unlinked = await tx
    .select()
    .from(emdadRequests)
    .where(and(eq(emdadRequests.tenantId, tenantId), eq(emdadRequests.lastImportId, importId), isNull(emdadRequests.partRequestId), isNotNull(emdadRequests.requestNo), eq(emdadRequests.matchSource, 'auto')));
  const numbers = [...new Set(unlinked.map((r) => r.requestNo!).filter(Boolean))];
  if (numbers.length) {
    const candidates = await tx
      .select({ id: partRequests.id, caseId: partRequests.caseId, orderRef: partRequests.orderRef })
      .from(partRequests)
      .innerJoin(cases, eq(cases.id, partRequests.caseId))
      .where(and(eq(partRequests.tenantId, tenantId), inArray(partRequests.orderRef, numbers), eq(partRequests.source, 'company'), eq(partRequests.status, 'ordered'), eq(cases.status, 'open')));
    for (const r of unlinked) {
      const same = candidates.filter((c) => c.orderRef === r.requestNo);
      if (same.length !== 1) continue;
      await tx
        .update(emdadRequests)
        .set({ partRequestId: same[0]!.id, caseId: same[0]!.caseId, matchStatus: 'matched', matchNote: 'اتصال با شمارهٔ درخواست ثبت‌شده در منیج', updatedAt: new Date(), version: r.version + 1 })
        .where(and(eq(emdadRequests.id, r.id), eq(emdadRequests.version, r.version)));
      await audit.record(tx, actor, { entityType: 'part', entityId: same[0]!.id, caseId: same[0]!.caseId, action: 'emdad.linked_by_request_no', after: { requestId: r.id, requestNo: r.requestNo } });
      result.linkedByRequestNo += 1;
    }
  }

  // 2 and 3. Status of every linked line in this report.
  const linked = await tx
    .select({ e: emdadRequests, p: partRequests })
    .from(emdadRequests)
    .innerJoin(partRequests, eq(partRequests.id, emdadRequests.partRequestId))
    .innerJoin(cases, eq(cases.id, partRequests.caseId))
    .where(and(eq(emdadRequests.tenantId, tenantId), eq(emdadRequests.lastImportId, importId), eq(partRequests.status, 'ordered'), eq(partRequests.source, 'company'), eq(cases.status, 'open')));
  const clerks = linked.some((l) => l.e.statusCategory === EMDAD_DEALER_SUPPLY_CATEGORY) ? await usersWithRole(tx, tenantId, ['parts_clerk']) : [];
  for (const { e, p } of linked) {
    const official = (e.official ?? {}) as { emdadStatus?: string };
    if ((EMDAD_ARRIVED_CATEGORIES as readonly string[]).includes(e.statusCategory)) {
      const [saved] = await tx
        .update(partRequests)
        .set({ status: 'received', receivedAt: reportAt, inspection: 'ok', inspectionNote: null, receiptDocNo: null, updatedAt: new Date(), version: p.version + 1 })
        .where(and(eq(partRequests.id, p.id), eq(partRequests.version, p.version)))
        .returning();
      if (!saved) continue;
      await audit.record(tx, actor, {
        entityType: 'part',
        entityId: p.id,
        caseId: p.caseId,
        action: 'part.emdad_arrived',
        occurredAt: reportAt,
        before: { status: 'ordered', flowState: 'emdad' },
        after: { description: p.description, status: 'received', flowState: 'ready', emdadStatus: official.emdadStatus ?? null, requestNo: e.requestNo },
        snapshot: { version: saved.version, row: saved },
      });
      const to = await caseAndBayRecipients(tx, tenantId, p.caseId);
      await notifyUsers(tx, tenantId, to, { kind: 'part_ready', title: `امداد ویژه رسید: ${p.description}`, body: 'قطعه آمادهٔ تحویل به جایگاه است؛ تحویل بگیرید.', link: partLink(p.caseId, p.id), dedupeKey: `part_ready:${p.id}:${saved.version}` });
      result.arrived += 1;
    } else if (e.statusCategory === EMDAD_DEALER_SUPPLY_CATEGORY) {
      await notifyUsers(tx, tenantId, clerks, {
        kind: 'emdad_dealer_supply',
        title: `امداد ویژه: تأمین توسط نمایندگی — ${p.description}`,
        body: 'شرکت این قطعه را ندارد. قیمت بدهید و از بازار یا موجودی تأمین کنید (پس از مجوز پرداخت‌کننده).',
        link: partLink(p.caseId, p.id),
        dedupeKey: `emdad_dealer_supply:${p.id}:${e.id}`,
      });
      result.dealerSupply += 1;
    }
  }
  return result;
}
