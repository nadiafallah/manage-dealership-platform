import request from 'supertest';
import {and,eq} from 'drizzle-orm';
import {authChallenges,auditEvents,idempotencyKeys,sessions,tenants,users} from '../src/db/schema';
import {newId} from '../src/common/ids';
import {authenticator} from '../src/auth/totp';
import { createHarness, LEGACY_QC_PERMISSIONS, type Client, type Harness } from './harness';

const KEY='synthetic-test-authenticator-key-32-characters';
const OLD_PASSWORD='old-personal-password-12';
const NEW_PASSWORD='new-personal-password-34';
const EMAIL='worker@example.test';
const nextCode=(secret:string)=>authenticator(secret).generate({timestamp:Date.now()+30000});

describe('Owner-issued staff access recovery',()=>{
  let h:Harness,owner:Client,ownerId:string;
  beforeEach(async()=>{
    h=await createHarness({config:{AUTH_TOKEN_SECRET:KEY,COOKIE_SECURE:'true',PUBLIC_APP_URL:'https://manage.example.test'}});
    owner=await h.login('manager');ownerId=(await owner.get('/auth/me')).body.id;
    await h.db.db.update(users).set({isOwner:true}).where(eq(users.id,ownerId));
  });
  afterEach(async()=>{await h.close();});
  const post=(path:string,body:object)=>request(h.app.getHttpServer()).post('/api/v1/auth'+path).set('x-manage-client','test').send(body);
  const tokenOf=(url:string)=>new URLSearchParams(new URL(url).hash.slice(1)).get('token')!;
  const workerRow=async()=>(await h.db.db.select().from(users).where(eq(users.email,EMAIL)))[0]!;

  /** A real employee: invited, password chosen, Authenticator enrolled. */
  async function activeWorker(){
    const invited=await owner.post('/auth/invitations',{email:EMAIL,displayName:'همکار آزمون',roles:['parts_clerk']});
    expect(invited.status).toBe(201);
    const accepted=await post('/invitations/accept',{token:tokenOf(invited.body.invitationUrl),password:OLD_PASSWORD});
    expect(accepted.status).toBe(201);
    const secret:string=accepted.body.secret;
    const confirmed=await post('/invitations/confirm',{challengeId:accepted.body.challengeId,proof:accepted.body.proof,code:authenticator(secret).generate()});
    expect(confirmed.status).toBe(201);
    return {id:invited.body.id as string,secret};
  }
  async function signIn(password:string,secret:string){
    const step=await post('/email/login',{email:EMAIL,password});expect(step.status).toBe(201);
    return post('/email/verify',{...step.body,code:nextCode(secret)});
  }

  it('lets only the actual owner issue a link',async()=>{
    const worker=await activeWorker();
    const admin=await h.login('admin');
    expect((await admin.get('/auth/me')).body.permissions).toContain('user.manage');
    expect((await admin.post(`/auth/users/${worker.id}/recovery`,{})).status).toBe(403);
    expect((await (await h.loginAs('narrow', [], LEGACY_QC_PERMISSIONS)).post(`/auth/users/${worker.id}/recovery`,{})).status).toBe(403);
    expect((await post(`/users/${worker.id}/recovery`,{})).status).toBe(401);
    const challenges=await h.db.db.select().from(authChallenges).where(eq(authChallenges.purpose,'recover'));
    expect(challenges).toHaveLength(0);
  });

  it('issues links only for active staff in the same tenant, never for the owner',async()=>{
    const self=await owner.post(`/auth/users/${ownerId}/recovery`,{});
    expect(self.status).toBe(409);expect(self.body.code).toBe('RECOVERY_OWNER');
    expect((await owner.post('/auth/users/not-a-uuid/recovery',{})).status).toBe(400);

    const pending=await owner.post('/auth/invitations',{email:'pending@example.test',displayName:'در انتظار آزمون',roles:['parts_clerk']});
    const notActive=await owner.post(`/auth/users/${pending.body.id}/recovery`,{});
    expect(notActive.status).toBe(409);expect(notActive.body.code).toBe('RECOVERY_NOT_ACTIVE');

    const otherTenant=newId(),otherUser=newId();
    await h.db.db.insert(tenants).values({id:otherTenant,code:'recovery-other',name:'نمایندگی آزمون دیگر',isTest:true});
    await h.db.db.insert(users).values({id:otherUser,tenantId:otherTenant,username:'other-user',email:'other@example.test',displayName:'همکار آزمون دیگر',roles:['parts_clerk'],passwordHash:'synthetic-not-a-password',encryptedTotpSecret:'synthetic',isActive:true,isTest:true});
    expect((await owner.post(`/auth/users/${otherUser}/recovery`,{})).status).toBe(404);
  });

  it('replaces the password and Authenticator, and ends every old session',async()=>{
    const worker=await activeWorker();
    const oldSession=await signIn(OLD_PASSWORD,worker.secret);expect(oldSession.status).toBe(201);
    const oldCookie=oldSession.headers['set-cookie']![0]!.split(';')[0]!;
    const me=()=>request(h.app.getHttpServer()).get('/api/v1/auth/me').set('Cookie',oldCookie);
    expect((await me()).status).toBe(200);
    await h.db.db.update(users).set({lockedUntil:new Date(Date.now()+600000),failedLoginCount:3}).where(eq(users.id,worker.id));

    const issued=await owner.post(`/auth/users/${worker.id}/recovery`,{}).set('idempotency-key','sensitive-recovery-response');
    expect(issued.status).toBe(201);
    expect(issued.body.recoveryUrl).toMatch(/^https:\/\/manage\.example\.test\/activate#token=.+&mode=recovery$/);
    expect(new Date(issued.body.expiresAt).getTime()-Date.now()).toBeLessThanOrEqual(3600000);
    expect(await h.db.db.select().from(idempotencyKeys)).toHaveLength(0);

    // Issuing alone changes nothing: a link made by mistake locks nobody out.
    expect((await me()).status).toBe(200);
    const unchanged=await workerRow();expect(unchanged.isActive).toBe(true);
    await h.db.db.update(users).set({lockedUntil:null,failedLoginCount:0}).where(eq(users.id,worker.id));
    expect((await post('/email/login',{email:EMAIL,password:OLD_PASSWORD})).status).toBe(201);
    await h.db.db.update(users).set({lockedUntil:new Date(Date.now()+600000),failedLoginCount:3}).where(eq(users.id,worker.id));

    const token=tokenOf(issued.body.recoveryUrl);
    const accepted=await post('/invitations/accept',{token,password:NEW_PASSWORD});
    expect(accepted.status).toBe(201);
    const newSecret:string=accepted.body.secret;expect(newSecret).not.toBe(worker.secret);
    const [pending]=await h.db.db.select().from(authChallenges).where(eq(authChallenges.id,accepted.body.challengeId));
    expect(pending!.purpose).toBe('recover_enroll');expect(pending!.encryptedTotpSecret).not.toContain(newSecret);expect(pending!.passwordHash).not.toContain(NEW_PASSWORD);

    // The link is single-use, and a wrong code leaves the old credentials in place.
    expect((await post('/invitations/accept',{token,password:NEW_PASSWORD})).status).toBe(401);
    const wrong=['000000','000001'].find(c=>authenticator(newSecret).validate({token:c,window:1})===null)!;
    expect((await post('/invitations/confirm',{challengeId:accepted.body.challengeId,proof:accepted.body.proof,code:wrong})).status).toBe(401);
    expect((await me()).status).toBe(200);
    expect((await workerRow()).encryptedTotpSecret).toBe(unchanged.encryptedTotpSecret);

    const code=authenticator(newSecret).generate();
    expect((await post('/invitations/confirm',{challengeId:accepted.body.challengeId,proof:accepted.body.proof,code})).status).toBe(201);
    expect((await post('/invitations/confirm',{challengeId:accepted.body.challengeId,proof:accepted.body.proof,code})).status).toBe(401);

    expect((await me()).status).toBe(401);
    const open=await h.db.db.select().from(sessions).where(eq(sessions.userId,worker.id));
    expect(open.every(s=>s.revokedAt!==null)).toBe(true);
    const row=await workerRow();
    expect(row.isActive).toBe(true);expect(row.lockedUntil).toBeNull();expect(row.failedLoginCount).toBe(0);
    expect(row.version).toBeGreaterThan(unchanged.version);expect(row.activatedAt).toEqual(unchanged.activatedAt);

    expect((await post('/email/login',{email:EMAIL,password:OLD_PASSWORD})).status).toBe(401);
    const newStep=await post('/email/login',{email:EMAIL,password:NEW_PASSWORD});expect(newStep.status).toBe(201);
    expect((await post('/email/verify',{...newStep.body,code:nextCode(worker.secret)})).status).toBe(401);
    const signedIn=await post('/email/verify',{...newStep.body,code:nextCode(newSecret)});
    expect(signedIn.status).toBe(201);expect(signedIn.body.roles).toEqual(['parts_clerk']);

    const actions=(await h.db.db.select({action:auditEvents.action}).from(auditEvents).where(eq(auditEvents.entityId,worker.id))).map(a=>a.action);
    expect(actions).toEqual(expect.arrayContaining(['user.recovery_issued','auth.recovery_started','auth.recovery_completed']));
    const [issuedAudit]=await h.db.db.select().from(auditEvents).where(and(eq(auditEvents.entityId,worker.id),eq(auditEvents.action,'user.recovery_issued')));
    expect(issuedAudit!.actorUserId).toBe(ownerId);
    expect(JSON.stringify(issuedAudit)).not.toContain(token.split('.')[1]);
  });

  it('refuses expired, replaced and withdrawn links',async()=>{
    const worker=await activeWorker();
    const issue=async()=>tokenOf((await owner.post(`/auth/users/${worker.id}/recovery`,{})).body.recoveryUrl);

    const replaced=await issue();const current=await issue();
    expect((await post('/invitations/accept',{token:replaced,password:NEW_PASSWORD})).status).toBe(401);

    await h.db.db.update(authChallenges).set({expiresAt:new Date(Date.now()-1000)}).where(eq(authChallenges.id,current.split('.')[0]!));
    expect((await post('/invitations/accept',{token:current,password:NEW_PASSWORD})).status).toBe(401);

    const deactivated=await issue();
    await h.db.db.update(users).set({isActive:false}).where(eq(users.id,worker.id));
    expect((await post('/invitations/accept',{token:deactivated,password:NEW_PASSWORD})).status).toBe(401);
    await h.db.db.update(users).set({isActive:true}).where(eq(users.id,worker.id));

    const forged=(await issue()).split('.')[0]!+'.'+'x'.repeat(43);
    expect((await post('/invitations/accept',{token:forged,password:NEW_PASSWORD})).status).toBe(401);
    expect((await workerRow()).isActive).toBe(true);
  });

  it('never lets a link change the owner, even if the person becomes owner mid-way',async()=>{
    const worker=await activeWorker();
    const issue=async()=>tokenOf((await owner.post(`/auth/users/${worker.id}/recovery`,{})).body.recoveryUrl);
    const replaced=await issue();const before=await issue();
    expect((await post('/invitations/accept',{token:replaced,password:NEW_PASSWORD})).status).toBe(401);
    const accepted=await post('/invitations/accept',{token:before,password:NEW_PASSWORD});expect(accepted.status).toBe(201);

    // Only one owner per tenant is allowed, so ownership moves rather than being added.
    await h.db.db.update(users).set({isOwner:false}).where(eq(users.id,ownerId));
    await h.db.db.update(users).set({isOwner:true}).where(eq(users.id,worker.id));
    const code=authenticator(accepted.body.secret).generate();
    expect((await post('/invitations/confirm',{challengeId:accepted.body.challengeId,proof:accepted.body.proof,code})).status).toBe(401);
    expect((await post('/email/login',{email:EMAIL,password:OLD_PASSWORD})).status).toBe(201);
    expect((await post('/email/login',{email:EMAIL,password:NEW_PASSWORD})).status).toBe(401);
  });

  it('refuses a new link once the person has become the owner',async()=>{
    const worker=await activeWorker();
    const token=tokenOf((await owner.post(`/auth/users/${worker.id}/recovery`,{})).body.recoveryUrl);
    await h.db.db.update(users).set({isOwner:false}).where(eq(users.id,ownerId));
    await h.db.db.update(users).set({isOwner:true}).where(eq(users.id,worker.id));
    expect((await post('/invitations/accept',{token,password:NEW_PASSWORD})).status).toBe(401);
  });

  it('keeps the two challenge kinds apart: a login challenge cannot finish a recovery',async()=>{
    const worker=await activeWorker();
    const step=await post('/email/login',{email:EMAIL,password:OLD_PASSWORD});expect(step.status).toBe(201);
    const code=nextCode(worker.secret);
    expect((await post('/invitations/confirm',{...step.body,code})).status).toBe(401);
    const issued=await owner.post(`/auth/users/${worker.id}/recovery`,{});
    const accepted=await post('/invitations/accept',{token:tokenOf(issued.body.recoveryUrl),password:NEW_PASSWORD});
    expect((await post('/email/verify',{challengeId:accepted.body.challengeId,proof:accepted.body.proof,code:authenticator(accepted.body.secret).generate()})).status).toBe(401);
    // Issuing a link closes the login that was waiting for its code.
    expect((await post('/email/verify',{...step.body,code})).status).toBe(401);
  });
});
