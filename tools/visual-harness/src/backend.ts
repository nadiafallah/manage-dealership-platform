// In-browser fake API for the visual harness. Every number on screen is
// derived from synthetic folders through the real shared rules (folderNextStep,
// buildBays, buildFunnel, analysisSentences…), like the API does.
// Synthetic data only: phones 0900…, VIN TESTVIN…, tenant marked test.
import {
  ALERT_TABLE, MODULES, STAGE_LABELS, allowedPartActions, analysisSentences, buildBays, buildFunnel, folderBehind, folderNextStep, folderPlace, journeyStep, permissionsFor,
  type CaseDetail, type CaseStage, type ControlRoomSnapshot, type CoverageType, type DeskFolder, type FolderTaskFact, type Me, type Part, type PartFlowState, type ReceivedReminder,
  type ReportResult, type Role, type Task, type TaskStatus, type TimelineEvent, type UnansweredAlert, type WorkItem,
} from '@manage/shared';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const ahead = (ms: number) => new Date(NOW + ms).toISOString();
const fa = (n: number | string) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]!);

const TENANT = { id: 't-test', code: 'TEST', name: 'نمایندگی نمونه (آزمایشی)' };
const PEOPLE = {
  expert: { id: 'u-exp1', displayName: 'کارشناس نمونه ۱', username: 'expert1', roles: ['accident_expert'] as Role[] },
  expert2: { id: 'u-exp2', displayName: 'کارشناس نمونه ۲', username: 'expert2', roles: ['accident_expert'] as Role[] },
  expert3: { id: 'u-exp3', displayName: 'کارشناس نمونه ۳', username: 'expert3', roles: ['accident_expert'] as Role[] },
  parts: { id: 'u-parts', displayName: 'مسئول قطعات نمونه', username: 'parts1', roles: ['parts_clerk'] as Role[] },
  manager: { id: 'u-mgr', displayName: 'مدیر خدمات نمونه', username: 'manager1', roles: ['service_manager'] as Role[] },
  admin: { id: 'u-admin', displayName: 'مدیر سیستم نمونه', username: 'admin', roles: ['system_admin'] as Role[], isOwner: true },
  techBody: { id: 'u-tb', displayName: 'تکنسین صافکاری نمونه', username: 't.body', roles: ['technician'] as Role[] },
  techPaint: { id: 'u-tp', displayName: 'تکنسین نقاشی نمونه', username: 't.paint', roles: ['technician'] as Role[] },
  techFront: { id: 'u-tf', displayName: 'تکنسین جلوبندی نمونه', username: 't.front', roles: ['technician'] as Role[] },
};
export type As = keyof typeof PEOPLE;

const DEPTS = { body: { id: 'd-body', code: 'body', name: 'صافکاری' }, paint: { id: 'd-paint', code: 'paint', name: 'نقاشی' }, mechanical: { id: 'd-mech', code: 'mechanical', name: 'مکانیکی' }, suspension: { id: 'd-susp', code: 'suspension', name: 'جلوبندی' } };
type DeptKey = keyof typeof DEPTS;
const STATIONS = [
  { id: 's-B1', code: 'B1', name: 'صافکاری ۱', department: 'صافکاری' },
  { id: 's-B2', code: 'B2', name: 'صافکاری ۲', department: 'صافکاری' },
  { id: 's-P1', code: 'P1', name: 'نقاشی', department: 'نقاشی' },
  { id: 's-S1', code: 'S1', name: 'جلوبندی', department: 'جلوبندی' },
  { id: 's-M1', code: 'M1', name: 'مکانیک', department: 'مکانیکی' },
];

interface TaskSpec { dept: DeptKey; station: string; status: TaskStatus; end: number; title: string; tech: As }
interface PartSpec { d: string; code: string; state: PartFlowState; price?: number; emdadDays?: number }
interface CarSpec { i: number; model: string; plate: string; cov: CoverageType; days: number; stage: CaseStage; by: As; tasks?: TaskSpec[]; parts?: PartSpec[]; blockers?: number; problem?: { label: string; hours: number } }

const CARS: CarSpec[] = [
  { i: 6, model: 'ریرا', plate: '23ب456-16', cov: 'insurance', days: 0.1, stage: 'reception', by: 'expert' },
  { i: 7, model: 'سورن پلاس', plate: '47ج812-16', cov: 'golden_card', days: 0.3, stage: 'reception', by: 'expert2' },
  { i: 8, model: 'رانا پلاس', plate: '19ه538-16', cov: 'insurance', days: 1, stage: 'reception', by: 'expert' },
  { i: 9, model: 'پژو پارس', plate: '52م907-16', cov: 'personal', days: 2, stage: 'assessment', by: 'expert', parts: [{ d: 'سپر جلو', code: '11010123', state: 'needed', price: 38_000_000 }, { d: 'چراغ جلو راست', code: '11010456', state: 'needed', price: 54_000_000 }] },
  { i: 10, model: 'تارا', plate: '68د193-16', cov: 'personal', days: 2, stage: 'assessment', by: 'expert3', parts: [{ d: 'اتاق کامل', code: '12010000', state: 'needed', price: 650_000_000 }] },
  { i: 11, model: 'دنا پلاس', plate: '33ل224-16', cov: 'golden_card', days: 7, stage: 'awaiting_parts', by: 'expert', parts: [{ d: 'گلگیر جلو چپ', code: '13010110', state: 'emdad', emdadDays: 5, price: 27_000_000 }, { d: 'براکت سپر جلو', code: '13010114', state: 'reserved', price: 4_200_000 }] },
  { i: 12, model: 'سمند', plate: '71س602-16', cov: 'golden_card', days: 6, stage: 'awaiting_parts', by: 'expert2', parts: [{ d: 'گلگیر جلو چپ', code: '13010120', state: 'emdad', emdadDays: 4, price: 25_000_000 }] },
  { i: 13, model: 'پژو ۲۰۷', plate: '84ط119-16', cov: 'golden_card', days: 3, stage: 'awaiting_parts', by: 'expert', parts: [{ d: 'گلگیر جلو چپ', code: '13010130', state: 'emdad', emdadDays: 1, price: 29_000_000 }] },
  { i: 14, model: 'هایما', plate: '15ی880-16', cov: 'insurance', days: 3, stage: 'awaiting_parts', by: 'expert', parts: [{ d: 'آینهٔ بغل راست', code: '14010077', state: 'ready', price: 48_000_000 }] },
  { i: 15, model: 'ریرا', plate: '29ق345-16', cov: 'insurance', days: 4, stage: 'in_repair', by: 'expert', tasks: [{ dept: 'body', station: 'B1', status: 'in_progress', end: DAY, title: 'صافکاری گلگیر و در', tech: 'techBody' }, { dept: 'paint', station: 'P1', status: 'pending', end: 3 * DAY, title: 'نقاشی', tech: 'techPaint' }], parts: [{ d: 'درب جلو راست', code: '15010001', state: 'handed_over', price: 120_000_000 }, { d: 'رکاب راست', code: '15010009', state: 'market', price: 18_000_000 }] },
  { i: 16, model: 'شاهین', plate: '61و774-16', cov: 'personal', days: 5, stage: 'in_repair', by: 'expert2', tasks: [{ dept: 'suspension', station: 'S1', status: 'in_progress', end: -DAY, title: 'جلوبندی', tech: 'techFront' }] },
  { i: 17, model: 'تیبا', plate: '38ص206-16', cov: 'insurance', days: 4, stage: 'in_repair', by: 'expert', tasks: [{ dept: 'body', station: 'B2', status: 'done', end: -2 * HOUR, title: 'صافکاری سپر عقب', tech: 'techBody' }, { dept: 'paint', station: 'P1', status: 'pending', end: 2 * DAY, title: 'نقاشی سپر عقب', tech: 'techPaint' }] },
  { i: 18, model: 'پژو ۴۰۵', plate: '27ن918-16', cov: 'golden_card', days: 6, stage: 'in_repair', by: 'expert3', tasks: [{ dept: 'mechanical', station: 'M1', status: 'in_progress', end: DAY, title: 'مکانیک — پایین آوردن موتور', tech: 'techFront' }], problem: { label: 'قطعه ندارم', hours: 5 } },
  { i: 19, model: 'دنا', plate: '44ک651-16', cov: 'insurance', days: 8, stage: 'in_repair', by: 'expert', tasks: [{ dept: 'paint', station: 'P1', status: 'in_progress', end: -2 * DAY, title: 'نقاشی کامل', tech: 'techPaint' }] },
  { i: 20, model: 'پژو ۲۰۶', plate: '92ر337-16', cov: 'personal', days: 3, stage: 'in_repair', by: 'expert3', tasks: [{ dept: 'paint', station: 'P1', status: 'pending', end: 2 * DAY, title: 'نقاشی درب عقب', tech: 'techPaint' }] },
  { i: 21, model: 'آریسان', plate: '56ت482-16', cov: 'insurance', days: 9, stage: 'quality_control', by: 'expert', tasks: [{ dept: 'body', station: 'B1', status: 'approved', end: -3 * DAY, title: 'صافکاری', tech: 'techBody' }, { dept: 'paint', station: 'P1', status: 'approved', end: -DAY, title: 'نقاشی', tech: 'techPaint' }] },
  { i: 22, model: 'سورن', plate: '13ع765-16', cov: 'golden_card', days: 10, stage: 'ready_for_delivery', by: 'expert2', tasks: [{ dept: 'body', station: 'B2', status: 'approved', end: -4 * DAY, title: 'صافکاری', tech: 'techBody' }] },
];

const caseId = (i: number) => `case-${String(i).padStart(2, '0')}`;
const caseNo = (i: number) => `AC-1405-${String(i + 40).padStart(4, '0')}`;
const station = (code: string) => STATIONS.find((s) => s.code === code)!;

function partFacts(c: CarSpec) {
  const ps = c.parts ?? [];
  const inProg: PartFlowState[] = ['emdad', 'dealer_supply', 'market', 'reserved'];
  return {
    total: ps.length,
    undecided: ps.filter((p) => p.state === 'needed').length,
    inProgress: ps.filter((p) => inProg.includes(p.state)).length,
    ready: ps.filter((p) => p.state === 'ready').length,
    emdadLate: ps.filter((p) => p.state === 'emdad' && (p.emdadDays ?? 0) > 3).length,
  };
}
function taskFacts(c: CarSpec): FolderTaskFact[] {
  return (c.tasks ?? []).map((t, k, all) => ({ department: DEPTS[t.dept].name, station: t.station, status: t.status, plannedEndAt: ahead(t.end), waiting: all.slice(0, k).some((x) => x.status !== 'approved' && x.status !== 'done') }));
}

export const FOLDERS: DeskFolder[] = CARS.map((c) => {
  const facts = { stage: c.stage, tasks: taskFacts(c), parts: partFacts(c), openBlockers: c.blockers ?? 0, problems: c.problem ? [c.problem] : [] };
  return {
    caseId: caseId(c.i),
    caseNumber: caseNo(c.i),
    admissionNo: `P-${fa(5200 + c.i)}`,
    plate: c.plate,
    vehicle: c.model,
    customerName: `مشتری نمونه ${fa(c.i)}`,
    coverageType: c.cov,
    stage: c.stage,
    journey: journeyStep(c.stage),
    place: folderPlace(facts, STAGE_LABELS[c.stage]),
    admittedAt: ago(c.days * DAY),
    daysInShop: Math.floor(c.days),
    next: folderNextStep(facts, NOW),
    behind: folderBehind(facts, NOW),
    responsibleUserId: PEOPLE[c.by].id,
    responsibleName: PEOPLE[c.by].displayName,
    parts: facts.parts,
    openBlockers: facts.openBlockers,
    tasks: (c.tasks ?? []).map((t, k) => ({ ...facts.tasks[k]!, assignedUserId: PEOPLE[t.tech].id, stationId: station(t.station).id })),
  };
});

function tasksOf(c: CarSpec): Task[] {
  return (c.tasks ?? []).map((t, k) => ({
    id: `task-${c.i}-${k}`,
    caseId: caseId(c.i),
    department: DEPTS[t.dept],
    title: t.title,
    technicianName: PEOPLE[t.tech].displayName,
    technicianCode: PEOPLE[t.tech].username,
    assignedUserId: PEOPLE[t.tech].id,
    stationId: station(t.station).id,
    stationCode: t.station,
    stationName: station(t.station).name,
    status: t.status,
    plannedStartAt: ahead(t.end - DAY),
    plannedEndAt: ahead(t.end),
    baselineEndAt: ahead(t.end),
    actualStartAt: t.status === 'pending' ? null : ahead(t.end - DAY),
    actualEndAt: t.status === 'done' || t.status === 'approved' ? ahead(t.end) : null,
    approvedAt: t.status === 'approved' ? ahead(t.end) : null,
    approvedBy: t.status === 'approved' ? { id: PEOPLE[c.by].id, displayName: PEOPLE[c.by].displayName } : null,
    dependsOn: k ? [`task-${c.i}-${k - 1}`] : [],
    qcInspectionId: null,
    weight: 1,
    notes: null,
    version: 1,
  }));
}

function detailOf(c: CarSpec): CaseDetail {
  const f = FOLDERS.find((x) => x.caseId === caseId(c.i))!;
  const by = PEOPLE[c.by];
  return {
    id: caseId(c.i),
    caseNumber: caseNo(c.i),
    admissionNo: f.admissionNo,
    stage: c.stage,
    status: 'open',
    coverageType: c.cov,
    admittedAt: f.admittedAt,
    admittedAtPrecision: 'minute',
    officialDeadlineAt: ahead(10 * DAY - c.days * DAY),
    forecastDeliveryAt: ahead(5 * DAY),
    vehicleLabel: `ایران‌خودرو ${c.model}`,
    vehicleSummary: c.model,
    plate: c.plate,
    vin: `TESTVIN1${String(c.i).padStart(9, '0')}`,
    responsible: { id: by.id, displayName: by.displayName },
    openBlockers: c.blockers ?? 0,
    progressPercent: { reception: 5, assessment: 15, awaiting_approval: 25, awaiting_parts: 35, in_repair: 60, quality_control: 85, ready_for_delivery: 95, delivered: 100 }[c.stage],
    missingFields: c.stage === 'reception' ? ['odometerKm'] : [],
    isLegacyEntry: false,
    isTest: true,
    repairPlan: null,
    version: 3,
    customer: { id: `cust-${c.i}`, fullName: `مشتری نمونه ${fa(c.i)}`, phone: `0900100${String(c.i).padStart(4, '0')}`, phoneMasked: false },
    vehicle: { id: `veh-${c.i}`, brand: 'ایران‌خودرو', model: c.model, trim: null, modelYear: 1400 + (c.i % 5), plate: c.plate, vin: `TESTVIN1${String(c.i).padStart(9, '0')}`, color: c.i % 2 ? 'سفید' : 'نقره‌ای', chassisRef: null },
    origin: 'manual',
    odometerKm: c.stage === 'reception' ? null : 42_000 + c.i * 1_300,
    damageDescription: 'خسارت نمونه برای نمایش (ساختگی).',
    vehicleLocation: f.place,
    goldenCardFileNo: c.cov === 'golden_card' ? `GC-TEST-${c.i}` : null,
    insurerName: c.cov === 'insurance' ? 'بیمهٔ نمونه' : null,
    insuranceClaimNo: c.cov === 'insurance' ? `INS-TEST-${c.i}` : null,
    coverageNotes: null,
    actualDeliveryAt: null,
    createdAt: f.admittedAt,
    createdBy: { id: by.id, displayName: by.displayName },
    updatedAt: ago(2 * HOUR),
    tasks: tasksOf(c),
    blockers: [],
  } as CaseDetail;
}

const STATUS_OF: Record<PartFlowState, Part['status']> = { needed: 'needed', reserved: 'reserved', emdad: 'ordered', dealer_supply: 'ordered', market: 'ordered', ready: 'received', handed_over: 'handed_over', consumed: 'handed_over', cancelled: 'cancelled', returned: 'cancelled' };
function partsOf(c: CarSpec): Part[] {
  return (c.parts ?? []).map((p, k) => ({
    id: `part-${c.i}-${k}`,
    caseId: caseId(c.i),
    assessmentItemId: null,
    description: p.d,
    partNumber: p.code,
    quantity: 1,
    source: p.state === 'market' ? 'external' : p.state === 'reserved' ? 'stock' : 'company',
    status: STATUS_OF[p.state],
    inStock: p.state === 'reserved' ? true : null,
    stockCheckedAt: null,
    reservedAt: p.state === 'reserved' ? ago(DAY) : null,
    approvedUnitPriceRial: p.price ?? null,
    salePriceRial: p.state === 'market' || p.state === 'ready' ? p.price ?? null : null,
    unitPriceRial: p.price ?? null,
    priceApprovalRef: null,
    priceApprovedBy: null,
    supplier: p.state === 'market' || p.state === 'ready' ? 'فروشگاه نمونه' : null,
    orderRef: p.state === 'emdad' ? `4027${c.i}135` : null,
    orderedAt: p.emdadDays ? ago(p.emdadDays * DAY) : p.state === 'market' ? ago(DAY) : null,
    etaAt: p.state === 'market' ? ahead(DAY) : null,
    firstEtaAt: null,
    receivedAt: p.state === 'ready' || p.state === 'handed_over' ? ago(6 * HOUR) : null,
    receiptDocNo: null,
    inspection: null,
    inspectionNote: null,
    handedOverAt: p.state === 'handed_over' ? ago(3 * HOUR) : null,
    handedOverDepartment: p.state === 'handed_over' ? { id: DEPTS.body.id, name: DEPTS.body.name } : null,
    recipientName: null,
    cancelledAt: null,
    cancelReason: null,
    financeBasis: null,
    notes: null,
    createdAt: ago(c.days * DAY),
    createdBy: { id: PEOPLE[c.by].id, displayName: PEOPLE[c.by].displayName },
    overdue: (p.emdadDays ?? 0) > 3,
    version: 2,
    flowState: p.state,
    allowedActions: allowedPartActions(p.state),
    fromSupplement: false,
    consumedAt: null,
    returnedAt: null,
    returnReason: null,
    emdad: p.state === 'emdad' ? { requestNo: `4027${c.i}135`, category: 'pending', statusText: 'در انتظار تأمین', reportAt: ago(5 * HOUR) } : null,
    priceNotice: null,
  } as Part));
}

function controlRoom(range: string): ControlRoomSnapshot {
  const bays = buildBays(FOLDERS, STATIONS, NOW);
  const funnel = buildFunnel(FOLDERS, {});
  const R = (as: As) => [PEOPLE[as].id];
  const alert = (a: Omit<UnansweredAlert, 'plate' | 'vehicle' | 'caseNumber' | 'waitingHours' | 'since'> & { hours: number }): UnansweredAlert => {
    const f = FOLDERS.find((x) => x.caseId === a.caseId);
    const { hours, ...rest } = a;
    return { ...rest, caseNumber: f?.caseNumber ?? null, plate: f?.plate ?? null, vehicle: f?.vehicle ?? null, since: ago(hours * HOUR), waitingHours: hours };
  };
  const alerts = [
    alert({ kind: 'emdad_late', text: 'امداد ویژه دیر شده: گلگیر جلو چپ', caseId: caseId(11), recipient: ALERT_TABLE.emdad_late.recipient, recipientUserIds: [...R('parts'), ...R('expert')], hours: 48 }),
    alert({ kind: 'expensive_part', text: 'قطعهٔ گران: اتاق کامل', caseId: caseId(10), recipient: PEOPLE.expert3.displayName, recipientUserIds: R('expert3'), hours: 40 }),
    alert({ kind: 'behind', text: 'عقب‌تر از برنامه: نقاشی', caseId: caseId(19), recipient: ALERT_TABLE.behind.recipient, recipientUserIds: [...R('expert'), ...R('techPaint')], hours: 46 }),
    alert({ kind: 'emdad_late', text: 'امداد ویژه دیر شده: گلگیر جلو چپ', caseId: caseId(12), recipient: ALERT_TABLE.emdad_late.recipient, recipientUserIds: [...R('parts'), ...R('expert2')], hours: 24 }),
    alert({ kind: 'behind', text: 'عقب‌تر از برنامه: جلوبندی', caseId: caseId(16), recipient: ALERT_TABLE.behind.recipient, recipientUserIds: [...R('expert2'), ...R('techFront')], hours: 22 }),
    alert({ kind: 'part_ready', text: 'قطعه آماده است: آینهٔ بغل راست', caseId: caseId(14), recipient: ALERT_TABLE.part_ready.recipient, recipientUserIds: R('expert'), hours: 6 }),
    alert({ kind: 'technician_problem', text: 'قطعه ندارم — مکانیک', caseId: caseId(18), recipient: ALERT_TABLE.technician_problem.recipient, recipientUserIds: [...R('parts'), ...R('expert3')], hours: 5 }),
  ].sort((a, b) => b.waitingHours - a.waitingHours);
  const behind = FOLDERS.filter((f) => f.behind);
  const avg = FOLDERS.reduce((n, f) => n + f.daysInShop, 0) / FOLDERS.length;
  const people: ControlRoomSnapshot['people'] = [
    ...(['expert', 'expert2', 'expert3'] as const).map((k) => {
      const mine = FOLDERS.filter((f) => f.responsibleUserId === PEOPLE[k].id);
      return { userId: PEOPLE[k].id, name: PEOPLE[k].displayName, role: 'accident_expert' as const, detail: '', open: mine.length, avgDays: mine.length ? Math.round((mine.reduce((n, f) => n + f.daysInShop, 0) / mine.length) * 10) / 10 : null, late: mine.filter((f) => f.behind).length, unanswered: alerts.filter((a) => a.recipientUserIds.includes(PEOPLE[k].id)).length };
    }),
    { userId: PEOPLE.parts.id, name: PEOPLE.parts.displayName, role: 'parts_clerk', detail: '', open: FOLDERS.reduce((n, f) => n + f.parts.inProgress, 0), avgDays: 2.4, late: FOLDERS.reduce((n, f) => n + f.parts.emdadLate, 0), unanswered: alerts.filter((a) => a.recipientUserIds.includes(PEOPLE.parts.id)).length },
    ...bays.filter((b) => b.key !== 'parts').map((b) => ({ userId: null, name: b.label, role: 'station' as const, detail: b.department ?? 'جایگاه', open: b.cars.length, avgDays: null, late: b.cars.filter((c) => c.state !== 'ok').length, unanswered: 0 })),
  ];
  return {
    generatedAt: new Date(NOW).toISOString(),
    range: range as ControlRoomSnapshot['range'],
    kpis: { inShop: FOLDERS.length, admitted: range === 'today' ? 2 : range === 'week' ? 9 : 31, delivered: range === 'today' ? 1 : range === 'week' ? 6 : 24, avgStayDays: Math.round(avg * 10) / 10, deliveredAvgStayDays: 6.8, behind: behind.length, behindOver3: behind.filter((f) => f.daysInShop > 3).length, unanswered: alerts.length, oldestUnansweredHours: alerts[0]?.waitingHours ?? null },
    funnel,
    bays,
    analysis: analysisSentences({ funnel, bays, folders: FOLDERS, alerts, emdadLateDays: 3, emdadFresh: true, afterNoon: false }),
    people,
    alerts,
    reports: { emdadFresh: true, stockFresh: true, emdadLastAt: ago(5 * HOUR) },
  };
}

function inbox(as: As): ReceivedReminder[] {
  if (as === 'manager' || as === 'admin' || as.startsWith('tech')) return [];
  const target = as === 'parts' ? caseId(11) : caseId(19);
  const f = FOLDERS.find((x) => x.caseId === target)!;
  return [{
    id: `rr-${as}`, reminderId: 'rem-1', sender: { id: PEOPLE.manager.id, displayName: PEOPLE.manager.displayName, roleLabel: 'مدیر خدمات' },
    body: as === 'parts' ? 'امداد ویژهٔ این خودرو دو روز دیر شده؛ لطفاً امروز پیگیری کنید.' : 'برنامهٔ نقاشی این خودرو دو روز عقب است؛ لطفاً برنامه را اصلاح کنید.',
    urgency: 'normal', source: 'manager_report',
    case: { id: f.caseId, caseNumber: f.caseNumber, vehicleLabel: f.vehicle } as ReceivedReminder['case'],
    part: null, plate: f.plate, status: 'unseen', seenAt: null, doneAt: null, reply: null, createdAt: ago(3 * HOUR), overdue: false, version: 1,
  } as unknown as ReceivedReminder];
}

function timeline(c: CarSpec): TimelineEvent[] {
  const ev = (k: number, action: string, hours: number, actor: As): TimelineEvent => ({ id: `ev-${c.i}-${k}`, action, entityType: 'case', entityId: caseId(c.i), occurredAt: ago(hours * HOUR), actor: { id: PEOPLE[actor].id, displayName: PEOPLE[actor].displayName }, reason: null, summary: null });
  const out = [ev(0, 'case.created', c.days * 24, c.by)];
  if (c.stage !== 'reception') out.push(ev(1, 'case.stage_changed', c.days * 20, c.by));
  if (c.parts?.length) out.push(ev(2, 'part.created', c.days * 18, c.by));
  if (c.tasks?.length) out.push(ev(3, 'task.created', c.days * 12, c.by), ev(4, 'task.started', 20, c.tasks[0]!.tech));
  return out.reverse();
}

function report(view: string): ReportResult {
  const byStage = (['reception', 'assessment', 'awaiting_parts', 'in_repair', 'quality_control', 'ready_for_delivery'] as CaseStage[]).map((st) => ({ key: st, label: STAGE_LABELS[st], value: FOLDERS.filter((f) => f.stage === st).length, listQuery: `stage=${st}` }));
  const rows: WorkItem[] = FOLDERS.filter((f) => f.next.actor !== 'none').slice(0, 8).map((f) => ({
    kind: f.next.actor === 'parts_clerk' ? 'part' : 'task', kindLabel: f.next.actor === 'parts_clerk' ? 'قطعه' : 'پرونده', caseId: f.caseId, caseNumber: f.caseNumber, admissionNo: f.admissionNo, plate: f.plate, vehicleLabel: f.vehicle,
    description: f.place, status: STAGE_LABELS[f.stage], dueAt: null, dueLabel: null, priority: f.behind ? 'overdue' : 'today', priorityReason: f.behind ? 'عقب‌تر از برنامه' : 'کار امروز',
    responsible: f.responsibleUserId ? { id: f.responsibleUserId, displayName: f.responsibleName ?? '' } : null, stoppedBy: null, nextAction: f.next.text,
  }));
  return {
    view: view as ReportResult['view'], generatedAt: new Date(NOW).toISOString(), isTestData: true,
    period: { key: 'month', from: ago(30 * DAY), to: new Date(NOW).toISOString(), label: 'این ماه', previousFrom: ago(60 * DAY), previousTo: ago(30 * DAY) },
    filters: [],
    kpis: [
      { key: 'open', label: 'پرونده‌های باز', unit: 'پرونده', value: FOLDERS.length, definition: 'پرونده‌های بازِ داخل تعمیرگاه', listQuery: 'status=open' },
      { key: 'behind', label: 'عقب‌تر از برنامه', unit: 'پرونده', value: FOLDERS.filter((f) => f.behind).length, definition: 'قدمی که پایان برنامه‌اش گذشته یا مهلت رسمی گذشته' },
      { key: 'parts', label: 'قطعهٔ در جریان', unit: 'درخواست قطعه', value: FOLDERS.reduce((n, f) => n + f.parts.inProgress, 0), definition: 'رزرو، امداد ویژه یا خرید بازار' },
      { key: 'delivered', label: 'تحویل‌شده', unit: 'پرونده', value: 24, definition: 'پرونده‌های تحویل‌شده در این بازه' },
    ],
    charts: [{ key: 'stage', title: 'پرونده‌ها بر اساس مرحله', unit: 'پرونده', kind: 'bar', bars: byStage }],
    events: [{ key: 'admitted', label: 'پذیرش', unit: 'خودرو', current: 31, previous: 27 }, { key: 'delivered', label: 'تحویل', unit: 'خودرو', current: 24, previous: 22 }],
    items: { rows, total: rows.length, page: 1, pageSize: 25, kinds: [{ kind: 'task', label: 'پرونده', count: rows.filter((r) => r.kind === 'task').length }, { kind: 'part', label: 'قطعه', count: rows.filter((r) => r.kind === 'part').length }] },
  } as ReportResult;
}

export function me(as: As): Me {
  const p = PEOPLE[as] as (typeof PEOPLE)[As] & { isOwner?: boolean };
  return {
    id: p.id, isOwner: !!p.isOwner, authentication: 'password', username: p.username, displayName: p.displayName, roles: p.roles,
    permissions: [...permissionsFor(p.roles, {}, null, !!p.isOwner)], tenant: TENANT, environment: 'preview',
    modules: MODULES.map((m) => ({ key: m.key, status: m.status })),
  } as Me;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
export const unknownCalls = new Set<string>();

export function installBackend(getAs: () => As | null, setAs: (a: As | null) => void) {
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    if (!url.pathname.startsWith('/api/v1')) return real(input, init);
    const path = url.pathname.slice('/api/v1'.length);
    const method = (init?.method ?? 'GET').toUpperCase();
    const q = url.searchParams;
    await new Promise((r) => setTimeout(r, 40));
    const as = getAs();
    if (method !== 'GET') {
      if (path === '/auth/login' || path === '/auth/pin-login' || path === '/auth/technician-login') {
        const body = JSON.parse(String(init?.body ?? '{}')) as { username?: string };
        const who = (Object.keys(PEOPLE) as As[]).find((k) => PEOPLE[k].username === body.username) ?? 'expert';
        setAs(who);
        return json({ ok: true });
      }
      if (path === '/auth/logout') { setAs(null); return new Response(null, { status: 204 }); }
      return json({ ok: true });
    }
    if (!as) return json({ statusCode: 401, code: 'UNAUTHENTICATED', message: 'وارد نشده‌اید' }, 401);
    const car = (id: string) => CARS.find((c) => caseId(c.i) === id);
    let m: RegExpMatchArray | null;
    if (path === '/auth/me') return json(me(as));
    if (path === '/desk/folders') return json(FOLDERS);
    if ((m = path.match(/^\/desk\/folders\/([^/]+)$/))) return json(FOLDERS.find((f) => f.caseId === m![1]) ?? null);
    if (path === '/control-room') return json(controlRoom(q.get('range') ?? 'today'));
    if ((m = path.match(/^\/cases\/([^/]+)$/)) && car(m[1]!)) return json(detailOf(car(m[1]!)!));
    if ((m = path.match(/^\/cases\/([^/]+)\/parts$/)) && car(m[1]!)) return json(partsOf(car(m[1]!)!));
    if ((m = path.match(/^\/cases\/([^/]+)\/timeline$/)) && car(m[1]!)) return json(timeline(car(m[1]!)!));
    if (path === '/reminders/inbox') return json(inbox(as));
    if (path === '/reminders') return json([]);
    if (path === '/notifications') return json({ unread: as === 'expert' ? 1 : 0, items: [] });
    if (path === '/alerts') {
      const only = q.get('caseId');
      const list = [{ caseId: caseId(10), caseNumber: caseNo(10), plate: '68د193-16', vehicleLabel: 'تارا', coverageType: 'personal', kind: 'expensive_part', level: 1, totalRial: 650_000_000, thresholdRial: 300_000_000, partDescription: 'اتاق کامل', responsible: { id: PEOPLE.expert3.id, displayName: PEOPLE.expert3.displayName } }];
      return json(only ? list.filter((a) => a.caseId === only) : as === 'expert3' ? list : []);
    }
    if (path === '/stock/options') {
      const base = q.get('base') ?? '';
      return json({ snapshot: { id: 'snap-1', reportedAt: ago(5 * HOUR), reportedAtPrecision: 'minute', publishedAt: ago(5 * HOUR), itemCount: 1840, currency: 'IRR', taxIncluded: true, completeness: 'full', scope: 'all', quantityMeaning: 'on_hand', fresh: true, reservable: true }, items: base ? [{ fullStockCode: `${base}01`, rawCode: `${base}01`, basePartNumber: base, supplySuffix: '01', codeKind: 'standard', description: 'نمونه', unit: 'عدد', vehicleModel: null, locationAddress: 'A-12', locationText: 'انبار اصلی', reported: '3', reserved: '1', available: '2', salePrice: null, avgPrice: null, carriedReportedAt: null }] : [] });
    }
    if (path === '/workshop/my-tasks') {
      const mine = CARS.flatMap((c) => tasksOf(c).filter((t) => t.assignedUserId === PEOPLE[as].id && t.status !== 'approved').map((t) => ({ c, t })));
      return json(mine.map(({ c, t }) => ({
        id: t.id, caseId: t.caseId, caseNumber: caseNo(c.i), vehicleLabel: c.model, plate: c.plate, title: t.title, stationCode: t.stationCode, stationName: t.stationName, departmentName: t.department.name,
        technicianName: t.technicianName, status: t.status, version: 1, plannedStartAt: t.plannedStartAt, plannedEndAt: t.plannedEndAt, baselineEndAt: t.baselineEndAt, actualStartAt: t.actualStartAt, actualEndAt: t.actualEndAt,
        approvedAt: null, canStart: t.status === 'pending' && !t.dependsOn.some((d) => tasksOf(c).find((x) => x.id === d)?.status !== 'approved'), workMinutes: null, lateMinutes: null, transferMinutes: null, calendarConfirmed: true,
        dayMinutes: 480, plannedWorkMinutes: 480, wage: null, partsReady: c.i === 15 ? { count: 1, names: ['درب جلو راست'] } : undefined, partsWaiting: c.parts?.filter((p) => ['emdad', 'market'].includes(p.state)).length ?? 0,
      })));
    }
    if (path === '/workshop/my-work') return json({ month: '1405-08', label: 'آبان ۱۴۰۵', months: [{ key: '1405-08', label: 'آبان ۱۴۰۵' }], rows: [], totalRial: 0, byCoverage: { golden_card: 0, insurance: 0, personal: 0, other: 0 }, missingWage: 0 });
    if (path === '/reports/views') return json({ views: as === 'parts' ? ['parts'] : as === 'manager' || as === 'admin' ? ['manager', 'parts', 'accident', 'workshop'] : ['accident'], defaultView: as === 'parts' ? 'parts' : as === 'manager' || as === 'admin' ? 'manager' : 'accident', defaultResponsible: as.startsWith('expert') ? 'me' : null });
    if (path === '/reports') return json(report(q.get('view') ?? 'manager'));
    if (path === '/users/assignable') return json((['expert', 'expert2', 'expert3'] as const).map((k) => ({ id: PEOPLE[k].id, displayName: PEOPLE[k].displayName })));
    if (path === '/departments') return json(Object.values(DEPTS).map((d) => ({ ...d, isActive: true })));
    if (path === '/workshop/stations') return json(STATIONS.map((s) => ({ ...s, departmentId: Object.values(DEPTS).find((d) => d.name === s.department)!.id, trade: null, isActive: true })));
    unknownCalls.add(`GET ${path}`);
    console.info('[harness] no fixture for', path);
    return json(null);
  };
}
