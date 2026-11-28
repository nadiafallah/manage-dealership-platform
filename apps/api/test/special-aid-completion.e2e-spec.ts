import { eq } from 'drizzle-orm';
import request from 'supertest';
import { formatJalaliDateInput, formatTimeInput, toJalaliParts, type DailyImport, type Paged, type ReferenceImport, type ReferenceInspection, type SpecialAidDossier, type SpecialAidDossierRow } from '@manage/shared';
import { auditEvents, specialAidCards, specialAidItems, stockReservations, users } from '../src/db/schema';
import { buildEmdadXml, buildStockXlsx, emdadRow, type EmdadRow, type StockRow } from '../src/daily-reports/fixtures';
import { writeSheet } from '../src/parts/xlsx';
import { Client, createHarness, type Harness } from './harness';

// Completion of «پیگیری امداد ویژه» (PR #119): consumption on install, VIN review and correction,
// admission-card archive, appointment tracking, replacement requests, feedback and warnings,
// guest access and job titles, unified report detection. Synthetic data only (TESTVIN…, 0900…).
let h: Harness;
let parts: Client, operator: Client, manager: Client, admin: Client, owner: Client;
const VIN = 'TESTVIN0000SC0001';
const LATE_VIN = 'TESTVIN0000SC0009';

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
const sku = (code: string, qty: string, loc: string): StockRow => ({ 'کد کالا': `_x001F_ ${code}`, 'شرح کالا': `قطعه ساختگی ${code}`, 'واحد شمارش': 'عدد', 'موجودي': qty, 'قيمت ميانگين': '1000', 'قيمت فروش': '1500', 'آدرس': loc });
const arrived = { 'شماره شاسی': VIN, 'شماره درخواست': '', 'شماره کارت پذيرش': '991001', 'شماره امداد ویژه': '0091001', 'کد قطعه': '00313131', 'کد اختصاصی اولیه': '00313131', 'كد تداركاتي كالا': '0031313101', 'وضعیت امداد ویژه': 'وارد موجودی شده است', 'تاريخ رسيد شدن امداد ويژه در انبار': '1405/08/29', 'تعداد اختصاصي': '1' };
const wrong = { 'شماره شاسی': VIN, 'شماره درخواست': '', 'شماره کارت پذيرش': '991001', 'شماره امداد ویژه': '0091002', 'کد قطعه': '00323232', 'کد اختصاصی اولیه': '00323232', 'وضعیت امداد ویژه': 'وارد موجودی شده است', 'تعداد اختصاصي': '1' };
const correct = { 'شماره شاسی': VIN, 'شماره درخواست': '', 'شماره کارت پذيرش': '991001', 'شماره امداد ویژه': '0091003', 'کد قطعه': '00333333', 'کد اختصاصی اولیه': '00333333', 'وضعیت امداد ویژه': 'در مرحله خرید', 'تعداد اختصاصي': '1' };
const badVin = { 'شماره شاسی': 'TESTVIN0000SC', 'شماره درخواست': '', 'شماره کارت پذيرش': '991009', 'شماره امداد ویژه': '0091009', 'کد قطعه': '00393939', 'وضعیت امداد ویژه': 'در حال تامین' };

const dossierOf = async (c: Client, vin = VIN) => ((await c.post('/special-aid/dossiers/search', { q: vin })).body as Paged<SpecialAidDossierRow>).items[0]!;
const detail = async (c: Client, id: string): Promise<SpecialAidDossier> => (await c.get(`/special-aid/dossiers/${id}`)).body;
const available = async (code: string) => {
  const opts = await parts.get(`/stock/options?q=${code}`);
  return Number((opts.body.items ?? opts.body).flatMap((g: { options?: { fullStockCode: string; available: string }[] }) => g.options ?? [g]).find((o: { fullStockCode: string }) => o.fullStockCode === code).available);
};
// A real 1×1 PNG (synthetic image, no person or document).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const xlsxB64 = (rows: string[][]) => Buffer.from(writeSheet('نوبت', rows)).toString('base64');

beforeAll(async () => {
  h = await createHarness();
  parts = await h.login('parts');
  [operator, manager, admin, owner] = await Promise.all([
    h.loginAs('sc-operator', ['special_aid_operator']),
    h.loginAs('sc-manager', ['service_manager']),
    h.loginAs('sc-admin', ['system_admin']),
    h.loginAs('sc-owner', ['service_manager']),
  ]);
  await h.db.db.update(users).set({ isOwner: true }).where(eq(users.username, 'sc-owner'));
  expect((await apply(await preview('stock', buildStockXlsx([sku('0031313101', '2', 'S-01')])), -600)).status).toBe(201);
  const prof = await owner.get('/daily-reports/profiles/stock');
  expect((await owner.patch('/daily-reports/profiles/stock', { expectedVersion: prof.body.version, completeness: 'partial', scope: 'انبار آزمون', quantityMeaning: 'on_hand', currency: 'IRR' })).status).toBe(200);
  await publish([emdadRow(1, arrived), emdadRow(2, wrong), emdadRow(3, correct), emdadRow(4, badVin)], -500);
});
afterAll(async () => { await h?.close(); });

it('installed completes the consumption once: delivery alone does not, and the hold stops lowering stock', async () => {
  let d = await detail(operator, (await dossierOf(operator)).id);
  let x = d.items.find((i) => i.emdadNo === '0091001')!;
  expect(x.state).toBe('reserved');
  expect(await available('0031313101')).toBe(1);
  // From «reserved», installed is not an allowed step: the part must leave the warehouse first.
  expect((await operator.post(`/special-aid/items/${x.id}/action`, { action: 'installed', expectedVersion: x.version })).status).toBe(422);
  d = (await operator.post(`/special-aid/items/${x.id}/action`, { action: 'deliver', expectedVersion: x.version })).body;
  x = d.items.find((i) => i.id === x.id)!;
  expect(x.state).toBe('delivered');
  // Issued but not consumed: still deducted.
  expect(await available('0031313101')).toBe(1);
  d = (await operator.post(`/special-aid/items/${x.id}/action`, { action: 'installed', expectedVersion: x.version })).body;
  x = d.items.find((i) => i.id === x.id)!;
  expect(x.state).toBe('installed');
  const [hold] = await h.db.db.select().from(stockReservations).where(eq(stockReservations.specialAidItemId, x.id));
  expect(hold).toMatchObject({ status: 'issued' });
  expect(hold!.reflectedAt).toBeTruthy();
  expect(hold!.reflectedSnapshotId).toBeTruthy();
  // The business report shows the consumption from now on; Manage no longer deducts it (no double deduction).
  expect(await available('0031313101')).toBe(2);
  const audit = await h.db.db.select().from(auditEvents).where(eq(auditEvents.entityId, x.id));
  expect(audit.some((a) => a.action === 'special_aid.installed' && (a.after as { consumed?: boolean }).consumed === true)).toBe(true);
});

it('an invalid VIN waits in the review queue; a corrected VIN in a later report joins the right dossier', async () => {
  const queue = (await operator.get('/special-aid/review-queue')).body as { emdadNo: string; vinText: string }[];
  expect(queue.find((q) => q.emdadNo === '0091009')).toMatchObject({ vinText: 'TESTVIN0000SC' });
  expect((await operator.post('/special-aid/dossiers/search', { q: 'TESTVIN0000SC' })).body.items.every((r: SpecialAidDossierRow) => r.vin.length === 17)).toBe(true);
  await publish([emdadRow(1, arrived), emdadRow(2, wrong), emdadRow(3, correct), emdadRow(4, { ...badVin, 'شماره شاسی': LATE_VIN })], -480);
  const late = await dossierOf(operator, LATE_VIN);
  expect(late).toBeTruthy();
  expect((await detail(operator, late.id)).items.map((i) => i.emdadNo)).toContain('0091009');
  expect(((await operator.get('/special-aid/review-queue')).body as { emdadNo: string }[]).some((q) => q.emdadNo === '0091009')).toBe(false);
});

it('a corrected request is linked to the wrong-part request of the same vehicle without overwriting it', async () => {
  const d = await detail(operator, (await dossierOf(operator)).id);
  const oldItem = d.items.find((i) => i.emdadNo === '0091002')!, newItem = d.items.find((i) => i.emdadNo === '0091003')!;
  const nc = await operator.post(`/special-aid/items/${oldItem.id}/non-consumption`, { reason: 'wrong_part_number', expectedVersion: oldItem.version });
  expect(nc.status).toBe(201);
  const linked = await operator.post(`/special-aid/items/${newItem.id}/replacement`, { replacesItemId: oldItem.id, expectedVersion: newItem.version });
  expect(linked.status).toBe(201);
  const after = linked.body as SpecialAidDossier;
  expect(after.items.find((i) => i.id === newItem.id)!.replacesItemId).toBe(oldItem.id);
  expect(after.items.find((i) => i.id === oldItem.id)).toMatchObject({ replacedByItemId: newItem.id, nonConsumptionReason: 'wrong_part_number', emdadNo: '0091002' });
  // Another vehicle's part cannot be linked; a self link is refused.
  const other = await detail(operator, (await dossierOf(operator, LATE_VIN)).id);
  const fresh = after.items.find((i) => i.id === newItem.id)!;
  expect((await operator.post(`/special-aid/items/${fresh.id}/replacement`, { replacesItemId: other.items[0]!.id, expectedVersion: fresh.version })).status).toBe(422);
  expect((await operator.post(`/special-aid/items/${fresh.id}/replacement`, { replacesItemId: fresh.id, expectedVersion: fresh.version })).status).toBe(422);
});

it('admission cards: originals with checksum, duplicate and fake files refused, exact match, retry after a later report', async () => {
  const b64 = PNG.toString('base64');
  const up = await operator.post('/special-aid/cards', { files: [{ fileName: 'card-991001.png', mime: 'image/png', dataBase64: b64, admissionNo: '991001' }] });
  expect(up.status).toBe(201);
  expect(up.body.results[0]).toMatchObject({ outcome: 'matched' });
  const again = await operator.post('/special-aid/cards', { files: [{ fileName: 'copy.png', mime: 'image/png', dataBase64: b64 }] });
  expect(again.body.results[0].outcome).toBe('duplicate');
  const fake = await operator.post('/special-aid/cards', { files: [{ fileName: 'x.png', mime: 'image/png', dataBase64: Buffer.from('not an image').toString('base64') }] });
  expect(fake.body.results[0].outcome).toBe('rejected');
  const d = await detail(operator, (await dossierOf(operator)).id);
  expect(d.cards).toHaveLength(1);
  expect(d.cards[0]).toMatchObject({ fileName: 'card-991001.png', mime: 'image/png', size: PNG.length, state: 'matched', uploadedByName: expect.any(String) });
  const file = await operator.get(`/special-aid/cards/${d.cards[0]!.id}/file`).buffer(true).parse((res, cb) => { const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); });
  expect(Buffer.compare(file.body as Buffer, PNG)).toBe(0);
  // A card whose admission is not known yet stays unmatched, then matches after the next report.
  const png2 = Buffer.concat([PNG, Buffer.from([0])]);
  const later = await operator.post('/special-aid/cards', { files: [{ fileName: 'card-991077.png', mime: 'image/png', dataBase64: png2.toString('base64'), admissionNo: '991077' }] });
  expect(later.body.results[0].outcome).toBe('unmatched');
  const unmatched = (await operator.get('/special-aid/cards?state=unmatched')).body;
  expect(unmatched.some((c: { fileName: string }) => c.fileName === 'card-991077.png')).toBe(true);
  await publish([emdadRow(1, arrived), emdadRow(2, wrong), emdadRow(3, correct), emdadRow(5, { ...correct, 'شماره کارت پذيرش': '991077', 'شماره امداد ویژه': '0091077' })], -460);
  const [card] = await h.db.db.select().from(specialAidCards).where(eq(specialAidCards.fileName, 'card-991077.png'));
  expect(card).toMatchObject({ state: 'matched', matchedBy: null });
  // Administrator-assisted matching with a VIN that points at a different vehicle than the admission is refused.
  const [first] = await h.db.db.select().from(specialAidCards).where(eq(specialAidCards.fileName, 'card-991001.png'));
  const mis = await operator.post(`/special-aid/cards/${first!.id}/match`, { admissionNo: '991001', vin: LATE_VIN, expectedVersion: first!.version });
  expect(mis.status).toBe(201);
  expect(mis.body.matched).toBe(false);
  // Read-only staff cannot upload.
  expect((await manager.post('/special-aid/cards', { files: [{ fileName: 'm.png', mime: 'image/png', dataBase64: b64 }] })).status).toBe(403);
});

it('appointments: imported from the ISACO list, linked automatically (spec 29.3), corrected by the operator; layout recognized next time', async () => {
  const j = toJalaliParts(new Date(Date.now() + 2 * 86_400_000));
  const day = `${j.jy}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`;
  const header = ['شماره نوبت', 'شماره شاسی', 'تاریخ نوبت', 'ساعت', 'وضعیت', 'نام مشتری', 'موبایل'];
  const rows = [header, ['N-5001', VIN, day, '10:30', 'تأیید شده', 'مشتری آزمونی', '09000000001'], ['N-5002', 'TESTVIN0000SCXXXX', day, '11:00', 'تأیید شده', 'دیگری', '09000000002']];
  const file = { kind: 'appointments', fileName: 'appointments.xlsx', fileBase64: xlsxB64(rows) };
  expect((await operator.post('/reference-imports/inspect', file)).status).toBe(403);
  const meta = (await admin.post('/reference-imports/inspect', file)).body as ReferenceInspection;
  expect(meta.sheets[0]!.rows[0]!.cells).toEqual(header);
  const mapping = { appointmentNo: 0, vin: 1, appointmentDate: 2, appointmentTime: 3, status: 4, fullName: 5, phone: 6 };
  const prev = (await admin.post('/reference-imports', { ...file, sheetIndex: 0, headerRow: 1, mapping })).body as ReferenceImport;
  expect(prev.counts.new).toBe(2);
  expect((await admin.post(`/reference-imports/${prev.id}/apply`, {})).status).toBe(201);
  let d = await detail(operator, (await dossierOf(operator)).id);
  expect(d.appointments).toHaveLength(1);
  // The only appointment of the vehicle after a waiting part arrived is linked by Manage, not guessed by a person.
  expect(d.appointments[0]).toMatchObject({ appointmentNo: 'N-5001', relation: 'related', auto: true, timeText: '10:30' });
  expect(d.appointmentState).toBe('confirmed');
  expect((await operator.post('/special-aid/dossiers/search', { view: 'appointed', pageSize: 100 })).body.items.some((r: SpecialAidDossierRow) => r.id === d.id)).toBe(true);
  // A linked appointment counts the customer as invited in the management funnel.
  expect((await manager.get('/special-aid/summary')).body.funnel.customers.invited).toBeGreaterThanOrEqual(1);
  // The operator's decision wins over the automatic link, in both directions.
  const unrel = await operator.post(`/special-aid/dossiers/${d.id}/appointments/${d.appointments[0]!.id}`, { relation: 'unrelated' });
  expect(unrel.status).toBe(201);
  expect(unrel.body.appointments[0]).toMatchObject({ relation: 'unrelated', auto: false });
  expect(unrel.body.appointmentState).toBe('none_recent');
  const rel = await operator.post(`/special-aid/dossiers/${d.id}/appointments/${d.appointments[0]!.id}`, { relation: 'related' });
  expect(rel.status).toBe(201);
  expect(rel.body.appointments[0]).toMatchObject({ relation: 'related', auto: false });
  expect(rel.body.appointmentState).toBe('confirmed');
  // Re-importing the same list (changed status) updates the appointment without a duplicate.
  rows[1]![4] = 'لغو شده';
  const det = await admin.post('/report-center/detect', { fileName: 'next.xls', fileBase64: xlsxB64(rows) });
  expect(det.body).toMatchObject({ kind: 'appointments', headerRow: 1, sheetIndex: 0 });
  const prev2 = (await admin.post('/reference-imports', { kind: 'appointments', fileName: 'next.xlsx', fileBase64: xlsxB64(rows), sheetIndex: 0, headerRow: det.body.headerRow, mapping: det.body.mapping })).body as ReferenceImport;
  expect(prev2.counts).toMatchObject({ new: 0, update: 1, unchanged: 1 });
  expect((await admin.post(`/reference-imports/${prev2.id}/apply`, {})).status).toBe(201);
  d = await detail(operator, d.id);
  expect(d.appointments).toHaveLength(1);
  expect(d.appointments[0]).toMatchObject({ status: 'لغو شده', relation: 'related' });
  // The special-aid report is recognized by its content; an unknown sheet is explained, not guessed.
  const emdadFile = Buffer.from(buildEmdadXml([emdadRow(1, arrived)])).toString('base64');
  expect((await admin.post('/report-center/detect', { fileName: 'whatever.xlsx', fileBase64: emdadFile })).body.kind).toBe('emdad');
  const unknown = await admin.post('/report-center/detect', { fileName: 'a.xlsx', fileBase64: xlsxB64([['ستون یک', 'ستون دو'], ['1', '2']]) });
  expect(unknown.body.kind).toBeNull();
  const center = (await admin.get('/report-center')).body as { kind: string; lastImport: unknown; stale: boolean; layoutConfirmed: boolean; ageWorkingDays: number }[];
  expect(center.find((e) => e.kind === 'appointments')).toMatchObject({ layoutConfirmed: true, stale: false, ageWorkingDays: 0 });
  expect(center.find((e) => e.kind === 'appointments')!.lastImport).toBeTruthy();
});

it('feedback and formal warnings: issued by the service manager, acknowledged by the recipient without accepting fault', async () => {
  const opId = (await h.db.db.select({ id: users.id }).from(users).where(eq(users.username, 'sc-operator')))[0]!.id;
  const d = await dossierOf(operator);
  expect((await operator.post('/special-aid/feedback', { recipientId: opId, kind: 'feedback', message: 'آزمون' })).status).toBe(403);
  const w = await manager.post('/special-aid/feedback', { recipientId: opId, kind: 'warning', reason: 'wrong_diagnosis', dossierId: d.id, message: 'تشخیص فنی این خودرو اشتباه ثبت شد؛ لطفاً دقت کنید.' });
  expect(w.status).toBe(201);
  expect(w.body).toMatchObject({ kind: 'warning', acknowledgedAt: null, vin: VIN });
  const mine = (await operator.get('/special-aid/feedback')).body;
  expect(mine).toHaveLength(1);
  expect((await parts.get('/special-aid/feedback')).body).toHaveLength(0);
  expect((await parts.post(`/special-aid/feedback/${w.body.id}/acknowledge`, { expectedVersion: 1 })).status).toBe(403);
  const ack = await operator.post(`/special-aid/feedback/${w.body.id}/acknowledge`, { reply: 'دریافت شد؛ قطعهٔ رسیده با شرح سفارش فرق داشت.', expectedVersion: 1 });
  expect(ack.status).toBe(201);
  expect(ack.body.acknowledgedAt).toBeTruthy();
  expect((await operator.post(`/special-aid/feedback/${w.body.id}/acknowledge`, { expectedVersion: 2 })).status).toBe(422);
  expect((await detail(manager, d.id)).feedback[0]).toMatchObject({ reply: expect.stringContaining('دریافت شد') });
  const sum = (await manager.get('/special-aid/summary')).body;
  expect(sum).toMatchObject({ warningsIssued: 1, feedbackOpen: 0 });
  expect(typeof sum.stalledSupply).toBe('number');
});

it('guest access needs an end date and stops at it; job titles are labels set only by the owner', async () => {
  const guest = await h.loginAs('sc-guest', ['guest']);
  expect((await guest.get('/special-aid/today')).status).toBe(200);
  expect((await guest.post('/special-aid/cards', { files: [{ fileName: 'g.png', mime: 'image/png', dataBase64: PNG.toString('base64') }] })).status).toBe(403);
  const cat = (await owner.get('/access')).body as { version: number; staff: { id: string; displayName: string; version: number; jobTitles: string[] }[] };
  const g = cat.staff.find((s) => s.displayName && s.id && s.jobTitles)!;
  const gid = (await h.db.db.select({ id: users.id }).from(users).where(eq(users.username, 'sc-guest')))[0]!.id;
  const gv = cat.staff.find((s) => s.id === gid)!;
  expect(g).toBeTruthy();
  const base = { expectedVersion: gv.version, expectedTemplateVersion: cat.version, roles: ['guest'], allow: [], deny: [] };
  expect((await owner.put(`/access/users/${gid}`, { ...base, accessExpiresAt: null })).status).toBe(422);
  expect((await admin.put(`/access/users/${gid}`, { ...base, accessExpiresAt: new Date(Date.now() + 86_400_000).toISOString() })).status).toBe(403);
  const opId = (await h.db.db.select({ id: users.id }).from(users).where(eq(users.username, 'sc-operator')))[0]!.id;
  const op = (await owner.get('/access')).body.staff.find((s: { id: string }) => s.id === opId);
  expect((await owner.put(`/access/users/${opId}`, { expectedVersion: op.version, expectedTemplateVersion: cat.version, roles: ['special_aid_operator', 'special_aid_supply'], allow: [], deny: [], jobTitles: ['اپراتور امداد ویژه', 'مسئول تماس'] })).status).toBe(200);
  expect((await operator.get('/auth/me')).body).toMatchObject({ jobTitles: ['اپراتور امداد ویژه', 'مسئول تماس'], roles: ['special_aid_operator', 'special_aid_supply'] });
  // An end date in the past ends the guest's access at once.
  expect((await owner.put(`/access/users/${gid}`, { ...base, accessExpiresAt: new Date(Date.now() - 60_000).toISOString() })).status).toBe(200);
  expect((await guest.get('/special-aid/today')).status).toBe(401);
});

it('the ISACO 8-character chassis of the real reports opens a dossier; a broken one stays in review', async () => {
  // Production Emdad and reception reports carry only the 8-character chassis (e.g. AAA12345), never a 17-character VIN.
  const short = { ...correct, 'شماره شاسی': 'tst 12345', 'شماره کارت پذيرش': '991088', 'شماره امداد ویژه': '0091088', 'کد قطعه': '00383838', 'کد اختصاصی اولیه': '00383838' };
  const broken = { ...badVin, 'شماره شاسی': 'TS1234', 'شماره کارت پذيرش': '991089', 'شماره امداد ویژه': '0091089' };
  await publish([emdadRow(1, arrived), emdadRow(2, wrong), emdadRow(3, correct), emdadRow(6, short), emdadRow(7, broken)], -440);
  const d = await dossierOf(operator, 'TST12345');
  expect(d).toMatchObject({ vin: 'TST12345' });
  expect((await detail(operator, d.id)).items.map((i) => i.emdadNo)).toEqual(['0091088']);
  const queue = (await operator.get('/special-aid/review-queue')).body as { emdadNo: string }[];
  expect(queue.some((q) => q.emdadNo === '0091089')).toBe(true);
  expect(queue.some((q) => q.emdadNo === '0091088')).toBe(false);
  // «خواندن دوباره» is idempotent: nothing new on a second run.
  const again = (await operator.post('/special-aid/sync', {})).body;
  expect(again).toMatchObject({ dossiers: 0, admissions: 0, items: 0, statusChanges: 0, held: 0 });
});

it('a line that had already arrived before the module saw it is never held automatically; a manual hold still works', async () => {
  expect((await apply(await preview('stock', buildStockXlsx([sku('0031313101', '2', 'S-01'), sku('0034343401', '3', 'S-04')])), -430)).status).toBe(201);
  const HIST_VIN = 'TESTVIN0000SC0004';
  const hist = { ...arrived, 'شماره شاسی': HIST_VIN, 'شماره کارت پذيرش': '991090', 'شماره امداد ویژه': '0091090', 'کد قطعه': '00343434', 'کد اختصاصی اولیه': '00343434', 'كد تداركاتي كالا': '0034343401' };
  const rows = [emdadRow(1, arrived), emdadRow(2, wrong), emdadRow(3, correct), emdadRow(8, hist)];
  await publish(rows, -425);
  // New in the report being published: held automatically.
  let d = await detail(operator, (await dossierOf(operator, HIST_VIN)).id);
  let x = d.items.find((i) => i.emdadNo === '0091090')!;
  expect(x.state).toBe('reserved');
  // Simulate data from before the module existed: the report row stays, the module line is gone.
  await h.db.db.delete(stockReservations).where(eq(stockReservations.specialAidItemId, x.id));
  await h.db.db.delete(specialAidItems).where(eq(specialAidItems.id, x.id));
  expect(await available('0034343401')).toBe(3);
  await publish(rows, -420);
  d = await detail(operator, (await dossierOf(operator, HIST_VIN)).id);
  x = d.items.find((i) => i.emdadNo === '0091090')!;
  expect(x.state).toBe('arrived');
  expect(x.holdNote).toContain('رزرو خودکار نمی‌شود');
  expect(await available('0034343401')).toBe(3);
  // A later report does not hold it either.
  await publish(rows, -415);
  expect(await available('0034343401')).toBe(3);
  // Staff can still hold it by hand for this vehicle.
  const r = await operator.post(`/special-aid/items/${x.id}/action`, { action: 'reserve', expectedVersion: (await detail(operator, d.id)).items.find((i) => i.id === x.id)!.version });
  expect(r.status).toBe(201);
  expect(await available('0034343401')).toBe(2);
});
