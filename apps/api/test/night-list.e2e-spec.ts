import { and, eq } from 'drizzle-orm';
import type { NightListPending, NightListView } from '@manage/shared';
import { newId } from '../src/common/ids';
import { tehranAt } from '../src/daily-reports/daily-time';
import { auditEvents, notifications, receptionRepairs, receptions, tenants, users } from '../src/db/schema';
import { DEMO_TENANT_CODE } from '../src/demo/demo-seed.service';
import { NightListService } from '../src/pulse/night-list.service';
import { createHarness, type Client, type Harness } from './harness';

// «لیست شب» (reconstruction scenario, owner 2026-11-25). Fixed past working days on the Tehran
// calendar (Sunday 2025-04-20 and Monday 2025-04-21); the service is driven with its own clock.
// Synthetic data only: TESTVIN…, invented names and plates.
const SECRET = `test-only-pulse-${'k'.repeat(28)}`;
const DAY1 = '2025-04-20';
const DAY2 = '2025-04-21';

describe('Nightly list of the reception module', () => {
  let h: Harness;
  let admin: Client;
  let reader: Client;
  let clerk: Client;
  let service: NightListService;
  let tenantId = '';
  const db = () => h.db.db;
  const view = async (c: Client, day: string) => (await c.post('/reception/night-list', { day }).expect(201)).body as NightListView;

  const reception = async (n: number, admittedAt: Date, isOpen = true) => {
    const id = newId();
    await db().insert(receptions).values({ id, tenantId, kasbRcd: `77${n}`, admissionNo: `NL${n}`, admissionNoKey: `nl${n}`, vin: `TESTVIN${String(n).padStart(10, '7')}`, plate: `${n}${n} ب ${n}${n}${n} - ${n}${n}`, productName: 'خودروی ساختگی', customerName: `مشتری ساختگی ${n}`, admittedAt, isOpen, official: {}, rowHash: `n${n}`, isTest: true });
    await db().insert(receptionRepairs).values({ id: newId(), tenantId, receptionId: id, kasbLineId: `nl${n}`, code: '7777', description: 'صافکاری ساختگی', state: 'باز', official: {}, rowHash: `nr${n}`, isTest: true });
    return id;
  };

  beforeAll(async () => {
    h = await createHarness({ config: { PULSE_ENABLED: 'true', PULSE_SECRET_KEY: SECRET } });
    admin = await h.login('admin');
    reader = await h.loginAs('night-reader', ['accident_expert'], ['reception.read']);
    clerk = await h.loginAs('night-clerk', ['accident_expert'], ['reception.read', 'reception.night_list']);
    await h.loginAs('night-manager', ['service_manager']);
    service = h.app.get(NightListService);
    const [t] = await db().select({ id: tenants.id }).from(tenants).where(eq(tenants.code, DEMO_TENANT_CODE));
    tenantId = t!.id;
    const morning = (day: string, back: number) => new Date(tehranAt(day, '09:00').getTime() - back * 86_400_000);
    await reception(1, morning(DAY1, 3));
    await reception(2, morning(DAY1, 0));
    await reception(3, morning(DAY1, 1));
    await reception(4, morning(DAY1, 2), false);
  });
  afterAll(async () => h.close());

  it('waits for 18:00 on a working day, then builds the draft once from the open receptions', async () => {
    expect(((await reader.post('/reception/night-list', { day: DAY1 }).expect(201)).body as NightListPending)).toMatchObject({ status: 'not_generated', workingDay: true });
    expect(await service.tick(tehranAt(DAY1, '17:59'))).toEqual({ generated: 0, alerted: 0 });
    expect((await service.tick(tehranAt(DAY1, '18:00'))).generated).toBeGreaterThanOrEqual(1);
    expect((await service.tick(tehranAt(DAY1, '18:01'))).generated).toBe(0);
    const list = await view(reader, DAY1);
    expect(list).toMatchObject({ day: DAY1, status: 'draft', missingReasons: 3, late: true });
    expect(list.rows.map((r) => r.admissionNo)).toEqual(['NL1', 'NL3', 'NL2']);
    expect(list.rows.map((r) => r.daysIn)).toEqual([4, 2, 1]);
    expect(list.rows[0]).toMatchObject({ vehicleName: expect.any(String), ownerName: 'مشتری ساختگی 1', labour: ['صافکاری ساختگی (باز)'], reason: null, carried: false, isOpen: true });
  });

  it('lets only the reception staff set reasons; «سایر» needs a note; versions protect concurrent edits', async () => {
    const list = await view(clerk, DAY1);
    const row = list.rows[0]!;
    await reader.post(`/reception/night-list/items/${row.id}`, { expectedVersion: row.version, reason: 'waiting_parts' }).expect(403);
    await clerk.post(`/reception/night-list/items/${row.id}`, { expectedVersion: row.version, reason: 'other' }).expect(400);
    const after = (await clerk.post(`/reception/night-list/items/${row.id}`, { expectedVersion: row.version, reason: 'waiting_parts', currentStation: 'باتری‌سازی 36', nextStations: 'مکانیکی 99' }).expect(201)).body as NightListView;
    expect(after.rows[0]).toMatchObject({ reason: 'waiting_parts', currentStation: 'باتری‌سازی 36', nextStations: 'مکانیکی 99', setByName: expect.any(String) });
    expect(after.missingReasons).toBe(2);
    await clerk.post(`/reception/night-list/items/${row.id}`, { expectedVersion: row.version, reason: 'station_load' }).expect(409);
    expect((await db().select().from(auditEvents).where(eq(auditEvents.action, 'reception.night_list_item_set'))).length).toBe(1);
  });

  it('tells the service manager once at 18:45 while it is still a draft', async () => {
    const [manager] = await db().select({ id: users.id }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.username, 'night-manager')));
    expect((await service.tick(tehranAt(DAY1, '18:44'))).alerted).toBe(0);
    expect((await service.tick(tehranAt(DAY1, '18:46'))).alerted).toBeGreaterThanOrEqual(1);
    expect((await service.tick(tehranAt(DAY1, '18:50'))).alerted).toBe(0);
    const late = await db().select().from(notifications).where(and(eq(notifications.userId, manager!.id), eq(notifications.kind, 'night_list_late')));
    expect(late).toHaveLength(1);
  });

  it('is sent by the supervisor with reasons still missing (a warning, not a lock) and exports to Excel', async () => {
    const list = await view(admin, DAY1);
    await clerk.post(`/reception/night-list/${list.id}/send`, { expectedVersion: list.version }).expect(403);
    const sent = (await admin.post(`/reception/night-list/${list.id}/send`, { expectedVersion: list.version }).expect(201)).body as NightListView;
    expect(sent).toMatchObject({ status: 'sent', missingReasons: 2, late: false, sentByName: expect.any(String) });
    await admin.post(`/reception/night-list/${list.id}/send`, { expectedVersion: sent.version }).expect(409);
    const [manager] = await db().select({ id: users.id }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.username, 'night-manager')));
    expect(await db().select().from(notifications).where(and(eq(notifications.userId, manager!.id), eq(notifications.kind, 'night_list_sent')))).toHaveLength(1);
    const file = await reader.get(`/reception/night-list/${list.id}/excel`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(file.status).toBe(200);
    expect(String(file.headers['content-type'])).toContain('spreadsheetml');
    expect((file.body as Buffer).subarray(0, 2).toString()).toBe('PK');
  });

  it('copies yesterday\'s reason for a vehicle still open the next evening; released vehicles drop off', async () => {
    await db().update(receptions).set({ isOpen: false }).where(and(eq(receptions.tenantId, tenantId), eq(receptions.admissionNo, 'NL2')));
    await service.tick(tehranAt(DAY2, '18:00'));
    const next = await view(reader, DAY2);
    expect(next.rows.map((r) => r.admissionNo)).toEqual(['NL1', 'NL3']);
    expect(next.rows[0]).toMatchObject({ reason: 'waiting_parts', carried: true, currentStation: 'باتری‌سازی 36', daysIn: 5 });
    expect(next.rows[1]).toMatchObject({ reason: null, carried: false });
    expect(next.missingReasons).toBe(1);
  });

  it('builds a draft on request for today only', async () => {
    await clerk.post('/reception/night-list/generate', {}).expect(403);
    await admin.post('/reception/night-list/generate', { day: '2999-01-01' }).expect(422);
    const today = (await admin.post('/reception/night-list/generate', {}).expect(201)).body as NightListView;
    expect(today.status).toBe('draft');
  });
});
