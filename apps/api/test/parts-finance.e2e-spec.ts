import { eq } from 'drizzle-orm';
import { users } from '../src/db/schema';
import type { Assessment, CaseDetail, CaseFinance, Department, Part, TimelineEvent } from '@manage/shared';
import { randomBytes } from 'node:crypto';
import { strToU8, zipSync } from 'fflate';
import { MAX_ENTRY_BYTES, writeSheet } from '../src/parts/xlsx';
import { IMPORT_COLUMNS } from '../src/parts/parts.service';
import { Client, LEGACY_QC_PERMISSIONS, createHarness, LEGACY_CASHIER_PERMISSIONS, daysAgo, daysAhead, type Harness } from './harness';

// Issues #9 (parts) and #10 (financial gate): acceptance scenarios 2, 3, 4, 8.

let h: Harness;
let expert: Client;
let supervisor: Client;
let manager: Client;
let parts: Client;
let cashier: Client;
let depts: Department[];

const dept = (code: string) => depts.find((d) => d.code === code)!.id;
const caseOf = async (id: string): Promise<CaseDetail> => (await expert.get(`/cases/${id}`)).body;
const partsOf = async (id: string): Promise<Part[]> => (await expert.get(`/cases/${id}/parts`)).body;
const financeOf = async (id: string): Promise<CaseFinance> => (await expert.get(`/cases/${id}/finance`)).body;

async function newCase(body: object): Promise<CaseDetail> {
  const res = await expert.post('/cases', {
    customer: { fullName: 'مشتری آزمون قطعات', phone: '09000004444' },
    vehicle: { brand: 'ایران‌خودرو', model: 'دنا', vin: `TESTVIN${Math.random().toString().slice(2, 12)}` },
    odometerKm: 9000,
    admittedAt: daysAgo(3),
    damageDescription: 'آزمون',
    ...body,
  });
  expect(res.status).toBe(201);
  return res.body;
}

/** Final assessment with the given lines, authorized by the given source. */
async function authorized(
  caseId: string,
  lines: { description: string; unitPriceRial: number; action?: 'replace' | 'repair' }[],
  source: 'golden_card' | 'insurer' | 'customer',
): Promise<Assessment> {
  let a: Assessment = (await expert.post(`/cases/${caseId}/assessments`, { kind: 'initial', assessorName: 'کارشناس آزمون' }))
    .body;
  for (const l of lines) {
    a = (
      await expert.post(`/assessments/${a.id}/items`, {
        expectedVersion: a.version,
        action: l.action ?? 'replace',
        description: l.description,
        partNumber: `TEST-${l.description.length}`,
        unitPriceRial: l.unitPriceRial,
        labourDepartmentId: dept('body'),
        labourRial: 1_000_000,
      })
    ).body;
  }
  a = (await expert.post(`/assessments/${a.id}/finalize`, { expectedVersion: a.version })).body;
  const res = await expert.post(`/assessments/${a.id}/authorization`, {
    expectedVersion: a.version,
    decision: 'approved',
    source,
    method: source === 'customer' ? 'in_person' : 'official_system',
    reference: source === 'customer' ? null : 'TEST-AUTH',
  });
  expect(res.status).toBe(201);
  return res.body;
}

async function partAct(p: Part, action: string, extra: object = {}, who: Client = parts) {
  if(action==='order' && (((extra as {source?:string}).source??p.source)==='external'||!!(extra as {priceApprovalRef?:string}).priceApprovalRef)) {
    const current=(await partsOf(p.caseId)).find(row=>row.id===p.id)!;
    const opts=extra as {unitPriceRial:number;supplier?:string;priceApprovalRef?:string;priceApprovedBy?:string};
    const proposal=await parts.post(`/workshop/parts/${p.id}/quotes`,{expectedVersion:current.version,unitPriceRial:opts.unitPriceRial,supplier:opts.supplier??'فروشنده آزمون',validUntil:daysAhead(2)});
    expect(proposal.status).toBe(201);
    const quote=proposal.body.find((q:{partId:string;status:string})=>q.partId===p.id&&q.status==='pending');
    const kase=await caseOf(p.caseId);
    const source=kase.coverageType==='golden_card'?'golden_card':kase.coverageType==='insurance'?'insurer':'customer';
    expect((await expert.post(`/workshop/quotes/${quote.id}/decision`,{expectedVersion:1,decision:'approved',officialRecorded:true,source,reference:opts.priceApprovalRef??'TEST-MARKET',approver:opts.priceApprovedBy??'تأییدکننده آزمون',note:'مجوز خرید آزمون ثبت شد'})).status).toBe(201);
    extra={...extra,supplier:opts.supplier??'فروشنده آزمون'};p={...p,version:current.version+1};
  }
  return who.post(`/parts/${p.id}/actions`, { action, expectedVersion: p.version, ...extra });
}

beforeAll(async () => {
  h = await createHarness();
  // This fixture exercises the legacy financial decision path with an explicit grant.
  await h.db.db.update(users).set({permissionOverrides:{allow:['finance.approve','finance.close','finance.propose'],deny:[]}}).where(eq(users.username,'manager'));
  [expert, supervisor, manager, parts, cashier] = await Promise.all([
    ...['expert', 'supervisor', 'manager', 'parts'].map((u) => h.login(u)),
    h.loginAs('payments', [], LEGACY_CASHIER_PERMISSIONS),
  ]);
  depts = (await supervisor.get('/departments')).body;
});

afterAll(async () => {
  await h?.close();
});

describe('acceptance 2: golden card, waiting for a company part', () => {
  it('tracks order, delay and handover; handover releases the blocked activity', async () => {
    const deadline = daysAhead(6);
    const c = await newCase({ coverageType: 'golden_card', goldenCardFileNo: 'GC-TEST-9', officialDeadlineAt: deadline });
    await authorized(c.id, [{ description: 'سپر جلو', unitPriceRial: 30_000_000 }], 'golden_card');

    const created = await expert.post(`/cases/${c.id}/parts/from-assessment`, {});
    expect(created.status).toBe(201);
    let [bumper] = created.body as Part[];
    expect(bumper).toMatchObject({ source: 'company', status: 'needed', approvedUnitPriceRial: 30_000_000 });
    const again = await expert.post(`/cases/${c.id}/parts/from-assessment`, {});
    expect(again.body.code).toBe('NOTHING_TO_REQUEST');

    // Golden card: the company pays, so the purchase gate is open.
    expect((await financeOf(c.id)).gate).toMatchObject({ open: true, reason: 'no_customer_share' });
    const firstEta = daysAhead(2);
    const ordered = await partAct(bumper, 'order', {
      supplier: 'شرکت (آزمون)',
      orderRef: 'ORD-TEST-1',
      unitPriceRial: 30_000_000,
      etaAt: firstEta,
    });
    expect(ordered.status).toBe(201);
    bumper = ordered.body;
    expect(bumper).toMatchObject({ status: 'ordered', financeBasis: 'no_customer_share' });

    // Body work waits for the part: blocker names it.
    const task = (await supervisor.post(`/cases/${c.id}/tasks`, { departmentId: dept('body') })).body;
    await supervisor.post(`/tasks/${task.id}/actions`, { action: 'start', expectedVersion: task.version });
    const t1 = (await caseOf(c.id)).tasks[0]!;
    const blk = await supervisor.post(`/cases/${c.id}/blockers`, {
      reason: 'part_not_arrived',
      taskId: t1.id,
      expectedTaskVersion: t1.version,
      partRequestId: bumper.id,
      description: 'سپر شرکت نرسیده',
    });
    expect(blk.status).toBe(201);
    expect(blk.body.partRequestId).toBe(bumper.id);
    expect((await caseOf(c.id)).tasks[0]!.status).toBe('blocked');

    // The company delays: new ETA, the first ETA is kept for accountability.
    const delayed = await partAct(bumper, 'update_eta', { etaAt: daysAhead(4), note: 'تأخیر شرکت' });
    bumper = delayed.body;
    expect(new Date(bumper.firstEtaAt!).getTime()).toBe(new Date(firstEta).getTime());

    bumper = (await partAct(bumper, 'receive', { receiptDocNo: 'RCV-TEST-1', inspection: 'ok' })).body;
    expect(bumper.status).toBe('received');
    const handed = await partAct(bumper, 'hand_over', { departmentId: dept('body'), recipientName: 'سرپرست صافکاری' });
    expect(handed.status).toBe(201);
    expect(handed.body.handedOverDepartment.id).toBe(dept('body'));

    const kase = await caseOf(c.id);
    expect(kase.blockers[0]!.resolvedAt).toBeTruthy();
    expect(kase.blockers[0]!.resolutionNote).toContain('سپر جلو');
    expect(kase.tasks[0]!.status).toBe('in_progress');
    expect(kase.officialDeadlineAt).toBe(c.officialDeadlineAt);

    // A later "not arrived" report contradicts the recorded handover and is surfaced.
    const contradiction = await supervisor.post(`/cases/${c.id}/blockers`, {
      reason: 'part_not_arrived',
      partRequestId: bumper.id,
    });
    expect(contradiction.body.code).toBe('PART_ALREADY_HANDED_OVER');

    const actions = ((await expert.get(`/cases/${c.id}/timeline`)).body as TimelineEvent[]).map((e) => e.action);
    for (const a of ['part.created', 'part.ordered', 'part.eta_changed', 'part.received', 'part.handed_over']) {
      expect(actions).toContain(a);
    }
  });

  it('a wrong part is rejected at receipt and re-ordered', async () => {
    const c = await newCase({ coverageType: 'golden_card', goldenCardFileNo: 'GC-TEST-10', officialDeadlineAt: daysAhead(5) });
    let p: Part = (await expert.post(`/cases/${c.id}/parts`, { description: 'چراغ', source: 'company' })).body;
    p = (await partAct(p, 'order', { unitPriceRial: 5_000_000, etaAt: daysAhead(1) })).body;
    const noNote = await partAct(p, 'receive', { inspection: 'wrong' });
    expect(noNote.status).toBe(400);
    p = (await partAct(p, 'receive', { inspection: 'wrong', note: 'چراغ سمت چپ ارسال شده' })).body;
    expect(p.status).toBe('rejected');
    const early = await partAct(p, 'hand_over', { recipientName: 'x' });
    expect(early.body.code).toBe('INVALID_TRANSITION');
    p = (await partAct(p, 'order', { unitPriceRial: 5_000_000, etaAt: daysAhead(2) })).body;
    expect(p).toMatchObject({ status: 'ordered', inspection: null });
  });
});

describe('acceptance 3: body insurance, price change approved by the assessor', () => {
  it('allows company/insurer supply without a generic assessment or price gate', async () => {
    const c = await newCase({ coverageType: 'insurance', insurerName: 'بیمه آزمون', insuranceClaimNo: 'TEST-CL-3' });
    const v1 = await authorized(
      c.id,
      [
        { description: 'گلگیر جلو', unitPriceRial: 20_000_000 },
        { description: 'درب جلو', unitPriceRial: 50_000_000 },
      ],
      'insurer',
    );
    let [fender, door] = (await expert.post(`/cases/${c.id}/parts/from-assessment`, { source: 'insurer_supplier' }))
      .body as Part[];

    const ok=await partAct(fender!,'order',{supplier:'تأمین‌کننده بیمه آزمون',unitPriceRial:23_000_000,etaAt:daysAhead(3)});
    expect(ok.status).toBe(201);fender=ok.body;
    expect(fender).toMatchObject({priceApprovalRef:null,unitPriceRial:23_000_000});

    // A supplement re-prices the door: until its authorization the door cannot be ordered.
    let v2: Assessment = (
      await expert.post(`/cases/${c.id}/assessments`, { kind: 'supplement', assessorName: 'الف', reason: 'قیمت جدید درب' })
    ).body;
    const doorLine = v2.items.find((i) => i.description === 'درب جلو')!;
    v2 = (await expert.patch(`/assessment-items/${doorLine.id}`, { expectedVersion: v2.version, unitPriceRial: 55_000_000 }))
      .body;
    v2 = (await expert.post(`/assessments/${v2.id}/finalize`, { expectedVersion: v2.version })).body;
    door=(await partAct(door!,'order',{unitPriceRial:50_000_000})).body;
    expect(door.status).toBe('ordered');
    expect(v1.status).toBe('final');
  });
});

describe('acceptance 4 and 8: personal case, advance payment and the purchase gate', () => {
  it('records the advance state without blocking purchases (owner rule 2026-11-05); no-cost work continues', async () => {
    const c = await newCase({ coverageType: 'personal' });
    let f = await financeOf(c.id);
    expect(f.gate).toMatchObject({ open: false, reason: 'no_estimate' });

    // Customer approves the estimate in person.
    await authorized(
      c.id,
      [
        { description: 'آینه', unitPriceRial: 8_000_000 },
        { description: 'دستگیره', unitPriceRial: 2_000_000 },
      ],
      'customer',
    );
    let [mirror, handle] = (await expert.post(`/cases/${c.id}/parts/from-assessment`, { source: 'external' }))
      .body as Part[];
    f = await financeOf(c.id);
    expect(f).toMatchObject({ estimateRial: 12_000_000, customerShareRial: 12_000_000, customerShareDerived: true });
    expect(f.gate).toMatchObject({ open: false, reason: 'advance_missing' });

    // Money never blocks a purchase: the order goes through and records why.
    mirror = (await partAct(mirror!, 'order', { unitPriceRial: 8_000_000, supplier: 'فروشگاه آزمون' })).body;
    expect(mirror).toMatchObject({ status: 'ordered', financeBasis: 'advance_missing' });

    // No-cost work continues: stock reservation and repair activities.
    handle = (await partAct(handle!, 'check_stock', { inStock: true })).body;
    const reserved = await partAct(handle!, 'reserve');
    expect(reserved.body).toMatchObject({ status: 'reserved', source: 'stock' });
    const task = (await supervisor.post(`/cases/${c.id}/tasks`, { departmentId: dept('paint') })).body;
    const start = await supervisor.post(`/tasks/${task.id}/actions`, { action: 'start', expectedVersion: task.version });
    expect(start.status).toBe(201);

    // Expert proposes; expert cannot approve; manager approves; cashier confirms receipt.
    f = (await expert.post(`/cases/${c.id}/finance/approvals`, { kind: 'advance', amountRial: 6_000_000, reason: 'نیمی از برآورد' }))
      .body;
    const advance = f.approvals[0]!;
    expect(advance).toMatchObject({ status: 'proposed', coversEstimateRial: 12_000_000 });
    expect((await expert.post(`/financial-approvals/${advance.id}/decision`, { decision: 'approve', expectedVersion: 1 })).status).toBe(403);
    const early = await cashier.post(`/financial-approvals/${advance.id}/payment`, { expectedVersion: 1, paymentRef: 'X' });
    expect(early.body.code).toBe('FINANCE_NOT_APPROVED');
    f = (await manager.post(`/financial-approvals/${advance.id}/decision`, { decision: 'approve', expectedVersion: 1 })).body;
    expect(f.gate.open).toBe(false); // approved but not yet received
    f = (
      await cashier.post(`/financial-approvals/${advance.id}/payment`, { expectedVersion: 2, paymentRef: 'POS-TEST-1' })
    ).body;
    expect(f).toMatchObject({ paidRial: 6_000_000, balanceRial: 6_000_000 });
    expect(f.gate).toMatchObject({ open: true, reason: 'advance_paid' });

    f = await financeOf(c.id);
    expect(f.purchasesRial).toBe(8_000_000);
  });

  it('a supplement that raises the cost is flagged for re-approval without blocking; exceptions still track their limit', async () => {
    const c = await newCase({ coverageType: 'personal' });
    await authorized(c.id, [{ description: 'سپر عقب', unitPriceRial: 10_000_000 }], 'customer');
    const proposed = (
      await expert.post(`/cases/${c.id}/finance/approvals`, { kind: 'advance', amountRial: 11_000_000, reason: 'کل برآورد' })
    ).body as CaseFinance;
    const advance = proposed.approvals[0]!;
    await manager.post(`/financial-approvals/${advance.id}/decision`, { decision: 'approve', expectedVersion: 1 });
    await cashier.post(`/financial-approvals/${advance.id}/payment`, { expectedVersion: 2, paymentRef: 'POS-TEST-2' });
    expect((await financeOf(c.id)).gate.reason).toBe('advance_paid');

    // Hidden damage: supplement approved by the customer raises the estimate.
    let v2: Assessment = (
      await expert.post(`/cases/${c.id}/assessments`, { kind: 'supplement', assessorName: 'الف', reason: 'براکت شکسته' })
    ).body;
    v2 = (
      await expert.post(`/assessments/${v2.id}/items`, {
        expectedVersion: v2.version,
        action: 'replace',
        description: 'براکت سپر',
        unitPriceRial: 9_000_000,
      })
    ).body;
    v2 = (await expert.post(`/assessments/${v2.id}/finalize`, { expectedVersion: v2.version })).body;
    await expert.post(`/assessments/${v2.id}/authorization`, {
      expectedVersion: v2.version,
      decision: 'approved',
      source: 'customer',
      method: 'phone',
    });
    let f = await financeOf(c.id);
    expect(f.estimateRial).toBe(20_000_000);
    expect(f.gate).toMatchObject({ open: false, reason: 're_approval_required' });

    const [, bracket] = (await expert.post(`/cases/${c.id}/parts/from-assessment`, { source: 'external' })).body as Part[];

    // Exception: limit 10 M; the proposer cannot approve it.
    f = (await manager.post(`/cases/${c.id}/finance/approvals`, { kind: 'exception', amountRial: 10_000_000, reason: 'مشتری ثابت نمایندگی' }))
      .body;
    const ex = f.approvals.find((a) => a.kind === 'exception')!;
    const self = await manager.post(`/financial-approvals/${ex.id}/decision`, { decision: 'approve', expectedVersion: 1 });
    expect(self.status).toBe(403);
    expect(self.body.message).toContain('پیشنهاددهنده');
    const sup = await supervisor.post(`/cases/${c.id}/finance/approvals`, { kind: 'exception', amountRial: 1, reason: 'x' });
    expect(sup.body.code).toBe('FINANCE_PROPOSAL_OPEN');

    // The demo has one service manager; a second one approves.
    const approver = await h.loginAs('manager2', ['service_manager']);
    await h.db.db.update(users).set({permissionOverrides:{allow:['finance.approve'],deny:[]}}).where(eq(users.username,'manager2'));
    await approver.post(`/financial-approvals/${ex.id}/decision`, { decision: 'approve', expectedVersion: 1 });
    const okOrder = await partAct(bracket!, 'order', { unitPriceRial: 9_000_000 });
    expect(okOrder.body).toMatchObject({ status: 'ordered', financeBasis: 'exception' });

    const extra: Part = (await expert.post(`/cases/${c.id}/parts`, { description: 'پیچ', source: 'external' })).body;
    const over = await partAct(extra, 'order', { unitPriceRial: 2_000_000 });
    expect(over.body).toMatchObject({ status: 'ordered', financeBasis: 're_approval_required' });
    expect((await financeOf(c.id)).approvals.find((a) => a.id === ex.id)!.spentRial).toBe(9_000_000);
  });

  it('prices freely; payer approval only when golden card or insurance pays above the approved price (owner rule 2026-11-05)', async () => {
    // The helper partAct records an approved quote first; these orders go direct.
    const order = async (part: Part, unitPriceRial: number) => {
      const current = (await partsOf(part.caseId)).find((row) => row.id === part.id)!;
      return parts.post(`/parts/${part.id}/actions`, { action: 'order', expectedVersion: current.version, source: 'external', unitPriceRial, supplier: 'بازار آزمون' });
    };
    // Personal case: the clerk buys outside at any price without a recorded approval.
    const personal = await newCase({ coverageType: 'personal' });
    await authorized(personal.id, [{ description: 'چراغ', unitPriceRial: 5_000_000 }], 'customer');
    const [lamp] = (await expert.post(`/cases/${personal.id}/parts/from-assessment`, { source: 'external' })).body as Part[];
    const free = await order(lamp!, 9_000_000);
    expect(free.body).toMatchObject({ status: 'ordered', unitPriceRial: 9_000_000 });

    // Golden card: at or below the approved price no approval; above it, approval is required.
    const golden = await newCase({ coverageType: 'golden_card' });
    await authorized(golden.id, [{ description: 'آینه', unitPriceRial: 4_000_000 }, { description: 'گلگیر جلو', unitPriceRial: 6_000_000 }], 'golden_card');
    const [mirror, fender] = (await expert.post(`/cases/${golden.id}/parts/from-assessment`, { source: 'external' })).body as Part[];
    expect((await order(mirror!, 4_000_000)).body).toMatchObject({ status: 'ordered' });
    expect((await order(fender!, 7_500_000)).body.code).toBe('PRICE_ABOVE_APPROVED');
  });

  it('raises non-blocking advance and parts-amount alerts the coordinator answers once (owner rule 2026-11-05)', async () => {
    const admin = await h.login('admin');
    expect((await expert.put('/settings/alerts', { partsAlertThresholdRial: 5_000_000 })).status).toBe(403);
    expect((await admin.get('/settings/alerts')).body).toMatchObject({ partsAlertThresholdRial: 500_000_000, defaultRial: 500_000_000 });
    expect((await admin.put('/settings/alerts', { partsAlertThresholdRial: 5_000_000 })).body.partsAlertThresholdRial).toBe(5_000_000);

    const c = await newCase({ coverageType: 'personal' });
    await authorized(c.id, [{ description: 'درب', unitPriceRial: 8_000_000 }, { description: 'قاب سپر', unitPriceRial: 3_000_000 }], 'customer');
    await expert.post(`/cases/${c.id}/parts/from-assessment`, { source: 'external' });
    const alerts = (await expert.get(`/alerts?caseId=${c.id}`)).body;
    expect(alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'advance', level: 1 }),
        expect.objectContaining({ kind: 'parts_amount', level: 2, totalRial: 11_000_000, thresholdRial: 5_000_000 }),
      ]),
    );
    const qc = await h.loginAs('narrow', [], LEGACY_QC_PERMISSIONS);
    expect((await qc.post(`/cases/${c.id}/alerts/respond`, { kind: 'advance', level: 1, response: 'received' })).status).toBe(403);
    const left = await expert.post(`/cases/${c.id}/alerts/respond`, { kind: 'advance', level: 1, response: 'not_received', note: 'مشتری فردا می‌آورد' });
    expect(left.body).toEqual([expect.objectContaining({ kind: 'parts_amount', level: 2 })]);
    expect(left.status).toBe(201);
    expect((await expert.post(`/cases/${c.id}/alerts/respond`, { kind: 'advance', level: 1, response: 'received' })).body.code).toBe('ALERT_NOT_OPEN');
    expect((await expert.post(`/cases/${c.id}/alerts/respond`, { kind: 'parts_amount', level: 2, response: 'not_needed' })).body).toEqual([]);
    const history = (await expert.get(`/cases/${c.id}/alerts/history`)).body;
    expect(history.map((x: { kind: string; response: string }) => `${x.kind}:${x.response}`).sort()).toEqual(['advance:not_received', 'parts_amount:not_needed']);
    await admin.put('/settings/alerts', { partsAlertThresholdRial: 500_000_000 });
  });

  it('records payer shares; a mixed case without shares is blocked', async () => {
    const c = await newCase({ coverageType: 'mixed' });
    await authorized(c.id, [{ description: 'کاپوت', unitPriceRial: 15_000_000 }], 'insurer');
    expect((await financeOf(c.id)).gate.reason).toBe('shares_unknown');
    const res = await expert.put(`/cases/${c.id}/finance/shares`, {
      customerShareRial: 0,
      insurerShareRial: 16_000_000,
      companyShareRial: null,
    });
    expect(res.status).toBe(200);
    expect(res.body.gate).toMatchObject({ open: true, reason: 'no_customer_share' });
    const stale = await expert.put(`/cases/${c.id}/finance/shares`, {
      customerShareRial: 1,
      insurerShareRial: null,
      companyShareRial: null,
      expectedVersion: 9,
    });
    expect(stale.status).toBe(409);
  });
});

describe('Excel import and permissions', () => {
  const sheet = (rows: (string | number | null)[][]) =>
    Buffer.from(
      writeSheet('قطعات', [
        [
          IMPORT_COLUMNS.description,
          IMPORT_COLUMNS.partNumber,
          IMPORT_COLUMNS.quantity,
          IMPORT_COLUMNS.source,
          IMPORT_COLUMNS.approvedUnitPriceRial,
          IMPORT_COLUMNS.notes,
        ],
        ...rows,
      ]),
    ).toString('base64');

  it('previews, rejects a file with errors entirely, then imports a valid file', async () => {
    const c = await newCase({ coverageType: 'golden_card', goldenCardFileNo: 'GC-TEST-11', officialDeadlineAt: daysAhead(9) });
    const bad = sheet([
      ['فیلتر روغن', 'TEST-PN-1', '۲', 'انبار نمایندگی', '۱٬۲۰۰٬۰۰۰', null],
      ['', null, 1, 'company', null, null],
      ['شیشه', null, 0, 'نامعلوم', null, null],
    ]);
    const preview = await expert.post(`/cases/${c.id}/parts/import`, { fileBase64: bad, dryRun: true });
    expect(preview.status).toBe(201);
    expect(preview.body.rows).toHaveLength(1);
    expect(preview.body.rows[0]).toMatchObject({ quantity: 2, source: 'stock', approvedUnitPriceRial: 1_200_000 });
    expect(preview.body.errors.map((e: { row: number }) => e.row)).toEqual([3, 4]);
    const refused = await expert.post(`/cases/${c.id}/parts/import`, { fileBase64: bad, dryRun: false });
    expect(refused.body.code).toBe('IMPORT_INVALID');
    expect(await partsOf(c.id)).toHaveLength(0);

    const good = sheet([
      ['فیلتر روغن', 'TEST-PN-1', 2, 'انبار نمایندگی', 1_200_000, null],
      ['چراغ مه‌شکن', 'TEST-PN-2', 1, 'قطعه شرکت', 4_500_000, 'سمت راست'],
    ]);
    const done = await expert.post(`/cases/${c.id}/parts/import`, { fileBase64: good, dryRun: false });
    expect(done.body).toMatchObject({ dryRun: false, created: 2 });
    const list = await partsOf(c.id);
    expect(list.map((p) => p.source)).toEqual(['stock', 'company']);

    const notXlsx = await expert.post(`/cases/${c.id}/parts/import`, {
      fileBase64: Buffer.from('not a spreadsheet').toString('base64'),
    });
    expect(notXlsx.body.errors[0].message).toContain('.xlsx');
  });

  it('accepts a realistic large sheet and refuses a decompression bomb', async () => {
    const c = await newCase({ coverageType: 'golden_card', goldenCardFileNo: 'GC-TEST-13', officialDeadlineAt: daysAhead(9) });
    // 1500 rows with random notes (incompressible): well above the 100 KB default JSON body limit.
    const many = Array.from({ length: 1500 }, (_, i) => [
      `قطعه آزمون شماره ${i + 1}`,
      `TEST-PN-${10_000 + i}`,
      1,
      'قطعه شرکت',
      1_000_000 + i,
      randomBytes(100).toString('hex'),
    ]);
    const big = sheet(many);
    expect(big.length).toBeGreaterThan(150_000);
    const preview = await expert.post(`/cases/${c.id}/parts/import`, { fileBase64: big, dryRun: true });
    expect(preview.status).toBe(201);
    expect(preview.body.rows).toHaveLength(1500);

    // 20 MB of spaces compresses to a few KB; it must be refused without inflating it.
    const bomb = zipSync({
      'xl/worksheets/sheet1.xml': strToU8(' '.repeat(MAX_ENTRY_BYTES + 4 * 1024 * 1024)),
    });
    expect(bomb.length).toBeLessThan(100_000);
    const refused = await expert.post(`/cases/${c.id}/parts/import`, {
      fileBase64: Buffer.from(bomb).toString('base64'),
      dryRun: true,
    });
    expect(refused.status).toBe(201);
    expect(refused.body.errors[0].message).toContain('بیش از حد بزرگ');
  });

  it('enforces part and finance permissions on the server', async () => {
    const c = await newCase({ coverageType: 'personal' });
    expect((await cashier.post(`/cases/${c.id}/parts`, { description: 'x', source: 'external' })).status).toBe(403);
    const p: Part = (await expert.post(`/cases/${c.id}/parts`, { description: 'x', source: 'external' })).body;
    expect((await partAct(p, 'cancel', { note: 'x' }, expert)).status).toBe(403);
    expect((await parts.post(`/cases/${c.id}/finance/approvals`, { kind: 'advance', amountRial: 1, reason: 'x' })).status).toBe(403);
    expect((await supervisor.get(`/cases/${c.id}/finance`)).status).toBe(200);
  });

  it('dashboard counts match the new case-list filters', async () => {
    const c = await newCase({ coverageType: 'golden_card', goldenCardFileNo: 'GC-TEST-12', officialDeadlineAt: daysAhead(9) });
    let p: Part = (await expert.post(`/cases/${c.id}/parts`, { description: 'رادیاتور', source: 'company' })).body;
    p = (await partAct(p, 'order', { unitPriceRial: 1, etaAt: daysAgo(1) })).body;
    expect(p.overdue).toBe(true);
    const d = (await manager.get('/dashboard')).body;
    for (const [flag, key] of [
      ['parts_overdue', 'partsOverdue'],
      ['parts_to_order', 'partsToOrder'],
      ['finance_pending', 'financePending'],
      ['awaiting_authorization', 'awaitingAuthorization'],
    ] as const) {
      const list = (await manager.get(`/cases?flag=${flag}&pageSize=100`)).body;
      expect(list.total).toBe(d[key]);
    }
    expect(d.partsOverdue).toBeGreaterThanOrEqual(1);
  });
});
