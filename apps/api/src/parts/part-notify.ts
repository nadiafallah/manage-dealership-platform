import { and, eq, inArray, notInArray } from 'drizzle-orm';
import { normalizeRoles } from '@manage/shared';
import { newId } from '../common/ids';
import type { DbOrTx } from '../db/database';
import { cases, notifications, tasks, users } from '../db/schema';

export interface PartNotice {
  kind: string;
  title: string;
  body?: string | null;
  link?: string | null;
  /** One notice per recipient and key: repeating the same event never spams. */
  dedupeKey: string;
}

/** Writes one in-app notice per recipient (deduplicated per user and key). */
export async function notifyUsers(tx: DbOrTx, tenantId: string, userIds: Iterable<string | null | undefined>, n: PartNotice) {
  const ids = [...new Set([...userIds].filter((x): x is string => !!x))];
  if (!ids.length) return;
  await tx
    .insert(notifications)
    .values(ids.map((userId) => ({ id: newId(), tenantId, userId, kind: n.kind, title: n.title, body: n.body ?? null, link: n.link ?? null, dedupeKey: n.dedupeKey })))
    .onConflictDoNothing();
}

/** Active colleagues holding one of the roles. */
export async function usersWithRole(tx: DbOrTx, tenantId: string, roles: string[]) {
  const rows = await tx.select({ id: users.id, roles: users.roles }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.isActive, true)));
  return rows.filter((u) => normalizeRoles(u.roles).some((r) => roles.includes(r))).map((u) => u.id);
}

/**
 * «قطعه آماده است» (spec section 7): the accident expert of the case and the
 * technicians of its open repair steps hear about it; nobody else.
 */
export async function caseAndBayRecipients(tx: DbOrTx, tenantId: string, caseId: string): Promise<string[]> {
  const [kase] = await tx.select({ responsible: cases.responsibleUserId }).from(cases).where(and(eq(cases.id, caseId), eq(cases.tenantId, tenantId)));
  const open = await tx
    .select({ assigned: tasks.assignedUserId })
    .from(tasks)
    .where(and(eq(tasks.tenantId, tenantId), eq(tasks.caseId, caseId), notInArray(tasks.status, ['approved'])));
  return [kase?.responsible, ...open.map((t) => t.assigned)].filter((x): x is string => !!x);
}

export const partLink = (caseId: string, _partId: string) => `/cases/${caseId}#case-parts`;

/** Ids of the given parts that still belong to an open case (for auto transitions). */
export async function openCaseIds(tx: DbOrTx, tenantId: string, caseIds: string[]) {
  if (!caseIds.length) return new Set<string>();
  const rows = await tx.select({ id: cases.id }).from(cases).where(and(eq(cases.tenantId, tenantId), inArray(cases.id, caseIds), eq(cases.status, 'open')));
  return new Set(rows.map((r) => r.id));
}

