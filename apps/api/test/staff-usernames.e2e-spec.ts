import request from 'supertest';
import { eq } from 'drizzle-orm';
import { AuditService } from '../src/audit/audit.service';
import { AuthService } from '../src/auth/auth.service';
import type { Actor } from '../src/auth/auth.types';
import { alignStationUsernames } from '../src/auth/staff-usernames';
import { users, workshopStations, auditEvents } from '../src/db/schema';
import { createHarness, type Harness, type Client } from './harness';

describe('Staff identifiers and legacy compatibility', () => {
  let h: Harness, admin: Client, actor: Actor;
  const login = (username: string, pin = '4815', devicePassword: string | undefined = 'Device2026test', cookie = '') => request(h.app.getHttpServer()).post('/api/v1/auth/technician-login').set('x-manage-client', 'test').set('Cookie', cookie).send({ username, pin, ...(devicePassword ? { devicePassword } : {}) });
  beforeEach(async () => {
    h = await createHarness();
    await h.db.db.update(users).set({ isActive: false }).where(eq(users.username, 'technician'));
    await h.db.db.update(users).set({ isOwner: true }).where(eq(users.username, 'admin'));
    admin = await h.login('admin');
    actor = { user: (await h.app.get(AuthService).authenticate(admin.cookie.split('=')[1]!))! };
  });
  afterEach(async () => h.close());

  it('creates EXP00, accepts displayed Persian digits, signs in with the PIN alone and keeps the parts role session', async () => {
    const made = await admin.post('/staff/technicians', { displayName: 'قطعات ساختگی', personnelCode: '۰۰', role: 'parts_clerk', pin: '4815', devicePassword: 'Device2026test' });
    expect(made.status).toBe(201);
    expect(made.body).toEqual(expect.arrayContaining([expect.objectContaining({ username: 'exp00' })]));
    expect((await login('EXP00', '1111', '')).status).toBe(401);
    const ok = await login('EXP ۰۰', '4815', '');
    expect(ok.status).toBe(200);
    expect(ok.body.roles).toEqual(['parts_clerk']);
    expect(ok.body.permissions).not.toContain('user.manage');
    const cookies = (ok.headers['set-cookie'] as unknown as string[]).map(c => c.split(';')[0]).join('; ');
    expect((await request(h.app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', cookies)).status).toBe(200);
    expect((await login('EXP00', '4815', '', cookies)).status).toBe(200);
    expect((await admin.post('/staff/technicians', { displayName: 'تکراری ساختگی', personnelCode: '00', role: 'parts_clerk', pin: '4815', devicePassword: 'Device2026test' })).status).toBe(409);
  });

  it('aligns swaps atomically by station, preserving IDs, PIN, owner and active sessions', async () => {
    for (const code of ['02', '03']) expect((await admin.post('/staff/technicians', { displayName: `تکنسین ساختگی ${code}`, stationCode: code, trade: 'suspension', pin: '4815', devicePassword: 'Device2026test' })).status).toBe(201);
    const rows = await h.db.db.select().from(users);
    const second = rows.find(u => u.username === 'tech02')!, third = rows.find(u => u.username === 'tech03')!;
    // Old sequential names identify the opposite bay. Keep their IDs/stations.
    await h.db.db.update(users).set({ username: 'temp' }).where(eq(users.id, second.id));
    await h.db.db.update(users).set({ username: 'tech02' }).where(eq(users.id, third.id));
    await h.db.db.update(users).set({ username: 'tech03' }).where(eq(users.id, second.id));
    const oldLogin = await login('tech03');
    const cookie = (oldLogin.headers['set-cookie'] as unknown as string[]).map(c => c.split(';')[0]).join('; ');
    const audit = h.app.get(AuditService);
    await expect(alignStationUsernames(h.db, audit, {user:{...actor.user,isOwner:false}})).rejects.toMatchObject({code:'FORBIDDEN'});
    const plan = await alignStationUsernames(h.db, audit, actor);
    expect(plan).toHaveLength(2);
    await expect(alignStationUsernames(h.db, audit, actor, [])).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    await alignStationUsernames(h.db, audit, actor, plan);
    const me = await request(h.app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', cookie);
    expect(me.body.id).toBe(second.id);
    expect(me.body.username).toBe('tech02');
    const after = await h.db.db.select().from(users);
    expect(after.find(u => u.id === second.id)?.pinHash).toBe(second.pinHash);
    expect(after.find(u => u.isOwner)).toEqual(rows.find(u => u.isOwner));
    expect((await login('TECH ۰۳')).body.id).toBe(third.id);
    expect((await h.db.db.select().from(auditEvents)).filter(e => e.action === 'user.username_aligned')).toHaveLength(2);
  });

  it('refuses ambiguous stations and occupied destinations without partial writes', async () => {
    await admin.post('/staff/technicians', { displayName: 'ساختگی', username: 'legacy', pin: '4815', devicePassword: 'Device2026test' });
    const audit = h.app.get(AuditService);
    await expect(alignStationUsernames(h.db, audit, actor)).rejects.toMatchObject({ code: 'AMBIGUOUS_STATION' });
    await h.db.db.update(users).set({ isActive: false }).where(eq(users.username, 'legacy'));
    await admin.post('/staff/technicians', { displayName: 'ساختگی جایگاه', stationCode: '03', trade: 'suspension', pin: '4815', devicePassword: 'Device2026test' });
    const [tech] = await h.db.db.select().from(users).where(eq(users.username, 'tech03'));
    await h.db.db.update(users).set({ username: 'oldtech' }).where(eq(users.id, tech!.id));
    await admin.post('/staff/technicians', { displayName: 'مقصد اشغال', username: 'tech03', role: 'parts_clerk', pin: '4815', devicePassword: 'Device2026test' });
    await expect(alignStationUsernames(h.db, audit, actor)).rejects.toMatchObject({ code: 'USERNAME_TAKEN' });
    expect((await h.db.db.select().from(users).where(eq(users.id, tech!.id)))[0]!.username).toBe('oldtech');
    expect((await h.db.db.select().from(workshopStations)).find(s => s.code === '03')!.responsibleUserId).toBe(tech!.id);
  });

  it('gives an existing parts clerk an owner-chosen EXP code without touching PIN, devices or sessions', async () => {
    expect((await admin.post('/staff/technicians', { displayName: 'قطعات قدیمی ساختگی', username: 'parts.legacy', role: 'parts_clerk', pin: '4815', devicePassword: 'Device2026test' })).status).toBe(201);
    expect((await admin.post('/staff/technicians', { displayName: 'کارشناس ساختگی', personnelCode: '21', role: 'accident_expert', pin: '4815', devicePassword: 'Device2026test' })).status).toBe(201);
    expect((await admin.post('/staff/technicians', { displayName: 'تکنسین ساختگی', stationCode: '03', trade: 'suspension', pin: '4815', devicePassword: 'Device2026test' })).status).toBe(201);
    const [clerk] = await h.db.db.select().from(users).where(eq(users.username, 'parts.legacy'));
    const [tech] = await h.db.db.select().from(users).where(eq(users.username, 'tech03'));
    const first = await login('parts.legacy');
    expect(first.status).toBe(200);
    const cookie = (first.headers['set-cookie'] as unknown as string[]).map(c => c.split(';')[0]).join('; ');
    // A PIN session never manages staff.
    expect((await request(h.app.getHttpServer()).put(`/api/v1/staff/technicians/${clerk!.id}/expert-code`).set('x-manage-client', 'test').set('Cookie', cookie).send({ personnelCode: '20' })).status).toBe(403);
    expect((await admin.put(`/staff/technicians/${tech!.id}/expert-code`, { personnelCode: '20' })).body.code).toBe('TECHNICIAN_USES_STATION');
    expect((await admin.put(`/staff/technicians/${clerk!.id}/expert-code`, { personnelCode: '21' })).status).toBe(409);
    expect((await admin.put(`/staff/technicians/${clerk!.id}/expert-code`, { personnelCode: '2' })).status).toBe(400);
    const changed = await admin.put(`/staff/technicians/${clerk!.id}/expert-code`, { personnelCode: '۲۰' });
    expect(changed.status).toBe(200);
    expect(changed.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: clerk!.id, username: 'exp20' })]));
    const [after] = await h.db.db.select().from(users).where(eq(users.id, clerk!.id));
    expect(after!.pinHash).toBe(clerk!.pinHash);
    expect(after!.devicePasswordHash).toBe(clerk!.devicePasswordHash);
    // The open session continues; the registered device signs in with the PIN alone under the new name.
    expect((await request(h.app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', cookie)).body.username).toBe('exp20');
    expect((await login('EXP ۲۰', '4815', '', cookie)).status).toBe(200);
    // The old name is not an alias.
    expect((await login('parts.legacy')).status).toBe(401);
    // Same code again changes nothing.
    expect((await admin.put(`/staff/technicians/${clerk!.id}/expert-code`, { personnelCode: '20' })).status).toBe(200);
    expect((await h.db.db.select().from(auditEvents)).filter(e => e.action === 'user.username_changed')).toHaveLength(1);
  });
  it('gives a service manager MGR + the two-digit code and keeps a legacy EXP manager signing in (scenario 2026-11-25)', async () => {
    const made = await admin.post('/staff/technicians', { displayName: 'مدیر ساختگی', personnelCode: '۳۰', role: 'service_manager', pin: '4815', devicePassword: 'Device2026test' });
    expect(made.status).toBe(201);
    expect(made.body).toEqual(expect.arrayContaining([expect.objectContaining({ username: 'mgr30' })]));
    const ok = await login('MGR ۳۰', '4815', '');
    expect(ok.status).toBe(200);
    expect(ok.body.roles).toEqual(['service_manager']);
    // A manager created before the change keeps the EXP name until the owner sets a code.
    const legacy = await admin.post('/staff/technicians', { displayName: 'مدیر قدیمی ساختگی', username: 'exp31', role: 'service_manager', pin: '4815', devicePassword: 'Device2026test' });
    expect(legacy.status).toBe(201);
    expect((await login('EXP 31', '4815', '')).status).toBe(200);
    const [old] = await h.db.db.select().from(users).where(eq(users.username, 'exp31'));
    expect((await admin.put(`/staff/technicians/${old!.id}/expert-code`, { personnelCode: '31' })).status).toBe(200);
    const [renamed] = await h.db.db.select().from(users).where(eq(users.id, old!.id));
    expect(renamed!.username).toBe('mgr31');
    expect((await login('MGR 31', '4815', '')).status).toBe(200);
  });
});
