import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { formatJalaliDateInput, formatTimeInput, type CaseDetail, type DailyImport, type Part } from '@manage/shared';
import { hashPassword } from '../src/auth/password';
import { newId } from '../src/common/ids';
import { cases, dailyReportFiles, dailyReportImports, dailyReportProfiles, dailyTasks, emdadRequests, notifications, stockSnapshots, tenants, users, vehicles } from '../src/db/schema';
import { DailyReportsService } from '../src/daily-reports/daily-reports.service';
import { DailyTasksService } from '../src/daily-reports/daily-tasks.service';
import { buildEmdadXml, buildStockXlsx, emdadRow, type StockRow } from '../src/daily-reports/fixtures';
import { readWorkbook, writeSheet } from '../src/parts/xlsx';
import { Client, LEGACY_QC_PERMISSIONS, createHarness, daysAgo, TEST_PASSWORD, type Harness } from './harness';

// Daily parts reports (docs/DAILY_PARTS_FA.md), synthetic files only.

let h: Harness;
let manager: Client, parts: Client, admin: Client, qc: Client, expert: Client, owner: Client;
const day = (n: number) => formatJalaliDateInput(new Date(Date.now() - n * 86_400_000));
// A report time a few minutes ahead (within the allowed clock tolerance), so it is after the recorded steps.
const soon = (min: number) => {
  const d = new Date(Date.now() + min * 60_000);
  return { reportDate: formatJalaliDateInput(d), reportTime: formatTimeInput(d) };
};

function upload(c: Client, kind: 'stock' | 'emdad', data: Uint8Array, fileName = 'synthetic.bin', type = 'application/octet-stream') {
  return request(h.app.getHttpServer())
    .post(`/api/v1/daily-reports/uploads?kind=${kind}&fileName=${encodeURIComponent(fileName)}`)
    .set('Cookie', c.cookie)
    .set('x-manage-client', 'test')
    .set('content-type', type)
    .send(Buffer.from(data));
}
async function ready(c: Client, id: string): Promise<DailyImport> {
  for (let i = 0; i < 300; i++) {
    const r = await c.get(`/daily-reports/imports/${id}`);
    if (!['uploaded', 'parsing'].includes(r.body.status)) return r.body;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error('import did not finish');
}
async function previewOf(kind: 'stock' | 'emdad', data: Uint8Array, c = manager) {
  const u = await upload(c, kind, data);
  expect(u.status).toBe(201);
  return ready(c, u.body.id);
}
const apply = (id: string, body: object, c = manager) => c.post(`/daily-reports/imports/${id}/apply`, { declaration: true, ...body });
const sku = (base: string, suffix: string, over: StockRow = {}): StockRow => ({ 'کد کالا': `_x001F_ ${base}${suffix}`, 'شرح کالا': `قطعه ساختگی ${base}`, 'واحد شمارش': 'عدد', 'موجودي': '2', 'قيمت ميانگين': '1000.125', 'قيمت فروش': '1500', 'آدرس': `A-${suffix}`, ...over });
const family = (base: string, n = 8, over: StockRow = {}) => Array.from({ length: n }, (_, i) => sku(base, String(i + 1).padStart(2, '0'), over));

async function newCase(admissionNo: string, chassisRef: string | null): Promise<CaseDetail> {
  const res = await expert.post('/cases', {
    customer: { fullName: 'مشتری آزمون روزانه', phone: '09000005555' },
    vehicle: { brand: 'ایران‌خودرو', model: 'دنا', vin: `TESTVIN${Math.random().toString().slice(2, 12)}` },
    admissionNo,
    admittedAt: daysAgo(3),
    damageDescription: 'آزمون',
  });
  expect(res.status).toBe(201);
  if (chassisRef) await h.db.db.update(vehicles).set({ chassisRef }).where(eq(vehicles.id, res.body.vehicle.id));
  return res.body;
}
async function need(caseId: string, partNumber: string, quantity = 2): Promise<Part> {
  const res = await expert.post(`/cases/${caseId}/parts`, { description: 'نیاز آزمون', partNumber, quantity, source: 'stock' });
  expect(res.status).toBe(201);
  return res.body;
}

beforeAll(async () => {
  h = await createHarness({ config: { DAILY_REPORT_MAX_BYTES: '3000000' } });
  [manager, parts, admin, qc, expert] = await Promise.all([...['admin', 'parts', 'admin'].map((u) => h.login(u)), h.loginAs('narrow', [], LEGACY_QC_PERMISSIONS), h.login('expert')]);
  owner = await h.loginAs('daily-owner', ['service_manager']);
  await h.db.db.update(users).set({ isOwner: true }).where(eq(users.username, 'daily-owner'));
});
afterAll(async () => {
  await h?.close();
});

describe('upload and preview', () => {
  it('detects formats from content, refuses wrong kinds and oversize files with Persian messages', async () => {
    const unknown = await upload(manager, 'stock', new TextEncoder().encode('<html>نه</html>'));
    expect(unknown.status).toBe(422);
    expect(unknown.body.code).toBe('DAILY_FILE_FORMAT');
    const binary = await upload(manager, 'emdad', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3, 4]));
    expect(binary.body.message).toContain('XLS باینری');
    expect((await upload(manager, 'stock', buildEmdadXml([emdadRow(1)]))).body.code).toBe('DAILY_FILE_KIND');
    const asJson = await upload(manager, 'stock', buildStockXlsx(family('11111111')), 'x.xlsx', 'application/json');
    expect([400, 422]).toContain(asJson.status);
    const big = await upload(manager, 'emdad', new Uint8Array(3_100_000));
    expect(big.status).toBe(413);
    expect((await upload(qc, 'stock', buildStockXlsx(family('11111111')))).status).toBe(403);
  });

  it('lets system support upload and inspect operational stock', async () => {
    const p = await previewOf('stock', buildStockXlsx([sku('22222222', '01')]), admin);
    expect(p.status).toBe('preview');
    expect((await admin.get('/stock/options')).status).toBe(200);
    expect((await admin.post('/emdad/requests/search', {})).status).toBe(201);
    expect((await admin.post(`/daily-reports/imports/${p.id}/discard`)).status).toBe(201);
  });

  it('previews outcomes per row, pages them, and resumes the same file instead of uploading it twice', async () => {
    const file = buildStockXlsx([...family('12345678'), sku('12345678', '01'), sku('', '', { 'کد کالا': '_x001F_ 9999999999A' }), sku('', '', { 'کد کالا': '' }), sku('33333333', '01', { 'موجودي': '0.888', 'واحد شمارش': '0.888 ليتر' })]);
    const p = await previewOf('stock', file);
    expect(p.status).toBe('preview');
    expect(p.counts).toMatchObject({ new: 8, duplicate: 2, needs_mapping: 1, invalid: 1, total: 12 });
    expect(p.headerRow).toBe(1);
    expect(p.sheetName).toBe('stkstock (3)');
    const again = await upload(manager, 'stock', file);
    expect(again.body).toMatchObject({ id: p.id, resumed: true });
    const dup = await manager.get(`/daily-reports/imports/${p.id}/rows?outcome=duplicate`);
    expect(dup.body.total).toBe(2);
    const page = await manager.get(`/daily-reports/imports/${p.id}/rows?pageSize=5&page=3`);
    expect(page.body.items).toHaveLength(2);
    const report = await manager.get(`/daily-reports/imports/${p.id}/report`).buffer(true).parse((res, cb) => {
      const parts: Buffer[] = [];
      res.on('data', (c: Buffer) => parts.push(c));
      res.on('end', () => cb(null, Buffer.concat(parts)));
    });
    expect(report.status).toBe(200);
    expect(readWorkbook(report.body as Buffer)[0]!.rows).toHaveLength(13);
    await manager.post(`/daily-reports/imports/${p.id}/discard`);
  });
});

describe('stock snapshot, options and reservations', () => {
  let snapshotId: string;
  let caseA: CaseDetail;
  let needA: Part;

  it('publishes atomically with an explicit report date and keeps leading zeros, letter codes and exact prices', async () => {
    const p = await previewOf('stock', buildStockXlsx([...family('00123456'), sku('00999999', '01', { 'موجودي': '0.5' }), sku('00000000', '01', { 'موجودي': '0' }), sku('', '', { 'کد کالا': '_x001F_ 999999999AA', 'شرح کالا': 'کد حرفی ساختگی' })]));
    expect((await manager.post(`/daily-reports/imports/${p.id}/apply`, { reportDate: day(6) })).status).toBe(400);
    expect((await apply(p.id, { reportDate: '1499/01/01' })).body.code).toBe('DAILY_REPORT_FUTURE');
    const r = await apply(p.id, { reportDate: day(6), reportTime: '09:00' });
    expect(r.status).toBe(201);
    expect(r.body.counts).toMatchObject({ published: 11, carried: 0 });
    expect((await parts.get('/stock/options?q=0000000001')).body.total).toBe(0);
    snapshotId = r.body.snapshotId;
    expect(await h.db.db.select().from(dailyReportFiles).where(eq(dailyReportFiles.importId, p.id))).toHaveLength(0);
    expect((await apply(p.id, { reportDate: day(6) })).status).toBe(409);

    const fam = await parts.get('/stock/options?q=00123456&pageSize=3');
    expect(fam.body.total).toBe(8);
    expect(fam.body.items).toHaveLength(3);
    expect(fam.body.items[0]).toMatchObject({ fullStockCode: '0012345601', basePartNumber: '00123456', supplySuffix: '01', reported: '2', available: '2', avgPrice: '1000.125', salePrice: '1500' });
    expect(fam.body.snapshot).toMatchObject({ currency: null, reservable: false, fresh: false });
    const all = await parts.get('/stock/options?base=00123456&pageSize=100');
    expect(all.body.items.map((i: { supplySuffix: string }) => i.supplySuffix)).toEqual(['01', '02', '03', '04', '05', '06', '07', '08']);
    const letter = await parts.get(`/stock/options?q=${encodeURIComponent('کد حرفی')}`);
    expect(letter.body.items[0]).toMatchObject({ codeKind: 'needs_mapping', basePartNumber: null, fullStockCode: '999999999AA' });
  });

  it('only groups a nonstandard code by an audited, versioned human alias and can detach it', async () => {
    const body = { fullStockCode: '999999999AA', basePartNumber: '00123456', reason: 'تأیید دستی خانواده در آزمون', expectedVersion: 0 };
    expect((await parts.post('/stock/aliases', body)).status).toBe(403);
    expect((await owner.post('/stock/aliases', { ...body, fullStockCode: '0012345601' })).body.code).toBe('STANDARD_CODE_ALIAS');
    const linked = await owner.post('/stock/aliases', body);
    expect(linked.status).toBe(201);
    expect((await parts.get('/stock/options?base=00123456')).body.total).toBe(9);
    expect((await parts.get('/stock/options?q=999999999AA')).body.items[0]).toMatchObject({ basePartNumber: '00123456', supplySuffix: null, alias: { version: 1 }, reported: '2' });
    expect((await owner.post('/stock/aliases', body)).status).toBe(409);
    const otherId = newId();
    const otherCode = `alias-${otherId.slice(0, 8)}`;
    await h.db.db.insert(tenants).values({ id: otherId, code: otherCode, name: 'نمایندگی ساختگی دیگر', isTest: true });
    await h.db.db.insert(users).values({ id: newId(), tenantId: otherId, username: 'alias-other', displayName: 'مالک آزمون دیگر', passwordHash: await hashPassword(TEST_PASSWORD), roles: ['service_manager'], isOwner: true, isTest: true });
    const other = await h.login('alias-other', otherCode);
    expect((await other.get('/stock/options?base=00123456')).body.total).toBe(0);
    expect((await other.post('/stock/aliases', body)).status).toBe(201);
    expect((await owner.post('/stock/aliases', { ...body, basePartNumber: null, expectedVersion: 1, reason: 'قطع اتصال برای آزمون' })).status).toBe(201);
    expect((await parts.get('/stock/options?base=00123456')).body.total).toBe(8);
    expect((await parts.get('/stock/options?q=99999999')).body.total).toBe(0);
    expect((await parts.get('/stock/options?needsMapping=true')).body.items.map((i: { fullStockCode: string }) => i.fullStockCode)).toContain('999999999AA');
  });

  it('refuses reservations until the owner confirms scope, completeness and the quantity meaning', async () => {
    caseA = await newCase('810001', null);
    needA = await need(caseA.id, '00123456', 2);
    const body = { partRequestId: needA.id, fullStockCode: '0012345601', locationAddress: 'A-01', snapshotId, quantity: '1', confirm: true };
    expect((await parts.post('/stock/reservations', body)).body.code).toBe('STOCK_NOT_CONFIRMED');
    const prof = await manager.get('/daily-reports/profiles/stock');
    expect((await manager.patch('/daily-reports/profiles/stock', { expectedVersion: prof.body.version, completeness: 'partial' })).status).toBe(403);
    const ok = await owner.patch('/daily-reports/profiles/stock', { expectedVersion: prof.body.version, completeness: 'partial', scope: 'انبار قطعات آزمون', quantityMeaning: 'on_hand', currency: 'IRR' });
    expect(ok.status).toBe(200);
    expect((await owner.patch('/daily-reports/profiles/stock', { expectedVersion: prof.body.version, currency: 'IRT' })).status).toBe(409);
    expect((await parts.get('/stock/options?q=0012345601')).body.snapshot).toMatchObject({ currency: 'IRR', reservable: true });
  });

  it('fills one need from several exact codes, never above the need or the available stock', async () => {
    const base = { partRequestId: needA.id, locationAddress: 'A-01', snapshotId, confirm: true };
    expect((await parts.post('/stock/reservations', { ...base, fullStockCode: '0012345601', quantity: '1.5', confirm: false })).status).toBe(400);
    const first = await parts.post('/stock/reservations', { ...base, fullStockCode: '0012345601', quantity: '1.5' });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ status: 'reserved', quantity: '1.5', unitSalePrice: '1500', unitAvgPrice: '1000.125', currency: 'IRR', caseNumber: caseA.caseNumber });
    const over = await parts.post('/stock/reservations', { ...base, fullStockCode: '0012345602', locationAddress: 'A-02', quantity: '1' });
    expect(over.body).toMatchObject({ code: 'OVER_NEED', details: { needLeft: '0.5' } });
    expect((await parts.post('/stock/reservations', { ...base, fullStockCode: '0012345602', locationAddress: 'A-02', quantity: '0.5' })).status).toBe(201);
    const opt = await parts.get('/stock/options?q=0012345601');
    expect(opt.body.items[0]).toMatchObject({ reported: '2', reserved: '1.5', available: '0.5' });
    expect((await expert.post('/stock/reservations', { ...base, fullStockCode: '0012345603', quantity: '0.1' })).status).toBe(403);
  });

  it('serializes concurrent reservations of the last units (no oversell)', async () => {
    const [c1, c2] = [await newCase('810002', null), await newCase('810003', null)];
    const [n1, n2] = [await need(c1.id, '00123456', 1), await need(c2.id, '00123456', 1)];
    const body = (n: Part) => ({ partRequestId: n.id, fullStockCode: '0012345601', locationAddress: 'A-01', snapshotId, quantity: '0.5', confirm: true });
    const results = await Promise.all([parts.post('/stock/reservations', body(n1)), parts.post('/stock/reservations', body(n2))]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.code).toBe('INSUFFICIENT_STOCK');
  });

  it('records issue, release and cancel as audited steps; deduction stops only with «پایان کار», never by hand', async () => {
    const list = (await parts.get(`/stock/reservations?caseId=${caseA.id}`)).body.items as { id: string; version: number; fullStockCode: string }[];
    const r1 = list.find((r) => r.fullStockCode === '0012345601')!;
    const r2 = list.find((r) => r.fullStockCode === '0012345602')!;
    expect((await parts.post(`/stock/reservations/${r2.id}/actions`, { action: 'release', expectedVersion: r2.version })).status).toBe(400);
    const released = await parts.post(`/stock/reservations/${r2.id}/actions`, { action: 'release', expectedVersion: r2.version, reason: 'تأمین از کد دیگر' });
    expect(released.body.status).toBe('released');
    const issued = await parts.post(`/stock/reservations/${r1.id}/actions`, { action: 'issue', expectedVersion: r1.version });
    expect(issued.body.status).toBe('issued');
    expect((await parts.post(`/stock/reservations/${r1.id}/actions`, { action: 'issue', expectedVersion: issued.body.version })).status).toBe(409);
    // Handed over to an open case: still deducted (spec section 7).
    expect((await parts.get('/stock/options?q=0012345601')).body.items[0]).toMatchObject({ issuedUnreflected: '1.5', available: '0' });
    // The manual reflection step is gone: it happens automatically with «پایان کار».
    expect((await parts.post(`/stock/reservations/${r1.id}/actions`, { action: 'reflect', expectedVersion: issued.body.version })).body.code).toBe('REFLECT_AUTOMATIC');
    expect((await parts.get('/stock/reservations?reconcile=true')).body.items.map((r: { id: string }) => r.id)).toContain(r1.id);

    // A new report does not stop the deduction while the case is open (no double counting either way).
    const next = await previewOf('stock', buildStockXlsx([sku('00123456', '01', { 'موجودي': '0.5', 'قيمت فروش': '1600' }), ...family('00123456').slice(1)]));
    expect(next.counts).toMatchObject({ changed: 1, unchanged: 7, missing: 3 });
    const pub = await apply(next.id, soon(1));
    expect(pub.status).toBe(201);
    expect(pub.body).toMatchObject({ counts: { published: 8, carried: 3 }, reconciliation: 1 });
    expect((await parts.get('/stock/options?q=0012345601')).body.items[0]).toMatchObject({ reported: '0.5', issuedUnreflected: '1.5', salePrice: '1600' });
    // Partial report: codes missing today keep their last values, labelled as carried.
    expect((await parts.get('/stock/options?q=00999999')).body.items[0]).toMatchObject({ reported: '0.5' });
    // An issue recorded by mistake can still be undone while the case is open.
    const undone = await parts.post(`/stock/reservations/${r1.id}/actions`, { action: 'cancel', expectedVersion: issued.body.version, reason: 'اشتباه' });
    expect(undone.status).toBe(201);
    expect(undone.body.status).toBe('cancelled');
    // The reservation keeps the price of the report it was made from.
    expect(undone.body.unitSalePrice).toBe('1500');
  });

  it('never lets an older file replace newer stock, and flags shortfalls without deleting reservations', async () => {
    const old = await previewOf('stock', buildStockXlsx(family('00123456', 8, { 'موجودي': '9' })));
    expect((await apply(old.id, { reportDate: day(5) })).body.code).toBe('DAILY_OLDER_REPORT');
    const snaps = await h.db.db.select().from(stockSnapshots).where(eq(stockSnapshots.status, 'active'));
    expect(snaps).toHaveLength(1);
    const c = await newCase('810004', null);
    const n = await need(c.id, '00123456', 2);
    const active = (await parts.get('/stock/options?q=0012345605')).body.snapshot.id;
    const r = await parts.post('/stock/reservations', { partRequestId: n.id, fullStockCode: '0012345605', locationAddress: 'A-05', snapshotId: active, quantity: '2', confirm: true });
    expect(r.status).toBe(201);
    await manager.post(`/daily-reports/imports/${old.id}/discard`);
    // A newer report with less stock flags the reservation; it is not deleted.
    const lower = await previewOf('stock', buildStockXlsx([sku('00123456', '01', { 'موجودي': '0.5', 'قيمت فروش': '1600' }), ...family('00123456').slice(1, 4), sku('00123456', '05', { 'موجودي': '1' }), ...family('00123456').slice(5)]));
    expect((await apply(lower.id, soon(2))).status).toBe(201);
    const flagged = (await parts.get(`/stock/reservations?caseId=${c.id}`)).body.items[0];
    expect(flagged).toMatchObject({ status: 'reserved', quantity: '2', shortfall: true });
    expect((await parts.get('/daily-reports/status')).body.counts.shortfalls).toBe(1);
    expect((await parts.post('/stock/reservations', { partRequestId: n.id, fullStockCode: '0012345606', locationAddress: 'A-06', snapshotId, quantity: '0', confirm: true })).status).toBe(400);
    expect((await parts.post('/stock/reservations', { partRequestId: n.id, fullStockCode: '0012345606', locationAddress: 'A-06', snapshotId, quantity: '0.1', confirm: true })).body.code).toBe('STOCK_REPORT_CHANGED');
  });

  it('replays a retried reservation by its key instead of reserving twice', async () => {
    const c = await newCase('810005', null);
    const n = await need(c.id, '00123456', 2);
    const snap = (await parts.get('/stock/options?q=0012345606')).body.snapshot.id;
    const body = { partRequestId: n.id, fullStockCode: '0012345606', locationAddress: 'A-06', snapshotId: snap, quantity: '0.5', confirm: true };
    const key = newId();
    const a = await parts.post('/stock/reservations', body).set('idempotency-key', key);
    const b = await parts.post('/stock/reservations', body).set('idempotency-key', key);
    expect(a.status).toBe(201);
    expect(b.headers['idempotent-replay']).toBe('true');
    expect(b.body.id).toBe(a.body.id);
    expect((await parts.get(`/stock/reservations?partRequestId=${n.id}`)).body.items).toHaveLength(1);
  });

  it('keeps reservation and need together when a report and a reservation race', async () => {
    const c = await newCase('810006', null);
    const n = await need(c.id, '00123456', 1);
    const snap = (await parts.get('/stock/options?q=0012345607')).body.snapshot.id;
    const next = await previewOf('stock', buildStockXlsx(family('00123456', 8, { 'موجودي': '1' })));
    const [pub, res] = await Promise.all([apply(next.id, soon(3)), parts.post('/stock/reservations', { partRequestId: n.id, fullStockCode: '0012345607', locationAddress: 'A-07', snapshotId: snap, quantity: '1', confirm: true })]);
    expect(pub.status).toBe(201);
    expect([201, 409]).toContain(res.status);
    if (res.status === 409) expect(res.body.code).toBe('STOCK_REPORT_CHANGED');
    const active = await h.db.db.select().from(stockSnapshots).where(eq(stockSnapshots.status, 'active'));
    expect(active).toHaveLength(1);
    const opt = (await parts.get('/stock/options?q=0012345607')).body.items[0];
    expect(opt).toMatchObject({ reported: '1', available: res.status === 201 ? '0' : '1' });
  });

  it('exports reservations without customer data and with formula-safe text', async () => {
    const x = await parts.get('/stock/reservations/export?status=reserved').buffer(true).parse((res, cb) => {
      const b: Buffer[] = [];
      res.on('data', (c: Buffer) => b.push(c));
      res.on('end', () => cb(null, Buffer.concat(b)));
    });
    expect(x.status).toBe(200);
    const rows = readWorkbook(x.body as Buffer)[0]!.rows;
    expect(rows.length).toBeGreaterThan(1);
    expect(JSON.stringify(rows)).not.toContain('09000005555');
    expect(JSON.stringify(rows)).not.toContain('مشتری آزمون روزانه');
  });

  it('asks for explicit acceptance when a column is missing from the first file of a kind', async () => {
    const svc = (await h.db.db.select().from(dailyReportProfiles).where(eq(dailyReportProfiles.kind, 'stock')))[0]!;
    await h.db.db.update(dailyReportProfiles).set({ headerSignature: null }).where(eq(dailyReportProfiles.id, svc.id));
    const rows = readWorkbook(buildStockXlsx([sku('44444445', '01')]))[0]!.rows.map((r) => r.slice(0, 5));
    const p = await previewOf('stock', writeSheet('stkstock (3)', rows));
    expect(p.templateChanged).toBe(true);
    expect((await apply(p.id, { reportDate: day(0) })).body.code).toBe('DAILY_TEMPLATE_CHANGED');
    await manager.post(`/daily-reports/imports/${p.id}/discard`);
    await h.db.db.update(dailyReportProfiles).set({ headerSignature: svc.headerSignature }).where(eq(dailyReportProfiles.id, svc.id));
  });

  it('asks for explicit acceptance when the column layout changes', async () => {
    const changed = readWorkbook(buildStockXlsx([sku('44444444', '01')]))[0]!.rows.map((r, i) => [...r, i === 0 ? 'ستون تازه' : 'x']);
    const p = await previewOf('stock', writeSheet('stkstock (3)', changed));
    expect(p.templateChanged).toBe(true);
    expect((await apply(p.id, { reportDate: day(0) })).body.code).toBe('DAILY_TEMPLATE_CHANGED');
    await manager.post(`/daily-reports/imports/${p.id}/discard`);
  });
});

describe('Emdad Vijeh follow-up', () => {
  let matched: CaseDetail;
  it('matches only by admission + exact chassis + confirmed base and keeps every other row for review', async () => {
    const casesBefore = (await manager.get('/cases?pageSize=100')).body.total as number;
    matched = await newCase('900001', 'T00001AB');
    await need(matched.id, '1234560101', 1);
    await newCase('900002', 'ZZZZZZZZ'); // same admission, different chassis
    await newCase('900003', 'T00003AB');
    await newCase('900003', 'T00003AB'); // two cases, same admission and chassis
    const file = buildEmdadXml([
      emdadRow(1, { 'كد تداركاتي كالا': '1234560101', 'کد قطعه': '12345601', 'کد اختصاصی اولیه': '12345601' }),
      emdadRow(2),
      emdadRow(3),
      emdadRow(4),
      emdadRow(5, { 'شماره کارت پذيرش': 'برگشتی' }),
      emdadRow(6, { 'كد تداركاتي كالا': '' }),
      emdadRow(7, { 'كد تداركاتي كالا': '9999999901' }),
      emdadRow(8),
      emdadRow(8),
      emdadRow(9, { 'وضعیت امداد ویژه': 'متن تازه ساختگی' }),
      emdadRow(10, { 'وضعیت امداد ویژه': 'ابطال', 'دلائل ابطال امداد ویژه': 'انصراف ساختگی' }),
    ]);
    const p = await previewOf('emdad', file);
    expect(p.counts).toMatchObject({ new: 9, duplicate: 2, total_row: 1, matched: 1 });
    expect(p.diagnostics).toMatchObject({ leadingWhitespace: 1 });
    expect((await apply(p.id, { reportDate: day(4) })).status).toBe(201);
    const all = (await parts.post('/emdad/requests/search', { pageSize: 100 })).body;
    expect(all.total).toBe(9);
    const by = (adm: string) => all.items.filter((r: { admissionNo: string }) => r.admissionNo === adm);
    expect(by('900001')[0]).toMatchObject({ matchStatus: 'matched', caseNumber: matched.caseNumber });
    expect(by('900001')[0].partRequestId).toBeTruthy();
    const [original] = await h.db.db.select().from(emdadRequests).where(eq(emdadRequests.id, by('900001')[0].id));
    const unrelatedId = newId();
    await h.db.db.insert(emdadRequests).values({...original!,id:unrelatedId,externalKey:'synthetic-unrelated-case-part',partRequestId:null,
      official:{...(original!.official as Record<string,unknown>),partCode:'99887766',initialCode:'99887766',fullCode:'9988776601',fullCodeBase:'99887766'}});
    try {
      expect((await parts.post('/emdad/requests/search',{caseId:matched.id})).body.total).toBe(2);
      const relevant = await parts.post('/emdad/requests/search',{caseId:matched.id,relatedPartsOnly:true});
      expect(relevant.body.total).toBe(1); expect(relevant.body.items[0].id).toBe(original!.id);
      expect((await parts.post('/emdad/requests/search',{caseId:matched.id,partRequestId:newId(),relatedPartsOnly:true})).body.total).toBe(0);
      expect((await parts.post('/emdad/requests/search',{relatedPartsOnly:true})).body.code).toBe('CASE_REQUIRED');
    } finally { await h.db.db.delete(emdadRequests).where(eq(emdadRequests.id, unrelatedId)); }
    expect(by('900002')[0]).toMatchObject({ matchStatus: 'needs_review', caseId: null });
    expect(by('900003')[0]).toMatchObject({ matchStatus: 'ambiguous', caseId: null });
    expect(by('900004')[0]).toMatchObject({ matchStatus: 'unmatched' });
    expect(by('برگشتی')[0]).toMatchObject({ matchStatus: 'unmatched' });
    expect(by('900007')[0].official.codeNotes.join()).toContain('پایه کد کامل');
    expect(by('900009')[0]).toMatchObject({ statusCategory: 'needs_interpretation' });
    expect((await manager.get('/cases?pageSize=100')).body.total).toBe(casesBefore + 4);
    const stored = JSON.stringify(await h.db.db.select().from(emdadRequests));
    for (const pii of ['مالک ساختگی', '09000000000', 'ENG-TEST', '11 ب 111 - 11']) expect(stored).not.toContain(pii);
    expect((await parts.post('/emdad/requests/search', { codeIssue: true })).body.total).toBe(2);
  });

  it('keeps one request per stable key across days, records official changes as history and never overwrites follow-up fields', async () => {
    const first = (await parts.post('/emdad/requests/search', { q: '700002' })).body.items[0];
    const followed = await parts.patch(`/emdad/requests/${first.id}/follow-up`, { expectedVersion: first.version, note: '=HYPERLINK("x")', nextAction: 'تماس با دفتر منطقه' });
    expect(followed.status).toBe(200);
    expect((await parts.patch(`/emdad/requests/${first.id}/follow-up`, { expectedVersion: first.version, note: 'x' })).status).toBe(409);
    const next = await previewOf('emdad', buildEmdadXml([emdadRow(2, { 'وضعیت امداد ویژه': 'وارد موجودی شده است' }), emdadRow(1, { 'كد تداركاتي كالا': '1234560101', 'کد قطعه': '12345601', 'کد اختصاصی اولیه': '12345601' }), emdadRow(11)]));
    expect(next.counts).toMatchObject({ changed: 1, unchanged: 1, new: 1 });
    expect((await apply(next.id, { reportDate: day(3) })).status).toBe(201);
    const after = await parts.get(`/emdad/requests/${first.id}`);
    expect(after.body.request).toMatchObject({ statusCategory: 'in_dealer_stock', note: '=HYPERLINK("x")', nextAction: 'تماس با دفتر منطقه' });
    expect(after.body.events[0].changes.emdadStatus).toEqual({ from: 'در حال تامین', to: 'وارد موجودی شده است' });
    expect((await parts.post('/emdad/requests/search', {})).body.total).toBe(10);
    // An older file does not revert the newer status.
    const old = await previewOf('emdad', buildEmdadXml([emdadRow(2, { 'وضعیت امداد ویژه': 'آماده جمع آوری' })]));
    const r = await apply(old.id, { reportDate: day(5) });
    expect(r.body.counts.older).toBe(1);
    expect((await parts.get(`/emdad/requests/${first.id}`)).body.request.statusCategory).toBe('in_dealer_stock');
    // Export is formula-safe and carries no contact data.
    const x = await parts.post('/emdad/requests/export', { q: '700002' }).buffer(true).parse((res, cb) => {
      const b: Buffer[] = [];
      res.on('data', (c: Buffer) => b.push(c));
      res.on('end', () => cb(null, Buffer.concat(b)));
    });
    const rows = readWorkbook(x.body as Buffer)[0]!.rows;
    expect(rows[1]).toContain(`'=HYPERLINK("x")`);
    expect(JSON.stringify(rows)).not.toContain('09000000000');
  });

  it('keeps a manual match decision and never re-matches it automatically', async () => {
    const amb = (await parts.post('/emdad/requests/search', { match: 'ambiguous' })).body.items[0];
    const chosen = (await manager.get('/cases?q=900003&pageSize=10')).body.items[0];
    const m = await parts.post(`/emdad/requests/${amb.id}/match`, { expectedVersion: amb.version, caseId: chosen.id, note: 'بررسی با برگه پذیرش' });
    expect(m.body.request).toMatchObject({ matchStatus: 'matched', matchSource: 'manual', caseId: chosen.id });
    const again = await previewOf('emdad', buildEmdadXml([emdadRow(3, { 'وضعیت امداد ویژه': 'ابطال' })]));
    await apply(again.id, { reportDate: day(2) });
    expect((await parts.get(`/emdad/requests/${amb.id}`)).body.request).toMatchObject({ caseId: chosen.id, matchSource: 'manual', statusCategory: 'cancelled' });
    expect((await qc.post('/emdad/requests/search', {})).status).toBe(403);
    expect((await expert.patch(`/emdad/requests/${amb.id}/follow-up`, { expectedVersion: 1, note: 'x' })).status).toBe(403);
  });
});

describe('11:00 Tehran tasks and reminders', () => {
  it('creates both tasks once per Tehran day and notifies once at the configured time, across restarts and workers', async () => {
    const svc = h.app.get(DailyTasksService);
    const tenantRows = await h.db.db.select().from(tenants);
    const at = (iso: string) => new Date(iso);
    // 2026-12-01 10:00 Tehran = 06:30Z; 11:00 = 07:30Z.
    await svc.tick(at('2026-12-01T06:30:00Z'));
    const tasks = await h.db.db.select().from(dailyTasks).where(eq(dailyTasks.localDate, '2026-12-01'));
    expect(tasks).toHaveLength(2 * tenantRows.length);
    expect(await h.db.db.select().from(notifications)).toHaveLength(0);
    await Promise.all([svc.tick(at('2026-12-01T07:30:00Z')), svc.tick(at('2026-12-01T07:30:00Z')), svc.tick(at('2026-12-01T07:31:00Z'))]);
    const sent = await h.db.db.select().from(notifications);
    const keys = sent.map((n) => `${n.userId}:${n.dedupeKey}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(sent.some((n) => n.dedupeKey === 'daily:stock:2026-12-01')).toBe(true);
    // Tehran midnight boundary: 20:29Z is still 12-01, 20:30Z is 12-02.
    await svc.tick(at('2026-12-01T20:29:00Z'));
    expect(await h.db.db.select().from(dailyTasks).where(eq(dailyTasks.localDate, '2026-12-02'))).toHaveLength(0);
    await svc.tick(at('2026-12-01T20:30:00Z'));
    expect(await h.db.db.select().from(dailyTasks).where(eq(dailyTasks.localDate, '2026-12-02'))).toHaveLength(2 * tenantRows.length);
    const inbox = await admin.get('/notifications');
    expect(inbox.body.unread).toBeGreaterThan(0);
    expect((await admin.post('/notifications/read', { ids: 'all' })).body.unread).toBe(0);
    expect((await parts.get('/notifications')).body.unread).toBeGreaterThan(0);
    expect((await admin.get('/notifications')).body.items.some((n: { link: string }) => n.link.startsWith('/daily-reports'))).toBe(true);
    expect((await expert.get('/notifications')).body.items).toHaveLength(0);
  });

  it('creates no task and sends no reminder on Friday (dealership closed)', async () => {
    const svc = h.app.get(DailyTasksService);
    // 2026-12-04 is a Friday; 12:00 Tehran = 08:30Z, after the 11:00 reminder time.
    await svc.tick(new Date('2026-12-04T08:30:00Z'));
    expect(await h.db.db.select().from(dailyTasks).where(eq(dailyTasks.localDate, '2026-12-04'))).toHaveLength(0);
    expect((await h.db.db.select().from(notifications)).some((n) => n.dedupeKey?.endsWith(':2026-12-04'))).toBe(false);
    const tenantId = (await h.db.db.select().from(tenants))[0]!.id;
    const today = await svc.today(tenantId, new Date('2026-12-04T08:30:00Z'));
    expect(today.every((t) => !t.late)).toBe(true);
  });

  it('keeps a reminder due when nobody can receive it, applies a new time to today and survives a restart', async () => {
    const svc = h.app.get(DailyTasksService);
    const staff = await h.db.db.select({ id: users.id, isActive: users.isActive }).from(users);
    await h.db.db.update(users).set({ isActive: false });
    await svc.tick(new Date('2026-12-03T07:40:00Z'));
    const waiting = await h.db.db.select().from(dailyTasks).where(eq(dailyTasks.localDate, '2026-12-03'));
    expect(waiting.every((t) => t.notifiedAt === null)).toBe(true);
    for (const u of staff) await h.db.db.update(users).set({ isActive: u.isActive }).where(eq(users.id, u.id));
    // A restart after the due time still sends today's reminder, once.
    const after = await svc.tick(new Date('2026-12-03T07:41:00Z'));
    expect(after.notified).toBeGreaterThan(0);
    expect((await svc.tick(new Date('2026-12-03T07:42:00Z'))).notified).toBe(0);
    // Before the reminder goes out, a changed time applies to today.
    const tenantId = (await h.db.db.select({ id: users.tenantId }).from(users).where(eq(users.username, 'manager')))[0]!.id;
    await svc.tick(new Date('2026-12-04T05:00:00Z'));
    const prof = await manager.get('/daily-reports/profiles/emdad');
    expect((await manager.patch('/daily-reports/profiles/emdad', { expectedVersion: prof.body.version, reminderTime: '09:00' })).status).toBe(200);
    const state = await svc.today(tenantId, new Date('2026-12-04T05:01:00Z'));
    expect(state.find((t) => t.kind === 'emdad')!.dueAt).toBe('2026-12-04T05:30:00.000Z');
    expect((await manager.patch('/daily-reports/profiles/emdad', { expectedVersion: prof.body.version + 1, reminderTime: '11:00' })).status).toBe(200);
  });

  it('stops retrying a repeatedly interrupted parse job and keeps it retryable', async () => {
    const u = await upload(manager, 'stock', buildStockXlsx([sku('55555555', '01')]));
    const id = u.body.id as string;
    await ready(manager, id);
    await h.db.db.update(dailyReportImports).set({ status: 'parsing', attempts: 3, createdAt: new Date(Date.now() - 3_600_000) }).where(eq(dailyReportImports.id, id));
    await h.app.get(DailyReportsService).recover(new Date());
    expect((await manager.get(`/daily-reports/imports/${id}`)).body.status).toBe('failed');
    expect((await manager.post(`/daily-reports/imports/${id}/retry`)).status).toBe(201);
    expect((await ready(manager, id)).status).toBe('preview');
    await manager.post(`/daily-reports/imports/${id}/discard`);
  });

  it('completes the day task only with an applied report of today; identical content needs a declaration', async () => {
    const file = buildEmdadXml([emdadRow(2, { 'وضعیت امداد ویژه': 'وارد موجودی شده است' }), emdadRow(30)]);
    const a = await previewOf('emdad', file);
    const r = await apply(a.id, { reportDate: day(0) });
    expect(r.body.task).toBe('done');
    const status = await parts.get('/daily-reports/status');
    expect(status.body.tasks.find((t: { kind: string }) => t.kind === 'emdad')).toMatchObject({ status: 'done' });
    expect(status.body.emdad).toMatchObject({ fresh: true });
    expect(status.body.counts.emdadReview).toBeGreaterThan(0);
    // The same file uploaded again is identical content.
    const b = await previewOf('emdad', file);
    expect(b.sameAsImportId).toBe(a.id);
    expect(b.sameContent).toBe(true);
    const [t] = await h.db.db.select().from(dailyTasks).where(and(eq(dailyTasks.kind, 'emdad'), eq(dailyTasks.status, 'done')));
    await h.db.db.update(dailyTasks).set({ status: 'pending', completedImportId: null }).where(eq(dailyTasks.id, t!.id));
    // Without the statement nothing is published and today stays open.
    expect((await apply(b.id, { reportDate: day(0) })).body.code).toBe('DAILY_SAME_CONTENT');
    expect((await parts.get('/daily-reports/status')).body.tasks.find((x: { kind: string }) => x.kind === 'emdad')).toMatchObject({ status: 'pending' });
    const declared = await apply(b.id, { reportDate: day(0), declaredToday: true });
    expect(declared.body.task).toBe('done');
    const [done] = await h.db.db.select().from(dailyTasks).where(eq(dailyTasks.id, t!.id));
    expect(done).toMatchObject({ status: 'done', unchangedDeclared: true });
    // Reordered rows have another hash, but they are still the same content and create nothing.
    const total = (await parts.post('/emdad/requests/search', {})).body.total;
    const reordered = await previewOf('emdad', buildEmdadXml([emdadRow(30), emdadRow(2, { 'وضعیت امداد ویژه': 'وارد موجودی شده است' })]));
    expect(reordered.sameAsImportId).toBeNull();
    expect(reordered.sameContent).toBe(true);
    expect(reordered.counts).toMatchObject({ unchanged: 2 });
    expect((await apply(reordered.id, { reportDate: day(0) })).body.code).toBe('DAILY_SAME_CONTENT');
    expect((await apply(reordered.id, { reportDate: day(0), declaredToday: true })).status).toBe(201);
    expect((await parts.post('/emdad/requests/search', {})).body.total).toBe(total);
  });
});

describe('isolation', () => {
  it('links desk totals to the same review and due-date filters', async () => {
    const open = (await parts.post('/emdad/requests/search', { openOnly: true })).body.items[0];
    expect(open).toBeDefined();
    expect((await parts.patch(`/emdad/requests/${open.id}/follow-up`, { expectedVersion: open.version, dueAt: daysAgo(1), nextAction: 'پیگیری آزمون' })).status).toBe(200);
    const { counts } = (await parts.get('/daily-reports/status')).body;
    expect((await parts.post('/emdad/requests/search', { review: true })).body.total).toBe(counts.emdadReview);
    expect((await parts.post('/emdad/requests/search', { openOnly: true, dueToday: true })).body.total).toBe(counts.emdadDueToday);
    expect(counts.emdadDueToday).toBeGreaterThan(0);
  });

  it('keeps imports, stock and Emdad rows inside their dealership', async () => {
    const tenantId = newId();
    await h.db.db.insert(tenants).values({ id: tenantId, code: 'daily-other', name: 'نمایندگی آزمون دیگر', isTest: true });
    await h.db.db.insert(users).values({ id: newId(), tenantId, username: 'daily-other-manager', displayName: 'مدیر آزمون', passwordHash: await hashPassword(TEST_PASSWORD), roles: ['system_admin'], isTest: true });
    const other = await h.login('daily-other-manager', 'daily-other');
    const mine = (await manager.get('/daily-reports/imports')).body[0];
    expect((await other.get(`/daily-reports/imports/${mine.id}`)).status).toBe(404);
    expect((await other.get('/stock/options?q=00123456')).body).toMatchObject({ total: 0, snapshot: null });
    expect((await other.post('/emdad/requests/search', {})).body.total).toBe(0);
    const someone = (await parts.post('/emdad/requests/search', {})).body.items[0];
    expect((await other.get(`/emdad/requests/${someone.id}`)).status).toBe(404);
    expect((await other.post(`/daily-reports/imports/${mine.id}/apply`, { reportDate: day(0), declaration: true })).status).toBe(404);
    expect((await h.db.db.select().from(cases).where(eq(cases.tenantId, tenantId))).length).toBe(0);
  });
});
