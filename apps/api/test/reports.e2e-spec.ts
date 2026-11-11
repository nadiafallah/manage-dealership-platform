import { eq } from 'drizzle-orm';
import type { CaseDetail, CaseListItem, Department, Paged, ReportResult } from '@manage/shared';
import { writeFileSync } from 'node:fs';
import { renderReportPdf } from '../src/reports/pdf';
import { hashPassword } from '../src/auth/password';
import { newId } from '../src/common/ids';
import { departments, tenants, users, tasks } from '../src/db/schema';
import { readWorkbook } from '../src/parts/xlsx';
import { Client, LEGACY_QC_PERMISSIONS, createHarness, LEGACY_CASHIER_PERMISSIONS, daysAgo, TEST_PASSWORD, type Harness } from './harness';

// Reports center (docs/REPORTS_FA.md): figures, charts, work list and export
// agree under the same filter; vehicles are not double counted; access by
// role and dealership; no due date is not "late".

let h: Harness;
let manager: Client;
let supervisor: Client;
let expert: Client;
let parts: Client;
let cashier: Client;
let qc: Client;
let depts: Department[];
const dept = (code: string) => depts.find((d) => d.code === code)!.id;

const report = async (who: Client, query: string): Promise<ReportResult> => {
  const res = await who.get(`/reports?${query}`);
  expect(res.status).toBe(200);
  return res.body;
};
const kpi = (r: ReportResult, key: string) => r.kpis.find((k) => k.key === key)!;
const listTotal = async (query: string) => ((await manager.get(`/cases?${query}`)).body as Paged<CaseListItem>).total;

async function newCase(body: object = {}): Promise<CaseDetail> {
  const res = await expert.post('/cases', {
    customer: { fullName: 'مالک آزمون گزارش', phone: '09000007777' },
    vehicle: { brand: 'ایران‌خودرو', model: 'دنا', vin: `TESTVIN${Math.random().toString().slice(2, 12)}` },
    odometerKm: 1000,
    admittedAt: daysAgo(5),
    damageDescription: 'آزمون گزارش',
    coverageType: 'personal',
    ...body,
  });
  expect(res.status).toBe(201);
  return res.body;
}

beforeAll(async () => {
  h = await createHarness({ withCases: true });
  [manager, supervisor, expert, parts, cashier, qc] = await Promise.all([
    ...['manager', 'supervisor', 'expert', 'parts'].map((u) => h.login(u)),
    h.loginAs('payments', [], LEGACY_CASHIER_PERMISSIONS),
    h.loginAs('narrow', [], LEGACY_QC_PERMISSIONS),
  ]);
  depts = (await supervisor.get('/departments')).body;
});
afterAll(async () => {
  await h?.close();
});

describe('reports: access', () => {
  it('opens only the views a role may see, in the API and in the export', async () => {
    expect((await manager.get('/reports/views')).body).toMatchObject({ views: ['manager', 'parts', 'accident', 'workshop'], defaultView: 'manager' });
    expect((await parts.get('/reports/views')).body).toMatchObject({ views: ['parts'], defaultView: 'parts' });
    expect((await qc.get('/reports/views')).body).toMatchObject({ views: ['workshop'], defaultView: 'workshop' });
    expect((await expert.get('/reports/views')).body).toMatchObject({ views: ['accident','workshop'], defaultResponsible: null });
    expect((await cashier.get('/reports/views')).body.views).toEqual([]);
    expect((await parts.get('/reports?view=manager')).status).toBe(403);
    expect((await parts.get('/reports/export?view=manager')).status).toBe(403);
    expect((await qc.get('/reports?view=parts')).status).toBe(403);
    expect((await cashier.get('/reports?view=accident')).status).toBe(403);
  });
});

describe('reports: consistent figures', () => {
  it('manager figures equal their case lists and chart totals, without double counting', async () => {
    // One vehicle stopped by two part problems and with two parts: still one case, one vehicle.
    const c = await newCase({ officialDeadlineAt: daysAgo(1), stage: 'in_repair' });
    for (const reason of ['part_not_arrived', 'part_wrong_or_defective']) {
      expect((await supervisor.post(`/cases/${c.id}/blockers`, { reason, description: 'آزمون' })).status).toBe(201);
    }
    for (const d of ['چراغ جلو', 'سپر جلو']) {
      expect((await expert.post(`/cases/${c.id}/parts`, { description: d, source: 'stock', quantity: 2 })).status).toBe(201);
    }
    await newCase({ forecastDeliveryAt: daysAgo(2) }); // late only against the forecast
    await newCase(); // no due date at all

    const r = await report(manager, 'view=manager');
    expect(r.isTestData).toBe(true);
    expect(kpi(r, 'active').value).toBe(await listTotal('status=open'));
    expect(kpi(r, 'blocked').value).toBe(await listTotal('flag=blocked'));
    expect(kpi(r, 'overdue_official').value).toBe(await listTotal('flag=overdue_official'));
    expect(kpi(r, 'overdue_forecast').value).toBe(await listTotal('flag=overdue_forecast'));
    expect(kpi(r, 'ready').value).toBe(await listTotal('flag=ready'));
    // Distinct vehicles never exceed cases.
    expect(kpi(r, 'vehicles').value).toBeLessThanOrEqual(kpi(r, 'active').value);
    const stages = r.charts.find((x) => x.key === 'stages')!;
    expect(stages.bars.reduce((n, b) => n + b.value, 0)).toBe(kpi(r, 'active').value);
    // The work list has exactly one "overdue official deadline" row per counted case.
    expect(r.items.kinds.find((k) => k.kind === 'overdue_official')!.count).toBe(kpi(r, 'overdue_official').value);
    // Per-reason bars count cases; each bar equals the case list filtered by that reason.
    const reasons = r.charts.find((x) => x.key === 'blockers')!;
    for (const b of reasons.bars) expect(b.value).toBe(await listTotal(b.listQuery!));
    // Missing due date is its own count, not lateness.
    const completeness = r.charts.find((x) => x.key === 'completeness')!;
    expect(completeness.bars.find((b) => b.key === 'no_deadline')!.value).toBe(await listTotal('flag=no_deadline'));

    const p = await report(parts, 'view=parts');
    expect(kpi(p, 'stopped_by_parts').value).toBe(await listTotal('blockerReason=part_not_arrived'));
    expect(kpi(p, 'unchecked').quantity).toBeGreaterThanOrEqual(4); // 2 + 2 physical parts of this case
    const mine = (await report(parts, `view=parts&q=${encodeURIComponent(c.caseNumber)}`)).items.rows;
    expect(mine.filter((i) => i.kind === 'stopped_by_parts')).toHaveLength(1);
    expect(mine.filter((i) => i.kind === 'unchecked').map((i) => i.quantity)).toEqual([2, 2]);
  });

  it('orders the work list by due time, keeps rows without a due date last, and pages on the server', async () => {
    const r = await report(manager, 'view=accident&pageSize=3');
    expect(r.items.rows).toHaveLength(3);
    expect(r.items.total).toBeGreaterThan(3);
    const all = (await report(manager, 'view=accident&pageSize=200')).items.rows;
    const order = ['overdue', 'today', 'soon', 'later', 'none'];
    const ranks = all.map((i) => order.indexOf(i.priority));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(all.filter((i) => !i.dueAt).every((i) => i.priority === 'none' && i.priorityReason === 'بدون موعد')).toBe(true);
    // Page 2 continues page 1.
    const second = await report(manager, 'view=accident&pageSize=3&page=2');
    expect(second.items.rows[0]!.caseId).toBe(all[3]!.caseId);
  });

  it('excludes imported/legacy cases from time-in-stage and says how many', async () => {
    await newCase({ isLegacyEntry: true, stage: 'awaiting_parts', admittedAt: daysAgo(40) });
    const r = await report(manager, 'view=manager');
    const inStage = r.charts.find((x) => x.key === 'in_stage')!;
    expect(inStage.excluded!.count).toBeGreaterThanOrEqual(1);
    expect(inStage.excluded!.reason).toContain('ثبت نشده');
    const age = r.charts.find((x) => x.key === 'age')!;
    expect(age.bars.find((b) => b.label === 'بیش از ۳۰ روز')!.value).toBeGreaterThanOrEqual(1);
  });

  it('compares events with a same-length previous period and filters by responsible person', async () => {
    const r = await report(manager, 'view=manager&period=custom&from=1300/01/01&to=1300/12/29');
    expect(r.events.find((e) => e.key === 'admitted')!.current).toBe(0);
    const p = r.period;
    expect(new Date(p.to).getTime() - new Date(p.from).getTime()).toBe(new Date(p.previousTo).getTime() - new Date(p.previousFrom).getTime());
    expect((await manager.get('/reports?view=manager&period=custom&from=1405/08/05&to=1405/08/01')).body.code).toBe('INVALID_PERIOD');

    const mine = await report(expert, 'view=accident&responsibleUserId=me');
    expect(mine.filters.find((f) => f.key === 'responsible')!.value).toBe('کارشناس نمونه');
    expect(mine.items.rows.every((i) => i.responsible?.displayName === 'کارشناس نمونه')).toBe(true);
  });

  it('workshop view counts activities per unit and links bars back to the report', async () => {
    const c = await newCase({ stage: 'in_repair' });
    const t = (await supervisor.post(`/cases/${c.id}/tasks`, { departmentId: dept('paint') })).body;
    await supervisor.post(`/tasks/${t.id}/actions`, { action: 'start', expectedVersion: t.version });
    const r = await report(qc, `view=workshop&departmentId=${dept('paint')}`);
    expect(r.items.rows.every((i) => i.description.startsWith('نقاشی'))).toBe(true);
    expect(kpi(r, 'in_progress').value).toBeGreaterThanOrEqual(1);
    const all = await report(supervisor, 'view=workshop');
    const paint = all.charts[0]!.bars.find((b) => b.label === 'نقاشی')!;
    expect(paint.reportQuery).toBe(`departmentId=${dept('paint')}`);
  });
});

describe('reports: export and isolation', () => {
  it('exports every filtered row with title, time, period and filters', async () => {
    const r = await report(manager, 'view=accident&pageSize=2');
    const res = await manager
      .get('/reports/export?view=accident&pageSize=2')
      .buffer(true)
      .parse((resp, cb) => {
        const chunks: Buffer[] = [];
        resp.on('data', (d: Buffer) => chunks.push(d));
        resp.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    const [summary, items] = readWorkbook(new Uint8Array(res.body as Buffer));
    expect(summary!.name).toBe('خلاصه');
    expect(summary!.rows.flat().join(' ')).toContain('زمان تهیه');
    expect(summary!.rows.flat().join(' ')).toContain('داده آزمایشی');
    const header = items!.rows.findIndex((row) => row[0] === 'اولویت');
    expect(items!.rows.length - header - 1).toBe(r.items.total); // all rows, not the page of 2
    // No customer phone numbers in reports.
    expect(JSON.stringify(items!.rows)).not.toContain('0900000');
  });

  it('renders a Persian PDF with the embedded font, header and every filtered row across pages', async () => {
    for (let i = 0; i < 30; i++) await newCase({ officialDeadlineAt: daysAgo(i % 3) });
    const binary = (req: ReturnType<Client['get']>) =>
      req.buffer(true).parse((resp, cb) => {
        const chunks: Buffer[] = [];
        resp.on('data', (d: Buffer) => chunks.push(d));
        resp.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    const res = await binary(manager.get('/reports/pdf?view=accident'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    const pdf = res.body as Buffer;
    // Optional local copy for the visual and black-and-white print review.
    if (process.env.REPORT_PDF_OUT) writeFileSync(process.env.REPORT_PDF_OUT, pdf);
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-')).toBe(true);
    // Font program embedded (subset), not referenced from the system.
    expect(text).toMatch(/FontFile2/);
    expect(text).toMatch(/\/BaseFont \/[A-Z]{6}\+Vazirmatn-Regular/);
    expect(text).toMatch(/Vazirmatn-Bold/);
    expect((text.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1);
    expect((await parts.get('/reports/pdf?view=manager')).status).toBe(403);
    const r = await report(manager, 'view=accident');
    const long = await renderReportPdf({ ...r, items: { ...r.items, total: 1, rows: [{ ...r.items.rows[0]!, nextAction: 'پیگیری قطعه '.repeat(400) + 'END-OF-LONG-ROW' }] } }, 'نمایندگی ایران‌خودرو ۱۳۰۷ حسینی');
    const pages = (long.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
    expect(pages).toBeGreaterThan(1);
    expect(pages).toBeLessThan(8);
    if (process.env.REPORT_PDF_OUT) writeFileSync(process.env.REPORT_PDF_OUT.replace(/\.pdf$/, '-long.pdf'), long);
  });

  it('another dealership sees none of these cases and real dealerships are not marked as test data', async () => {
    const tenantId = newId();
    await h.db.db.insert(tenants).values({ id: tenantId, code: 'real-reports', name: 'نمایندگی واقعی آزمون', isTest: false });
    await h.db.db.insert(departments).values({ id: newId(), tenantId, code: 'body', name: 'صافکاری' });
    await h.db.db.insert(users).values({
      id: newId(),
      tenantId,
      username: 'manager-real',
      displayName: 'مدیر دیگر',
      passwordHash: await hashPassword(TEST_PASSWORD),
      roles: ['service_manager'],
      isTest: false,
    });
    const other = await h.login('manager-real', 'real-reports');
    const r = await report(other, 'view=manager');
    expect(r.isTestData).toBe(false);
    expect(kpi(r, 'active').value).toBe(0);
    expect(r.items.total).toBe(0);
  });
});


it('keeps station codes and station filtering in the report, Excel and PDF paths',async()=>{
 const c=await newCase();
 const created=await supervisor.post(`/cases/${c.id}/tasks`,{departmentId:dept('body'),title:'آزمون گزارش جایگاه'});expect(created.status).toBe(201);
 await h.db.db.update(tasks).set({stationSnapshot:{code:'TEST-REPORT-01',name:'جایگاه ساختگی گزارش',trade:'body'}}).where(eq(tasks.id,created.body.id));
 expect((await supervisor.post(`/tasks/${created.body.id}/actions`,{action:'start',expectedVersion:1})).status).toBe(201);
 const result=await report(manager,'view=workshop&stationCode=TEST-REPORT-01');
 expect(result.filters).toContainEqual({key:'station',label:'کد جایگاه ارجاع',value:'TEST-REPORT-01'});
 expect((await manager.get('/cases?stationCode=TEST-REPORT-01')).body.total).toBe(1);
 expect((await manager.get('/cases?stationCode=TEST-NONEXISTENT')).body.total).toBe(0);
 expect(result.items.rows).toHaveLength(1);expect(result.items.rows[0]!.stationCodes).toEqual(['TEST-REPORT-01']);
 const scopedManager=await report(manager,'view=manager&stationCode=TEST-REPORT-01');expect(scopedManager.kpis.find(k=>k.key==='active')?.listQuery).toBe('stationCode=TEST-REPORT-01');
 const filtered=await report(manager,'view=accident&stationCode=TEST-REPORT-01');expect(filtered.items.rows).toHaveLength(1);expect(filtered.items.rows.every(r=>r.caseId===c.id&&r.stationCodes?.includes('TEST-REPORT-01'))).toBe(true);
 const binary=(req:ReturnType<Client['get']>)=>req.buffer(true).parse((resp,cb)=>{const chunks:Buffer[]=[];resp.on('data',(d:Buffer)=>chunks.push(d));resp.on('end',()=>cb(null,Buffer.concat(chunks)));});
 const xlsx=await binary(manager.get('/reports/export?view=workshop&stationCode=TEST-REPORT-01'));expect(xlsx.status).toBe(200);
 const sheets=readWorkbook(new Uint8Array(xlsx.body as Buffer));expect(sheets[1]!.rows.flat()).toContain('کد جایگاه‌ها');expect(sheets[1]!.rows.flat()).toContain('TEST-REPORT-01');
 const pdf=await binary(manager.get('/reports/pdf?view=workshop&stationCode=TEST-REPORT-01'));expect(pdf.status).toBe(200);expect((pdf.body as Buffer).subarray(0,4).toString()).toBe('%PDF');
 if(process.env.WORKSHOP_PDF_OUT)writeFileSync(process.env.WORKSHOP_PDF_OUT,pdf.body as Buffer);
});
