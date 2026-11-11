import type { CaseListItem } from '@manage/shared';
import { createHarness, type Harness } from './harness';

let h: Harness;

beforeAll(async () => {
  h = await createHarness({ withCases: true });
});
afterAll(async () => {
  await h?.close();
});

it('demo dealership seeds through the real services with realistic states', async () => {
  const manager = await h.login('manager');
  const list = (await manager.get('/cases?status=all')).body;
  expect(list.total).toBe(5);
  const items = list.items as CaseListItem[];
  expect(items.every((i) => i.isTest)).toBe(true);
  expect(items.map((i) => i.stage).sort()).toEqual(
    ['awaiting_parts', 'awaiting_parts', 'in_repair', 'in_repair', 'ready_for_delivery'].sort(),
  );

  const d = (await manager.get('/dashboard')).body;
  expect(d).toMatchObject({
    activeCases: 5,
    overdue: 1,
    blockedCases: 1,
    readyForDelivery: 1,
    legacyEntries: 1,
    awaitingAuthorization: 0,
    partsOverdue: 1,
    partsToOrder: 1,
    // The advance proposal flow is retired (spec section 9): nothing waits for a finance decision.
    financePending: 0,
  });
});
