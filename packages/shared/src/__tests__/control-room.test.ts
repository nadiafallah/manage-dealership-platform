import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analysisSentences, buildBays, buildFunnel, carState, type DeskFolder } from '../index';

const NOW = Date.parse('2026-11-10T09:00:00Z');
const folder = (id: string, x: Partial<DeskFolder>): DeskFolder => ({
  caseId: id, caseNumber: id, admissionNo: null, plate: null, vehicle: 'ریرا', customerName: null, coverageType: 'insurance',
  stage: 'in_repair', journey: 'repair', place: '', admittedAt: '2026-11-05T06:00:00Z', daysInShop: 5,
  next: { text: 'طبق برنامه', actor: 'technician', tone: 'ok' }, behind: false, responsibleUserId: null, responsibleName: null,
  parts: { total: 0, undecided: 0, inProgress: 0, ready: 0, emdadLate: 0 }, openBlockers: 0, tasks: [], ...x,
});

test('funnel: counts, average days in stage and the bottleneck by car-days', () => {
  const f = buildFunnel([
    folder('a', { journey: 'parts' }), folder('b', { journey: 'parts' }), folder('c', { journey: 'repair' }), folder('d', { journey: 'reception', daysInShop: 1 }),
  ], { a: 4, b: 3, c: 2 });
  const parts = f.find((s) => s.key === 'parts')!;
  assert.equal(parts.count, 2);
  assert.equal(parts.avgDays, 3.5);
  assert.equal(parts.bottleneck, true);
  assert.equal(f.filter((s) => s.bottleneck).length, 1);
  assert.equal(f.find((s) => s.key === 'reception')!.avgDays, 1);
});

test('live map: cars on their bay with three colours, and a waiting-for-parts bay', () => {
  const stations = [{ id: 's1', code: 'B1', name: 'صافکاری ۱', department: 'صافکاری' }, { id: 's2', code: 'P1', name: 'نقاشی', department: 'نقاشی' }];
  const onPlan = folder('a', { tasks: [{ department: 'صافکاری', station: 'B1', stationId: 's1', status: 'in_progress', plannedEndAt: '2026-11-11T10:00:00Z', assignedUserId: null }] });
  const late = folder('b', { tasks: [{ department: 'صافکاری', station: 'B1', stationId: 's1', status: 'in_progress', plannedEndAt: '2026-11-09T10:00:00Z', assignedUserId: null }] });
  const stopped = folder('c', { openBlockers: 1, tasks: [{ department: 'صافکاری', station: 'B1', stationId: 's1', status: 'in_progress', plannedEndAt: null, assignedUserId: null }] });
  const waiting = folder('d', { journey: 'parts', parts: { total: 1, undecided: 0, inProgress: 1, ready: 0, emdadLate: 1 } });
  const bays = buildBays([onPlan, late, stopped, waiting], stations, NOW);
  assert.deepEqual(bays[0]!.cars.map((c) => c.state), ['ok', 'late', 'stop']);
  assert.equal(bays[0]!.tone, 'warn');
  assert.equal(bays[1]!.tone, 'free');
  assert.equal(bays[2]!.label, 'انتظار قطعه');
  assert.equal(bays[2]!.cars[0]!.state, 'late');
  assert.equal(carState(onPlan, onPlan.tasks[0], NOW), 'ok');
});

test('analysis: three to five plain sentences, bottleneck first, no names', () => {
  const folders = [folder('a', { journey: 'parts', parts: { total: 1, undecided: 0, inProgress: 1, ready: 0, emdadLate: 1 } }), folder('b', { journey: 'parts' })];
  const funnel = buildFunnel(folders, { a: 4, b: 3 });
  const bays = buildBays(folders, [{ id: 's2', code: 'P1', name: 'نقاشی', department: 'نقاشی' }], NOW);
  const s = analysisSentences({ funnel, bays, folders, alerts: [], emdadLateDays: 3, emdadFresh: false, afterNoon: true });
  assert.ok(s.length >= 3 && s.length <= 5);
  assert.match(s[0]!, /^بیشترین توقف در «منتظر قطعه» است: ۲ خودرو/);
  assert.match(s[0]!, /بیش از ۳ روز/);
  assert.ok(s.some((x) => x.includes('گزارش امداد ویژهٔ امروز')));
  assert.equal(s.at(-1), 'همهٔ هشدارها پاسخ گرفته‌اند.');
  assert.deepEqual(analysisSentences({ funnel: buildFunnel([], {}), bays: [], folders: [], alerts: [], emdadLateDays: 3, emdadFresh: true, afterNoon: false }), ['الان خودرویی در تعمیرگاه ثبت نشده است.']);
});
