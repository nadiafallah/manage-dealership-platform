import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { formatJalaliDateInput, formatTimeInput, type CaseDetail, type DailyImport, type Part } from '@manage/shared';
import { notifications, partPriceNotices, stockReservations, users } from '../src/db/schema';
import { buildEmdadXml, emdadRow } from '../src/daily-reports/fixtures';
import { Client, createHarness, daysAgo, type Harness } from './harness';

// Unified parts list (spec section 7): one list per vehicle, the state machine
// enforced on the server, Emdad Vijeh reports moving lines automatically.
let h: Harness;
let expert: Client;
let parts: Client;
let admin: Client;

const flow = (p: Pick<Part, 'id' | 'version'>, body: object, c = parts) => c.post(`/parts/${p.id}/flow`, { expectedVersion: p.version, ...body });
const partsOf = async (caseId: string): Promise<Part[]> => (await expert.get(`/cases/${caseId}/parts`)).body;
const one = async (p: Pick<Part, 'id' | 'caseId'>) => (await partsOf(p.caseId)).find((x) => x.id === p.id)!;

async function newCase(admissionNo: string, coverageType = 'personal'): Promise<CaseDetail> {
  const res = await expert.post('/cases', {
    customer: { fullName: 'مشتری آزمون قطعات', phone: '09000007777' },
    vehicle: { brand: 'ایران‌خودرو', model: 'ریرا', vin: `TESTVIN${Math.random().toString().slice(2, 12)}` },
    admissionNo,
    admittedAt: daysAgo(2),
    coverageType,
    damageDescription: 'آزمون فهرست واحد قطعات',
  });
  expect(res.status).toBe(201);
  return res.body;
}
async function newPart(caseId: string, partNumber: string | null, quantity = 1, description = 'گلگیر جلو آزمون'): Promise<Part> {
  const res = await expert.post(`/cases/${caseId}/parts`, { description, partNumber, quantity, source: 'company' });
  expect(res.status).toBe(201);
  return res.body;
}

beforeAll(async () => {
  h = await createHarness();
  [expert, parts, admin] = await Promise.all(['expert', 'parts', 'admin'].map((u) => h.login(u)));
});
afterAll(async () => {
  await h?.close();
});

describe('state machine on the server', () => {
  it('offers only the actions of the current state and refuses every other one in Persian', async () => {
    const c = await newCase('940001');
    let p = await newPart(c.id, '11112222');
    expect(p).toMatchObject({ flowState: 'needed', allowedActions: ['reserve', 'emdad', 'market', 'cancel', 'set_price', 'announce_price'] });
    const refused = await flow(p, { action: 'hand_over', recipientName: 'تکنسین آزمون' });
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('PART_ACTION_NOT_ALLOWED');
    expect(refused.body.message).toContain('تعیین تکلیف نشده');
    // The accident expert adds needs and reads supply; changing it is the parts clerk's work.
    expect((await flow(p, { action: 'emdad', requestNo: 'REQ-1' }, expert)).status).toBe(403);
    // The Emdad request number is mandatory; a cancellation needs a reason.
    expect((await flow(p, { action: 'emdad', requestNo: '' })).status).toBe(400);
    expect((await flow(p, { action: 'cancel', reason: '' })).status).toBe(400);

    p = (await flow(p, { action: 'emdad', requestNo: '4027713501', requestedCode: '1111222201' })).body;
    expect(p).toMatchObject({ flowState: 'emdad', orderRef: '4027713501', allowedActions: ['cancel', 'set_price', 'announce_price'] });
    // Status changes only through the daily report: no manual receipt.
    expect((await flow(p, { action: 'receive' })).body.code).toBe('PART_ACTION_NOT_ALLOWED');
    expect((await flow(p, { expectedVersion: p.version - 1, action: 'cancel', reason: 'نسخهٔ قدیمی' })).status).toBe(409);
    p = (await flow(p, { action: 'cancel', reason: 'خودرو با قطعهٔ شرکت دیگر تعمیر شد' })).body;
    expect(p).toMatchObject({ flowState: 'cancelled', allowedActions: [], cancelReason: 'خودرو با قطعهٔ شرکت دیگر تعمیر شد' });
    // Cancelled lines leave the active list but stay in history.
    expect((await partsOf(c.id)).map((x) => x.id)).toContain(p.id);
  });

  it('market purchase: receipt makes it ready, handover delivers it, a return keeps the reason', async () => {
    const c = await newCase('940002');
    let p = await newPart(c.id, '33334444');
    p = (await flow(p, { action: 'market', supplier: 'فروشگاه آزمون', purchaseUnitRial: 9_000_000, saleUnitRial: 11_000_000 })).body;
    expect(p).toMatchObject({ flowState: 'market', supplier: 'فروشگاه آزمون', unitPriceRial: 9_000_000, salePriceRial: 11_000_000 });
    expect((await flow(p, { action: 'hand_over', recipientName: 'تکنسین آزمون' })).body.code).toBe('PART_ACTION_NOT_ALLOWED');
    p = (await flow(p, { action: 'receive', receiptDocNo: 'RCV-TEST-1' })).body;
    expect(p).toMatchObject({ flowState: 'ready', allowedActions: ['hand_over', 'cancel', 'set_price', 'announce_price'] });
    p = (await flow(p, { action: 'hand_over', recipientName: 'تکنسین آزمون' })).body;
    expect(p).toMatchObject({ flowState: 'handed_over', recipientName: 'تکنسین آزمون', allowedActions: ['return', 'set_price', 'announce_price'] });
    p = (await flow(p, { action: 'return', reason: 'قطعه با خودرو نخواند' })).body;
    expect(p).toMatchObject({ flowState: 'returned', returnReason: 'قطعه با خودرو نخواند', allowedActions: [] });
  });

  it('the same technical code never makes a second row: an undecided line grows, a decided one refuses', async () => {
    const c = await newCase('940003');
    const p = await newPart(c.id, '5555-6666', 1);
    const again = await expert.post(`/cases/${c.id}/parts`, { description: 'همان قطعه', partNumber: '۵۵۵۵۶۶۶۶', quantity: 2, source: 'company' });
    expect(again.status).toBe(201);
    expect(again.body).toMatchObject({ id: p.id, quantity: 3 });
    expect(await partsOf(c.id)).toHaveLength(1);
    await flow(await one(p), { action: 'emdad', requestNo: '4027713502' });
    const third = await expert.post(`/cases/${c.id}/parts`, { description: 'همان قطعه', partNumber: '55556666', quantity: 1, source: 'company' });
    expect(third.body.code).toBe('DUPLICATE_PART_CODE');
    expect(await partsOf(c.id)).toHaveLength(1);
  });
});

describe('price: free and silent, «اعلام قیمت» only on purpose', () => {
  it('records announcements, lets the expert answer once and never blocks the line', async () => {
    const c = await newCase('940004');
    let p = await newPart(c.id, '77778888');
    p = (await flow(p, { action: 'set_price', saleUnitRial: 2_000_000 })).body;
    expect(p).toMatchObject({ salePriceRial: 2_000_000, priceNotice: null });
    expect(await h.db.db.select().from(partPriceNotices).where(eq(partPriceNotices.partRequestId, p.id))).toHaveLength(0);

    p = (await flow(p, { action: 'announce_price', saleUnitRial: 2_400_000, note: 'قیمت بازار بالا رفت' })).body;
    expect(p.priceNotice).toMatchObject({ saleUnitRial: 2_400_000, note: 'قیمت بازار بالا رفت', response: null });
    const open = (await expert.get(`/price-notices?caseId=${c.id}`)).body;
    expect(open).toEqual([expect.objectContaining({ id: p.priceNotice!.id, part: expect.objectContaining({ id: p.id }) })]);
    // Work continues while nobody answers.
    p = (await flow(p, { action: 'market', supplier: 'بازار آزمون', purchaseUnitRial: 2_000_000, saleUnitRial: 2_400_000 })).body;
    expect(p.flowState).toBe('market');

    expect((await parts.post(`/price-notices/${p.priceNotice!.id}/respond`, { expectedVersion: 1, response: 'approved' })).status).toBe(403);
    expect((await expert.post(`/price-notices/${p.priceNotice!.id}/respond`, { expectedVersion: 1, response: 'instruction' })).status).toBe(400);
    const answered = await expert.post(`/price-notices/${p.priceNotice!.id}/respond`, { expectedVersion: 1, response: 'instruction', instruction: 'از فروشگاه آزمون دوم بخرید' });
    expect(answered.status).toBe(201);
    expect(answered.body).toMatchObject({ response: 'instruction', instruction: 'از فروشگاه آزمون دوم بخرید' });
    expect((await expert.post(`/price-notices/${p.priceNotice!.id}/respond`, { expectedVersion: 2, response: 'approved' })).body.code).toBe('PRICE_NOTICE_CLOSED');
    const [clerk] = await h.db.db.select({ id: users.id }).from(users).where(eq(users.username, 'parts'));
    const told = await h.db.db.select().from(notifications).where(and(eq(notifications.userId, clerk!.id), eq(notifications.kind, 'price_notice_answer')));
    expect(told).toHaveLength(1);
    expect((await one(p)).priceNotice).toBeNull();
  });
});

describe('daily Emdad report moves the line automatically', () => {
  const soon = (min: number) => {
    const d = new Date(Date.now() + min * 60_000);
    return { reportDate: formatJalaliDateInput(d), reportTime: formatTimeInput(d) };
  };
  async function publish(rows: ReturnType<typeof emdadRow>[], min: number) {
    const u = await request(h.app.getHttpServer())
      .post('/api/v1/daily-reports/uploads?kind=emdad&fileName=synthetic.xls')
      .set('Cookie', admin.cookie)
      .set('x-manage-client', 'test')
      .set('content-type', 'application/octet-stream')
      .send(Buffer.from(buildEmdadXml(rows)));
    expect(u.status).toBe(201);
    let job: DailyImport = u.body;
    for (let i = 0; i < 300 && ['uploaded', 'parsing'].includes(job.status); i++) {
      await new Promise((r) => setTimeout(r, 50));
      job = (await admin.get(`/daily-reports/imports/${u.body.id}`)).body;
    }
    const applied = await admin.post(`/daily-reports/imports/${job.id}/apply`, { declaration: true, ...soon(min) });
    expect(applied.status).toBe(201);
    return applied.body;
  }

  it('links by the request number, then «وارد موجودی» makes it ready and «تأمین توسط نمایندگی» tells the clerk', async () => {
    const c = await newCase('950041');
    let arrived = await newPart(c.id, '12345641', 1, 'سپر جلو آزمون');
    let dealer = await newPart(c.id, '12345642', 1, 'چراغ جلو آزمون');
    arrived = (await flow(arrived, { action: 'emdad', requestNo: '500041' })).body;
    dealer = (await flow(dealer, { action: 'emdad', requestNo: '500042' })).body;

    const result = await publish([
      emdadRow(41, { 'شماره کارت پذيرش': 'X-UNMATCHED-41', 'وضعیت امداد ویژه': 'وارد موجودی شده است' }),
      emdadRow(42, { 'شماره کارت پذيرش': 'X-UNMATCHED-42', 'وضعیت امداد ویژه': 'تامین توسط نمایندگی' }),
    ], 1);
    expect(result.counts).toMatchObject({ partsArrived: 1, partsDealerSupply: 1, linkedByRequestNo: 2 });

    const now = await partsOf(c.id);
    const a = now.find((p) => p.id === arrived.id)!;
    expect(a).toMatchObject({ flowState: 'ready', allowedActions: ['hand_over', 'cancel', 'set_price', 'announce_price'] });
    expect(a.emdad).toMatchObject({ requestNo: '500041', category: 'in_dealer_stock', statusText: 'وارد موجودی شده است' });
    const d = now.find((p) => p.id === dealer.id)!;
    expect(d).toMatchObject({ flowState: 'dealer_supply', allowedActions: ['market', 'reserve', 'set_price', 'announce_price'] });

    const [clerk] = await h.db.db.select({ id: users.id }).from(users).where(eq(users.username, 'parts'));
    expect(await h.db.db.select().from(notifications).where(and(eq(notifications.userId, clerk!.id), eq(notifications.kind, 'emdad_dealer_supply')))).toHaveLength(1);
    // From «تأمین توسط نمایندگی» the clerk buys from the market.
    const bought = await flow(d, { action: 'market', supplier: 'بازار آزمون', purchaseUnitRial: 5_000_000, saleUnitRial: 6_000_000 });
    expect(bought.body).toMatchObject({ flowState: 'market', source: 'external' });

    // The parts desk counts what is still open on this vehicle.
    const card = ((await parts.get('/parts/desk')).body as { caseId: string; counts: Record<string, number> }[]).find((x) => x.caseId === c.id)!;
    expect(card.counts).toMatchObject({ ready: 1, in_progress: 1 });
    expect((await expert.get('/parts/desk')).status).toBe(403);
    // No stock reservation is created by an Emdad arrival.
    expect(await h.db.db.select().from(stockReservations).where(eq(stockReservations.partRequestId, arrived.id))).toHaveLength(0);
  });
});
