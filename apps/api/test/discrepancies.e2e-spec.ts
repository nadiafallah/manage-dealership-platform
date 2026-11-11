import type { CaseDetail, Part, PartDiscrepancy, ReportResult } from '@manage/shared';
import { eq } from 'drizzle-orm';
import { partDiscrepancies, partRequests, tenants, users } from '../src/db/schema';
import { newId } from '../src/common/ids';
import { hashPassword } from '../src/auth/password';
import { Client, LEGACY_QC_PERMISSIONS, createHarness, daysAgo, TEST_PASSWORD, type Harness } from './harness';

// Parts discrepancy queue (#11): rules flag contradicting records once per
// condition; only a person closes an item, with a reason and history.

let h: Harness;
let expert: Client;
let supervisor: Client;
let manager: Client;
let parts: Client;
let qc: Client;
let depts: { id: string; code: string }[];
const dept = (code: string) => depts.find((d) => d.code === code)!.id;

async function newCase(): Promise<CaseDetail> {
  const res = await expert.post('/cases', {
    vehicle: { model: 'دنا', vin: `TESTVIN${Math.random().toString().slice(2, 12)}` },
    admittedAt: daysAgo(2),
    coverageType: 'personal',
  });
  expect(res.status).toBe(201);
  return res.body;
}
async function step(p: Part, action: string, extra: object = {}): Promise<Part> {
  const res = await parts.post(`/parts/${p.id}/actions`, { action, expectedVersion: p.version, ...extra });
  expect(res.status).toBe(201);
  return res.body;
}
const queue = async (who: Client = parts, query = ''): Promise<PartDiscrepancy[]> => {
  const res = await who.get(`/part-discrepancies${query}`);
  expect(res.status).toBe(200);
  return res.body;
};

beforeAll(async () => {
  h = await createHarness();
  [expert, supervisor, manager, parts, qc] = await Promise.all([...['expert', 'supervisor', 'manager', 'parts'].map((u) => h.login(u)), h.loginAs('narrow', [], LEGACY_QC_PERMISSIONS)]);
  depts = (await supervisor.get('/departments')).body;
});
afterAll(async () => {
  await h?.close();
});

describe('parts discrepancy queue', () => {
  it('flags "handover recorded but the unit reports a shortage" once, with the facts, and closes only with a reason', async () => {
    const c = await newCase();
    let p: Part = (await expert.post(`/cases/${c.id}/parts`, { description: 'چراغ جلو آزمون', source: 'stock' })).body;
    p = await step(p, 'check_stock', { inStock: true });
    p = await step(p, 'reserve');
    await step(p, 'hand_over', { departmentId: dept('body'), salePriceRial: 1_500_000, recipientName: 'تکنسین آزمون' });
    // The unit still reports the part missing (case-level blocker, not linked to the part).
    expect((await supervisor.post(`/cases/${c.id}/blockers`, { reason: 'part_not_arrived', description: 'واحد می‌گوید چراغ نرسیده' })).status).toBe(201);

    const first = (await queue()).filter((d) => d.caseId === c.id);
    expect(first).toHaveLength(1);
    const item = first[0]!;
    expect(item).toMatchObject({ kind: 'handover_vs_shortage', status: 'open', assignee: null, part: { description: 'چراغ جلو آزمون' } });
    expect(item.detail).toContain('تکنسین آزمون');
    // Detecting again (another list, a report) never duplicates the same discrepancy.
    await queue(manager);
    const report = (await manager.get('/reports?view=parts')).body as ReportResult;
    expect(report.items.rows.filter((r) => r.kind === 'discrepancy' && r.caseId === c.id)).toHaveLength(1);
    expect((await h.db.db.select().from(partDiscrepancies).where(eq(partDiscrepancies.caseId, c.id))).length).toBe(1);

    // Assign a reviewer, then close with a reason; no reason is refused.
    const assigned = await parts.post(`/part-discrepancies/${item.id}/assign`, { expectedVersion: item.version, assigneeUserId: (await parts.get('/auth/me')).body.id });
    expect(assigned.status).toBe(201);
    expect(assigned.body).toMatchObject({ status: 'in_review', assignee: { displayName: 'کاربر قطعات نمونه' } });
    const noReason = await parts.post(`/part-discrepancies/${item.id}/resolve`, { expectedVersion: assigned.body.version, outcome: 'resolved', reason: '' });
    expect(noReason.status).toBe(400);
    const stale = await parts.post(`/part-discrepancies/${item.id}/resolve`, { expectedVersion: item.version, outcome: 'resolved', reason: 'بررسی شد؛ قطعه در واحد پیدا شد' });
    expect(stale.status).toBe(409);
    const closed = await parts.post(`/part-discrepancies/${item.id}/resolve`, {
      expectedVersion: assigned.body.version,
      outcome: 'resolved',
      reason: 'بررسی شد؛ قطعه در قفسه واحد صافکاری پیدا شد، مانع رفع شد',
    });
    expect(closed.status).toBe(201);
    expect(closed.body).toMatchObject({ status: 'resolved', resolvedBy: { displayName: 'کاربر قطعات نمونه' }, resolutionReason: expect.stringContaining('قفسه') });
    const again = await parts.post(`/part-discrepancies/${item.id}/resolve`, { expectedVersion: closed.body.version, outcome: 'dismissed', reason: 'دوباره' });
    expect(again.body.code).toBe('DISCREPANCY_CLOSED');

    // History: detection time and every review step with its actor.
    const history = (await parts.get(`/part-discrepancies/${item.id}/history`)).body;
    expect(history.detectedAt).toBe(item.detectedAt);
    expect(history.events.map((e: { action: string }) => e.action)).toEqual(expect.arrayContaining(['discrepancy.detected', 'discrepancy.assigned', 'discrepancy.resolved']));
    // A resolved item is not raised again for the same condition.
    expect((await queue()).filter((d) => d.caseId === c.id)).toHaveLength(0);
    expect((await queue(parts, '?status=resolved')).some((d) => d.id === item.id)).toBe(true);
  });

  it('flags a wrong or defective part and a contradictory supply record; a vanished condition is marked, not closed', async () => {
    const c = await newCase();
    let p: Part = (await expert.post(`/cases/${c.id}/parts`, { description: 'سپر مشتری', source: 'customer' })).body;
    p = await step(p, 'order', { supplier: 'مشتری' });
    p = await step(p, 'receive', { inspection: 'defective', note: 'ترک در گوشه' });
    expect(p.status).toBe('rejected');
    // A record that never went through ordering (e.g. entered before Manage): received without an order.
    let q: Part = (await expert.post(`/cases/${c.id}/parts`, { description: 'گلگیر شرکت', source: 'company' })).body;
    await h.db.db.update(partRequests).set({ status: 'received', receivedAt: new Date() }).where(eq(partRequests.id, q.id));

    const items = (await queue(manager)).filter((d) => d.caseId === c.id);
    expect(items.map((d) => d.kind).sort()).toEqual(['supply_inconsistent', 'wrong_or_defective']);
    expect(items.find((d) => d.kind === 'wrong_or_defective')!.detail).toContain('ترک در گوشه');

    // The part is re-ordered: the "defective" condition is gone, but the item stays open for a person.
    p = await step(p, 'order', { supplier: 'مشتری' });
    const after = (await queue()).find((d) => d.kind === 'wrong_or_defective' && d.caseId === c.id)!;
    expect(after.status).toBe('open');
    expect(after.conditionClearedAt).toBeTruthy();
    expect(after.version).toBeGreaterThan(items.find((d) => d.id === after.id)!.version);
    const unchanged = (await queue()).find((d) => d.id === after.id)!;
    expect(unchanged.version).toBe(after.version);
    const history = (await parts.get(`/part-discrepancies/${after.id}/history`)).body;
    expect(history.events.filter((e: { action: string }) => e.action === 'discrepancy.condition_cleared')).toHaveLength(1);
    q = (await expert.get(`/cases/${c.id}/parts`)).body.find((x: Part) => x.id === q.id);
    expect(q.status).toBe('received');
  });

  it('is open to parts staff and the service manager only, per dealership', async () => {
    expect((await expert.get('/part-discrepancies')).status).toBe(403);
    expect((await qc.get('/part-discrepancies')).status).toBe(403);
    const any = (await queue(manager, '?status=all'))[0]!;
    expect((await expert.post(`/part-discrepancies/${any.id}/assign`, { expectedVersion: any.version, assigneeUserId: null })).status).toBe(403);
    expect((await supervisor.get('/part-discrepancies')).status).toBe(403); // coordinator does not manage parts
    const before = await h.db.db.select({ id: partDiscrepancies.id, version: partDiscrepancies.version }).from(partDiscrepancies);
    const tenantId = newId();
    await h.db.db.insert(tenants).values({ id: tenantId, code: 'other-discrepancies', name: 'نمایندگی دیگر آزمون', isTest: true });
    await h.db.db.insert(users).values({ id: newId(), tenantId, username: 'other-discrepancy-manager', displayName: 'مدیر دیگر آزمون', passwordHash: await hashPassword(TEST_PASSWORD), roles: ['parts_clerk'], isTest: true });
    const other = await h.login('other-discrepancy-manager', 'other-discrepancies');
    expect((await other.get('/part-discrepancies')).body).toEqual([]);
    expect((await other.get(`/part-discrepancies/${any.id}/history`)).status).toBe(404);
    expect((await other.post(`/part-discrepancies/${any.id}/assign`, { expectedVersion: any.version, assigneeUserId: null })).status).toBe(404);
    expect(await h.db.db.select({ id: partDiscrepancies.id, version: partDiscrepancies.version }).from(partDiscrepancies)).toEqual(before);
  });
});
