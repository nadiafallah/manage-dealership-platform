import type { ControlRoomSnapshot, DeskFolder } from '@manage/shared';
import { createHarness, type Harness } from './harness';

// Package 8: the demo shows every desk full — about twenty synthetic cars in
// different stages, Emdad requests, alerts and a live workshop map.
let h: Harness;
beforeAll(async () => {
  h = await createHarness({ withCases: true, fleet: true });
});
afterAll(async () => h?.close());

it('seeds about twenty synthetic cars across every step, with alerts and bays in use', async () => {
  const manager = await h.login('manager');
  const folders = (await (await h.login('expert')).get('/desk/folders')).body as DeskFolder[];
  expect(folders.length).toBeGreaterThanOrEqual(19);
  expect(new Set(folders.map((f) => f.journey))).toEqual(new Set(['reception', 'assessment', 'parts', 'repair', 'delivery']));
  expect(folders.every((f) => f.plate)).toBe(true);
  expect(folders.some((f) => f.next.text.includes('تمام شد — تأیید'))).toBe(true);
  expect(folders.some((f) => f.behind)).toBe(true);
  expect(folders.some((f) => f.parts.emdadLate > 0)).toBe(true);

  const room = (await manager.get('/control-room?range=month')).body as ControlRoomSnapshot;
  expect(room.kpis.inShop).toBe(folders.length);
  const kinds = new Set(room.alerts.map((a) => a.kind));
  for (const k of ['technician_problem', 'expensive_part', 'price_notice', 'emdad_late', 'part_ready', 'behind']) expect(kinds.has(k as never)).toBe(true);
  expect(room.bays.filter((b) => b.cars.length).length).toBeGreaterThanOrEqual(3);
  expect(room.people.filter((p) => p.role === 'accident_expert').length).toBe(3);

  // Synthetic only: test tenant, 0900 phones, TESTVIN chassis.
  const list = (await manager.get('/cases?status=all&pageSize=100')).body;
  expect(list.items.every((c: { isTest: boolean; vin: string | null }) => c.isTest && (!c.vin || c.vin.startsWith('TESTVIN')))).toBe(true);
});
