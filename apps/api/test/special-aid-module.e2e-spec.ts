import { and, eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { dossierQueue, formatJalaliDateInput, formatTimeInput, SPECIAL_AID_QUEUES, type DailyImport, type Paged, type SpecialAidDossier, type SpecialAidDossierRow, type SpecialAidSupplyRow, type SpecialAidTodayEntry } from '@manage/shared';
import { notifications, specialAidContacts, specialAidDossiers, specialAidItems, stockReservations, users } from '../src/db/schema';
import { buildEmdadXml, buildStockXlsx, emdadRow, type EmdadRow, type StockRow } from '../src/daily-reports/fixtures';
import { newId } from '../src/common/ids';
import { Client, createHarness, type Harness } from './harness';

// «پیگیری امداد ویژه» for a general-repair vehicle (no accident case), spec section 25.
// Synthetic data only: TESTVIN…, invented codes and numbers.
let h: Harness;
let parts: Client, operator: Client, supplyExpert: Client, manager: Client, admin: Client, owner: Client;
const VIN = 'TESTVIN0000SA0001';
const OTHER_VIN = 'TESTVIN0000SA0002';

const at = (min: number) => { const d = new Date(Date.now() + min * 60_000); return { reportDate: formatJalaliDateInput(d), reportTime: formatTimeInput(d) }; };
async function preview(kind: 'stock' | 'emdad', data: Uint8Array): Promise<DailyImport> {
  const u = await request(h.app.getHttpServer()).post(`/api/v1/daily-reports/uploads?kind=${kind}&fileName=synthetic.bin`).set('Cookie', parts.cookie).set('x-manage-client', 'test').set('content-type', 'application/octet-stream').send(Buffer.from(data));
  expect(u.status).toBe(201);
  let job: DailyImport = u.body;
  for (let i = 0; i < 300 && ['uploaded', 'parsing'].includes(job.status); i++) { await new Promise((r) => setTimeout(r, 50)); job = (await parts.get(`/daily-reports/imports/${u.body.id}`)).body; }
  expect(job.status).toBe('preview');
  return job;
}
const apply = (job: DailyImport, min: number) => parts.post(`/daily-reports/imports/${job.id}/apply`, { declaration: true, declaredToday: true, acceptTemplate: true, ...at(min) });
async function publish(rows: EmdadRow[], min: number) { const r = await apply(await preview('emdad', buildEmdadXml(rows)), min); expect(r.status).toBe(201); }
const line = (i: number, over: EmdadRow): EmdadRow => emdadRow(i, { 'شماره شاسی': VIN, 'شماره درخواست': '', ...over });
const sku = (code: string, qty: string, loc: string): StockRow => ({ 'کد کالا': `_x001F_ ${code}`, 'شرح کالا': `قطعه ساختگی ${code}`, 'واحد شمارش': 'عدد', 'موجودي': qty, 'قيمت ميانگين': '1000', 'قيمت فروش': '1500', 'آدرس': loc });
const arrivedX = { 'شماره کارت پذيرش': '981001', 'شماره امداد ویژه': '0081001', 'کد قطعه': '00112233', 'کد اختصاصی اولیه': '00112233', 'كد تداركاتي كالا': '0011223301', 'وضعیت امداد ویژه': 'وارد موجودی شده است', 'تاريخ رسيد شدن امداد ويژه در انبار': '1405/08/29', 'تعداد اختصاصي': '1' };
const pendingY = { 'شماره کارت پذيرش': '981001', 'شماره امداد ویژه': '0081002', 'کد قطعه': '00445566', 'کد اختصاصی اولیه': '00445566', 'كد تداركاتي كالا': '0044556601', 'وضعیت امداد ویژه': 'در مرحله خرید', 'تعداد اختصاصي': '1' };
const pendingZ = { 'شماره کارت پذيرش': '981002', 'شماره امداد ویژه': '0081003', 'کد قطعه': '00778899', 'کد اختصاصی اولیه': '00778899', 'كد تداركاتي كالا': '0077889901', 'وضعیت امداد ویژه': 'در حال تامین', 'تعداد اختصاصي': '2' };
const shortChassis = { 'شماره شاسی': 'SHORT12', 'شماره کارت پذيرش': '981009', 'شماره امداد ویژه': '0081009', 'کد قطعه': '00999999', 'وضعیت امداد ویژه': 'در حال تامین' };

const dossierOf = async (c: Client, vin = VIN) => ((await c.post('/special-aid/dossiers/search', { q: vin })).body as Paged<SpecialAidDossierRow>).items[0]!;
const detail = async (c: Client, id: string): Promise<SpecialAidDossier> => (await c.get(`/special-aid/dossiers/${id}`)).body;
const holdsOf = (itemId: string) => h.db.db.select().from(stockReservations).where(eq(stockReservations.specialAidItemId, itemId));

beforeAll(async () => {
  h = await createHarness();
  parts = await h.login('parts');
  [operator, supplyExpert, manager, admin, owner] = await Promise.all([
    h.loginAs('sa-operator', ['special_aid_operator']),
    h.loginAs('sa-supply', ['special_aid_supply']),
    h.loginAs('sa-manager', ['service_manager']),
    h.loginAs('sa-admin', ['system_admin']),
    h.loginAs('sa-owner', ['service_manager']),
  ]);
  await h.db.db.update(users).set({ isOwner: true }).where(eq(users.username, 'sa-owner'));
  expect((await apply(await preview('stock', buildStockXlsx([sku('0011223301', '2', 'S-01'), sku('0044556601', '3', 'S-02'), sku('0044556601', '3', 'S-03')])), -600)).status).toBe(201);
  const prof = await owner.get('/daily-reports/profiles/stock');
  expect((await owner.patch('/daily-reports/profiles/stock', { expectedVersion: prof.body.version, completeness: 'partial', scope: 'انبار آزمون امداد', quantityMeaning: 'on_hand', currency: 'IRR' })).status).toBe(200);
  await publish([line(1, arrivedX), line(2, pendingY), line(3, pendingZ), emdadRow(4, { 'شماره درخواست': '', ...shortChassis }), emdadRow(5, { 'شماره شاسی': OTHER_VIN, 'شماره کارت پذيرش': '981050', 'شماره امداد ویژه': '0081050', 'کد قطعه': '00121212', 'وضعیت امداد ویژه': 'در حال تامین' })], -500);
});
afterAll(async () => { await h?.close(); });

it('builds one dossier per valid VIN with independent admissions and parts; a short chassis is not a dossier', async () => {
  const d = await dossierOf(operator);
  expect(d).toMatchObject({ vin: VIN, admissionCount: 2, arrived: 1, pending: 2 });
  const full = await detail(operator, d.id);
  expect(full.admissions.map((a) => a.admissionNo).sort()).toEqual(['981001', '981002']);
  expect(full.items).toHaveLength(3);
  expect(full.items.filter((i) => i.admissionNo === '981001')).toHaveLength(2);
  expect((await operator.post('/special-aid/dossiers/search', { q: 'SHORT12' })).body.total).toBe(0);
  // Copyable full VIN and search by special-aid number.
  expect((await operator.post('/special-aid/dossiers/search', { q: '0081003' })).body.items[0].vin).toBe(VIN);
});

it('holds the arrived part for its VIN: deducted from available stock and untouchable from the stock desk', async () => {
  const full = await detail(operator, (await dossierOf(operator)).id);
  const x = full.items.find((i) => i.emdadNo === '0081001')!;
  expect(x).toMatchObject({ state: 'reserved', holdNote: null });
  expect(x.holdId).toBeTruthy();
  const [hold] = await holdsOf(x.id);
  expect(hold).toMatchObject({ caseId: null, partRequestId: null, fullStockCode: '0011223301', locationAddress: 'S-01', status: 'reserved' });
  expect(Number(hold!.quantity)).toBe(1);
  const opts = await parts.get('/stock/options?q=0011223301');
  expect(JSON.stringify(opts.body)).toContain('0011223301');
  const option = (opts.body.items ?? opts.body).flatMap((g: { options?: { fullStockCode: string; available: string }[] }) => g.options ?? [g]).find((o: { fullStockCode: string }) => o.fullStockCode === '0011223301');
  expect(Number(option.available)).toBe(1);
  const act = await parts.post(`/stock/reservations/${hold!.id}/actions`, { action: 'release', expectedVersion: hold!.version, reason: 'آزمون' });
  expect(act.status).toBe(422);
  expect(act.body.code).toBe('SPECIAL_AID_HOLD');
  // The pending part with stock in two locations is not held before it arrives.
  expect(await holdsOf(full.items.find((i) => i.emdadNo === '0081002')!.id)).toHaveLength(0);
});

it('re-publishing the same report creates no duplicate dossier, admission, part or hold', async () => {
  await publish([line(1, arrivedX), line(2, pendingY), line(3, pendingZ)], -450);
  expect(await h.db.db.select().from(specialAidDossiers).where(eq(specialAidDossiers.vin, VIN))).toHaveLength(1);
  const full = await detail(operator, (await dossierOf(operator)).id);
  expect(full.items).toHaveLength(3);
  expect(full.admissions).toHaveLength(2);
  expect(await holdsOf(full.items.find((i) => i.emdadNo === '0081001')!.id)).toHaveLength(1);
  // A row missing from a later report is not treated as cancelled.
  await publish([line(1, arrivedX)], -440);
  expect((await detail(operator, full.id)).items.find((i) => i.emdadNo === '0081003')!.state).toBe('pending');
});

it('today lists the unannounced arrival; three failed days notify management; an answer records the announcement', async () => {
  const today = (await operator.get('/special-aid/today')).body as SpecialAidTodayEntry[];
  const mine = today.find((t) => t.dossier.vin === VIN)!;
  expect(mine.tasks[0]).toMatchObject({ kind: 'inform_arrival', urgent: true });
  let d = await detail(operator, mine.dossier.id);
  const x = d.items.find((i) => i.emdadNo === '0081001')!;
  // Two earlier failed days (synthetic history), then today's attempt.
  const opUser = (await h.db.db.select({ id: users.id, tenantId: users.tenantId }).from(users).where(eq(users.username, 'sa-operator')))[0]!;
  for (const daysBack of [2, 1]) await h.db.db.insert(specialAidContacts).values({ id: newId(), tenantId: opUser.tenantId, dossierId: d.id, outcome: 'no_answer', itemIds: [x.id], createdBy: opUser.id, createdAt: new Date(Date.now() - daysBack * 86_400_000), isTest: true });
  const r = await operator.post(`/special-aid/dossiers/${d.id}/contacts`, { outcome: 'no_answer', itemIds: [x.id], expectedVersion: d.version });
  expect(r.status).toBe(201);
  expect(r.body.failedAttemptDays).toBe(3);
  expect(r.body.tasks.some((t: { kind: string }) => t.kind === 'escalation')).toBe(true);
  const mgr = (await h.db.db.select({ id: users.id }).from(users).where(eq(users.username, 'sa-manager')))[0]!;
  const notes = await h.db.db.select().from(notifications).where(and(eq(notifications.userId, mgr.id), eq(notifications.kind, 'special_aid.escalation')));
  expect(notes).toHaveLength(1);
  // The same streak never notifies twice.
  d = r.body;
  await operator.post(`/special-aid/dossiers/${d.id}/contacts`, { outcome: 'no_answer', itemIds: [x.id], expectedVersion: d.version });
  expect(await h.db.db.select().from(notifications).where(and(eq(notifications.userId, mgr.id), eq(notifications.kind, 'special_aid.escalation')))).toHaveLength(1);
  d = await detail(operator, d.id);
  const ok = await operator.post(`/special-aid/dossiers/${d.id}/contacts`, { outcome: 'answered', itemIds: [x.id], note: 'مشتری فردا می‌آید', expectedVersion: d.version });
  expect(ok.status).toBe(201);
  expect(ok.body.items.find((i: { id: string }) => i.id === x.id).informedAt).toBeTruthy();
  expect(ok.body.failedAttemptDays).toBe(0);
  // A stale version is rejected.
  expect((await operator.post(`/special-aid/dossiers/${d.id}/contacts`, { outcome: 'answered', itemIds: [x.id], expectedVersion: d.version })).status).toBe(409);
});

it('postponement keeps the original deadline; the reason is required', async () => {
  const d = await detail(operator, (await dossierOf(operator)).id);
  expect((await operator.post(`/special-aid/dossiers/${d.id}/postpone`, { until: new Date(Date.now() + 3 * 86_400_000).toISOString(), reason: '', expectedVersion: d.version })).status).toBe(400);
  const p = await operator.post(`/special-aid/dossiers/${d.id}/postpone`, { until: new Date(Date.now() + 3 * 86_400_000).toISOString(), reason: 'مشتری در سفر است', expectedVersion: d.version });
  expect(p.status).toBe(201);
  expect(p.body.postponeReason).toBe('مشتری در سفر است');
});

it('part states: delivered is not installed; a non-consumption reason never releases; release needs authorization', async () => {
  let d = await detail(operator, (await dossierOf(operator)).id);
  const x = d.items.find((i) => i.emdadNo === '0081001')!;
  expect((await operator.post(`/special-aid/items/${x.id}/action`, { action: 'installed', expectedVersion: x.version })).body.code).toBe('SPECIAL_AID_ACTION');
  const delivered = await operator.post(`/special-aid/items/${x.id}/action`, { action: 'deliver', expectedVersion: x.version });
  expect(delivered.status).toBe(201);
  let item = delivered.body.items.find((i: { id: string }) => i.id === x.id);
  expect(item.state).toBe('delivered');
  expect((await holdsOf(x.id))[0]!.status).toBe('issued');
  const reason = await operator.post(`/special-aid/items/${x.id}/non-consumption`, { reason: 'wrong_part_number', note: 'کد اشتباه ثبت شده بود', expectedVersion: item.version });
  expect(reason.status).toBe(201);
  item = reason.body.items.find((i: { id: string }) => i.id === x.id);
  expect(item.nonConsumptionReason).toBe('wrong_part_number');
  expect((await holdsOf(x.id))[0]!.status).toBe('issued');
  const notInstalled = await operator.post(`/special-aid/items/${x.id}/action`, { action: 'not_installed', expectedVersion: item.version });
  item = notInstalled.body.items.find((i: { id: string }) => i.id === x.id);
  expect(item.state).toBe('not_installed');
  const back = await operator.post(`/special-aid/items/${x.id}/action`, { action: 'return_to_stock_hold', expectedVersion: item.version });
  item = back.body.items.find((i: { id: string }) => i.id === x.id);
  expect(item.state).toBe('reserved');
  expect((await holdsOf(x.id))[0]!.status).toBe('reserved');
  // The operator may not release; an authorized administrator may, with a reason.
  expect((await operator.post(`/special-aid/items/${x.id}/action`, { action: 'release', reason: 'مشتری انصراف داد', expectedVersion: item.version })).status).toBe(403);
  expect((await admin.post(`/special-aid/items/${x.id}/action`, { action: 'release', expectedVersion: item.version })).status).toBe(400);
  const released = await admin.post(`/special-aid/items/${x.id}/action`, { action: 'release', reason: 'قطعه اشتباه بود؛ با فرایند انبار', expectedVersion: item.version });
  expect(released.status).toBe(201);
  expect(released.body.items.find((i: { id: string }) => i.id === x.id).state).toBe('released');
  expect((await holdsOf(x.id))[0]!.status).toBe('released');
  d = released.body;
  expect(d.items.find((i) => i.id === x.id)!.nonConsumptionReason).toBe('wrong_part_number');
});

it('a later report moves a pending part to arrived with the observation date; a group waits for the operator', async () => {
  let d = await detail(operator, (await dossierOf(operator)).id);
  const y = d.items.find((i) => i.emdadNo === '0081002')!, z = d.items.find((i) => i.emdadNo === '0081003')!;
  expect((await operator.post(`/special-aid/dossiers/${d.id}/groups`, { itemIds: [y.id, z.id], label: 'سپر و چراغ' })).status).toBe(201);
  await publish([line(2, { ...pendingY, 'وضعیت امداد ویژه': 'وارد موجودی شده است', 'تاريخ رسيد شدن امداد ويژه در انبار': '1405/09/01' }), line(3, pendingZ)], -300);
  d = await detail(operator, d.id);
  const y2 = d.items.find((i) => i.id === y.id)!;
  expect(y2.state).toBe('arrived');
  expect(y2.arrivalObservedAt).toBeTruthy();
  // Two locations: no automatic choice; the operator is told.
  expect(y2.holdNote).toContain('چند محل');
  expect(d.tasks.some((t) => t.kind === 'group_decision')).toBe(true);
  expect(d.tasks.some((t) => t.kind === 'inform_arrival' && t.itemIds.includes(y.id))).toBe(false);
  const g = d.groups[0]!;
  const decided = await operator.post(`/special-aid/groups/${g.id}/decision`, { decision: 'partial', expectedVersion: g.version });
  expect(decided.status).toBe(201);
  expect(decided.body.tasks.some((t: { kind: string; itemIds: string[] }) => t.kind === 'inform_arrival' && t.itemIds.includes(y.id))).toBe(true);
  // The operator chooses the location; the hold respects the same code.
  const chosen = await operator.post(`/special-aid/items/${y.id}/action`, { action: 'reserve', fullStockCode: '0044556601', locationAddress: 'S-03', expectedVersion: y2.version });
  expect(chosen.status).toBe(201);
  expect((await holdsOf(y.id))[0]).toMatchObject({ locationAddress: 'S-03', status: 'reserved' });
  expect((await operator.post(`/special-aid/items/${y.id}/action`, { action: 'reserve', fullStockCode: '0099999901', expectedVersion: chosen.body.items.find((i: { id: string }) => i.id === y.id).version })).status).toBeGreaterThanOrEqual(400);
});

it('supply follow-up: pending parts with official text and observation days, Excel export; roles stay separate', async () => {
  const s = await supplyExpert.post('/special-aid/supply/search', {});
  expect(s.status).toBe(201);
  const rows = (s.body as Paged<SpecialAidSupplyRow>).items;
  const z = rows.find((r) => r.emdadNo === '0081003')!;
  expect(z).toMatchObject({ vin: VIN, officialStatus: 'در حال تامین', officialCategory: 'in_supply' });
  expect(z.statusObservedAt).toBeTruthy();
  expect(z.idleDays).toBeGreaterThanOrEqual(0);
  expect(rows.some((r) => r.emdadNo === '0081002')).toBe(false);
  expect((await supplyExpert.post('/special-aid/supply/search', { q: '0081003', minIdleDays: 400 })).body.total).toBe(0);
  const x = await request(h.app.getHttpServer()).post('/api/v1/special-aid/supply/export').set('Cookie', supplyExpert.cookie).set('x-manage-client', 'test').send({});
  expect(x.status).toBe(201);
  expect(x.headers['content-type']).toContain('spreadsheetml');
  // Separate workspaces and permissions.
  expect((await operator.post('/special-aid/supply/search', {})).status).toBe(403);
  const d = await dossierOf(supplyExpert);
  expect((await supplyExpert.post(`/special-aid/dossiers/${d.id}/contacts`, { outcome: 'answered', itemIds: [newId()], expectedVersion: 1 })).status).toBe(403);
  expect((await parts.get(`/special-aid/dossiers/${d.id}`)).status).toBe(200);
  expect((await parts.post(`/special-aid/dossiers/${d.id}/postpone`, { until: new Date(Date.now() + 86_400_000).toISOString(), reason: 'آزمون', expectedVersion: 1 })).status).toBe(403);
  // The supply expert does not see the customer's full phone number.
  expect((await supplyExpert.get(`/special-aid/dossiers/${d.id}`)).status).toBe(200);
});

it('management summary keeps non-consumption reasons apart and is read only', async () => {
  const s = await manager.get('/special-aid/summary');
  expect(s.status).toBe(200);
  expect(s.body.reasons.wrong_part_number).toBe(1);
  expect(s.body.released).toBe(1);
  expect(s.body.total).toBeGreaterThanOrEqual(4);
  // Funnel (owner, 2026-11-23): parts add up, vehicles never exceed the registered count.
  const f = s.body.funnel;
  expect(f.parts.requested).toBe(s.body.total);
  expect(f.parts.pending + f.parts.arrived).toBe(f.parts.requested);
  expect(f.parts.releasedToOthers).toBe(1);
  for (const k of ['arrived', 'informed', 'invited', 'attended', 'installed']) expect(f.customers[k]).toBeLessThanOrEqual(f.customers.registered);
  const future = (await manager.get('/special-aid/summary?from=2099-01-01')).body.funnel;
  expect(future.parts.requested).toBe(0);
  expect((await manager.get('/special-aid/summary?from=bad')).status).toBe(400);
  expect((await operator.get('/special-aid/summary')).status).toBe(403);
  const d = await dossierOf(manager);
  expect((await manager.post(`/special-aid/dossiers/${d.id}/attended`, { expectedVersion: 1 })).status).toBe(403);
});

it('items of other vehicles cannot be used in a contact of this dossier', async () => {
  const d = await detail(operator, (await dossierOf(operator)).id);
  const other = await detail(operator, (await dossierOf(operator, OTHER_VIN)).id);
  const r = await operator.post(`/special-aid/dossiers/${d.id}/contacts`, { outcome: 'answered', itemIds: [other.items[0]!.id], expectedVersion: d.version });
  expect(r.status).toBe(422);
  expect(r.body.code).toBe('SPECIAL_AID_ITEMS');
  const all = await h.db.db.select().from(specialAidItems).where(inArray(specialAidItems.dossierId, [d.id, other.id]));
  expect(all.length).toBe(4);
});

it('notification center: reading is not completing; urgent stays counted until resolved; no duplicates', async () => {
  const inbox = (await manager.get('/notifications')).body as { unread: number; badge: number; items: { id: string; kind: string; urgent: boolean; category: string; state: string }[] };
  const esc = inbox.items.filter((n) => n.kind === 'special_aid.escalation');
  expect(esc).toHaveLength(1);
  expect(esc[0]).toMatchObject({ urgent: true, category: 'special_aid', state: 'unread' });
  const read = (await manager.post('/notifications/read', { ids: [esc[0]!.id] })).body;
  expect(read.items.find((n: { id: string }) => n.id === esc[0]!.id).state).toBe('open');
  expect(read.badge).toBeGreaterThanOrEqual(1);
  const done = await manager.post('/notifications/resolve', { ids: [esc[0]!.id] });
  expect(done.status).toBe(201);
  expect(done.body.items.find((n: { id: string }) => n.id === esc[0]!.id).state).toBe('done');
  expect(done.body.badge).toBe(read.badge - 1);
  // History is kept; another user cannot resolve it.
  expect((await operator.post('/notifications/resolve', { ids: [esc[0]!.id] })).body.items.some((n: { id: string }) => n.id === esc[0]!.id)).toBe(false);
});

it('report center: three ISACO reports, last import, editable guide only with report_center.manage', async () => {
  const list = await parts.get('/report-center');
  expect(list.status).toBe(200);
  expect(list.body.map((e: { kind: string }) => e.kind)).toEqual(['emdad', 'reception', 'appointments']);
  const emdad = list.body[0];
  expect(emdad).toMatchObject({ isacoPath: 'خدمات ← گزارش ← امداد ویژه', supported: true, pastDays: 150 });
  expect(emdad.lastImport.rows).toBeGreaterThan(0);
  expect(list.body[2]).toMatchObject({ supported: true, pastDays: 30, futureDays: 30, lastImport: null, stale: true, layoutConfirmed: false });
  const body = { kind: 'appointments', guide: 'راهنمای آزمونی برای گزارش نوبت با بازهٔ تازه', pastDays: 20, futureDays: 40 };
  expect((await parts.put('/report-center', body)).status).toBe(403);
  expect((await operator.get('/report-center')).status).toBe(403);
  const saved = await admin.put('/report-center', body);
  expect(saved.status).toBe(200);
  expect(saved.body[2]).toMatchObject({ guide: body.guide, pastDays: 20, futureDays: 40 });
  expect((await admin.put('/report-center', { ...body, futureDays: 400 })).status).toBe(400);
});

it('reconstruction: one queue per vehicle, «خاموش» counts as not reached, inspection file (scenario 2026-11-25)', async () => {
  const d = await detail(operator, (await dossierOf(operator)).id);
  const expected = dossierQueue(d.items.map((i) => ({ id: i.id, state: i.state, receivedAt: i.receivedAt, arrivalObservedAt: i.arrivalObservedAt, informedAt: i.informedAt, groupId: i.groupId, officialCancelled: i.officialCategory === 'cancelled' })), d.contacts);
  const member: string[] = [];
  for (const view of SPECIAL_AID_QUEUES) {
    const ids = ((await operator.post('/special-aid/dossiers/search', { view, pageSize: 100 })).body as Paged<SpecialAidDossierRow>).items.map((x) => x.id);
    if (ids.includes(d.id)) member.push(view);
  }
  expect(member).toEqual(expected ? [expected] : []);
  const r = await operator.post(`/special-aid/dossiers/${d.id}/contacts`, { outcome: 'switched_off', itemIds: [d.items[0]!.id], expectedVersion: d.version });
  expect(r.status).toBe(201);
  expect((r.body as SpecialAidDossier).contacts[0]!.outcome).toBe('switched_off');
  expect((r.body as SpecialAidDossier).failedAttemptDays).toBeGreaterThanOrEqual(1);
  const file = await operator.get(`/special-aid/dossiers/${d.id}/inspection`).buffer(true).parse((res, cb) => {
    const b: Buffer[] = [];
    res.on('data', (c: Buffer) => b.push(c));
    res.on('end', () => cb(null, Buffer.concat(b)));
  });
  expect(file.status).toBe(200);
  expect(String(file.headers['content-type'])).toContain('spreadsheetml');
  expect((file.body as Buffer).subarray(0, 2).toString()).toBe('PK');
  const item = (r.body as SpecialAidDossier).items.find((i) => i.state !== 'installed')!;
  const saved = await operator.post(`/special-aid/items/${item.id}/non-consumption`, { reason: 'technician_diagnosis', requestingStation: 'مکانیکی 99', expectedVersion: item.version });
  expect(saved.status).toBe(201);
  expect((await detail(operator, d.id)).items.find((i) => i.id === item.id)).toMatchObject({ nonConsumptionReason: 'technician_diagnosis', requestingStation: 'مکانیکی 99' });
  const guest = await h.loginAs('sa-recon-guest', ['guest']);
  expect((await guest.get(`/special-aid/dossiers/${d.id}/inspection`)).status).toBe(403);
});
