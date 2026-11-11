import { eq } from 'drizzle-orm';
import { users } from '../src/db/schema';
import {
  QC_CHECK_ITEMS,
  type Assessment,
  type CaseCompletion,
  type CaseDetail,
  type CaseFinance,
  type Department,
  type Part,
  type QcCheckItem,
  type Task,
  type TimelineEvent,
} from '@manage/shared';
import { Client, LEGACY_QC_PERMISSIONS, createHarness, LEGACY_CASHIER_PERMISSIONS, daysAgo, type Harness } from './harness';

// Issue #12: QC with corrective work, technical and financial close as two
// independent gates, settlement payment and handover (acceptance scenario 9).

let h: Harness;
let expert: Client;
let supervisor: Client;
let manager: Client;
let parts: Client;
let cashier: Client;
let qc: Client;
let depts: Department[];

const dept = (code: string) => depts.find((d) => d.code === code)!.id;
const caseOf = async (id: string): Promise<CaseDetail> => (await expert.get(`/cases/${id}`)).body;
const completionOf = async (id: string): Promise<CaseCompletion> => (await expert.get(`/cases/${id}/completion`)).body;
const financeOf = async (id: string): Promise<CaseFinance> => (await expert.get(`/cases/${id}/finance`)).body;
const codes = (body: { details?: { issues?: { code: string }[] } }) => (body.details?.issues ?? []).map((i) => i.code);

/** Every checklist item "ok", with overrides. */
function checks(overrides: Partial<Record<QcCheckItem, object>> = {}) {
  return QC_CHECK_ITEMS.map((item) => ({ item, result: 'ok', ...overrides[item] }));
}

async function newCase(body: object): Promise<CaseDetail> {
  const res = await expert.post('/cases', {
    customer: { fullName: 'مشتری آزمون تحویل', phone: '09000005555' },
    vehicle: { brand: 'ایران‌خودرو', model: 'سورن', vin: `TESTVIN${Math.random().toString().slice(2, 12)}` },
    odometerKm: 12000,
    admittedAt: daysAgo(4),
    damageDescription: 'آزمون',
    ...body,
  });
  expect(res.status).toBe(201);
  return res.body;
}

/** Final, authorized assessment: one replaced part (10 M) with body labour (1 M). */
async function authorized(caseId: string, source: 'golden_card' | 'customer'): Promise<Assessment> {
  let a: Assessment = (await expert.post(`/cases/${caseId}/assessments`, { kind: 'initial', assessorName: 'کارشناس آزمون' }))
    .body;
  a = (
    await expert.post(`/assessments/${a.id}/items`, {
      expectedVersion: a.version,
      action: 'replace',
      description: 'گلگیر جلو',
      partNumber: 'TEST-PN-12',
      unitPriceRial: 10_000_000,
      labourDepartmentId: dept('body'),
      labourRial: 1_000_000,
    })
  ).body;
  a = (await expert.post(`/assessments/${a.id}/finalize`, { expectedVersion: a.version })).body;
  const res = await expert.post(`/assessments/${a.id}/authorization`, {
    expectedVersion: a.version,
    decision: 'approved',
    source,
    method: source === 'customer' ? 'in_person' : 'official_system',
    reference: source === 'customer' ? null : 'TEST-AUTH-12',
  });
  expect(res.status).toBe(201);
  return res.body;
}

/** The part from the assessment, taken from stock and handed over to the body shop. */
async function installPart(caseId: string) {
  let [p] = (await expert.post(`/cases/${caseId}/parts/from-assessment`, { source: 'stock' })).body as Part[];
  for (const [action, extra] of [
    ['check_stock', { inStock: true }],
    ['reserve', {}],
    ['hand_over', { departmentId: dept('body'), salePriceRial: 1_500_000, recipientName: 'سرپرست صافکاری آزمون' }],
  ] as const) {
    const res = await parts.post(`/parts/${p!.id}/actions`, { action, expectedVersion: p!.version, ...extra });
    expect(res.status).toBe(201);
    p = res.body;
  }
  expect(p!.status).toBe('handed_over');
}

async function runTask(t: Task, steps: ('start' | 'complete' | 'approve')[]): Promise<Task> {
  let cur = t;
  for (const action of steps) {
    const res = await supervisor.post(`/tasks/${cur.id}/actions`, { action, expectedVersion: cur.version });
    expect(res.status).toBe(201);
    cur = res.body;
  }
  return cur;
}

async function addApprovedTask(caseId: string, code = 'body'): Promise<Task> {
  const t = (await supervisor.post(`/cases/${caseId}/tasks`, { departmentId: dept(code) })).body as Task;
  return runTask(t, ['start', 'complete', 'approve']);
}

async function recordQc(caseId: string, overrides: Partial<Record<QcCheckItem, object>> = {}, who: Client = qc) {
  const kase = await caseOf(caseId);
  return who.post(`/cases/${caseId}/qc`, { expectedVersion: kase.version, checks: checks(overrides) });
}

async function closeTechnically(caseId: string) {
  const res = await supervisor.post(`/cases/${caseId}/technical-close`, { expectedVersion: (await caseOf(caseId)).version });
  expect(res.status).toBe(201);
  return res.body as CaseCompletion;
}

/** Golden-card case with the part installed, work approved, QC passed and technically closed. */
async function technicallyClosedGoldenCard(): Promise<CaseDetail> {
  const c = await newCase({ coverageType: 'golden_card', goldenCardFileNo: 'GC-TEST-12' });
  await authorized(c.id, 'golden_card');
  await installPart(c.id);
  await addApprovedTask(c.id);
  expect((await recordQc(c.id)).status).toBe(201);
  await closeTechnically(c.id);
  return caseOf(c.id);
}

beforeAll(async () => {
  h = await createHarness();
  // This fixture exercises the legacy financial decision path with an explicit grant.
  await h.db.db.update(users).set({permissionOverrides:{allow:['finance.approve','finance.close','finance.propose'],deny:[]}}).where(eq(users.username,'manager'));
  [expert, supervisor, manager, parts, cashier, qc] = await Promise.all([
    ...['expert', 'supervisor', 'manager', 'parts'].map((u) => h.login(u)),
    h.loginAs('payments', [], LEGACY_CASHIER_PERMISSIONS),
    h.loginAs('narrow', [], LEGACY_QC_PERMISSIONS),
  ]);
  depts = (await supervisor.get('/departments')).body;
});

afterAll(async () => {
  await h?.close();
});

describe('acceptance 9: QC, corrective work, settlement, delivery', () => {
  it('runs a personal case from failed QC through settlement to an archived handover', async () => {
    const c = await newCase({ coverageType: 'personal' });
    await authorized(c.id, 'customer');
    const task = (await supervisor.post(`/cases/${c.id}/tasks`, { departmentId: dept('body') })).body as Task;
    const work = await runTask(task, ['start', 'complete']);

    // QC waits for the supervisor's approval of all work.
    const early = await recordQc(c.id);
    expect(early.body.code).toBe('QC_WORK_UNFINISHED');
    await runTask(work, ['approve']);

    // Reconciliation before QC: the approved part is not installed, QC is missing.
    let close = await supervisor.post(`/cases/${c.id}/technical-close`, { expectedVersion: (await caseOf(c.id)).version });
    expect(close.body.code).toBe('TECHNICAL_CLOSE_BLOCKED');
    expect(codes(close.body)).toEqual(expect.arrayContaining(['lines_without_part', 'qc_missing']));

    // Checklist rules: a failed item needs a description and a unit; safety items cannot be skipped.
    expect((await recordQc(c.id, { paint: { result: 'fail' } })).status).toBe(400);
    expect((await recordQc(c.id, { brakes_steering: { result: 'na' } })).status).toBe(400);
    const partial = await qc.post(`/cases/${c.id}/qc`, {
      expectedVersion: (await caseOf(c.id)).version,
      checks: checks().slice(1),
    });
    expect(partial.status).toBe(400);

    // Round 1 fails on paint: a corrective activity opens and the case returns to repair.
    const round1 = await recordQc(c.id, {
      paint: { result: 'fail', note: 'اختلاف رنگ لبه گلگیر', departmentId: dept('paint') },
      road_test: { result: 'na', note: 'خودرو بدون پلاک موقت' },
    });
    expect(round1.status).toBe(201);
    let state = round1.body as CaseCompletion;
    expect(state.qc).toHaveLength(1);
    expect(state.qc[0]).toMatchObject({ round: 1, outcome: 'failed', inspectedBy: { displayName: 'کنترل کیفیت نمونه' } });
    const fixId = state.qc[0]!.checks.find((x) => x.item === 'paint')!.correctiveTaskId!;
    let kase = await caseOf(c.id);
    expect(kase.stage).toBe('in_repair');
    const fix = kase.tasks.find((t) => t.id === fixId)!;
    expect(fix).toMatchObject({ status: 'pending', qcInspectionId: state.qc[0]!.id, department: { code: 'paint' } });
    expect(fix.title).toContain('رنگ، همرنگی و پولیش');

    close = await supervisor.post(`/cases/${c.id}/technical-close`, { expectedVersion: kase.version });
    expect(codes(close.body)).toEqual(expect.arrayContaining(['tasks_unapproved', 'qc_failed']));

    // Corrective work approved, part installed, round 2 passes.
    await runTask(fix, ['start', 'complete', 'approve']);
    await installPart(c.id);
    const round2 = await recordQc(c.id);
    expect(round2.status).toBe(201);
    expect((round2.body as CaseCompletion).qc.map((q) => q.outcome)).toEqual(['failed', 'passed']);
    expect((await caseOf(c.id)).stage).toBe('quality_control');

    state = await closeTechnically(c.id);
    expect(state.technical).toMatchObject({ valid: true, closedBy: { displayName: 'سرپرست نمونه' } });
    expect((await caseOf(c.id)).stage).toBe('ready_for_delivery');
    expect(state.deliveryIssues.map((i) => i.code)).toEqual(['financial_not_closed']);

    // Financial close (spec decision 3): the invoice and payments are in the accounting
    // system, so the customer balance no longer blocks; payments are not recorded here.
    kase = await caseOf(c.id);
    const handover = { recipientName: 'مشتری آزمون تحویل', recipientRelation: 'owner', handoverConfirmed: true };
    const tooEarly = await expert.post(`/cases/${c.id}/delivery`, { expectedVersion: kase.version, ...handover });
    expect(tooEarly.body.code).toBe('DELIVERY_GATE');
    expect((await cashier.post(`/cases/${c.id}/finance/payments`, { amountRial: 11_000_000, paymentRef: 'RCPT-TEST-1' })).body.code).toBe('FINANCE_FLOW_RETIRED');
    expect((await parts.post(`/cases/${c.id}/financial-close`, { expectedVersion: kase.version })).status).toBe(403);
    const fin = await cashier.post(`/cases/${c.id}/financial-close`, { expectedVersion: kase.version });
    expect(fin.status).toBe(201);
    state = fin.body;
    expect(state.financial).toMatchObject({ valid: true, waivedRial: 0 });
    expect(state.deliveryIssues).toEqual([]);

    // Handover: the recipient's confirmation is required; the case is archived afterwards.
    kase = await caseOf(c.id);
    const unconfirmed = await expert.post(`/cases/${c.id}/delivery`, {
      expectedVersion: kase.version,
      ...handover,
      handoverConfirmed: false,
    });
    expect(unconfirmed.status).toBe(400);
    const delivered = await expert.post(`/cases/${c.id}/delivery`, { expectedVersion: kase.version, ...handover });
    expect(delivered.status).toBe(201);
    expect((delivered.body as CaseCompletion).delivery).toMatchObject({
      recipientName: 'مشتری آزمون تحویل',
      recipientRelation: 'owner',
      deliveredBy: { displayName: 'کارشناس نمونه' },
    });
    kase = await caseOf(c.id);
    expect(kase).toMatchObject({ stage: 'delivered', status: 'closed' });
    expect(kase.actualDeliveryAt).toBeTruthy();

    // Archived: read-only and out of the open list, still searchable under "all".
    expect((await supervisor.post(`/cases/${c.id}/tasks`, { departmentId: dept('body') })).body.code).toBe('CASE_NOT_OPEN');
    const open = (await expert.get(`/cases?q=${kase.caseNumber}`)).body;
    expect(open.total).toBe(0);
    const all = (await expert.get(`/cases?q=${kase.caseNumber}&status=all`)).body;
    expect(all.total).toBe(1);

    const timeline = (await supervisor.get(`/cases/${c.id}/timeline`)).body as TimelineEvent[];
    const actions = timeline.map((e) => e.action);
    for (const a of ['qc.recorded', 'case.technical_closed', 'case.financial_closed', 'case.delivered']) {
      expect(actions).toContain(a);
    }
  });

  it('a change after a close invalidates it and blocks the handover', async () => {
    const c = await technicallyClosedGoldenCard();
    let kase = c;
    // Golden card: nothing to collect from the customer.
    const fin = await cashier.post(`/cases/${c.id}/financial-close`, { expectedVersion: kase.version });
    expect(fin.status).toBe(201);
    expect((fin.body as CaseCompletion).deliveryIssues).toEqual([]);

    // Reopened work: the technical close no longer holds.
    const t = (await caseOf(c.id)).tasks[0]!;
    const reopened = await supervisor.post(`/tasks/${t.id}/actions`, {
      action: 'reopen',
      expectedVersion: t.version,
      note: 'صدای اضافه در تست نهایی',
    });
    expect(reopened.status).toBe(201);
    let state = await completionOf(c.id);
    expect(state.technical.valid).toBe(false);
    expect(state.technical.issues.map((i) => i.code)).toContain('tasks_unapproved');
    kase = await caseOf(c.id);
    const refused = await expert.post(`/cases/${c.id}/delivery`, {
      expectedVersion: kase.version,
      recipientName: 'نماینده آزمون',
      recipientRelation: 'agent',
      handoverConfirmed: true,
    });
    expect(refused.body.code).toBe('DELIVERY_GATE');
    expect(codes(refused.body)).toEqual(['technical_not_closed']);

    // After approval the old QC is stale: a new round is needed before closing again.
    await runTask((await caseOf(c.id)).tasks[0]!, ['complete', 'approve']);
    state = await completionOf(c.id);
    expect(state.technical.issues.map((i) => i.code)).toContain('qc_stale');
    expect((await recordQc(c.id)).status).toBe(201);
    await closeTechnically(c.id);

    // Payer shares are information only now: changing them keeps the financial close.
    const shares = await expert.put(`/cases/${c.id}/finance/shares`, {
      customerShareRial: 2_000_000,
      insurerShareRial: null,
      companyShareRial: 9_000_000,
      note: 'فرانشیز مشتری',
    });
    expect(shares.status).toBe(200);
    state = await completionOf(c.id);
    expect(state.financial.valid).toBe(true);
    expect(state.deliveryIssues).toEqual([]);
  });

  it('a personal case closes financially without a settlement in Manage (spec decision 3)', async () => {
    const c = await newCase({ coverageType: 'personal' });
    await authorized(c.id, 'customer');
    await installPart(c.id);
    await addApprovedTask(c.id);
    expect((await recordQc(c.id)).status).toBe(201);
    await closeTechnically(c.id);
    const v = (await caseOf(c.id)).version;
    expect((await manager.post(`/cases/${c.id}/financial-close`, { expectedVersion: v, waiveBalance: true })).status).toBe(400);
    const res = await expert.post(`/cases/${c.id}/financial-close`, { expectedVersion: v, note: 'فاکتور در سامانهٔ حسابداری صادر شد' });
    expect(res.status).toBe(201);
    expect((res.body as CaseCompletion).financial).toMatchObject({ valid: true, waivedRial: 0 });
    expect((await financeOf(c.id)).balanceRial).toBe(11_000_000);
    expect((res.body as CaseCompletion).deliveryIssues).toEqual([]);
  });

  it('enforces roles on QC, closes and handover', async () => {
    const c = await newCase({ coverageType: 'golden_card', goldenCardFileNo: 'GC-TEST-13' });
    const v = c.version;
    expect((await recordQc(c.id, {}, manager)).status).toBe(403);
    expect((await recordQc(c.id, {}, parts)).status).toBe(403);
    expect((await qc.post(`/cases/${c.id}/technical-close`, { expectedVersion: v })).status).toBe(403);
    expect((await parts.post(`/cases/${c.id}/financial-close`, { expectedVersion: v })).status).toBe(403);
    const handover = { expectedVersion: v, recipientName: 'آزمون', recipientRelation: 'owner', handoverConfirmed: true };
    expect((await cashier.post(`/cases/${c.id}/delivery`, handover)).status).toBe(403);
    expect((await qc.post(`/cases/${c.id}/delivery`, handover)).status).toBe(403);
    // Everyone who can read the case sees the completion state, incl. the QC inspector.
    expect((await qc.get(`/cases/${c.id}/completion`)).status).toBe(200);
  });
});
