import { eq } from 'drizzle-orm';
import { users } from '../src/db/schema';
import { createHarness, type Client, type Harness } from './harness';

// Package 6 — desks as folders: one card per open car with place, days and one «قدم بعدی».
let h: Harness;
let expert: Client, tech: Client;
let techId: string, body: string, paint: string;

beforeAll(async () => {
  h = await createHarness({ config: { DAILY_SCHEDULER: 'false' } });
  [expert, tech] = await Promise.all([h.loginAs('p6-expert', ['accident_expert']), h.loginAs('p6-tech', ['technician'])]);
  techId = (await h.db.db.select({ id: users.id }).from(users).where(eq(users.username, 'p6-tech')))[0]!.id;
  const departments = (await expert.get('/departments')).body as { id: string; code: string }[];
  body = departments.find((d) => d.code === 'body')!.id;
  paint = departments.find((d) => d.code === 'paint')!.id;
});
afterAll(async () => h?.close());

it('a folder follows the car: assessment, plan, finished step waiting for the expert', async () => {
  const created = await expert.post('/cases', {
    vehicle: { model: 'ریرا', plate: '۲۳ ب ۴۵۶ - ۱۶', vin: 'TESTVIN6000000001' },
    customer: { fullName: 'مشتری آزمون پوشه', phone: '09006000001' },
    admittedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    coverageType: 'insurance',
  });
  expect(created.status).toBe(201);
  const caseId = created.body.id as string;

  let folder = (await expert.get(`/desk/folders/${caseId}`)).body;
  expect(folder).toMatchObject({ vehicle: 'ریرا', coverageType: 'insurance', journey: 'reception', next: { actor: 'accident_expert', text: 'برآورد کارشناسی را وارد کنید' } });
  expect(folder.daysInShop).toBeGreaterThanOrEqual(2);
  expect((await expert.get('/desk/folders')).body.some((f: { caseId: string }) => f.caseId === caseId)).toBe(true);

  const plan = await expert.post(`/cases/${caseId}/repair-plan/steps`, { steps: [
    { departmentId: body, assignedUserId: techId, days: 2, title: 'صافکاری' },
    { departmentId: paint, days: 2, title: 'نقاشی' },
  ] });
  expect(plan.status).toBe(201);
  const first = plan.body[0] as { id: string };
  expect((await tech.post(`/workshop/my-tasks/${first.id}/actions`, { action: 'start', expectedVersion: 1 })).status).toBe(201);
  folder = (await expert.get(`/desk/folders/${caseId}`)).body;
  expect(folder.next.text).toMatch(/^طبق برنامه — پایان صافکاری/);
  expect(folder.place).toBe('صافکاری');
  expect((await tech.post(`/workshop/my-tasks/${first.id}/actions`, { action: 'complete', expectedVersion: 2 })).status).toBe(201);
  folder = (await expert.get(`/desk/folders/${caseId}`)).body;
  expect(folder.next).toEqual({ text: 'صافکاری تمام شد — تأیید و ارجاع به نقاشی', actor: 'accident_expert', tone: 'warn' });
  expect((await tech.get('/desk/folders')).status).toBe(403);
});
