import { sql } from 'drizzle-orm';
import request from 'supertest';
import type { CaseDetail, Department, Task } from '@manage/shared';
import { newId } from '../src/common/ids';
import { hashPassword } from '../src/auth/password';
import { departments, tenants, users } from '../src/db/schema';
import { purgeTestTenants } from '../src/demo/demo-reset';
import { Client, createHarness, daysAgo, daysAhead, type Harness, TEST_PASSWORD } from './harness';

let h: Harness;
let expert: Client;
let supervisor: Client;
let manager: Client;
let parts: Client;
let admin: Client;
let depts: Department[];
let supervisorId: string;

const dept = (code: string) => depts.find((d) => d.code === code)!.id;

async function newCase(body: object = {}): Promise<CaseDetail> {
  const res = await expert.post('/cases', {
    customer: { fullName: 'مشتری آزمون', phone: '09000001111' },
    vehicle: { brand: 'ایران‌خودرو', model: 'دنا', plate: '۱۲ ب ۳۴۵ - ۶۷', vin: `TESTVIN${Date.now()}`.slice(0, 17) },
    odometerKm: 1000,
    admittedAt: daysAgo(1),
    damageDescription: 'آزمون',
    coverageType: 'personal',
    responsibleUserId: supervisorId,
    ...body,
  });
  expect(res.status).toBe(201);
  return res.body;
}

async function addTask(caseId: string, body: object): Promise<Task> {
  const res = await supervisor.post(`/cases/${caseId}/tasks`, body);
  expect(res.status).toBe(201);
  return res.body;
}

async function act(task: Task, action: string, extra: object = {}) {
  return supervisor.post(`/tasks/${task.id}/actions`, { action, expectedVersion: task.version, ...extra });
}

beforeAll(async () => {
  h = await createHarness();
  [expert, supervisor, manager, parts, admin] = await Promise.all(
    ['expert', 'supervisor', 'manager', 'parts', 'admin'].map((u) => h.login(u)),
  );
  depts = (await supervisor.get('/departments')).body;
  const assignable = (await expert.get('/users/assignable')).body as { id: string; displayName: string }[];
  supervisorId = assignable.find((u) => u.displayName === 'سرپرست نمونه')!.id;
});

afterAll(async () => {
  await h?.close();
});

describe('authentication and HTTP hardening', () => {
  it('rejects requests without a session', async () => {
    const res = await request(h.app.getHttpServer()).get('/api/v1/cases');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('answers malformed JSON with 400, not an internal error', async () => {
    const res = await request(h.app.getHttpServer())
      .post('/api/v1/cases')
      .set('Cookie', expert.cookie)
      .set('x-manage-client', 'test')
      .set('content-type', 'application/json')
      .send('{"admittedAt": ');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_BODY');
  });

  it('rejects state-changing requests without the client header (CSRF)', async () => {
    const res = await request(h.app.getHttpServer())
      .post('/api/v1/cases')
      .set('Cookie', expert.cookie)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF_HEADER_MISSING');
  });

  it('rejects a wrong password with a generic message and locks after repeated failures', async () => {
    const attempt = () =>
      request(h.app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('x-manage-client', 'test')
        .send({ username: 'qc', password: 'wrong' });
    for (let i = 0; i < 5; i++) expect((await attempt()).body.code).toBe('INVALID_CREDENTIALS');
    const locked = await request(h.app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('x-manage-client', 'test')
      .send({ username: 'qc', password: TEST_PASSWORD });
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');
  });

  it('returns the current user with permissions; logout revokes the session', async () => {
    const c = await h.login('parts');
    const me = await c.get('/auth/me');
    expect(me.body.roles).toEqual(['parts_clerk']);
    expect(me.body.permissions).toContain('case.read');
    expect(me.body.permissions).not.toContain('task.manage');
    await c.post('/auth/logout');
    expect((await c.get('/auth/me')).status).toBe(401);
  });

  it('health endpoint is public', async () => {
    const res = await request(h.app.getHttpServer()).get('/api/v1/health');
    expect(res.body).toMatchObject({ status: 'ok', db: 'ok', dbDriver: 'pglite' });
  });
});

describe('acceptance 1: create and search a case', () => {
  it('creates a case with a case number and finds it by plate, VIN, name, phone and number', async () => {
    const c = await newCase({
      customer: { fullName: 'علي كريمي آزمون', phone: '+98 900 000 2222' },
      vehicle: { model: 'تارا', plate: '۹۹ ق ۸۷۶ - ۵۴', vin: 'testvin0000000099' },
    });
    expect(c.caseNumber).toMatch(/^AC-\d{4}-\d{4}$/);
    expect(c.vehicle.vin).toBe('TESTVIN0000000099');
    expect(c.customer?.phone).toBe('09000002222');
    expect(c.missingFields).toEqual([]);

    for (const q of ['99ق87654', '۹۹ ق ۸۷۶', 'TESTVIN0000000099', 'علی کریمی', '09000002222', c.caseNumber]) {
      const res = await expert.get(`/cases?q=${encodeURIComponent(q)}`);
      expect(res.status).toBe(200);
      expect(res.body.items.map((i: { id: string }) => i.id)).toContain(c.id);
    }
  });

  it('keeps unknown fields empty and flags them as needing completion', async () => {
    const res = await expert.post('/cases', { admittedAt: daysAgo(0), coverageType: 'unknown' });
    expect(res.status).toBe(201);
    expect(res.body.customer).toBeNull();
    expect(res.body.missingFields).toEqual(
      expect.arrayContaining(['customer_name', 'customer_phone', 'vehicle_identity', 'responsible', 'coverage_type']),
    );
    const list = await expert.get('/cases?flag=needs_completion');
    expect(list.body.items.map((i: { id: string }) => i.id)).toContain(res.body.id);
  });

  it('rejects an admission time in the future', async () => {
    const res = await expert.post('/cases', { admittedAt: daysAhead(1), coverageType: 'personal' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('FUTURE_TIMESTAMP');
  });

  it('treats a second visit of the same VIN as a new case on the same vehicle', async () => {
    const first = await newCase({ vehicle: { model: 'رانا', vin: 'TESTVIN0000000777' } });
    const second = await newCase({ vehicle: { vin: 'TESTVIN0000000777', plate: '۱۰ ل ۱۰۰ - ۱۰' } });
    expect(second.id).not.toBe(first.id);
    expect(second.vehicle.id).toBe(first.vehicle.id);
    expect(second.vehicle.model).toBe('رانا');
  });
});

describe('acceptance 2: golden card with official deadline and part waiting', () => {
  it('keeps official deadline separate from forecast and requires a reason to change it', async () => {
    const c = await newCase({
      coverageType: 'golden_card',
      goldenCardFileNo: 'GC-T-1',
      officialDeadlineAt: daysAhead(5),
      forecastDeliveryAt: daysAhead(7),
    });
    expect(c.officialDeadlineAt).not.toBe(c.forecastDeliveryAt);

    const noReason = await expert.patch(`/cases/${c.id}`, {
      expectedVersion: c.version,
      officialDeadlineAt: daysAhead(9),
    });
    expect(noReason.body.code).toBe('REASON_REQUIRED');

    const forecastOnly = await expert.patch(`/cases/${c.id}`, {
      expectedVersion: c.version,
      forecastDeliveryAt: daysAhead(8),
    });
    expect(forecastOnly.status).toBe(200);
    expect(forecastOnly.body.officialDeadlineAt).toBe(c.officialDeadlineAt);

    const t = await addTask(c.id, { departmentId: dept('assembly'), title: 'تعویض چراغ' });
    const blocked = await supervisor.post(`/cases/${c.id}/blockers`, {
      reason: 'part_not_arrived',
      description: 'قطعه شرکت',
      taskId: t.id,
      occurredAt: daysAgo(1),
    });
    expect(blocked.status).toBe(201);
    const detail = (await supervisor.get(`/cases/${c.id}`)).body as CaseDetail;
    expect(detail.tasks[0]!.status).toBe('blocked');
    expect(detail.openBlockers).toBe(1);

    const dashboard = (await manager.get('/dashboard')).body;
    expect(dashboard.openBlockersByReason).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: 'part_not_arrived' })]),
    );
  });

  it('flags a golden card case without file number or official deadline', async () => {
    const c = await newCase({ coverageType: 'golden_card' });
    expect(c.missingFields).toEqual(expect.arrayContaining(['golden_card_file_no', 'official_deadline']));
  });
});

describe('acceptance 6: multiple departments, parallel and dependent work', () => {
  it('enforces dependencies, supports parallel work and weights progress', async () => {
    const c = await newCase({ stage: 'assessment' });
    const body = await addTask(c.id, { departmentId: dept('body'), technicianName: 'الف', weight: 3 });
    const elec = await addTask(c.id, { departmentId: dept('electrical'), technicianName: 'ب', weight: 1 });
    const paint = await addTask(c.id, {
      departmentId: dept('paint'),
      technicianName: 'ج',
      dependsOn: [body.id],
      weight: 2,
    });

    const early = await act(paint, 'start');
    expect(early.status).toBe(422);
    expect(early.body.code).toBe('DEPENDENCY_NOT_DONE');

    // Body and electrical run in parallel; first start moves the case into repair.
    const b1 = (await act(body, 'start', { at: daysAgo(1) })).body as Task;
    const e1 = (await act(elec, 'start')).body as Task;
    expect([b1.status, e1.status]).toEqual(['in_progress', 'in_progress']);
    expect((await supervisor.get(`/cases/${c.id}`)).body.stage).toBe('in_repair');

    const b2 = (await act(b1, 'complete')).body as Task;
    expect(b2.status).toBe('done');
    expect((await act(b2,'approve')).status).toBe(201);
    const p1 = await act(paint, 'start');
    expect(p1.status).toBe(201);

    const detail = (await supervisor.get(`/cases/${c.id}`)).body as CaseDetail;
    expect(detail.progressPercent).toBe(50); // 3 of 6 weight units done

    const cycle = await supervisor.patch(`/tasks/${body.id}`, {
      expectedVersion: b2.version+1,
      scheduleReason: 'آزمون چرخه وابستگی',
      dependsOn: [paint.id],
    });
    expect(cycle.body.code).toBe('DEPENDENCY_CYCLE');
  });

  it('rejects stale versions (concurrent edits)', async () => {
    const c = await newCase();
    const t = await addTask(c.id, { departmentId: dept('body') });
    expect((await act(t, 'start')).status).toBe(201);
    const stale = await act(t, 'complete'); // still version 1
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('VERSION_CONFLICT');
  });

  it('completion needs approval before delivery; reopen requires a reason', async () => {
    const c = await newCase();
    const t = await addTask(c.id, { departmentId: dept('paint') });
    let cur = (await act(t, 'start')).body as Task;
    cur = (await act(cur, 'complete')).body as Task;

    let kase = (await supervisor.get(`/cases/${c.id}`)).body as CaseDetail;
    const gate = await supervisor.post(`/cases/${c.id}/stage`, { stage: 'delivered', expectedVersion: kase.version });
    expect(gate.body.code).toBe('DELIVERY_GATE');

    expect((await act(cur, 'reopen')).status).toBe(400);
    cur = (await act(cur, 'approve')).body as Task;
    expect(cur.status).toBe('approved');
    expect(cur.approvedBy?.displayName).toBe('سرپرست نمونه');

    // Even with all work approved the stage selector cannot deliver or skip QC:
    // both go through QC, technical/financial close and handover (qc-delivery spec).
    kase = (await supervisor.get(`/cases/${c.id}`)).body;
    const delivered = await supervisor.post(`/cases/${c.id}/stage`, { stage: 'delivered', expectedVersion: kase.version });
    expect(delivered.body.code).toBe('DELIVERY_GATE');
    const ready = await supervisor.post(`/cases/${c.id}/stage`, { stage: 'ready_for_delivery', expectedVersion: kase.version });
    expect(ready.body.code).toBe('TECHNICAL_CLOSE_REQUIRED');
    expect(((await supervisor.get(`/cases/${c.id}`)).body as CaseDetail).actualDeliveryAt).toBeNull();
  });
});

describe('blockers: occurrence, follow-up and resolution timing', () => {
  it('resolving the last blocker returns the task to its previous state', async () => {
    const c = await newCase();
    const t = await addTask(c.id, { departmentId: dept('mechanical') });
    const started = (await act(t, 'start')).body as Task;
    const b = (
      await supervisor.post(`/cases/${c.id}/blockers`, {
        reason: 'technical_issue',
        taskId: t.id,
        expectedTaskVersion: started.version,
        occurredAt: daysAgo(2),
      })
    ).body;
    expect(new Date(b.recordedAt).getTime() - new Date(b.occurredAt).getTime()).toBeGreaterThan(86_400_000);

    const f = await supervisor.post(`/blockers/${b.id}/follow-up`, { note: 'پیگیری با واحد' });
    expect(f.body.followUpCount).toBe(1);

    expect((await supervisor.post(`/blockers/${b.id}/resolve`, {})).status).toBe(400);
    const r = await supervisor.post(`/blockers/${b.id}/resolve`, { note: 'رفع شد' });
    expect(r.body.resolvedBy.displayName).toBe('سرپرست نمونه');
    const task = (await supervisor.get(`/cases/${c.id}`)).body.tasks[0];
    expect(task.status).toBe('in_progress');
    expect((await supervisor.post(`/blockers/${b.id}/resolve`, { note: 'دوباره' })).body.code).toBe(
      'BLOCKER_RESOLVED',
    );
  });

  it('accepts minute-precision resolution times in the same minute the blocker occurred', async () => {
    const c = await newCase();
    const occurredAt = new Date();
    const b = (await supervisor.post(`/cases/${c.id}/blockers`, { reason: 'capacity', occurredAt: occurredAt.toISOString() }))
      .body;
    const sameMinute = new Date(Math.floor(occurredAt.getTime() / 60_000) * 60_000).toISOString();
    const r = await supervisor.post(`/blockers/${b.id}/resolve`, { note: 'رفع', at: sameMinute });
    expect(r.status).toBe(201);
    expect(new Date(r.body.resolvedAt).getTime()).toBeGreaterThanOrEqual(new Date(b.occurredAt).getTime());
    const earlier = new Date(occurredAt.getTime() - 5 * 60_000).toISOString();
    const b2 = (await supervisor.post(`/cases/${c.id}/blockers`, { reason: 'capacity', occurredAt: occurredAt.toISOString() }))
      .body;
    expect((await supervisor.post(`/blockers/${b2.id}/resolve`, { note: 'x', at: earlier })).body.code).toBe('INVALID_TIME');
  });

  it('records the full history in the case timeline', async () => {
    const c = await newCase();
    const t = await addTask(c.id, { departmentId: dept('body') });
    await act(t, 'start');
    const timeline = (await manager.get(`/cases/${c.id}/timeline`)).body as { action: string }[];
    expect(timeline.map((e) => e.action)).toEqual(
      expect.arrayContaining(['case.created', 'task.created', 'task.started', 'case.stage_changed']),
    );
  });
});

describe('acceptance 10: roles and access control (enforced by the API)', () => {
  it('support roles cannot create cases or manage tasks', async () => {
    const c = await newCase();
    expect((await parts.post('/cases', { admittedAt: daysAgo(0), coverageType: 'personal' })).status).toBe(403);
    expect((await parts.post(`/cases/${c.id}/tasks`, { departmentId: dept('body') })).status).toBe(403);
    expect((await expert.post(`/cases/${c.id}/tasks`, { departmentId: dept('body') })).status).toBe(201);
    expect((await manager.post(`/cases/${c.id}/tasks`, { departmentId: dept('body') })).status).toBe(403);
  });

  it('unified coordinator can report and resolve repair blockers', async () => {
    const c = await newCase();
    const t = await addTask(c.id, { departmentId: dept('body') });
    expect((await expert.post(`/cases/${c.id}/blockers`, { reason: 'financial' })).status).toBe(201);
    expect((await expert.post(`/cases/${c.id}/blockers`, { reason: 'capacity', taskId: t.id })).status).toBe(201);
    const b = (await supervisor.get(`/cases/${c.id}`)).body.blockers[0];
    expect((await expert.post(`/blockers/${b.id}/resolve`, { note: 'x' })).status).toBe(201);
  });

  it('parts clerk sees cases but customer phone is masked', async () => {
    const c = await newCase({ customer: { fullName: 'محرمانه', phone: '09000003333' } });
    const res = await parts.get(`/cases/${c.id}`);
    expect(res.status).toBe(200);
    expect(res.body.customer.phone).toBe('0900***3333');
    expect(res.body.customer.phoneMasked).toBe(true);
    expect((await parts.get(`/cases/${c.id}/timeline`)).status).toBe(403);
  });

  it('system admin supports case operations without owner access management', async () => {
    expect((await admin.get('/cases')).status).toBe(200);
    expect((await admin.get('/dashboard')).status).toBe(200)
    expect((await admin.get('/access')).status).toBe(403);
  });

  it('isolates tenants: another dealership cannot see or change these cases', async () => {
    const c = await newCase();
    const otherTenant = newId();
    await h.db.db.insert(tenants).values({ id: otherTenant, code: 'other', name: 'نمایندگی دیگر', isTest: true });
    await h.db.db.insert(departments).values({ id: newId(), tenantId: otherTenant, code: 'body', name: 'صافکاری' });
    await h.db.db.insert(users).values({
      id: newId(),
      tenantId: otherTenant,
      username: 'supervisor',
      displayName: 'سرپرست دیگر',
      passwordHash: await hashPassword(TEST_PASSWORD),
      roles: ['accident_expert'],
      isTest: true,
    });
    // Same username in two tenants: login must name the tenant.
    const ambiguous = await request(h.app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('x-manage-client', 'test')
      .send({ username: 'supervisor', password: TEST_PASSWORD });
    expect(ambiguous.body.code).toBe('TENANT_REQUIRED');

    const other = await h.login('supervisor', 'other');
    expect((await other.get(`/cases/${c.id}`)).status).toBe(404);
    expect((await other.get('/cases?status=all')).body.total).toBe(0);
    expect((await other.post(`/cases/${c.id}/tasks`, { departmentId: dept('body') })).status).toBe(404);
    supervisor = await h.login('supervisor', 'demo');
  });
});

describe('acceptance 11: vehicles already in the workshop (legacy entry)', () => {
  it('accepts a past admission date and the current stage, and shows as overdue', async () => {
    const c = await newCase({
      admittedAt: daysAgo(25),
      stage: 'in_repair',
      isLegacyEntry: true,
      coverageType: 'golden_card',
      goldenCardFileNo: 'GC-OLD',
      officialDeadlineAt: daysAgo(2),
    });
    expect(c.stage).toBe('in_repair');
    expect(c.isLegacyEntry).toBe(true);
    expect(new Date(c.admittedAt).getTime()).toBeLessThan(new Date(c.createdAt).getTime() - 20 * 86_400_000);

    const overdue = (await manager.get('/cases?flag=overdue')).body.items.map((i: { id: string }) => i.id);
    expect(overdue).toContain(c.id);
    const legacy = (await manager.get('/cases?flag=legacy')).body.items.map((i: { id: string }) => i.id);
    expect(legacy).toContain(c.id);
  });

  it('rejects creating a case directly as delivered', async () => {
    const res = await expert.post('/cases', { admittedAt: daysAgo(3), coverageType: 'personal', stage: 'delivered' });
    expect(res.body.code).toBe('INVALID_STAGE');
  });
});

describe('dashboard counts match the filtered lists they link to', () => {
  it('each card count equals the total of its filter', async () => {
    const d = (await manager.get('/dashboard')).body;
    const flags: [string, number][] = [
      ['overdue', d.overdue],
      ['due_soon', d.dueSoon],
      ['blocked', d.blockedCases],
      ['needs_completion', d.needsCompletion],
      ['unassigned', d.unassigned],
      ['ready', d.readyForDelivery],
      ['legacy', d.legacyEntries],
    ];
    for (const [flag, count] of flags) {
      const res = await manager.get(`/cases?flag=${flag}&pageSize=1`);
      expect({ flag, total: res.body.total }).toEqual({ flag, total: count });
    }
    expect(d.activeCases).toBeGreaterThan(0);
  });
});

describe('audit trail and sync foundations', () => {
  it('audit events cannot be updated or deleted, even directly in the database', async () => {
    const failure = (q: Promise<unknown>) =>
      q.then(
        () => 'succeeded',
        (err: any) => String(err.cause?.message ?? err.message),
      );
    expect(await failure(h.db.db.execute(sql`update audit_events set action = 'tampered'`))).toMatch(/append-only/);
    expect(await failure(h.db.db.execute(sql`delete from audit_events`))).toMatch(/append-only/);
  });

  it('every change writes a change-log entry in the same transaction', async () => {
    const c = await newCase();
    const rows = await h.db.db.execute<{ op: string; entity_version: number }>(
      sql`select op, entity_version from change_log where entity_id = ${c.id} order by seq`,
    );
    const list = ((rows as any).rows ?? rows) as { op: string; entity_version: number }[];
    expect(list[0]).toMatchObject({ op: 'case.created', entity_version: 1 });
  });

  it('replays the stored response for a repeated Idempotency-Key instead of creating twice', async () => {
    const body = { admittedAt: daysAgo(0), coverageType: 'personal' };
    const first = await expert.post('/cases', body).set('Idempotency-Key', 'k-123');
    const second = await expert.post('/cases', body).set('Idempotency-Key', 'k-123');
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(second.body.id).toBe(first.body.id);
  });

  it('demo reset removes only synthetic tenants', async () => {
    const realTenant = newId();
    await h.db.db.insert(tenants).values({ id: realTenant, code: 'real', name: 'واقعی', isTest: false });
    const removed = await purgeTestTenants(h.db.db);
    expect(removed).toBeGreaterThanOrEqual(1);
    const left = await h.db.db.execute<{ code: string }>(sql`select code from tenants`);
    expect((((left as any).rows ?? left) as { code: string }[]).map((r) => r.code)).toEqual(['real']);
  });
});
