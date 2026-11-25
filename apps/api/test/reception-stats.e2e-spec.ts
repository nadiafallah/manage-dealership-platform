import { eq } from 'drizzle-orm';
import type { ReceptionDayStats, ReceptionList, ReceptionSettings } from '@manage/shared';
import { newId } from '../src/common/ids';
import { auditEvents, receptionRepairs, receptions, tenants } from '../src/db/schema';
import { DEMO_TENANT_CODE } from '../src/demo/demo-seed.service';
import { tehranMidnight } from '../src/pulse/pulse-map';
import { createHarness, type Client, type Harness } from './harness';

// «پذیرش تا ترخیص» daily statistics, stay filters and the service labour codes (reconstruction
// scenario, owner 2026-11-25). Receptions are written directly as Pulse would store them; all data
// is synthetic (TESTVIN…, invented names) and the day under test is a fixed past Tehran day.
const SECRET = `test-only-pulse-${'k'.repeat(28)}`;
const DAY = '2025-03-15';
const DAY_START = new Date(Date.parse(`${DAY}T00:00:00Z`) - 210 * 60_000);

describe('Reception statistics and stay filters', () => {
  let h: Harness;
  let admin: Client;
  let expert: Client;
  let reader: Client;
  let tenantId = '';
  const db = () => h.db.db;

  const reception = async (n: number, admittedAt: Date, receptionist: string | null, codes: string[], isOpen = true) => {
    const id = newId();
    await db().insert(receptions).values({ id, tenantId, kasbRcd: `99${n}`, admissionNo: `TST${n}`, admissionNoKey: `tst${n}`, vin: `TESTVIN${String(n).padStart(10, '0')}`, receptionist, admittedAt, isOpen, official: {}, rowHash: `h${n}`, searchText: `tst${n}`, isTest: true });
    for (const [i, code] of codes.entries()) {
      await db().insert(receptionRepairs).values({ id: newId(), tenantId, receptionId: id, kasbLineId: `${n}-${i}`, code, official: {}, rowHash: `r${n}-${i}`, isTest: true });
    }
    return id;
  };

  beforeAll(async () => {
    h = await createHarness({ config: { PULSE_ENABLED: 'true', PULSE_SECRET_KEY: SECRET } });
    admin = await h.login('admin');
    expert = await h.login('expert');
    reader = await h.loginAs('rcp-reader', ['accident_expert'], ['reception.read']);
    const [t] = await db().select({ id: tenants.id }).from(tenants).where(eq(tenants.code, DEMO_TENANT_CODE));
    tenantId = t!.id;
    const at = (hour: number) => new Date(DAY_START.getTime() + hour * 3_600_000);
    await reception(1, at(8), 'پذیرشگر ساختگی الف', ['0100']);
    await reception(2, at(9), 'پذیرشگر ساختگی الف', ['0100', '7777']);
    await reception(3, at(10), 'پذیرشگر ساختگی ب', ['0200']);
    await reception(4, at(11), null, []);
    // A removed labour line does not count: this one is a service reception.
    await reception(5, at(12), 'پذیرشگر ساختگی ب', ['0100', '8888']);
    await db().update(receptionRepairs).set({ removedAt: new Date() }).where(eq(receptionRepairs.kasbLineId, '5-1'));
    // Outside the day: the evening before and the next morning on the Tehran calendar.
    await reception(6, new Date(DAY_START.getTime() - 60_000), 'پذیرشگر ساختگی الف', ['7777']);
    await reception(7, new Date(DAY_START.getTime() + 86_400_000), 'پذیرشگر ساختگی الف', ['7777']);
    // Open receptions for the stay filters, relative to today in Tehran.
    const today = tehranMidnight(new Date()).getTime();
    await reception(11, new Date(today - 86_400_000 + 3_600_000), 'پذیرشگر ساختگی الف', ['7777']);
    await reception(12, new Date(today - 2 * 86_400_000 + 3_600_000), 'پذیرشگر ساختگی الف', ['7777']);
    await reception(13, new Date(today - 5 * 86_400_000), 'پذیرشگر ساختگی الف', ['7777']);
    await reception(14, new Date(today - 5 * 86_400_000), 'پذیرشگر ساختگی الف', ['7777'], false);
  });
  afterAll(async () => h.close());

  it('needs reception.read; only the owner or system administrator edits the service codes', async () => {
    await expert.post('/reception/stats', {}).expect(403);
    await reader.post('/reception/stats', {}).expect(201);
    await reader.put('/reception/settings', { serviceLaborCodes: ['0100'] }).expect(403);
    await admin.post('/reception/stats', { date: '1404/12/24' }).expect(400);
  });

  it('counts every reception of the day as «بدون اجرت» or «تعمیراتی» until service codes are set', async () => {
    const stats = (await admin.post('/reception/stats', { date: DAY }).expect(201)).body as ReceptionDayStats;
    expect(stats).toMatchObject({ date: DAY, total: 5, repair: 4, service: 0, unclassified: 1, serviceCodesConfigured: false });
  });

  it('classifies with the saved codes, per receptionist, and audits the change', async () => {
    const saved = (await admin.put('/reception/settings', { serviceLaborCodes: ['۰۱۰۰', '0200', '0100 '] }).expect(200)).body as ReceptionSettings;
    expect(saved.serviceLaborCodes).toEqual(['0100', '0200']);
    expect(((await reader.get('/reception/settings').expect(200)).body as ReceptionSettings).serviceLaborCodes).toEqual(['0100', '0200']);
    const stats = (await reader.post('/reception/stats', { date: DAY }).expect(201)).body as ReceptionDayStats;
    expect(stats).toMatchObject({ total: 5, repair: 1, service: 3, unclassified: 1, serviceCodesConfigured: true });
    expect(stats.byReceptionist).toEqual([
      { name: 'پذیرشگر ساختگی الف', total: 2, repair: 1, service: 1, unclassified: 0 },
      { name: 'پذیرشگر ساختگی ب', total: 2, repair: 0, service: 2, unclassified: 0 },
      { name: 'ثبت نشده', total: 1, repair: 0, service: 0, unclassified: 1 },
    ]);
    const audit = await db().select().from(auditEvents).where(eq(auditEvents.action, 'settings.reception_service_codes_updated'));
    expect(audit).toHaveLength(1);
  });

  it('filters open receptions by days in the dealership and by admission day range', async () => {
    const mine = (list: ReceptionList) => list.items.map((r) => r.admissionNo).filter((n) => n && /^TST1\d$/.test(n)).sort();
    const open = async (body: object) => mine((await admin.post('/reception/search', { view: 'open', pageSize: 100, ...body }).expect(201)).body as ReceptionList);
    expect(await open({ stay: '1' })).toEqual(['TST11']);
    expect(await open({ stay: '2' })).toEqual(['TST12']);
    expect(await open({ stay: '3plus' })).toEqual(['TST13']);
    const all = (await admin.post('/reception/search', { view: 'released', pageSize: 100 }).expect(201)).body as ReceptionList;
    expect(mine(all)).toEqual(['TST14']);
    const range = (await admin.post('/reception/search', { view: 'open', pageSize: 100, from: DAY, to: DAY }).expect(201)).body as ReceptionList;
    expect(range.items.map((r) => r.admissionNo).sort()).toEqual(['TST1', 'TST2', 'TST3', 'TST4', 'TST5']);
    await admin.post('/reception/search', { view: 'open', from: '2025-03-16', to: DAY }).expect(400);
  });
});
