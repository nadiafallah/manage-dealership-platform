import { eq } from 'drizzle-orm';
import { users } from '../src/db/schema';
import { createHarness, type Client, type Harness } from './harness';

// Package 5 — repair plan (spec §8): ordered steps with bay, person, days and
// wage, saved together; a concurrent step waits for what the previous one waits for.
let h: Harness;
let expert: Client, tech: Client, manager: Client;
let techId: string, body: string, paint: string;

beforeAll(async () => {
  h = await createHarness({ config: { DAILY_SCHEDULER: 'false' } });
  [expert, tech] = await Promise.all([h.loginAs('p5-expert', ['accident_expert']), h.loginAs('p5-tech', ['technician'])]);
  manager = await h.login('manager');
  techId = (await h.db.db.select({ id: users.id }).from(users).where(eq(users.username, 'p5-tech')))[0]!.id;
  const departments = (await expert.get('/departments')).body as { id: string; code: string }[];
  body = departments.find((d) => d.code === 'body')!.id;
  paint = departments.find((d) => d.code === 'paint')!.id;
});
afterAll(async () => h?.close());

async function newCase() {
  const res = await expert.post('/cases', {
    vehicle: { model: 'خودرو آزمون مسیر تعمیر', plate: '۱۲ ب ۵۵۵ - ۶۷', vin: 'TESTVIN5000000001' },
    customer: { fullName: 'مشتری آزمون مسیر', phone: '09005000001' },
    admittedAt: new Date().toISOString(),
    coverageType: 'golden_card',
  });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe('repair plan steps', () => {
  it('saves ordered steps, concurrency and wages in one go', async () => {
    const caseId = await newCase();
    const res = await expert.post(`/cases/${caseId}/repair-plan/steps`, {
      steps: [
        { departmentId: body, assignedUserId: techId, days: 2, wageRial: 12_000_000, title: 'صافکاری' },
        { departmentId: paint, days: 3, title: 'نقاشی' },
        { departmentId: body, days: 1, title: 'مونتاژ', concurrentWithPrevious: true },
        { departmentId: body, days: 2, title: 'صافکاری دوباره' },
      ],
    });
    expect(res.status).toBe(201);
    const [a, b, c, d] = res.body as { id: string; dependsOn: string[]; assignedUserId: string | null }[];
    expect(a!.dependsOn).toEqual([]);
    expect(b!.dependsOn).toEqual([a!.id]);
    expect(c!.dependsOn).toEqual([a!.id]);
    expect([...d!.dependsOn].sort()).toEqual([b!.id, c!.id].sort());
    expect(a!.assignedUserId).toBe(techId);

    const wages = (await expert.get(`/cases/${caseId}/wages`)).body as { taskId: string; wageRial: number | null }[];
    expect(wages.find((w) => w.taskId === a!.id)?.wageRial).toBe(12_000_000);

    // A later addition continues after the open tail of the plan.
    const more = await expert.post(`/cases/${caseId}/repair-plan/steps`, { steps: [{ departmentId: paint, days: 1, title: 'پولیش' }] });
    expect(more.status).toBe(201);
    expect(more.body[0].dependsOn).toEqual([d!.id]);
  });

  it('rejects a wage without a person and a wage from someone without wage.manage', async () => {
    const caseId = await newCase();
    const noPerson = await expert.post(`/cases/${caseId}/repair-plan/steps`, { steps: [{ departmentId: body, days: 1, wageRial: 1_000 }] });
    expect(noPerson.status).toBe(400);
    expect((await manager.post(`/cases/${caseId}/repair-plan/steps`, { steps: [{ departmentId: body, days: 1 }] })).status).toBe(403);
    expect((await tech.post(`/cases/${caseId}/repair-plan/steps`, { steps: [{ departmentId: body, days: 1 }] })).status).toBe(403);
    // Nothing was written by the failed calls.
    expect((await expert.get(`/cases/${caseId}`)).body.tasks ?? []).toHaveLength(0);
  });
});
