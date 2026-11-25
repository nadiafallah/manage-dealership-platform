import { eq } from 'drizzle-orm';
import type { ReceptionDetail, ReceptionList } from '@manage/shared';
import { newId } from '../src/common/ids';
import { receptionParts, receptions, tenants } from '../src/db/schema';
import { DEMO_TENANT_CODE } from '../src/demo/demo-seed.service';
import { NightListService } from '../src/pulse/night-list.service';
import { createHarness, type Client, type Harness } from './harness';

// Server-side masking for guest sessions (reconstruction scenario, owner 2026-11-25): the mobile,
// the owner's full name, the full chassis/VIN and amounts never leave the API for a guest, and files
// are refused. The same answers stay complete for staff. Synthetic data only.
const SECRET = `test-only-pulse-${'k'.repeat(28)}`;

describe('Guest masking', () => {
  let h: Harness;
  let admin: Client;
  let guest: Client;
  let receptionId = '';

  beforeAll(async () => {
    h = await createHarness({ config: { PULSE_ENABLED: 'true', PULSE_SECRET_KEY: SECRET } });
    admin = await h.login('admin');
    // A guest the owner allowed to read receptions (the default guest template reads Special Aid only).
    guest = await h.loginAs('mask-guest', ['guest'], ['reception.read']);
    const [t] = await h.db.db.select({ id: tenants.id }).from(tenants).where(eq(tenants.code, DEMO_TENANT_CODE));
    receptionId = newId();
    await h.db.db.insert(receptions).values({
      id: receptionId, tenantId: t!.id, kasbRcd: '660001', admissionNo: 'GM1', vin: 'TESTVIN0000006601', chassis: 'TST66001', plate: '66 ب 666 - 66', productName: 'خودروی ساختگی',
      customerName: 'مشتری ساختگی مهمان', customerMobile: '09000000066', customerNationalId: '0000000066', admittedAt: new Date(Date.now() - 86_400_000), isOpen: true, official: {}, rowHash: 'gm1', searchText: 'gm1', isTest: true,
    });
    await h.db.db.insert(receptionParts).values({ id: newId(), tenantId: t!.id, receptionId, kasbLineId: 'gm1-p', name: 'قطعهٔ ساختگی', code: '00000066', unitPriceRial: 4_500_000, official: {}, rowHash: 'gm1p', isTest: true });
    await h.app.get(NightListService).generate(t!.id, '2025-05-04', null, true, new Date());
  });
  afterAll(async () => h.close());

  it('staff see the full reception; the guest sees initials, the last four of the VIN and no amounts', async () => {
    const full = (await admin.get(`/reception/${receptionId}`).expect(200)).body as ReceptionDetail;
    expect(full.customer).toMatchObject({ name: 'مشتری ساختگی مهمان', mobile: '09000000066' });
    expect(full.vehicle.vin).toBe('TESTVIN0000006601');
    expect(full.parts[0]!.unitPriceRial).toBe(4_500_000);

    const masked = (await guest.get(`/reception/${receptionId}`).expect(200)).body as ReceptionDetail;
    expect(masked.customer.name).toBe('م… س… م…');
    expect(masked.customer.mobile).toBeNull();
    expect(masked.customer.nationalId).toBeNull();
    expect(masked.vehicle.vin).toBe('•••••••••••••6601');
    expect(masked.vehicle.chassis).toBe('••••6001');
    expect(masked.parts[0]).toMatchObject({ name: 'قطعهٔ ساختگی', unitPriceRial: null });
    expect(masked.plate).toBe('66 ب 666 - 66');
    const list = (await guest.post('/reception/search', { view: 'open' }).expect(201)).body as ReceptionList;
    expect(list.items.find((r) => r.admissionNo === 'GM1')).toMatchObject({ customerName: 'م… س… م…' });
    expect(list.total).toBeGreaterThanOrEqual(1);
  });

  it('refuses files to a guest and keeps the guest read only', async () => {
    const night = (await admin.post('/reception/night-list', { day: '2025-05-04' }).expect(201)).body as { id: string };
    await admin.get(`/reception/night-list/${night.id}/excel`).expect(200);
    await guest.get(`/reception/night-list/${night.id}/excel`).expect(403);
    await guest.post(`/reception/${receptionId}/notes`, { text: 'یادداشت مهمان' }).expect(403);
  });
});
