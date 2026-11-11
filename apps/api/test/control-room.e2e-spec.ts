import { eq } from 'drizzle-orm';
import { DailyTasksService } from '../src/daily-reports/daily-tasks.service';
import { notifications, users } from '../src/db/schema';
import { createHarness, type Client, type Harness } from './harness';

// Package 7 — control room (spec §10) and time-based alerts of spec §9.
let h: Harness;
let expert: Client, tech: Client, manager: Client;
let techId: string, expertId: string, body: string;

beforeAll(async () => {
  h = await createHarness({ config: { DAILY_SCHEDULER: 'false' } });
  [expert, tech] = await Promise.all([h.loginAs('p7-expert', ['accident_expert']), h.loginAs('p7-tech', ['technician'])]);
  manager = await h.login('manager');
  const id = async (u: string) => (await h.db.db.select({ id: users.id }).from(users).where(eq(users.username, u)))[0]!.id;
  [techId, expertId] = await Promise.all([id('p7-tech'), id('p7-expert')]);
  body = ((await expert.get('/departments')).body as { id: string; code: string }[]).find((d) => d.code === 'body')!.id;
});
afterAll(async () => h?.close());

it('shows four numbers, the funnel, the map, analysis, people and unanswered alerts, read-only', async () => {
  const created = await expert.post('/cases', {
    vehicle: { model: 'دنا پلاس', plate: '۵۲ م ۹۰۷ - ۱۶', vin: 'TESTVIN7000000001' },
    customer: { fullName: 'مشتری آزمون اتاق کنترل', phone: '09007000001' },
    admittedAt: new Date(Date.now() - 4 * 86_400_000).toISOString(),
    coverageType: 'golden_card',
    responsibleUserId: expertId,
  });
  const caseId = created.body.id as string;
  const plan = await expert.post(`/cases/${caseId}/repair-plan/steps`, { steps: [{ departmentId: body, assignedUserId: techId, days: 1, title: 'جلوبندی' }] });
  const taskId = plan.body[0].id as string;
  expect((await tech.post(`/workshop/my-tasks/${taskId}/actions`, { action: 'start', expectedVersion: 1 })).status).toBe(201);
  expect((await tech.post(`/workshop/my-tasks/${taskId}/problem`, { problem: 'no_part' })).status).toBe(201);

  const res = await manager.get('/control-room?range=week');
  expect(res.status).toBe(200);
  const room = res.body;
  expect(room.range).toBe('week');
  expect(room.kpis.inShop).toBeGreaterThanOrEqual(1);
  expect(room.funnel).toHaveLength(5);
  expect(room.funnel.filter((s: { bottleneck: boolean }) => s.bottleneck)).toHaveLength(1);
  expect(room.analysis.length).toBeGreaterThanOrEqual(1);
  expect(room.analysis.length).toBeLessThanOrEqual(5);
  const problem = room.alerts.find((a: { kind: string; caseId: string }) => a.kind === 'technician_problem' && a.caseId === caseId);
  expect(problem).toMatchObject({ vehicle: 'دنا پلاس', recipient: 'مسئول قطعات، کارشناس' });
  expect(problem.recipientUserIds).toContain(expertId);
  // The alert table names the file, so the manager can find it without opening the map.
  expect(problem.caseNumber).toMatch(/^AC-\d{4}-\d{4}$/);
  expect(room.people.some((p: { userId: string; open: number }) => p.userId === expertId && p.open >= 1)).toBe(true);
  // Oldest first.
  const waits = room.alerts.map((a: { waitingHours: number }) => a.waitingHours);
  expect([...waits].sort((a, b) => b - a)).toEqual(waits);

  expect((await expert.get('/control-room')).status).toBe(403);
  expect((await tech.get('/control-room')).status).toBe(403);
  expect((await manager.get('/control-room?range=year')).status).toBe(400);
});

it('sends «عقب‌تر از برنامه» once to the expert and the technician', async () => {
  const created = await expert.post('/cases', {
    vehicle: { model: 'تارا', plate: '۶۸ د ۱۹۳ - ۱۶', vin: 'TESTVIN7000000002' },
    customer: { fullName: 'مشتری آزمون تأخیر', phone: '09007000002' },
    admittedAt: new Date(Date.now() - 6 * 86_400_000).toISOString(),
    coverageType: 'personal',
    responsibleUserId: expertId,
  });
  const plan = await expert.post(`/cases/${created.body.id}/repair-plan/steps`, { steps: [{ departmentId: body, assignedUserId: techId, days: 1 }] });
  expect(plan.status).toBe(201);
  const svc = h.app.get(DailyTasksService);
  // Two working weeks later the one-day step is certainly past its planned end.
  const later = new Date(Date.now() + 14 * 86_400_000);
  later.setUTCHours(7, 0, 0, 0);
  while ([4, 5].includes(new Date(later.getTime() + 210 * 60_000).getUTCDay())) later.setTime(later.getTime() + 86_400_000);
  await svc.sweepAlerts(later);
  await svc.sweepAlerts(later);
  const sent = (await h.db.db.select().from(notifications)).filter((n) => n.kind === 'behind_schedule' && n.link === `/cases/${created.body.id}#case-tasks`);
  expect(new Set(sent.map((n) => n.userId))).toEqual(new Set([expertId, techId]));
});

it('a reminder can point to one part line of its own car only', async () => {
  const created = await expert.post('/cases', {
    vehicle: { model: 'سورن پلاس', plate: '۴۷ ج ۸۱۲ - ۱۶', vin: 'TESTVIN7000000003' },
    customer: { fullName: 'مشتری آزمون تذکر قطعه', phone: '09007000003' },
    admittedAt: new Date().toISOString(),
    coverageType: 'personal',
  });
  const caseId = created.body.id as string;
  const part = await expert.post(`/cases/${caseId}/parts`, { description: 'گلگیر جلو آزمون', partNumber: '87654321', quantity: 1, source: 'stock' });
  expect(part.status).toBe(201);
  const sent = await manager.post('/reminders', { userIds: [expertId], caseId, partId: part.body.id, body: 'قطعهٔ این خودرو را پیگیری کن.' });
  expect(sent.status).toBe(201);
  const card = (await expert.get('/reminders/inbox')).body.find((r: { reminderId: string }) => r.reminderId === sent.body.id);
  expect(card.part).toEqual({ id: part.body.id, description: 'گلگیر جلو آزمون' });
  expect((await manager.post('/reminders', { userIds: [expertId], partId: part.body.id, body: 'بدون خودرو' })).status).toBe(400);
  const other = await expert.post('/cases', {
    vehicle: { model: 'تارا', plate: '۱۱ ب ۱۱۱ - ۱۱', vin: 'TESTVIN7000000004' },
    customer: { fullName: 'مشتری آزمون دیگر', phone: '09007000004' },
    admittedAt: new Date().toISOString(),
    coverageType: 'personal',
  });
  expect((await manager.post('/reminders', { userIds: [expertId], caseId: other.body.id, partId: part.body.id, body: 'قطعهٔ خودروی دیگر' })).body.code).toBe('INVALID_PART');
});
