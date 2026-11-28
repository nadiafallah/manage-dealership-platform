import { and, eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import {
  DEADLINE_RELEASE_REASON, formatJalaliDateInput, formatTimeInput, toJalaliParts,
  type DailyImport, type Paged, type SpecialAidDossier, type SpecialAidDossierRow, type SpecialAidSummary, type SpecialAidTodayEntry,
} from '@manage/shared';
import { auditEvents, notifications, users } from '../src/db/schema';
import { buildEmdadXml, emdadRow, type EmdadRow } from '../src/daily-reports/fixtures';
import { SpecialAidService } from '../src/special-aid/special-aid.service';
import { Client, createHarness, type Harness } from './harness';

// Special-aid mission of 2026-11-28, part 3 (spec 29.2–29.5): 20 working days from arrival (yellow from
// working day 11, red from 18), a call every ten days from the registration of the request, an alert to
// the operator when a part arrives, an alert at the end of the deadline and a one-click release.
// Dates are relative to today on the default calendar (Friday off, no holidays in the test dealership).
// Synthetic data only: TESTVIN…, invented numbers and codes.
let h: Harness;
let parts: Client, operator: Client, admin: Client, manager: Client;
const DAY = 86_400_000;
const key = (d: Date) => new Date(d.getTime() + 210 * 60_000).toISOString().slice(0, 10); // Tehran day
const working = (k: string) => new Date(`${k}T12:00:00Z`).getUTCDay() !== 5;
const prev = (k: string) => new Date(Date.parse(`${k}T00:00:00Z`) - DAY).toISOString().slice(0, 10);
const jalali = (k: string) => formatJalaliDateInput(new Date(`${k}T12:00:00+03:30`));
/** Report date of an arrival that leaves exactly `n` working days after it, up to today. */
function arrivalOnDay(n: number): string {
  let k = key(new Date());
  for (let count = 0; count < n; k = prev(k)) if (working(k)) count += 1;
  return jalali(k);
}
const calendarDaysAgo = (n: number) => jalali(key(new Date(Date.now() - n * DAY)));

const VIN = { yellow: 'TESTVIN0000FU0011', red: 'TESTVIN0000FU0019', expired: 'TESTVIN0000FU0025', recent: 'TESTVIN0000FU0021', fresh: 'TESTVIN0000FU0001', call: 'TESTVIN0000FU0100', quiet: 'TESTVIN0000FU0200' };
const arrived = (i: number, vin: string, day: number): EmdadRow => emdadRow(i, {
  'شماره شاسی': vin, 'شماره درخواست': '', 'شماره کارت پذيرش': `97${i}`, 'شماره امداد ویژه': `00971${i}`, 'کد قطعه': `0097${String(i).padStart(4, '0')}`, 'کد اختصاصی اولیه': `0097${String(i).padStart(4, '0')}`,
  'كد تداركاتي كالا': `0097${String(i).padStart(4, '0')}01`, 'وضعیت امداد ویژه': 'وارد موجودی شده است', 'تاريخ رسيد شدن امداد ويژه در انبار': arrivalOnDay(day), 'تاریخ ثبت امداد ویژه': calendarDaysAgo(60), 'تعداد اختصاصي': '1',
});
const pending = (i: number, vin: string, registeredDaysAgo: number): EmdadRow => emdadRow(i, {
  'شماره شاسی': vin, 'شماره درخواست': '', 'شماره کارت پذيرش': `97${i}`, 'شماره امداد ویژه': `00971${i}`, 'کد قطعه': `0097${String(i).padStart(4, '0')}`, 'کد اختصاصی اولیه': `0097${String(i).padStart(4, '0')}`,
  'وضعیت امداد ویژه': 'در مرحله خرید', 'تاریخ ثبت امداد ویژه': calendarDaysAgo(registeredDaysAgo),
});
const ROWS = [arrived(11, VIN.yellow, 12), arrived(12, VIN.red, 19), arrived(13, VIN.expired, 26), arrived(14, VIN.recent, 21), arrived(15, VIN.fresh, 0), pending(16, VIN.call, 12), pending(17, VIN.quiet, 3)];

const at = (min: number) => { const d = new Date(Date.now() + min * 60_000); return { reportDate: formatJalaliDateInput(d), reportTime: formatTimeInput(d) }; };
async function publish(rows: EmdadRow[], min: number) {
  const u = await request(h.app.getHttpServer()).post('/api/v1/daily-reports/uploads?kind=emdad&fileName=emdad.xls').set('Cookie', parts.cookie).set('x-manage-client', 'test').set('content-type', 'application/octet-stream').send(Buffer.from(buildEmdadXml(rows)));
  expect(u.status).toBe(201);
  let job: DailyImport = u.body;
  for (let i = 0; i < 300 && ['uploaded', 'parsing'].includes(job.status); i++) { await new Promise((r) => setTimeout(r, 50)); job = (await parts.get(`/daily-reports/imports/${u.body.id}`)).body; }
  expect(job.status).toBe('preview');
  expect((await parts.post(`/daily-reports/imports/${job.id}/apply`, { declaration: true, declaredToday: true, acceptTemplate: true, ...at(min) })).status).toBe(201);
}
const row = async (vin: string) => ((await operator.post('/special-aid/dossiers/search', { q: vin })).body as Paged<SpecialAidDossierRow>).items[0]!;
const detail = async (c: Client, vin: string): Promise<SpecialAidDossier> => (await c.get(`/special-aid/dossiers/${(await row(vin)).id}`)).body;
const view = async (v: string) => new Set(((await operator.post('/special-aid/dossiers/search', { view: v, pageSize: 100 })).body as Paged<SpecialAidDossierRow>).items.map((r) => r.vin));
const userId = async (username: string) => (await h.db.db.select({ id: users.id }).from(users).where(eq(users.username, username)))[0]!.id;
const notices = async (username: string, kind: string) => h.db.db.select().from(notifications).where(and(eq(notifications.userId, await userId(username)), eq(notifications.kind, kind)));

beforeAll(async () => {
  h = await createHarness();
  parts = await h.login('parts');
  [operator, admin, manager] = await Promise.all([
    h.loginAs('fu-operator', ['special_aid_operator']),
    h.loginAs('fu-admin', ['system_admin']),
    h.loginAs('fu-manager', ['service_manager']),
  ]);
  await publish(ROWS, -120);
});
afterAll(async () => { await h?.close(); });

it('deadline: 20 working days from the official receipt; yellow from day 11, red from day 18, expired after day 20', async () => {
  const y = await detail(operator, VIN.yellow);
  expect(y.items[0]!.deadline).toMatchObject({ day: 12, remaining: 8, level: 'yellow', official: true });
  expect(y.deadline).toMatchObject({ level: 'yellow' });
  expect((await detail(operator, VIN.red)).items[0]!.deadline).toMatchObject({ day: 19, remaining: 1, level: 'red' });
  expect((await detail(operator, VIN.expired)).items[0]!.deadline).toMatchObject({ remaining: 0, level: 'expired' });
  expect((await detail(operator, VIN.fresh)).items[0]!.deadline).toMatchObject({ day: 0, remaining: 20, level: 'ok' });
  expect((await detail(operator, VIN.call)).items[0]!.deadline).toBeNull();
  // The colour filters of «پرونده خودروها» (links of the management report).
  expect(await view('yellow')).toEqual(new Set([VIN.yellow]));
  expect(await view('red')).toEqual(new Set([VIN.red]));
  expect(await view('expired')).toEqual(new Set([VIN.expired, VIN.recent]));
});

it('«کارهای امروز» in three parts: due calls, newly arrived parts to invite, yellow and red dossiers', async () => {
  const today = (await operator.get('/special-aid/today')).body as SpecialAidTodayEntry[];
  const of = (vin: string) => today.find((e) => e.dossier.vin === vin);
  const kinds = (vin: string) => of(vin)?.tasks.map((t) => `${t.section}:${t.kind}`) ?? [];
  expect(kinds(VIN.yellow)).toContain('deadline:deadline_yellow');
  expect(kinds(VIN.red)).toContain('deadline:deadline_red');
  expect(kinds(VIN.expired)).toContain('deadline:deadline_expired');
  expect(kinds(VIN.fresh)).toEqual(['invite:inform_arrival']);
  // A call every ten days from the registration of the request, before the part arrives.
  expect(kinds(VIN.call)).toEqual(['calls:recurring_contact']);
  expect(of(VIN.call)!.tasks[0]!.overdue).toBe(true);
  expect(of(VIN.quiet)).toBeUndefined();
  // Expired parts are offered for the one-click release; other parts are not.
  expect(of(VIN.expired)!.releasable).toHaveLength(1);
  expect(of(VIN.yellow)!.releasable).toHaveLength(0);
  expect(await view('calls_overdue')).toEqual(new Set([VIN.yellow, VIN.red, VIN.expired, VIN.recent, VIN.call]));
});

it('an arrival tells the special-aid operator to invite the customer, once per vehicle', async () => {
  const before = await notices('fu-operator', 'special_aid.arrived');
  expect(before).toHaveLength(5);
  expect(before.every((n) => n.link?.startsWith('/special-aid/vehicles/'))).toBe(true);
  // The same report again: nothing new. The waiting part of another vehicle arrives: one more notice.
  await publish(ROWS, -90);
  expect(await notices('fu-operator', 'special_aid.arrived')).toHaveLength(5);
  await publish([...ROWS.filter((r) => r['شماره شاسی'] !== VIN.quiet), { ...ROWS[6]!, 'وضعیت امداد ویژه': 'وارد موجودی شده است', 'تاريخ رسيد شدن امداد ويژه در انبار': arrivalOnDay(0) }], -60);
  expect(await notices('fu-operator', 'special_aid.arrived')).toHaveLength(6);
  expect(await notices('fu-manager', 'special_aid.arrived')).toHaveLength(0);
});

it('the end of the deadline alerts the operator and the administrator once; old expiries do not flood the bell', async () => {
  const aid = h.app.get(SpecialAidService);
  // Sweep on a working day (Friday has no alerts): today, or tomorrow morning when today is Friday.
  const now = working(key(new Date())) ? new Date() : new Date(Date.now() + DAY);
  const sent = await aid.deadlineSweep(now);
  // The recent expiry only, to the special-aid operator and every system administrator (the demo one included).
  expect(sent).toBeGreaterThanOrEqual(2);
  const op = await notices('fu-operator', 'special_aid.deadline');
  expect(op).toHaveLength(1);
  expect(op[0]!.link).toBe(`/special-aid/vehicles/${(await row(VIN.recent)).id}`);
  expect(op[0]!.urgent).toBe(true);
  expect(await notices('fu-admin', 'special_aid.deadline')).toHaveLength(1);
  expect(await aid.deadlineSweep(now)).toBe(0);
});

it('one-click release at the end of the deadline: authorized staff only, recorded with name, time and deadline', async () => {
  const d = await detail(operator, VIN.expired);
  const item = d.items[0]!;
  expect(item.state).toBe('arrived');
  expect(item.allowedActions).toContain('release');
  expect((await operator.post(`/special-aid/items/${item.id}/action`, { action: 'release', reason: DEADLINE_RELEASE_REASON, expectedVersion: item.version })).status).toBe(403);
  const r = await admin.post(`/special-aid/items/${item.id}/action`, { action: 'release', reason: DEADLINE_RELEASE_REASON, expectedVersion: item.version });
  expect(r.status).toBe(201);
  expect((r.body as SpecialAidDossier).items[0]).toMatchObject({ state: 'released', deadline: null });
  const audit = await h.db.db.select().from(auditEvents).where(and(eq(auditEvents.entityId, item.id), inArray(auditEvents.action, ['special_aid.release'])));
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({ reason: DEADLINE_RELEASE_REASON, actorUserId: await userId('fu-admin') });
  expect((audit[0]!.after as { deadline: { level: string } }).deadline.level).toBe('expired');
  // Nothing is left to do for this vehicle.
  expect(((await operator.get('/special-aid/today')).body as SpecialAidTodayEntry[]).some((e) => e.dossier.vin === VIN.expired)).toBe(false);
});

it('management report: funnels, yellow and red dossiers, expired deadlines and overdue calls', async () => {
  const s = (await manager.get('/special-aid/summary')).body as SpecialAidSummary;
  expect(s.deadline).toEqual({ yellow: 1, red: 1, expired: 1 });
  expect(s.overdueCalls).toBe(4);
  expect(s.contactFailed).toBe(0);
  const c = s.funnel.customers, p = s.funnel.parts;
  expect(c).toMatchObject({ registered: 7, arrived: 6, informed: 0, invited: 0, attended: 0, installed: 0, releasedNoShow: 1, pastDeadlineNoVisit: 1 });
  expect(p).toMatchObject({ requested: 7, pending: 1, arrived: 6, installed: 0, releasedToOthers: 1 });
  expect((await operator.get('/special-aid/summary')).status).toBe(403);
});

it('the Jalali helper of this test agrees with the server (sanity)', () => {
  const j = toJalaliParts(new Date());
  expect(formatJalaliDateInput(new Date())).toBe(`${j.jy}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`);
});
