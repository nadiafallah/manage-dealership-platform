import { and, eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { formatJalaliDateInput, formatTimeInput, type DailyImport, type Paged, type SpecialAidDossier, type SpecialAidDossierRow } from '@manage/shared';
import { auditEvents, emdadRequests, notifications, specialAidItems, users } from '../src/db/schema';
import { buildEmdadXml, emdadRow, type EmdadRow } from '../src/daily-reports/fixtures';
import { Client, createHarness, type Harness } from './harness';

// Special-aid mission of 2026-11-28, part 1: the daily special-aid report (Pulse or a manual Excel
// upload after 10:00) updates the state of every part. Lines are identified by the VIN, the special-aid
// number and the 8-digit code (with the admission number); a repeated upload records nothing twice.
// The Pulse path reaches the same apply (DailyReportsService.applyPulseReports, test/pulse.e2e-spec.ts).
// Synthetic data only: TESTVIN…, invented numbers and codes.
let h: Harness;
let parts: Client, operator: Client;
const VIN = 'TESTVIN0000RR0001';

const at = (min: number) => { const d = new Date(Date.now() + min * 60_000); return { reportDate: formatJalaliDateInput(d), reportTime: formatTimeInput(d) }; };
async function preview(rows: EmdadRow[]): Promise<DailyImport> {
  const u = await request(h.app.getHttpServer()).post('/api/v1/daily-reports/uploads?kind=emdad&fileName=emdad.xls').set('Cookie', parts.cookie).set('x-manage-client', 'test').set('content-type', 'application/octet-stream').send(Buffer.from(buildEmdadXml(rows)));
  expect(u.status).toBe(201);
  let job: DailyImport = u.body;
  for (let i = 0; i < 300 && ['uploaded', 'parsing'].includes(job.status); i++) { await new Promise((r) => setTimeout(r, 50)); job = (await parts.get(`/daily-reports/imports/${u.body.id}`)).body; }
  expect(job.status).toBe('preview');
  return job;
}
async function publish(rows: EmdadRow[], min: number) {
  const job = await preview(rows);
  const r = await parts.post(`/daily-reports/imports/${job.id}/apply`, { declaration: true, declaredToday: true, acceptTemplate: true, ...at(min) });
  expect(r.status).toBe(201);
  return job;
}
const line = (i: number, over: EmdadRow): EmdadRow => emdadRow(i, { 'شماره شاسی': VIN, 'شماره درخواست': '', 'شماره کارت پذيرش': '961001', ...over });
const head = { 'شماره امداد ویژه': '0061001', 'کد قطعه': '00616161', 'کد اختصاصی اولیه': '00616161', 'كد تداركاتي كالا': '0061616101', 'شرح اختصاصی': 'چراغ جلو ساختگی' };
const bumper = { 'شماره امداد ویژه': '0061002', 'کد قطعه': '00626262', 'کد اختصاصی اولیه': '00626262', 'كد تداركاتي كالا': '0062626201', 'شرح اختصاصی': 'سپر ساختگی' };
const dossier = async (): Promise<SpecialAidDossier> => {
  const row = ((await operator.post('/special-aid/dossiers/search', { q: VIN })).body as Paged<SpecialAidDossierRow>).items[0]!;
  return (await operator.get(`/special-aid/dossiers/${row.id}`)).body;
};
const counts = async () => {
  const d = await dossier();
  const opId = (await h.db.db.select({ id: users.id }).from(users).where(eq(users.username, 'rr-operator')))[0]!.id;
  return {
    items: (await h.db.db.select().from(specialAidItems).where(eq(specialAidItems.dossierId, d.id))).length,
    requests: (await h.db.db.select().from(emdadRequests).where(eq(emdadRequests.chassis, VIN))).length,
    arrivedNotices: (await h.db.db.select().from(notifications).where(and(eq(notifications.userId, opId), eq(notifications.kind, 'special_aid.arrived')))).length,
  };
};

beforeAll(async () => {
  h = await createHarness();
  parts = await h.login('parts');
  operator = await h.loginAs('rr-operator', ['special_aid_operator']);
});
afterAll(async () => { await h?.close(); });

it('a manual upload sets the official stage of each part, before arrival too; two special-aid numbers are two parts', async () => {
  await publish([line(1, { ...head, 'وضعیت امداد ویژه': 'در مرحله خرید' }), line(2, { ...bumper, 'وضعیت امداد ویژه': 'در حال تامین' })], -300);
  const d = await dossier();
  expect(d.items).toHaveLength(2);
  const h1 = d.items.find((i) => i.emdadNo === '0061001')!;
  expect(h1).toMatchObject({ state: 'pending', officialStatus: 'در مرحله خرید', assessmentCode: '00616161', procurementCode: '0061616101', deadline: null });
  // The request date of the report is kept on the part (official, apart from Manage's observations).
  expect(h1.officialRegisteredAt).toBeTruthy();
  expect(d.items.find((i) => i.emdadNo === '0061002')!.officialStatus).toBe('در حال تامین');
});

it('the same file again records nothing twice: no part, request, event or notice', async () => {
  const before = await counts();
  const job = await preview([line(1, { ...head, 'وضعیت امداد ویژه': 'در مرحله خرید' }), line(2, { ...bumper, 'وضعیت امداد ویژه': 'در حال تامین' })]);
  expect(job.sameContent).toBe(true);
  expect((await parts.post(`/daily-reports/imports/${job.id}/apply`, { declaration: true, declaredToday: true, acceptTemplate: true, ...at(-250) })).status).toBe(201);
  expect(await counts()).toEqual(before);
});

it('a newer report moves the same line (VIN + special-aid number + code) to «arrived»; the operator is told once', async () => {
  const before = await counts();
  await publish([line(1, { ...head, 'وضعیت امداد ویژه': 'وارد موجودی شده است', 'تاريخ رسيد شدن امداد ويژه در انبار': formatJalaliDateInput(new Date()), 'تعداد اختصاصي': '1' }), line(2, { ...bumper, 'وضعیت امداد ویژه': 'در حال تامین' })], -200);
  const d = await dossier();
  expect(d.items).toHaveLength(2);
  const h1 = d.items.find((i) => i.emdadNo === '0061001')!;
  expect(h1).toMatchObject({ state: 'arrived', officialStatus: 'وارد موجودی شده است' });
  expect(h1.receivedAt).toBeTruthy();
  // The 20-working-day clock starts from the official warehouse receipt.
  expect(h1.deadline).toMatchObject({ day: 0, remaining: 20, level: 'ok', official: true });
  expect(d.items.find((i) => i.emdadNo === '0061002')!.state).toBe('pending');
  const after = await counts();
  expect(after).toEqual({ ...before, arrivedNotices: before.arrivedNotices + 1 });
  const history = await h.db.db.select().from(auditEvents).where(and(eq(auditEvents.entityId, h1.id), inArray(auditEvents.action, ['special_aid.status_observed'])));
  expect(history.length).toBeGreaterThanOrEqual(1);
  // Publishing that report again does not repeat the notice.
  await publish([line(1, { ...head, 'وضعیت امداد ویژه': 'وارد موجودی شده است', 'تاريخ رسيد شدن امداد ويژه در انبار': formatJalaliDateInput(new Date()), 'تعداد اختصاصي': '1' }), line(2, { ...bumper, 'وضعیت امداد ویژه': 'در حال تامین' })], -150);
  expect(await counts()).toEqual(after);
});

it('an older report never reverts the newer stage', async () => {
  await publish([line(1, { ...head, 'وضعیت امداد ویژه': 'در مرحله خرید' })], -600);
  const d = await dossier();
  expect(d.items.find((i) => i.emdadNo === '0061001')).toMatchObject({ state: 'arrived', officialStatus: 'وارد موجودی شده است' });
});
