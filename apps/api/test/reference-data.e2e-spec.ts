import {eq} from 'drizzle-orm';
import {referenceEntries,referenceImports,tenants,users,auditEvents} from '../src/db/schema';
import {writeSheet} from '../src/parts/xlsx';
import {newId} from '../src/common/ids';
import {hashPassword} from '../src/auth/password';
import { Client, LEGACY_QC_PERMISSIONS, createHarness, TEST_PASSWORD, type Harness } from './harness';

let h:Harness,manager:Client,parts:Client,qc:Client;
const file=(kind:'parts'|'customers',rows:string[][])=>({kind,fileName:'synthetic.xlsx',fileBase64:Buffer.from(writeSheet('داده آزمون',rows)).toString('base64')});
const partPreview=(rows:string[][],who=manager)=>who.post('/reference-imports',{...file('parts',[['کد','نام','موجودی'],...rows]),sheetIndex:0,headerRow:1,mapping:{partNumber:0,description:1,quantity:2}});
const customerFile=()=>file('customers',[['شاسی','نام','تلفن','مدل'],['TESTCHS001','مشتری آزمون اول','09000000001','خودرو آزمون'],['TESTCHS001','مشتری آزمون دوم','09000000002','خودرو آزمون']]);
const customerPreview=(who=manager)=>who.post('/reference-imports',{...customerFile(),sheetIndex:0,headerRow:1,mapping:{chassis:0,fullName:1,phone:2,model:3}});
beforeAll(async()=>{h=await createHarness();[manager,parts,qc]=await Promise.all([h.login('admin'),h.login('parts'),h.loginAs('narrow',[],LEGACY_QC_PERMISSIONS)]);});
afterAll(async()=>{await h?.close();});

it('inspects sheets, validates mappings and preserves code leading zeroes',async()=>{
 const inspect=await manager.post('/reference-imports/inspect',file('parts',[['کد','نام'],['۰۰۱۲۳','قطعه آزمون']]));expect(inspect.status).toBe(201);expect(inspect.body.sheets[0].rows[1].cells[0]).toBe('۰۰۱۲۳');
 const p=await partPreview([['۰۰۱۲۳','قطعه آزمون','5']]);expect(p.status).toBe(201);expect(p.body.rows[0].data.partNumber).toBe('00123');
 expect(await h.db.db.select().from(referenceEntries)).toHaveLength(0);
 const applied=await manager.post(`/reference-imports/${p.body.id}/apply`);expect(applied.status).toBe(201);expect(applied.body.counts.new).toBe(1);
 const found=await manager.post('/reference-data/parts/search',{query:'۰۰۱۲'});expect(found.body.records[0].data).toMatchObject({partNumber:'00123',description:'قطعه آزمون',quantity:'5'});
 expect((await manager.post(`/reference-imports/${p.body.id}/apply`)).status).toBe(409);
 const repeat=await partPreview([['00123','قطعه آزمون','5']]);expect(repeat.body.counts.unchanged).toBe(1);
});
it('keeps every error/duplicate row and rejects arbitrary/duplicate mapping columns',async()=>{
 const p=await partPreview([['DUP001','قطعه یک','1'],['DUP001','قطعه دیگر','2'],['BAD001','قطعه بد','-1'],['','بدون کد','']]);expect(p.status).toBe(201);expect(p.body.counts).toMatchObject({duplicate:2,error:2,new:0});
 const invalid=await manager.post('/reference-imports',{...file('parts',[['کد','نام'],['A','B']]),sheetIndex:0,headerRow:1,mapping:{partNumber:0,description:0}});expect(invalid.status).toBe(422);
 const report=await manager.get(`/reference-imports/${p.body.id}/report`);expect(report.status).toBe(200);
});
it('supports previewed updates, preserves blank fields and detects stale previews',async()=>{
 const a=await partPreview([['UPD001','نام اولیه','4']]);expect((await manager.post(`/reference-imports/${a.body.id}/apply`)).status).toBe(201);
 const b=await partPreview([['UPD001','نام جدید','']]),stale=await partPreview([['UPD001','نام موازی','6']]);expect(b.body.counts.update).toBe(1);
 expect((await manager.post(`/reference-imports/${b.body.id}/apply`)).status).toBe(201);
 const blocked=await manager.post(`/reference-imports/${stale.body.id}/apply`);expect(blocked.body.counts.conflict).toBe(1);
 const found=await manager.post('/reference-data/parts/search',{query:'UPD001'});expect(found.body.records[0].data).toMatchObject({description:'نام جدید',quantity:'4'});expect(found.body.records[0].data._quantityFileName).toBe('synthetic.xlsx');
});
it('serializes concurrent imports of the same part without duplicate entries',async()=>{
 const a=await partPreview([['RACE001','قطعه هم‌زمان','2']]),b=await partPreview([['RACE001','قطعه هم‌زمان','2']]);
 const outcomes=await Promise.all([manager.post(`/reference-imports/${a.body.id}/apply`),manager.post(`/reference-imports/${b.body.id}/apply`)]);expect(outcomes.every(r=>r.status===201)).toBe(true);
 const found=await manager.post('/reference-data/parts/search',{query:'RACE001'});expect(found.body.records).toHaveLength(1);
});
it('keeps different historical customers for a chassis without creating operational cases',async()=>{
 const p=await customerPreview();expect(p.status).toBe(201);expect((await manager.post(`/reference-imports/${p.body.id}/apply`)).status).toBe(201);
 const found=await manager.post('/reference-data/customers/search',{query:'testchs001'});expect(found.status).toBe(201);expect(found.headers['cache-control']).toBe('no-store');expect(found.body.records).toHaveLength(2);
 expect(found.body.records.map((r:{data:{fullName:string}})=>r.data.fullName)).toEqual(expect.arrayContaining(['مشتری آزمون اول','مشتری آزمون دوم']));
 expect((await customerPreview()).body.counts.unchanged).toBe(2);
 expect((await manager.get('/cases')).body.total).toBe(0);
 expect((await manager.post('/reference-data/customers/search',{query:'TESTCHS'})).body.records).toHaveLength(0);
 expect((await manager.post('/reference-data/customers/search',{query:'TEST'})).status).toBe(422);
});
it('does not expose customers to parts/QC roles or allow unauthorized imports',async()=>{
 expect((await parts.post('/reference-data/parts/search',{query:'00123'})).status).toBe(201);
 expect((await parts.post('/reference-data/customers/search',{query:'TESTCHS001'})).status).toBe(403);
 expect((await customerPreview(parts)).status).toBe(403);
 expect((await qc.post('/reference-data/parts/search',{query:'00123'})).status).toBe(403);
});
it('isolates previews, reports, apply and search across dealerships; writes audited transactions',async()=>{
 const p=await partPreview([['TENANT001','قطعه خصوصی آزمون','1']]);
 const tenantId=newId();await h.db.db.insert(tenants).values({id:tenantId,code:'reference-other',name:'نمایندگی آزمون دیگر',isTest:true});
 await h.db.db.insert(users).values({id:newId(),tenantId,username:'reference-other-manager',displayName:'مدیر آزمون',passwordHash:await hashPassword(TEST_PASSWORD),roles:['system_admin'],isTest:true});
 const other=await h.login('reference-other-manager','reference-other');
 expect((await other.get(`/reference-imports/${p.body.id}`)).status).toBe(404);expect((await other.get(`/reference-imports/${p.body.id}/report`)).status).toBe(404);expect((await other.post(`/reference-imports/${p.body.id}/apply`)).status).toBe(404);
 expect((await other.post('/reference-data/customers/search',{query:'TESTCHS001'})).body.records).toEqual([]);
 expect((await other.get('/reference-data/parts')).body.count).toBe(0);
 expect(await h.db.db.select().from(auditEvents).where(eq(auditEvents.action,'reference.applied'))).not.toHaveLength(0);
 expect(await h.db.db.select().from(referenceImports)).not.toHaveLength(0);
});

it('accepts full manufacturer trim descriptions and exposes editable admission numbers in list/search',async()=>{
 const trim='شرح تجهیزات خودرو '.repeat(40),fullName='نام سازمان و مشتری '.repeat(12);
 const created=await manager.post('/cases',{admissionNo:'۱۴۰۵۱۲۳۴۵۶',admittedAt:new Date(Date.now()-86400000).toISOString(),vehicle:{model:'خودرو آزمون',trim,plate:'پلاک آزمون'},customer:{fullName,phone:'09000000003'}});
 expect(created.status).toBe(201);expect(created.body.vehicle.trim).toBe(trim.trim());expect(created.body.customer.fullName).toBe(fullName.trim());
 const listed=await manager.get('/cases?q=1405123456');expect(listed.body.items.some((c:{id:string;admissionNo:string})=>c.id===created.body.id&&!!c.admissionNo)).toBe(true);
 const updated=await manager.patch(`/cases/${created.body.id}`,{expectedVersion:created.body.version,admissionNo:'1405999999',vehicle:{plate:'پلاک اصلاح شده'},customer:{fullName:'مشتری اصلاح شده',phone:'09000000004'}});expect(updated.status).toBe(200);expect(updated.body.vehicle.plate).toBe('پلاک اصلاح شده');expect(updated.body.caseNumber).toBe(created.body.caseNumber);
 expect((await manager.get('/cases?q=1405999999')).body.items.some((c:{id:string})=>c.id===created.body.id)).toBe(true);
});
it('keeps meaningful limits and explains invalid input in Persian without losing text',async()=>{
 const tooLong=await manager.post('/cases',{admittedAt:new Date().toISOString(),vehicle:{trim:'x'.repeat(1001)}});expect(tooLong.status).toBe(400);expect(tooLong.body.details[0].message).toContain('شرح تیپ خودرو');expect(tooLong.body.details[0].message).toContain('1000');
 const date=await manager.post('/cases',{admittedAt:'۱۴۰۵/۰۸/۰۱'});expect(date.status).toBe(400);expect(date.body.details[0].message).toContain('تاریخ پذیرش');
});
