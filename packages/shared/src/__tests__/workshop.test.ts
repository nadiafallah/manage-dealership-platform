import test from 'node:test';
import assert from 'node:assert/strict';
import { isWorkingDay, addWorkingMinutes, workingMinutesBetween, DEFAULT_WORK_CALENDAR, calendarSchema, unionElapsedMinutes } from '../workshop';
import { permissionsFor } from '../permissions';
test('eight working hours across Wednesday evening and Thursday morning',()=>{
  const start='2026-11-04T15:30:00+03:30';
  const end=addWorkingMinutes(start,480,DEFAULT_WORK_CALENDAR);
  assert.equal(end,new Date('2026-11-05T13:00:00+03:30').toISOString());
  assert.equal(workingMinutesBetween(start,end,DEFAULT_WORK_CALENDAR),480);
});
test('lunch, Friday and recorded holidays are excluded',()=>{
  assert.equal(addWorkingMinutes('2026-11-05T12:00:00+03:30',120,DEFAULT_WORK_CALENDAR),new Date('2026-11-07T09:00:00+03:30').toISOString());
  const calendar={...DEFAULT_WORK_CALENDAR,holidays:[{date:'2026-11-07',title:'تعطیلی آزمون',official:true}]};
  assert.equal(addWorkingMinutes('2026-11-05T12:00:00+03:30',120,calendar),new Date('2026-11-08T09:00:00+03:30').toISOString());
  assert.equal(workingMinutesBetween('2026-11-07T13:00:00+03:30','2026-11-07T15:30:00+03:30',DEFAULT_WORK_CALENDAR),0);
});
test('calendar validates dates, nonoverlap and available work',()=>{
  assert.equal(calendarSchema.safeParse({...DEFAULT_WORK_CALENDAR,week:Array.from({length:7},()=>[])}).success,false);
  const week=structuredClone(DEFAULT_WORK_CALENDAR.week);week[0]=[{start:480,end:780},{start:700,end:800}];
  assert.equal(calendarSchema.safeParse({...DEFAULT_WORK_CALENDAR,week}).success,false);
  assert.equal(calendarSchema.safeParse({...DEFAULT_WORK_CALENDAR,holidays:[{date:'2026-02-30',title:'غلط',official:false}]}).success,false);
});
test('overlapping blockers count once per vehicle',()=>{
  assert.equal(unionElapsedMinutes([{start:'2026-11-01T08:00:00Z',end:'2026-11-01T10:00:00Z'},{start:'2026-11-01T09:00:00Z',end:'2026-11-01T11:00:00Z'}]),180);
});
test('roles separate parts supply, expert coordination, reporting and own execution',()=>{
  const c=permissionsFor(['accident_expert']);assert(c.has('part.request'));assert(c.has('part.price_authorize'));assert(!c.has('part.manage'));assert(!c.has('stock.issue'));assert(!c.has('stock.reserve'));
  // Retired roles resolve to the accident expert, so old rows keep working until migrated.
  assert.deepEqual(permissionsFor(['accident_coordinator']),c);assert.deepEqual(permissionsFor(['accident_supervisor']),c);assert.deepEqual(permissionsFor(['qc_inspector']),c);
  const p=permissionsFor(['parts_clerk']);assert(p.has('part.quote'));assert(p.has('part.manage'));assert(!p.has('part.price_authorize'));assert(p.has('daily_reports.apply'));
  const m=permissionsFor(['service_manager']);assert(m.has('report.manager'));assert(!m.has('task.manage'));assert(!m.has('case.create'));assert(!m.has('part.manage'));
  assert.deepEqual([...permissionsFor(['technician'])],['task.execute']);
  assert.equal(permissionsFor(['cashier']).size,0);
});

test('isWorkingDay: Friday and recorded holidays are closed', () => {
  assert.equal(isWorkingDay('2026-12-04', DEFAULT_WORK_CALENDAR), false); // Friday
  assert.equal(isWorkingDay('2026-12-03', DEFAULT_WORK_CALENDAR), true); // Thursday half day
  assert.equal(isWorkingDay('2026-12-05', DEFAULT_WORK_CALENDAR), true); // Saturday
  assert.equal(isWorkingDay('2026-12-05', { ...DEFAULT_WORK_CALENDAR, holidays: [{ date: '2026-12-05', title: 'تعطیلی', official: true }] }), false);
});
