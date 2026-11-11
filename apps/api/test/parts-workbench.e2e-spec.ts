import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { formatJalaliDateInput, type CaseDetail, type Department, type Part, type PartsStatement, type PartsWorkbench } from '@manage/shared';
import { dailyReportImports, emdadRequests, partRequests, stockSnapshotItems, stockSnapshots, users } from '../src/db/schema';
import { readWorkbook } from '../src/parts/xlsx';
import { createHarness, daysAgo, type Client, type Harness } from './harness';

let h: Harness;
let parts: Client;
let coordinator: Client;
let admin: Client;
let technician: Client;
let techId: string;
let tenantId: string;
let userId: string;
let departmentId: string;
let emdadImportId: string;
const stockCode = '6666123401';
const snapshotId = randomUUID();

beforeAll(async () => {
  h = await createHarness();
  [parts, coordinator, admin, technician] = await Promise.all([
    h.login('parts'), h.login('expert'), h.login('admin'), h.loginAs('test-parts-technician', ['technician']),
  ]);
  const [u] = await h.db.db.select().from(users).where(eq(users.username, 'admin'));
  const [tech] = await h.db.db.select().from(users).where(eq(users.username, 'test-parts-technician'));
  tenantId = u!.tenantId;
  userId = u!.id;
  techId = tech!.id;
  departmentId = ((await coordinator.get('/departments')).body as Department[])[0]!.id;
  const db = h.db.db;
  const stockImportId = randomUUID();
  emdadImportId = randomUUID();
  await db.insert(dailyReportImports).values([
    { id: stockImportId, tenantId, kind: 'stock', fileName: 'TEST.xlsx', fileSize: 1, fileSha256: 'TEST-STOCK',
      format: 'xlsx', parserVersion: 'test', uploadedBy: userId, status: 'applied', isTest: true },
    { id: emdadImportId, tenantId, kind: 'emdad', fileName: 'TEST.xls', fileSize: 1, fileSha256: 'TEST-EMDAD',
      format: 'xml', parserVersion: 'test', uploadedBy: userId, status: 'applied', isTest: true },
  ]);
  await db.insert(stockSnapshots).values({ id: snapshotId, tenantId, importId: stockImportId, reportedAt: new Date(),
    reportedAtPrecision: 'minute', scope: 'TEST', completeness: 'full', quantityMeaning: 'on_hand', currency: 'IRR',
    itemCount: 1, publishedBy: userId });
  await db.insert(stockSnapshotItems).values({ id: randomUUID(), snapshotId, tenantId, rowNo: 1, rawCode: stockCode,
    fullStockCode: stockCode, basePartNumber: '66661234', codeKind: 'standard', quantity: '1', salePrice: '1550000' });
});

afterAll(async () => { await h?.close(); });

async function kase(): Promise<CaseDetail> {
  const r = await coordinator.post('/cases', { admittedAt: daysAgo(5), coverageType: 'personal',
    customer: { fullName: 'مشتری آزمون فاز قطعات', phone: '09000001111' },
    vehicle: { brand: 'ایران خودرو', model: 'دنا', vin: `TESTVIN${randomUUID().replaceAll('-', '').slice(0, 10)}` } });
  expect(r.status).toBe(201);
  return r.body;
}

async function need(caseId: string, partNumber: string, source = 'company'): Promise<Part> {
  const r = await coordinator.post(`/cases/${caseId}/parts`, { source, quantity: 1, description: `قطعه آزمون ${partNumber}`, partNumber });
  expect(r.status).toBe(201);
  return r.body;
}

async function line(part: Part) {
  const body = (await parts.get('/parts/workbench')).body as PartsWorkbench;
  return body.cards.find(c => c.id === part.caseId)?.items.find(i => i.id === part.id);
}

const workAction = (id: string, body: object) => parts.post(`/parts/workbench/${id}/actions`, body);
const taskAction = (id: string, expectedVersion: number, action: string) => coordinator.post(`/tasks/${id}/actions`, { expectedVersion, action });

test('suggests exact stock, prevents double booking, and permits pickup only by the assigned technician', async () => {
  const c1 = await kase(), c2 = await kase();
  const p1 = await need(c1.id, stockCode), p2 = await need(c2.id, stockCode);
  const before = await line(p1);
  expect(before).toMatchObject({ action: 'emdad', suggestedPriceRial: 1550000, stockOptions: [expect.objectContaining({ snapshotId, fullStockCode: stockCode })], negativeRecommendations: expect.any(Array) });
  const stock = { snapshotId, fullStockCode: stockCode, locationAddress: '', confirm: true };
  const reserve = (p: Part) => workAction(p.id, { action: 'reserve', expectedVersion: p.version, salePriceRial: 1550000, stock });
  expect((await reserve(p1)).status).toBe(201);
  expect((await reserve(p2)).status).toBe(409);
  expect(await line(p2)).toMatchObject({ action: 'emdad', stock: null, negativeRecommendations: expect.arrayContaining([expect.objectContaining({ route: 'reserve' })]) });
  const task = await coordinator.post(`/cases/${c1.id}/tasks`, { departmentId, assignedUserId: techId });
  expect(task.status).toBe(201);
  const ready = await line(p1);
  expect(ready).toMatchObject({ action: 'handover', destinations: [expect.objectContaining({ taskId: task.body.id })] });
  expect((await parts.post(`/reminders/parts-ready/${p1.id}`, { taskId: randomUUID() })).status).toBe(422);
  expect((await parts.post(`/reminders/parts-ready/${p1.id}`, { taskId: task.body.id })).status).toBe(201);
  expect(((await technician.get('/reminders/inbox')).body as { body: string }[]).some(r => r.body.includes(p1.description))).toBe(true);
  expect((await technician.get('/parts/workbench')).status).toBe(403);
  const other = await h.loginAs('test-other-technician', ['technician']);
  const body = { partId: p1.id, expectedVersion: ready!.version };
  expect((await other.post(`/tasks/${task.body.id}/part-pickup`, body)).status).toBe(403);
  expect((await technician.post(`/tasks/${task.body.id}/part-pickup`, body)).status).toBe(201);
  expect(await line(p1)).toBeUndefined();
  expect(await line(p2)).toMatchObject({ action: 'emdad' });
});

test('batches Emdad with separate prices, suggests matched receipts and keeps market approval logic', async () => {
  const c = await kase();
  const p1 = await need(c.id, '88887777'), p2 = await need(c.id, '88889999');
  const p3 = await need(c.id, '11113333', 'external');
  expect(await line(p3)).toMatchObject({ action: 'emdad' });
  expect((await workAction(p3.id, { action: 'market', expectedVersion: p3.version, supplier: 'فروشنده آزمون', purchasePriceRial: 3000 })).status).toBe(201);
  const req = await workAction(c.id, { action: 'emdad', requestNo: 'TEST-EMDAD-3', requestedAt: daysAgo(3),
    parts: [{ id: p1.id, expectedVersion: p1.version, companyPriceRial: 2500 },
      { id: p2.id, expectedVersion: p2.version, companyPriceRial: 3200 }] });
  expect(req.status).toBe(201);
  const ordered = (await parts.get(`/cases/${c.id}/parts`)).body as Part[];
  expect(ordered.filter(p => p.orderRef === 'TEST-EMDAD-3').map(p => p.salePriceRial).sort()).toEqual([2500, 3200]);
  const id = randomUUID();
  await h.db.db.insert(emdadRequests).values({ id, tenantId, externalKey: 'TEST-EMDAD-3/1', requestNo: 'TEST-EMDAD-3',
    official: { fullCodeBase: '88887777', emdadRegisteredAt: formatJalaliDateInput(new Date(daysAgo(3))),
      receivedInWarehouseAt: formatJalaliDateInput(new Date(daysAgo(1))) }, statusCategory: 'received_by_dealer',
    firstImportId: emdadImportId, lastImportId: emdadImportId, lastReportAt: new Date(),
    caseId: c.id, partRequestId: p1.id, matchStatus: 'matched', isTest: true });
  const action = await line(p1);
  expect(action).toMatchObject({ action: 'received', emdadId: id, suggestedPriceRial: 2500 });
  expect((await workAction(p1.id, { action: 'received', expectedVersion: action!.version, emdadId: id, salePriceRial: 4000 })).status).toBe(201);
  expect(await line(p1)).toMatchObject({ action: 'handover', suggestedPriceRial: 4000 });
});

test('rejects handover without a sale price and exports immutable versions after approval', async () => {
  const c = await kase();
  const p = await need(c.id, '99998888', 'stock');
  const check = await parts.post(`/parts/${p.id}/actions`, { action: 'check_stock', expectedVersion: p.version, inStock: true });
  const reserve = await parts.post(`/parts/${p.id}/actions`, { action: 'reserve', expectedVersion: check.body.version });
  const hand = { action: 'hand_over', expectedVersion: reserve.body.version, recipientName: 'تعمیرکار آزمون' };
  const reject = await parts.post(`/parts/${p.id}/actions`, hand);
  expect(reject.body.code).toBe('PART_SALE_PRICE_REQUIRED');
  const delivered = await parts.post(`/parts/${p.id}/actions`, { ...hand, salePriceRial: 3300 });
  expect(delivered.status).toBe(201);
  const t = await coordinator.post(`/cases/${c.id}/tasks`, { departmentId });
  const start = await taskAction(t.body.id, t.body.version, 'start');
  const finish = await taskAction(t.body.id, start.body.version, 'complete');
  expect((await taskAction(t.body.id, finish.body.version, 'approve')).status).toBe(201);
  const endpoint = `/cases/${c.id}/parts-statement`;
  expect((await parts.get('/parts/workbench/notices')).body).toEqual(expect.arrayContaining([expect.objectContaining({ caseId: c.id })]));
  expect((await parts.post(`${endpoint}/${p.id}/consume`, { expectedVersion: delivered.body.version })).status).toBe(201);
  expect((await parts.post(endpoint, { expectedVersion: 0 })).body).toEqual({ number: 1 });
  const [used] = await h.db.db.select().from(partRequests).where(eq(partRequests.id, p.id));
  expect((await workAction(p.id, { action: 'return', expectedVersion: used!.version, reason: 'قطعهٔ آزمون برگشت خورد' })).status).toBe(201);
  expect((await parts.post(endpoint, { expectedVersion: 1 })).body).toEqual({ number: 2 });
  const statement = (await coordinator.get(endpoint)).body as PartsStatement;
  expect(statement.live.parts).toEqual([]);
  expect(statement.versions[0]?.snapshot.parts[0]?.priceRial).toBe(3300);
  expect(statement.versions[1]?.removed).toEqual([p.description]);
  const pdf = await coordinator.get(`${endpoint}/export?format=pdf&version=1`).buffer(true)
    .parse((res, done) => { const chunks: Buffer[] = []; res.on('data', (x: Buffer) => chunks.push(x)); res.on('end', () => done(null, Buffer.concat(chunks))); });
  expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');
  const xlsx = await coordinator.get(`${endpoint}/export?format=xlsx&version=1&assessment=1`).buffer(true)
    .parse((res, done) => { const chunks: Buffer[] = []; res.on('data', (x: Buffer) => chunks.push(x)); res.on('end', () => done(null, Buffer.concat(chunks))); });
  expect(readWorkbook(xlsx.body)[0]?.rows[1]).toContain('کارشناسی واحد (ریال)');
  expect((await technician.get(endpoint)).status).toBe(403);
});

test('routes external work through the same plan and approval and surfaces its late promise', async () => {
  const c = await kase();
  const contractor = await admin.post('/parts/contractors', { name: 'شیشه‌بر آزمون', phone: '09000001112', specialty: 'شیشه' });
  expect(contractor.status).toBe(201);
  const e = await coordinator.post(`/cases/${c.id}/external-work`, { title: 'برش شیشه آزمون', durationDays: 1, departmentId });
  expect(e.status).toBe(201);
  const id = e.body.id;
  const planned = (await coordinator.get(`/cases/${c.id}`)).body as CaseDetail;
  expect(planned.tasks[0]?.plannedEndAt).toBeTruthy();
  expect(planned.forecastDeliveryAt).toBe(planned.tasks[0]?.plannedEndAt);
  const act = (body: object) => parts.post(`/parts/external-work/${id}/actions`, body);
  expect((await act({ action: 'coordinate', expectedVersion: 1, contractorId: contractor.body.id, mode: 'send',
    appointmentAt: daysAgo(3), promisedAt: daysAgo(2), priceRial: 1500 })).status).toBe(201);
  expect((await coordinator.get('/parts/operations/notices')).body).toEqual(expect.arrayContaining([expect.objectContaining({ key: id })]));
  expect((await act({ action: 'dispatch', expectedVersion: 2, expectedTaskVersion: 1 })).status).toBe(201);
  expect((await act({ action: 'complete', expectedVersion: 3, expectedTaskVersion: 2 })).status).toBe(201);
  expect((await taskAction(id, 3, 'approve')).status).toBe(201);
  const statement = (await coordinator.get(`/cases/${c.id}/parts-statement`)).body as PartsStatement;
  expect(statement.live.external[0]).toMatchObject({ id, priceRial: 1500 });
});

test('parts clerk records the verified payer response to their own market quote', async () => {
  const created = await coordinator.post('/cases', { admittedAt: daysAgo(2), coverageType: 'insurance',
    insurerName: 'بیمه آزمون', customer: { fullName: 'مشتری تست قیمت' },
    vehicle: { model: 'تارا', vin: `TESTVIN${randomUUID().replaceAll('-', '').slice(0, 10)}` } });
  expect(created.status).toBe(201);
  const p = await need(created.body.id, '77775555', 'external');
  const quoted = await parts.post(`/workshop/parts/${p.id}/quotes`, {
    expectedVersion: p.version, unitPriceRial: 4_000_000, supplier: 'فروشنده آزمون',
    validUntil: new Date(Date.now() + 2 * 86400000).toISOString(),
  });
  expect(quoted.status).toBe(201);
  const pending = quoted.body.find((q: { partId: string; status: string }) => q.partId === p.id && q.status === 'pending');
  expect(pending).toBeDefined();
  // Spec section 7: the accident expert records the payer's answer; the parts clerk cannot.
  expect((await parts.post(`/workshop/quotes/${pending.id}/decision`, {
    expectedVersion: pending.version, decision: 'approved', source: 'insurer',
    officialRecorded: true, reference: 'TEST-APPROVAL', approver: 'کارشناس تست', note: 'آزمون',
  })).status).toBe(403);
  const missingOfficial = await coordinator.post(`/workshop/quotes/${pending.id}/decision`, {
    expectedVersion: pending.version, decision: 'approved', source: 'insurer',
    officialRecorded: false, reference: 'TEST-APPROVAL', approver: 'کارشناس تست', note: 'آزمون',
  });
  expect(missingOfficial.status).toBe(422);
  const approved = await coordinator.post(`/workshop/quotes/${pending.id}/decision`, {
    expectedVersion: pending.version, decision: 'approved', source: 'insurer',
    officialRecorded: true, reference: 'TEST-APPROVAL', approver: 'کارشناس تست', note: 'مجوز رسمی آزمون ثبت است',
  });
  expect(approved.status).toBe(201);
  const history = (await parts.get(`/workshop/quotes?caseId=${created.body.id}`)).body;
  expect(history).toEqual(expect.arrayContaining([expect.objectContaining({
    id: pending.id, status: 'approved', reference: 'TEST-APPROVAL',
  })]));
});
