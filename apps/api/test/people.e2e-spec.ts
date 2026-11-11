import { and, eq } from 'drizzle-orm';
import { jalaliMonthKey } from '@manage/shared';
import { newId } from '../src/common/ids';
import { caseResponsibilityPeriods, reminderRecipients, technicianWages, tenants, users } from '../src/db/schema';
import { RemindersService } from '../src/people/reminders.service';
import { createHarness, daysAgo, type Client, type Harness } from './harness';

// Phase 3: reminders between desks, technician wages and monthly work,
// case responsibility periods, owner and system-admin boundary.
let h: Harness;
let coordA: Client, coordB: Client, coordC: Client, coordD: Client, tech: Client, techB: Client, parts: Client, manager: Client, admin: Client;
let coordAId: string, coordCId: string, coordDId: string, techId: string, techBId: string, partsId: string, adminId: string;
let body: string, paint: string;
let vin = 0;

const idOf = async (username: string) => (await h.db.db.select({ id: users.id }).from(users).where(eq(users.username, username)))[0]!.id;

async function newCase(by: Client, coverageType: string, responsibleUserId?: string, admittedAt = new Date().toISOString()) {
  vin += 1;
  const res = await by.post('/cases', {
    vehicle: { model: 'خودرو آزمون فاز سه', plate: `۱${vin} ب ۳۴۵ - ۶۷`, vin: `TESTVIN3000${String(vin).padStart(6, '0')}` },
    customer: { fullName: 'مشتری آزمون فاز سه', phone: `0900300${String(vin).padStart(4, '0')}` },
    admittedAt,
    coverageType,
    ...(responsibleUserId ? { responsibleUserId } : {}),
  });
  expect(res.status).toBe(201);
  return res.body as { id: string; version: number };
}

/** A job of the technician: started and finished by the technician, approved by the coordinator. */
async function job(caseId: string, title: string, options: { approve?: boolean; by?: Client; worker?: Client; workerId?: string; departmentId?: string } = {}) {
  const by = options.by ?? coordA;
  const worker = options.worker ?? tech;
  const created = await by.post(`/cases/${caseId}/tasks`, { departmentId: options.departmentId ?? body, assignedUserId: options.workerId ?? techId, title });
  expect(created.status).toBe(201);
  const id = created.body.id as string;
  expect((await worker.post(`/workshop/my-tasks/${id}/actions`, { action: 'start', expectedVersion: 1 })).status).toBe(201);
  expect((await worker.post(`/workshop/my-tasks/${id}/actions`, { action: 'complete', expectedVersion: 2 })).status).toBe(201);
  let approvedAt: string | null = null;
  if (options.approve !== false) {
    const approved = await by.post(`/tasks/${id}/actions`, { action: 'approve', expectedVersion: 3 });
    expect(approved.status).toBe(201);
    approvedAt = approved.body.approvedAt;
  }
  return { id, approvedAt };
}

beforeAll(async () => {
  h = await createHarness({ config: { DAILY_SCHEDULER: 'false' } });
  [coordA, coordB, coordC, coordD, tech, techB] = await Promise.all([
    h.loginAs('p3-coord-a', ['accident_expert']),
    h.loginAs('p3-coord-b', ['accident_expert']),
    h.loginAs('p3-coord-c', ['accident_expert']),
    h.loginAs('p3-coord-d', ['accident_expert']),
    h.loginAs('p3-tech-a', ['technician']),
    h.loginAs('p3-tech-b', ['technician']),
  ]);
  [parts, manager, admin] = await Promise.all([h.login('parts'), h.login('manager'), h.login('admin')]);
  [coordAId, coordCId, coordDId, techId, techBId, partsId, adminId] = await Promise.all(
    ['p3-coord-a', 'p3-coord-c', 'p3-coord-d', 'p3-tech-a', 'p3-tech-b', 'parts', 'admin'].map(idOf),
  );
  const departments = (await coordA.get('/departments')).body as { id: string; code: string }[];
  body = departments.find((d) => d.code === 'body')!.id;
  paint = departments.find((d) => d.code === 'paint')!.id;
});
afterAll(async () => {
  jest.useRealTimers();
  await h?.close();
});

describe('reminders between desks', () => {
  let caseId: string, taskId: string;
  beforeAll(async () => {
    caseId = (await newCase(coordA, 'golden_card', coordAId)).id;
    taskId = (await job(caseId, 'صافکاری درب آزمون تذکر', { approve: false })).id;
  });

  it('goes to one person, to several people and to a role, never to the sender', async () => {
    const one = await coordA.post('/reminders', { userIds: [techId], caseId, body: 'لطفاً امروز پیگیری کن.', urgency: 'urgent' });
    expect(one.status).toBe(201);
    expect(one.body.recipients).toBe(1);
    const card = (await tech.get('/reminders/inbox')).body.find((r: { reminderId: string }) => r.reminderId === one.body.id);
    expect(card).toMatchObject({ body: 'لطفاً امروز پیگیری کن.', urgency: 'urgent', status: 'sent', case: { id: caseId } });
    expect(card.sender.displayName).toBe('کاربر آزمون p3-coord-a');
    expect(card.plate).toBeTruthy();

    const several = await coordA.post('/reminders', { userIds: [techId, partsId, coordAId], body: 'وضعیت این خودرو را به‌روز کن.' });
    expect(several.body.recipients).toBe(2);

    const role = await coordA.post('/reminders', { role: 'parts_clerk', body: 'قطعه آماده است؛ تحویل بگیر.' });
    expect(role.status).toBe(201);
    expect(role.body.recipients).toBe(1);
    const sent = (await coordA.get('/reminders')).body.sent.find((s: { id: string }) => s.id === role.body.id);
    expect(sent.targetRole).toBe('parts_clerk');
    expect(sent.recipients.map((r: { userId: string }) => r.userId)).toEqual([partsId]);

    expect((await coordA.post('/reminders', { userIds: [coordAId], body: 'به خودم' })).body.code).toBe('NO_RECIPIENTS');
    expect((await coordA.post('/reminders', { body: 'بدون گیرنده' })).status).toBe(400);
    expect((await coordA.post('/reminders', { userIds: [techId], body: 'ب'.repeat(301) })).status).toBe(400);
  });

  it('records seen, done and a one-line reply that the sender can see', async () => {
    const sent = await parts.post('/reminders', { userIds: [coordAId], body: 'مشتری منتظر است؛ زمان تحویل را مشخص کن.' });
    const card = (await coordA.get('/reminders/inbox')).body.find((r: { reminderId: string }) => r.reminderId === sent.body.id);
    const seen = await coordA.post(`/reminders/${card.id}/respond`, { action: 'seen', expectedVersion: card.version });
    expect(seen.status).toBe(201);
    expect(seen.body.status).toBe('seen');
    expect((await coordA.post(`/reminders/${card.id}/respond`, { action: 'seen', expectedVersion: card.version })).status).toBe(409);
    const replied = await coordA.post(`/reminders/${card.id}/respond`, { action: 'reply', reply: 'فردا ساعت ۱۰ آماده است', expectedVersion: seen.body.version });
    expect(replied.body.reply).toBe('فردا ساعت ۱۰ آماده است');
    const done = await coordA.post(`/reminders/${card.id}/respond`, { action: 'done', expectedVersion: replied.body.version });
    expect(done.body.status).toBe('done');
    expect((await coordA.get('/reminders/inbox')).body.some((r: { id: string }) => r.id === card.id)).toBe(false);
    const mine = (await parts.get('/reminders')).body.sent.find((s: { id: string }) => s.id === sent.body.id);
    expect(mine.recipients[0]).toMatchObject({ userId: coordAId, status: 'done', reply: 'فردا ساعت ۱۰ آماده است' });
    expect(mine.recipients[0].seenAt).toBeTruthy();
    // Only the recipient answers.
    expect((await parts.post(`/reminders/${card.id}/respond`, { action: 'seen', expectedVersion: done.body.version })).status).toBe(404);
  });

  it('sends one notification when a reminder is still unseen after two working hours', async () => {
    // Saturday 12:00 Tehran: 60 minutes until the 13:00 break, then 60 more from 15:30.
    const tehranToday = new Date(Date.now() + 210 * 60_000);
    const saturday = new Date(Date.UTC(tehranToday.getUTCFullYear(), tehranToday.getUTCMonth(), tehranToday.getUTCDate()));
    do saturday.setUTCDate(saturday.getUTCDate() - 1);
    while (saturday.getUTCDay() !== 6);
    const sentAt = new Date(saturday.getTime() + 12 * 3_600_000 - 210 * 60_000);
    jest.useFakeTimers({ now: sentAt, doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'queueMicrotask', 'nextTick', 'hrtime', 'performance'] });
    let unseen = '';
    let early = '';
    try {
      unseen = (await coordB.post('/reminders', { userIds: [techBId], body: 'وضعیت این خودرو را به‌روز کن.' })).body.id;
      early = (await coordB.post('/reminders', { userIds: [techBId], body: 'لطفاً امروز پیگیری کن.' })).body.id;
    } finally {
      jest.useRealTimers();
    }
    const [row] = await h.db.db.select().from(reminderRecipients).where(eq(reminderRecipients.reminderId, unseen));
    expect(row!.remindAt.toISOString()).toBe(new Date(sentAt.getTime() + 4.5 * 3_600_000).toISOString());
    const earlyCard = (await techB.get('/reminders/inbox')).body.find((r: { reminderId: string }) => r.reminderId === early);
    expect(earlyCard.overdue).toBe(true);
    await techB.post(`/reminders/${earlyCard.id}/respond`, { action: 'seen', expectedVersion: earlyCard.version });

    const service = h.app.get(RemindersService);
    const before = (await techB.get('/notifications')).body.items.length;
    expect((await service.tick(new Date(sentAt.getTime() + 4.5 * 3_600_000 - 60_000))).nudged).toBe(0);
    expect((await service.tick(new Date(sentAt.getTime() + 4.5 * 3_600_000 + 60_000))).nudged).toBe(1);
    expect((await service.tick(new Date(sentAt.getTime() + 5 * 3_600_000))).nudged).toBe(0);
    const inbox = (await techB.get('/notifications')).body.items;
    expect(inbox.length).toBe(before + 1);
    expect(inbox[0]).toMatchObject({ kind: 'reminder_unseen', link: '/reminders' });
  });

  it('sends the technician\'s ready-made problem to the accident responsible of that case', async () => {
    const res = await tech.post(`/workshop/my-tasks/${taskId}/problem`, { problem: 'no_part' });
    expect(res.status).toBe(201);
    const card = (await coordA.get('/reminders/inbox')).body.find((r: { reminderId: string }) => r.reminderId === res.body.id);
    expect(card).toMatchObject({ urgency: 'urgent', source: 'technician_problem', case: { id: caseId } });
    expect(card.body).toContain('قطعه ندارم');
    expect((await coordB.get('/reminders/inbox')).body.some((r: { reminderId: string }) => r.reminderId === res.body.id)).toBe(false);
    expect((await techB.post(`/workshop/my-tasks/${taskId}/problem`, { problem: 'part_late' })).status).toBe(403);
    expect((await tech.post(`/workshop/my-tasks/${taskId}/problem`, { problem: 'unknown' })).status).toBe(400);
    // A technician attaches only a case of their own job.
    const other = await newCase(coordA, 'personal', coordAId);
    expect((await techB.post('/reminders', { userIds: [coordAId], caseId: other.id, body: 'پروندهٔ دیگری' })).status).toBe(403);
    expect((await tech.post('/reminders', { userIds: [coordAId], caseId, body: 'ابزار یا جایگاه ندارم' })).status).toBe(201);
  });

  it('never reaches another dealership', async () => {
    const otherTenant = newId();
    const otherUser = newId();
    await h.db.db.insert(tenants).values({ id: otherTenant, code: 'p3-other', name: 'نمایندگی آزمون دیگر', isTest: true });
    await h.db.db.insert(users).values({ id: otherUser, tenantId: otherTenant, username: 'p3-other-parts', displayName: 'قطعات آزمون دیگر', roles: ['parts_clerk'], passwordHash: 'synthetic-not-a-password', isTest: true });
    const direct = await coordA.post('/reminders', { userIds: [otherUser], body: 'نباید برسد' });
    expect(direct.status).toBe(422);
    expect(direct.body.code).toBe('INVALID_RECIPIENT');
    const byRole = await coordA.post('/reminders', { role: 'parts_clerk', body: 'فقط همین نمایندگی' });
    expect(byRole.body.recipients).toBe(1);
    expect(await h.db.db.select().from(reminderRecipients).where(eq(reminderRecipients.userId, otherUser))).toHaveLength(0);
  });
});

describe('technician wage and monthly work', () => {
  let golden: string, personal: string, insurance: string;
  let a: { id: string; approvedAt: string | null }, b: { id: string; approvedAt: string | null }, c: { id: string; approvedAt: string | null };
  let pending: string, unpaid: string, otherTech: string;
  beforeAll(async () => {
    golden = (await newCase(coordA, 'golden_card', coordAId)).id;
    personal = (await newCase(coordA, 'personal', coordAId)).id;
    insurance = (await newCase(coordA, 'insurance', coordAId)).id;
    // Assessment labour for body work on the golden-card case: 18,000,000 Rial.
    const assessment = (await coordA.post(`/cases/${golden}/assessments`, { kind: 'initial', assessorName: 'کارشناس آزمون' })).body;
    const item = await coordA.post(`/assessments/${assessment.id}/items`, { expectedVersion: assessment.version, action: 'repair', description: 'صافکاری گلگیر آزمون', labourDepartmentId: body, labourRial: 18_000_000 });
    expect(item.status).toBe(201);
    a = await job(golden, 'صافکاری گلگیر');
    b = await job(personal, 'صافکاری سپر');
    c = await job(insurance, 'نقاشی درب', { departmentId: paint });
    pending = (await job(personal, 'کار تأییدنشده', { approve: false })).id;
    unpaid = (await job(insurance, 'کار تأییدشده بی‌اجرت')).id;
    otherTech = (await job(golden, 'کار تعمیرکار دیگر', { worker: techB, workerId: techBId })).id;
  });

  it('is recorded per job by the coordinator, independent from the assessment labour, with a reason for each change', async () => {
    const rows = (await coordA.get(`/cases/${golden}/wages`)).body;
    const first = rows.find((r: { taskId: string }) => r.taskId === a.id);
    // Two body jobs on the case share the assessment labour equally.
    expect(first).toMatchObject({ wageRial: null, version: 0, expertShareRial: 9_000_000, technician: { id: techId } });
    expect((await coordA.put(`/tasks/${a.id}/wage`, { amountRial: 9_000_000, expectedVersion: 0 })).status).toBe(200);
    const change = await coordA.put(`/tasks/${a.id}/wage`, { amountRial: 45_000_000, expectedVersion: 1 });
    expect(change.body.code).toBe('WAGE_REASON_REQUIRED');
    expect((await coordA.put(`/tasks/${a.id}/wage`, { amountRial: 45_000_000, expectedVersion: 0, reason: 'x' })).status).toBe(409);
    const changed = await coordA.put(`/tasks/${a.id}/wage`, { amountRial: 45_000_000, expectedVersion: 1, reason: 'توافق تازه با تعمیرکار' });
    expect(changed.status).toBe(200);
    expect(changed.body.find((r: { taskId: string }) => r.taskId === a.id)).toMatchObject({ wageRial: 45_000_000, version: 2, reason: 'توافق تازه با تعمیرکار' });
    const history = (await coordA.get(`/tasks/${a.id}/wage-history`)).body;
    expect(history.map((x: { afterRial: number }) => x.afterRial)).toEqual([45_000_000, 9_000_000]);
    expect(history[0]).toMatchObject({ beforeRial: 9_000_000, reason: 'توافق تازه با تعمیرکار' });
    for (const [id, amount] of [[b.id, 30_000_000], [c.id, 20_000_000], [pending, 70_000_000], [otherTech, 11_000_000]] as const) {
      expect((await coordA.put(`/tasks/${id}/wage`, { amountRial: amount, expectedVersion: 0 })).status).toBe(200);
    }
    expect((await parts.put(`/tasks/${b.id}/wage`, { amountRial: 1, expectedVersion: 1 })).status).toBe(403);
  });

  it('counts in the monthly work only after the coordinator approved the job, with totals per coverage', async () => {
    const month = jalaliMonthKey(new Date(a.approvedAt!));
    const work = (await tech.get(`/workshop/my-work?month=${month}`)).body;
    const ids = work.rows.map((r: { taskId: string }) => r.taskId);
    expect(ids).toEqual(expect.arrayContaining([a.id, b.id, c.id, unpaid]));
    expect(ids).not.toContain(pending);
    expect(ids).not.toContain(otherTech);
    const sameMonth = [a, b, c].filter((x) => jalaliMonthKey(new Date(x.approvedAt!)) === month);
    expect(sameMonth).toHaveLength(3);
    expect(work.byCoverage).toEqual({ golden_card: 45_000_000, insurance: 20_000_000, personal: 30_000_000, other: 0 });
    expect(work.totalRial).toBe(95_000_000);
    expect(work.missingWage).toBe(1);
    expect(Object.keys(work.rows[0]).sort()).toEqual(['approvedAt', 'coverage', 'plate', 'taskId', 'title', 'vehicleLabel', 'wageRial']);
    expect((await tech.get('/workshop/my-work?month=1405-13')).status).toBe(422);
    // Reopening takes the job out of the month until it is approved again.
    const task = (await coordA.get(`/cases/${personal}`)).body.tasks.find((t: { id: string }) => t.id === b.id);
    expect((await coordA.post(`/tasks/${b.id}/actions`, { action: 'reopen', expectedVersion: task.version, note: 'اصلاح پس از بازدید' })).status).toBe(201);
    const after = (await tech.get(`/workshop/my-work?month=${month}`)).body;
    expect(after.rows.map((r: { taskId: string }) => r.taskId)).not.toContain(b.id);
    expect(after.byCoverage.personal).toBe(0);
  });

  it('shows the technician only their own wage, and the "changed" label after a change they saw', async () => {
    let card = (await tech.get('/workshop/my-tasks')).body.find((t: { id: string }) => t.id === a.id);
    expect(card.wage).toEqual({ amountRial: 45_000_000, seen: false, changed: false, previousRial: null, version: 2 });
    expect((await tech.post(`/workshop/my-tasks/${a.id}/wage-seen`, { expectedVersion: 2 })).body.seen).toBe(true);
    expect((await techB.post(`/workshop/my-tasks/${a.id}/wage-seen`, { expectedVersion: 2 })).status).toBe(404);
    await coordA.put(`/tasks/${a.id}/wage`, { amountRial: 48_000_000, expectedVersion: 2, reason: 'اضافه‌کار صافکاری' });
    card = (await tech.get('/workshop/my-tasks')).body.find((t: { id: string }) => t.id === a.id);
    expect(card.wage).toMatchObject({ amountRial: 48_000_000, changed: true, previousRial: 45_000_000 });
    const mine = JSON.stringify((await tech.get('/workshop/my-tasks')).body);
    expect(mine).not.toContain('18000000');
    expect(mine).not.toContain('9000000');
    expect(mine).not.toContain('11000000');
    expect(JSON.stringify((await techB.get('/workshop/my-tasks')).body)).not.toContain('48000000');
  });

  it('keeps assessment amounts and other people\'s wages away from technicians at the API', async () => {
    expect((await tech.get(`/cases/${golden}/wages`)).status).toBe(403);
    expect((await tech.get(`/tasks/${a.id}/wage-history`)).status).toBe(403);
    expect((await tech.get('/reports/wages')).status).toBe(403);
    expect((await tech.get('/reports/wages/export')).status).toBe(403);
    expect((await tech.put(`/tasks/${a.id}/wage`, { amountRial: 1, expectedVersion: 3 })).status).toBe(403);
    expect((await tech.get(`/cases/${golden}`)).status).toBe(403);
  });

  it('gives the service manager paid wages against assessment labour per technician, with Excel', async () => {
    const month = jalaliMonthKey(new Date(a.approvedAt!));
    const report = await manager.get(`/reports/wages?month=${month}`);
    expect(report.status).toBe(200);
    const mine = report.body.rows.find((r: { technician: { id: string } }) => r.technician.id === techId);
    expect(mine).toMatchObject({ paidRial: 48_000_000 + 20_000_000, expertRial: 9_000_000, missingWage: 1 });
    expect(mine.differenceRial).toBe(mine.paidRial - mine.expertRial);
    const xlsx = await manager.get(`/reports/wages/export?month=${month}`);
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    // The system administrator may act for any role (spec section 3), wages included.
    expect((await admin.get('/reports/wages')).status).toBe(200);
    expect((await admin.get(`/cases/${golden}/wages`)).status).toBe(200);
    expect(await h.db.db.select().from(technicianWages).where(eq(technicianWages.taskId, a.id))).toHaveLength(1);
  });
});

describe('case responsibility periods', () => {
  it('closes and opens periods on transfer and attributes statistics to each period', async () => {
    const kase = await newCase(coordC, 'golden_card', coordCId, daysAgo(1));
    let periods = (await coordC.get(`/cases/${kase.id}/responsibility`)).body;
    expect(periods).toHaveLength(1);
    expect(periods[0]).toMatchObject({ userId: coordCId, endedAt: null, derived: false });
    const before = await job(kase.id, 'کار پیش از انتقال', { by: coordC });

    expect((await coordC.post(`/cases/${kase.id}/transfer`, { toUserId: coordCId, expectedVersion: (await coordC.get(`/cases/${kase.id}`)).body.version })).body.code).toBe('SAME_RESPONSIBLE');
    const version = (await coordC.get(`/cases/${kase.id}`)).body.version;
    expect((await coordC.post(`/cases/${kase.id}/transfer`, { toUserId: techId, expectedVersion: version })).body.code).toBe('INVALID_RESPONSIBLE');
    expect((await coordC.post(`/cases/${kase.id}/transfer`, { toUserId: adminId, expectedVersion: version })).body.code).toBe('INVALID_RESPONSIBLE');
    expect((await tech.post(`/cases/${kase.id}/transfer`, { toUserId: coordDId, expectedVersion: version })).status).toBe(403);
    const moved = await coordC.post(`/cases/${kase.id}/transfer`, { toUserId: coordDId, reason: 'مرخصی مسئول قبلی', expectedVersion: version });
    expect(moved.status).toBe(201);
    expect(moved.body.responsible.id).toBe(coordDId);

    periods = (await coordD.get(`/cases/${kase.id}/responsibility`)).body;
    expect(periods.map((p: { userId: string }) => p.userId)).toEqual([coordCId, coordDId]);
    expect(periods[0].endedAt).toBe(periods[1].startedAt);
    expect(periods[1]).toMatchObject({ endedAt: null, reason: 'مرخصی مسئول قبلی' });
    const timeline = (await coordD.get(`/cases/${kase.id}/timeline`)).body;
    expect(timeline.some((e: { action: string; reason: string }) => e.action === 'case.transferred' && e.reason === 'مرخصی مسئول قبلی')).toBe(true);

    const after = await job(kase.id, 'کار پس از انتقال', { by: coordD });
    const month = jalaliMonthKey(new Date(after.approvedAt!));
    expect(jalaliMonthKey(new Date(before.approvedAt!))).toBe(month);
    const report = (await manager.get(`/reports/responsibility?month=${month}`)).body;
    const c = report.rows.find((r: { user: { id: string } }) => r.user.id === coordCId);
    const d = report.rows.find((r: { user: { id: string } }) => r.user.id === coordDId);
    expect(c).toMatchObject({ cases: 1, approvedTasks: 1, delivered: 0 });
    expect(d).toMatchObject({ cases: 1, approvedTasks: 1, delivered: 0 });
    expect(c.heldDays + d.heldDays).toBeGreaterThan(0);
    expect((await coordC.get('/reports/responsibility')).status).toBe(403);
  });

  it('computes the first period of an existing case from its admission and keeps it when transferred', async () => {
    const admittedAt = daysAgo(2);
    const kase = await newCase(coordC, 'personal', coordCId, admittedAt);
    // A case recorded before periods existed has no rows.
    await h.db.db.delete(caseResponsibilityPeriods).where(eq(caseResponsibilityPeriods.caseId, kase.id));
    const derived = (await coordC.get(`/cases/${kase.id}/responsibility`)).body;
    expect(derived).toEqual([expect.objectContaining({ userId: coordCId, startedAt: new Date(admittedAt).toISOString(), endedAt: null, derived: true })]);
    const version = (await coordC.get(`/cases/${kase.id}`)).body.version;
    expect((await coordC.post(`/cases/${kase.id}/transfer`, { toUserId: coordDId, expectedVersion: version })).status).toBe(201);
    const rows = await h.db.db.select().from(caseResponsibilityPeriods).where(and(eq(caseResponsibilityPeriods.caseId, kase.id), eq(caseResponsibilityPeriods.userId, coordCId)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ origin: 'initial', startedAt: new Date(admittedAt) });
    expect(rows[0]!.endedAt).not.toBeNull();
  });
});

describe('owner and system administrator', () => {
  let owner: Client;
  beforeAll(async () => {
    owner = await h.loginAs('p3-owner', ['service_manager']);
    await h.db.db.update(users).set({ isOwner: true }).where(eq(users.username, 'p3-owner'));
  });

  it('lets only the owner take and give back "invite and deactivate staff" of a system administrator', async () => {
    expect((await admin.get('/access/system-admins')).status).toBe(403);
    let list = (await owner.get('/access/system-admins')).body;
    let entry = list.find((x: { id: string }) => x.id === adminId);
    expect(entry.canManageStaff).toBe(true);
    expect((await admin.get('/staff/technicians')).status).toBe(200);
    expect((await admin.put(`/access/users/${adminId}/staff-admin`, { granted: true, expectedVersion: entry.version })).status).toBe(403);

    list = (await owner.put(`/access/users/${adminId}/staff-admin`, { granted: false, expectedVersion: entry.version })).body;
    entry = list.find((x: { id: string }) => x.id === adminId);
    expect(entry.canManageStaff).toBe(false);
    expect((await admin.get('/staff/technicians')).status).toBe(403);
    expect((await admin.post('/auth/invitations', { email: 'p3-blocked@example.test', displayName: 'دعوت آزمون', roles: ['parts_clerk'] })).status).toBe(403);
    expect((await admin.get('/auth/me')).body.permissions).not.toContain('user.manage');
    expect((await owner.put(`/access/users/${adminId}/staff-admin`, { granted: true, expectedVersion: entry.version - 1 })).status).toBe(409);

    list = (await owner.put(`/access/users/${adminId}/staff-admin`, { granted: true, expectedVersion: entry.version })).body;
    expect(list.find((x: { id: string }) => x.id === adminId).canManageStaff).toBe(true);
    expect((await admin.get('/staff/technicians')).status).toBe(200);
    expect((await owner.put(`/access/users/${coordAId}/staff-admin`, { granted: true, expectedVersion: 1 })).body.code).toBe('NOT_SYSTEM_ADMIN');
  });

  it('needs a reason from the system administrator for corrections and shows them to the owner only', async () => {
    const kase = await newCase(coordA, 'personal', coordAId);
    let version = (await admin.get(`/cases/${kase.id}`)).body.version;
    // Filling an empty field is data entry, not a correction.
    const filled = await admin.patch(`/cases/${kase.id}`, { expectedVersion: version, damageDescription: 'ضربه به سپر عقب (آزمون)' });
    expect(filled.status).toBe(200);
    version = filled.body.version;
    const silent = await admin.patch(`/cases/${kase.id}`, { expectedVersion: version, damageDescription: 'ضربه به سپر و چراغ عقب (آزمون)' });
    expect(silent.body.code).toBe('SUPPORT_REASON_REQUIRED');
    const corrected = await admin.patch(`/cases/${kase.id}`, { expectedVersion: version, damageDescription: 'ضربه به سپر و چراغ عقب (آزمون)', reason: 'اشتباه تایپی همکار پذیرش' });
    expect(corrected.status).toBe(200);
    // The coordinator corrects without the support rule.
    expect((await coordA.patch(`/cases/${kase.id}`, { expectedVersion: corrected.body.version, damageDescription: 'ضربه به سپر عقب' })).status).toBe(200);

    const report = await owner.get(`/access/admin-actions?month=${jalaliMonthKey()}`);
    expect(report.status).toBe(200);
    const row = report.body.rows.find((r: { action: string; reason: string | null }) => r.action === 'case.updated' && r.reason === 'اشتباه تایپی همکار پذیرش');
    expect(row).toMatchObject({ actor: { id: adminId }, actionLabel: 'ویرایش پرونده', caseId: kase.id });
    expect(report.body.rows.every((r: { actor: { id: string } }) => r.actor.id === adminId)).toBe(true);
    expect(report.body.rows.some((r: { action: string }) => r.action.startsWith('auth.'))).toBe(false);
    for (const client of [admin, manager, coordA, tech]) expect((await client.get('/access/admin-actions')).status).toBe(403);
  });
});
