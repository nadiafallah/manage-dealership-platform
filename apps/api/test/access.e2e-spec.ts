import {eq} from 'drizzle-orm';
import {PERMISSIONS,permissionsFor} from '@manage/shared';
import {users,tenants,auditEvents,changeLog} from '../src/db/schema';
import {newId} from '../src/common/ids';
import {Client,createHarness,type Harness} from './harness';
// The edited colleague is the technician: the smallest role, so every added permission is visible.
let h:Harness,owner:Client,qc:Client,admin:Client,qcId:string,ownerId:string,caseId:string;
beforeAll(async()=>{h=await createHarness();[owner,qc,admin]=await Promise.all(['manager','technician','admin'].map(u=>h.login(u)));ownerId=(await owner.get('/auth/me')).body.id;qcId=(await qc.get('/auth/me')).body.id;await h.db.db.update(users).set({isOwner:true}).where(eq(users.id,ownerId));const c=await owner.post('/cases',{admittedAt:new Date().toISOString(),vehicle:{model:'خودرو آزمون',plate:'پلاک آزمون'},customer:{fullName:'مشتری آزمون',phone:'09000000001'}});expect(c.status).toBe(201);caseId=c.body.id;});
afterAll(async()=>{await h?.close();});
async function update(overrides:{allow:string[];deny:string[]}){const c=(await owner.get('/access')).body;const u=c.staff.find((v:{id:string})=>v.id===qcId);return owner.put(`/access/users/${qcId}`,{roles:u.roles,expectedVersion:u.version,expectedTemplateVersion:c.version,...overrides});}
it('preserves default roles and restricts access administration to the actual owner',async()=>{
 expect((await qc.get('/access')).status).toBe(403);expect((await admin.get('/access')).status).toBe(403);expect((await admin.get('/access/presets')).status).toBe(200);
 expect((await qc.get('/auth/me')).body.permissions.sort()).toEqual([...permissionsFor(['technician'])].sort());
 const me=(await owner.get('/auth/me')).body;expect(me.isOwner).toBe(true);expect(me.permissions.sort()).toEqual([...PERMISSIONS].sort());
 expect((await qc.post(`/cases/${caseId}/parts`,{description:'قطعه آزمون',source:'company'})).status).toBe(403);
});
it('applies per-user additions/removals to existing sessions, including actual mutations and PII masking',async()=>{
 expect((await update({allow:['case.read','part.request','reference.parts.read','customer.pii.read'],deny:['task.execute']})).status).toBe(200);
 expect((await qc.post(`/cases/${caseId}/parts`,{description:'قطعه آزمون سفارشی',source:'company'})).status).toBe(201);
 expect((await qc.get(`/cases/${caseId}`)).body.customer.phone).toBe('09000000001');
 expect((await qc.post('/reference-data/parts/search',{query:'TEST-PART'})).status).toBe(201);
 expect((await qc.get('/auth/me')).body.permissions).not.toContain('task.execute');
 expect((await update({allow:['case.read','part.request','reference.parts.read'],deny:['task.execute']})).status).toBe(200);
 expect((await qc.get(`/cases/${caseId}`)).body.customer.phone).not.toBe('09000000001');
});
it('protects owner access, rejects forged flags/unknown permissions, stale edits and cross-tenant targets',async()=>{
 const c=(await owner.get('/access')).body,u=c.staff.find((x:{id:string})=>x.id===qcId);const input={roles:u.roles,allow:[],deny:[],expectedVersion:u.version,expectedTemplateVersion:c.version};
 expect((await admin.put(`/access/users/${qcId}`,input)).status).toBe(403);
 expect((await owner.put(`/access/users/${ownerId}`,{...input,expectedVersion:1})).status).toBe(403);
 expect((await owner.put(`/access/users/${qcId}`,{...input,isOwner:true})).status).toBe(400);
 expect((await owner.put(`/access/users/${qcId}`,{...input,allow:['unknown.permission']})).status).toBe(400);
 expect((await owner.put(`/access/users/${qcId}`,{...input,expectedVersion:1})).status).toBe(409);
 const other=newId();await h.db.db.insert(tenants).values({id:other,code:'access-other',name:'نمایندگی آزمون دیگر',isTest:true});
 const otherId=newId();await h.db.db.insert(users).values({id:otherId,tenantId:other,username:'other-user',displayName:'همکار آزمون دیگر',roles:['technician'],passwordHash:'synthetic-not-a-password',isTest:true});
 expect((await owner.put(`/access/users/${otherId}`,input)).status).toBe(404);
});
it('updates tenant role defaults while preserving personal exceptions and immutable full owner access',async()=>{
 const before=(await owner.get('/access')).body;
 const changed=await owner.put('/access/templates/technician',{expectedVersion:before.version,permissions:['case.read','dashboard.read','task.execute']});expect(changed.status).toBe(200);
 const me=(await qc.get('/auth/me')).body;expect(me.permissions).toContain('dashboard.read');expect(me.permissions).toContain('part.request');expect(me.permissions).not.toContain('task.execute');
 const fresh=await h.loginAs('fresh-technician',['technician']);expect((await fresh.get('/auth/me')).body.permissions.sort()).toEqual(['case.read','dashboard.read','task.execute'].sort());
 expect((await owner.put('/access/templates/technician',{expectedVersion:before.version,permissions:[]})).status).toBe(409);
 expect((await admin.put('/access/templates/technician',{expectedVersion:before.version+1,permissions:[]})).status).toBe(403);
 const catalog=(await owner.get('/access')).body,u=catalog.staff.find((x:{id:string})=>x.id===qcId);
 expect((await owner.put(`/access/users/${qcId}`,{expectedVersion:u.version,expectedTemplateVersion:before.version,roles:u.roles,allow:[],deny:[]})).status).toBe(409);
 expect((await owner.get('/auth/me')).body.permissions).toHaveLength(PERMISSIONS.length);
});
it('records access mutations in immutable audit and change log without touching credentials',async()=>{
 const audits=await h.db.db.select().from(auditEvents).where(eq(auditEvents.action,'user.access_updated'));expect(audits).toHaveLength(2);
 expect(await h.db.db.select().from(changeLog).where(eq(changeLog.entityId,qcId))).not.toHaveLength(0);
 // The original session still works, and password sign-in still works after access edits.
 expect((await qc.get('/auth/me')).status).toBe(200);expect((await (await h.login('technician')).get('/auth/me')).status).toBe(200);
});
