import { eq } from 'drizzle-orm';
import { DEFAULT_WORK_CALENDAR } from '@manage/shared';
import { users, tenants } from '../src/db/schema';
import { newId } from '../src/common/ids';
import { createHarness, type Harness, type Client } from './harness';
let h:Harness,c:Client,p:Client,admin:Client,tech:Client,other:Client,manager:Client;
let caseId:string,departmentId:string,stationId:string,techId:string,taskId:string,partId:string;
beforeAll(async()=>{h=await createHarness();c=await h.loginAs('coordinator-new',['accident_expert']);p=await h.login('parts');admin=await h.login('admin');tech=await h.loginAs('tech-new',['technician']);other=await h.loginAs('tech-other',['technician']);manager=await h.login('manager');
 const [u]=await h.db.db.select().from(users).where(eq(users.username,'tech-new'));techId=u.id;
 const ds=await c.get('/departments');departmentId=ds.body[0].id;
 const res=await c.post('/cases',{vehicle:{model:'خودرو آزمون',vin:'TESTVIN0000099001'},customer:{fullName:'مشتری آزمون',phone:'09000009900'},admittedAt:new Date().toISOString(),coverageType:'golden_card'});expect(res.status).toBe(201);caseId=res.body.id;
});
afterAll(async()=>{await h?.close();});
it('holiday suggestions require calendar authority and never create a calendar revision',async()=>{
 expect((await manager.get('/workshop/calendar/iran-holidays')).status).toBe(403);
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response(`BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:${new Date().getUTCFullYear()}1225\r\nDESCRIPTION:Public holiday\r\nSUMMARY:Synthetic holiday\r\nEND:VEVENT\r\nEND:VCALENDAR`);};
 try{const before=await admin.get('/workshop/calendar');const response=await admin.get('/workshop/calendar/iran-holidays');expect(response.status).toBe(200);expect(response.body.items).toHaveLength(1);expect(calls).toBe(1);expect((await admin.get('/workshop/calendar')).body.version).toBe(before.body.version);}finally{globalThis.fetch=original;}
});
it('admin versions calendars; coordinator and manager cannot change them',async()=>{
 const day=new Date(Date.now()+210*60000).toISOString().slice(0,10);
 const body={expectedVersion:0,effectiveFrom:day,calendar:DEFAULT_WORK_CALENDAR,reason:'ساعات مصوب آزمون'};
 expect((await manager.post('/workshop/calendar',body)).status).toBe(403);
 expect((await c.post('/workshop/calendar',body)).status).toBe(403);
 const saved=await admin.post('/workshop/calendar',body);expect(saved.status).toBe(201);expect(saved.body.version).toBe(1);
 expect((await admin.post('/workshop/calendar',body)).status).toBe(409);
});
it('defines coded stations with tenant-scoped staff and no duplicate code',async()=>{
 const body={code:'TEST-B01',name:'جایگاه آزمایشی',trade:'body',departmentId,responsibleUserId:techId};
 const r=await admin.post('/workshop/stations',body);expect(r.status).toBe(201);stationId=r.body[0].id;
 expect((await admin.post('/workshop/stations',body)).body.code).toBe('STATION_CODE_EXISTS');
 expect((await admin.post('/workshop/stations',{...body,code:'TEST-X',responsibleUserId:newId()})).body.code).toBe('INVALID_ASSIGNEE');
});
it('suggests days per unit and the station that frees up first; technicians cannot read it',async()=>{
 expect((await tech.get(`/workshop/plan-suggestion?caseId=${caseId}`)).status).toBe(403);
 const before=await c.get(`/workshop/plan-suggestion?caseId=${caseId}`);expect(before.status).toBe(200);
 const body=before.body.find((x:{departmentId:string})=>x.departmentId===departmentId);
 expect(body).toMatchObject({basis:'default',suggestedDays:2,recommendedStationId:stationId});
 expect(body.stations[0]).toMatchObject({id:stationId,freeFrom:null,queuedCars:0});
 const end=new Date(Date.now()+3*86_400_000).toISOString();
 const t=await c.post(`/cases/${caseId}/tasks`,{departmentId,stationId,title:'اشغال جایگاه',plannedStartAt:new Date().toISOString(),plannedEndAt:end});expect(t.status).toBe(201);
 const after=(await c.get(`/workshop/plan-suggestion?caseId=${caseId}`)).body.find((x:{departmentId:string})=>x.departmentId===departmentId);
 expect(after.stations[0].queuedCars).toBe(1);expect(Date.parse(after.stations[0].freeFrom)).toBeGreaterThan(Date.now());
});
it('assigned technician can start/finish only own task, and cannot view a case or approve delivery',async()=>{
 const r=await c.post(`/cases/${caseId}/tasks`,{departmentId,stationId,assignedUserId:techId,title:'صافکاری آزمون',plannedStartAt:'2026-11-04T15:30:00+03:30',durationMinutes:480});expect(r.status).toBe(201);taskId=r.body.id;
 expect(r.body.baselineEndAt).toBe(new Date('2026-11-05T13:00:00+03:30').toISOString());
 expect((await tech.get(`/cases/${caseId}`)).status).toBe(403);
 expect((await other.get('/workshop/my-tasks')).body).toHaveLength(0);
 expect((await other.post(`/workshop/my-tasks/${taskId}/actions`,{action:'start',expectedVersion:1})).status).toBe(403);
 expect((await tech.post(`/workshop/my-tasks/${taskId}/actions`,{action:'approve',expectedVersion:1})).status).toBe(403);
 expect((await tech.post(`/workshop/my-tasks/${taskId}/actions`,{action:'start',expectedVersion:1,at:new Date().toISOString()})).status).toBe(403);
 expect((await tech.post(`/workshop/my-tasks/${taskId}/actions`,{action:'start',expectedVersion:1})).status).toBe(201);
 expect((await tech.post(`/workshop/my-tasks/${taskId}/actions`,{action:'complete',expectedVersion:1})).status).toBe(409);
 expect((await tech.post(`/workshop/my-tasks/${taskId}/actions`,{action:'complete',expectedVersion:2})).status).toBe(201);
 const second=await c.post(`/cases/${caseId}/tasks`,{departmentId,title:'مرحله بعد',dependsOn:[taskId]});expect(second.status).toBe(201);
 expect((await c.post(`/tasks/${second.body.id}/actions`,{action:'start',expectedVersion:1})).body.code).toBe('DEPENDENCY_NOT_DONE');
 expect((await c.post(`/tasks/${taskId}/actions`,{action:'approve',expectedVersion:3})).status).toBe(201);
 expect((await c.post(`/tasks/${second.body.id}/actions`,{action:'start',expectedVersion:1})).status).toBe(201);
});
it('rescheduling needs a reason and preserves the original baseline and calendar',async()=>{
 const before=(await c.get(`/cases/${caseId}`)).body.tasks.find((t:{id:string})=>t.id===taskId);
 const fail=await c.patch(`/tasks/${taskId}`,{expectedVersion:before.version,plannedEndAt:'2026-11-10T10:00:00Z'});expect(fail.body.code).toBe('SCHEDULE_REASON_REQUIRED');
 const r=await c.patch(`/tasks/${taskId}`,{expectedVersion:before.version,plannedEndAt:'2026-11-10T10:00:00Z',scheduleReason:'تغییر برنامه با حفظ سابقه'});expect(r.status).toBe(200);expect(r.body.baselineEndAt).toBe(before.baselineEndAt);
});
it('uses the effective calendar for a first plan while preserving already planned work',async()=>{
 const unplanned=await c.post(`/cases/${caseId}/tasks`,{departmentId,title:'بدون برنامه اولیه'});expect(unplanned.status).toBe(201);
 const old=(await c.get(`/cases/${caseId}`)).body.tasks.find((t:{id:string})=>t.id===taskId);
 const today=new Date(Date.now()+210*60000).toISOString().slice(0,10);
 const calendar={...DEFAULT_WORK_CALENDAR,week:DEFAULT_WORK_CALENDAR.week.map((_,day)=>day===5?[]:[{start:480,end:540}])};
 expect((await admin.post('/workshop/calendar',{expectedVersion:1,effectiveFrom:today,calendar,reason:'تغییر ساعات برای نخستین برنامه'})).status).toBe(201);
 const startDay=new Date(today+'T00:00:00Z');while(startDay.getUTCDay()!==3)startDay.setUTCDate(startDay.getUTCDate()+1);
 const start=startDay.toISOString().slice(0,10)+'T08:00:00+03:30';const expectedDay=new Date(startDay.getTime()+86400000).toISOString().slice(0,10)+'T09:00:00+03:30';
 const plan=await c.patch(`/tasks/${unplanned.body.id}`,{expectedVersion:1,plannedStartAt:start,durationMinutes:120,scheduleReason:'اولین برنامه طبق تقویم جاری'});
 expect(plan.status).toBe(200);expect(plan.body.plannedEndAt).toBe(new Date(expectedDay).toISOString());
 const after=(await c.get(`/cases/${caseId}`)).body.tasks.find((t:{id:string})=>t.id===taskId);expect(after.plannedEndAt).toBe(old.plannedEndAt);expect(after.baselineEndAt).toBe(old.baselineEndAt);
});
it('parts proposes, coordinator records external authorization, only matching approved quote permits purchase',async()=>{
 const part=await c.post(`/cases/${caseId}/parts`,{description:'قطعه آزمون بازار',quantity:1,source:'external'});expect(part.status).toBe(201);partId=part.body.id;
 expect((await c.post(`/parts/${partId}/actions`,{action:'order',expectedVersion:1,source:'external',unitPriceRial:1000})).status).toBe(403);
 const quoteBody={expectedVersion:1,unitPriceRial:1000,supplier:'فروشنده آزمون',validUntil:new Date(Date.now()+86400000).toISOString()};
 expect((await p.post(`/workshop/parts/${partId}/quotes`,quoteBody)).status).toBe(201);
 const q=(await c.get('/workshop/quotes')).body[0];
 const order={action:'order',expectedVersion:2,source:'external',unitPriceRial:1000,supplier:'فروشنده آزمون'};
 expect((await p.post(`/parts/${partId}/actions`,order)).body.code).toBe('MARKET_APPROVAL_REQUIRED');
 const decision={expectedVersion:1,decision:'approved',officialRecorded:true,source:'golden_card',reference:'TEST-APPROVAL-001',approver:'کارشناس آزمون',note:'ثبت مجوز سامانه رسمی آزمون'};
 // Spec section 7: the accident expert records the payer's answer; the parts clerk only proposes the price.
 expect((await p.post(`/workshop/quotes/${q.id}/decision`,decision)).status).toBe(403);
 expect((await c.post(`/workshop/quotes/${q.id}/decision`,{...decision,source:'insurer'})).body.code).toBe('QUOTE_WRONG_SOURCE');
 expect((await c.post(`/workshop/quotes/${q.id}/decision`,{...decision,officialRecorded:false})).body.code).toBe('OFFICIAL_APPROVAL_REQUIRED');
 expect((await c.post(`/workshop/quotes/${q.id}/decision`,decision)).status).toBe(201);
 expect((await p.post(`/parts/${partId}/actions`,{...order,unitPriceRial:1200})).body.code).toBe('MARKET_APPROVAL_REQUIRED');
 expect((await p.post(`/parts/${partId}/actions`,order)).status).toBe(201);
});
it('manager sees station reports but cannot perform operational actions',async()=>{
 const overview=await manager.get('/workshop/overview');expect(overview.status).toBe(200);expect(overview.body.tasks.find((t:{id:string})=>t.id===taskId).stationCode).toBe('TEST-B01');
 expect((await manager.post(`/cases/${caseId}/tasks`,{departmentId})).status).toBe(403);
 expect((await manager.post(`/workshop/parts/${partId}/quotes`,{})).status).toBe(403);
});
it('different tenant cannot read, assign, authorize or act on these resources',async()=>{
 const id=newId();await h.db.db.insert(tenants).values({id,code:'TEST-OTHER-'+id,name:'نمایندگی آزمون جدا',isTest:true});
 const [u]=await h.db.db.select().from(users).where(eq(users.username,'tech-other'));
 await h.db.db.update(users).set({tenantId:id,roles:['accident_expert']}).where(eq(users.id,u.id));
 // Re-login refreshes the tenant-bound session and permissions.
 const foreign=await h.login('tech-other');
 expect((await foreign.get('/workshop/overview')).body.tasks).toHaveLength(0);
 expect((await foreign.post(`/tasks/${taskId}/actions`,{action:'start',expectedVersion:1})).status).toBe(404);
 expect((await foreign.get(`/cases/${caseId}`)).status).toBe(404);
});
it('tells the technician when a part of the vehicle is ready to collect',async()=>{
 const mineOf=async()=>(await tech.get('/workshop/my-tasks')).body.find((t:{id:string})=>t.id===taskId);
 expect((await mineOf()).partsWaiting).toBeGreaterThanOrEqual(1);
 const part=(await c.get(`/cases/${caseId}/parts`)).body.find((x:{id:string})=>x.id===partId);
 const rec=await p.post(`/parts/${partId}/actions`,{action:'receive',expectedVersion:part.version,inspection:'ok'});
 expect(rec.status).toBe(201);
 expect((await mineOf()).partsReady).toMatchObject({count:1,names:['قطعه آزمون بازار'],pickup:[{id:partId,version:rec.body.version}]});
});
