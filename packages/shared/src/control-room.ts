import type { DeskFolder, JourneyStep } from './desk';

// Control room of the service manager (spec §10, mockup ControlRoom.dc.html).
// Display and analysis only; the one action is «تذکر». Manage never assigns
// personal blame: sentences describe where a stage waits and who holds it.

export const CONTROL_RANGES = ['today', 'week', 'month'] as const;
export type ControlRange = (typeof CONTROL_RANGES)[number];
export const CONTROL_RANGE_LABELS: Record<ControlRange, string> = { today: 'امروز', week: 'این هفته', month: 'این ماه' };

export const UNANSWERED_KINDS = ['technician_problem', 'parts_amount', 'expensive_part', 'price_notice', 'emdad_late', 'dealer_supply', 'part_ready', 'behind', 'report_missing'] as const;
export type UnansweredKind = (typeof UNANSWERED_KINDS)[number];
/** The alert table of spec §9: what, who receives it and what answers it. */
export const ALERT_TABLE: Record<UnansweredKind, { label: string; recipient: string; answer: string }> = {
  parts_amount: { label: 'هزینهٔ قطعات از سقف گذشت', recipient: 'کارشناس تصادفات', answer: 'پیش‌پرداخت: گرفتم / نگرفتم / لازم نیست' },
  expensive_part: { label: 'قطعهٔ گران', recipient: 'کارشناس تصادفات', answer: 'همان سه گزینه' },
  dealer_supply: { label: 'امداد ویژه: تأمین توسط نمایندگی', recipient: 'مسئول قطعات', answer: 'قیمت و راه تأمین تازه' },
  emdad_late: { label: 'امداد ویژه دیر شده', recipient: 'مسئول قطعات، کارشناس', answer: 'پیگیری' },
  report_missing: { label: 'گزارش امروز بارگذاری نشده', recipient: 'مسئول قطعات، مدیر سیستم', answer: 'بارگذاری' },
  price_notice: { label: 'اعلام قیمت', recipient: 'کارشناس تصادفات', answer: 'تأیید / دستور دیگر' },
  part_ready: { label: 'قطعه آمادهٔ تحویل', recipient: 'کارشناس + جایگاه', answer: 'تحویل گرفتن' },
  technician_problem: { label: 'قطعه ندارم / مشکل تکنسین', recipient: 'مسئول قطعات، کارشناس', answer: 'پاسخ یا تحویل قطعه' },
  behind: { label: 'عقب‌تر از برنامه', recipient: 'کارشناس، تکنسین', answer: 'اصلاح برنامه یا پیگیری' },
};

export interface UnansweredAlert {
  kind: UnansweredKind;
  text: string;
  caseId: string | null;
  /** File number shown in the alert table (null for tenant-wide alerts). */
  caseNumber?: string | null;
  plate: string | null;
  vehicle: string | null;
  since: string;
  waitingHours: number;
  /** Who should answer (role or name). */
  recipient: string;
  /** Users who would receive a «تذکر» about it. */
  recipientUserIds: string[];
}

export interface FunnelStage {
  key: JourneyStep;
  label: string;
  count: number;
  avgDays: number;
  bottleneck: boolean;
}
export const FUNNEL_LABELS: Record<JourneyStep, string> = {
  reception: 'پذیرش',
  assessment: 'کارشناسی و مجوز',
  parts: 'منتظر قطعه',
  repair: 'در حال تعمیر',
  delivery: 'کنترل و تحویل',
};

export type BayCarState = 'ok' | 'late' | 'stop';
export interface BayCar { caseId: string; plate: string | null; vehicle: string; state: BayCarState; step: string }
export interface Bay { key: string; label: string; department: string | null; cars: BayCar[]; tone: 'ok' | 'warn' | 'free' }

export interface PersonLine {
  userId: string | null;
  name: string;
  role: 'accident_expert' | 'parts_clerk' | 'station';
  detail: string;
  open: number;
  avgDays: number | null;
  late: number;
  unanswered: number;
}

export interface ControlRoomSnapshot {
  generatedAt: string;
  range: ControlRange;
  kpis: {
    inShop: number;
    admitted: number;
    delivered: number;
    avgStayDays: number;
    deliveredAvgStayDays: number | null;
    behind: number;
    behindOver3: number;
    unanswered: number;
    oldestUnansweredHours: number | null;
  };
  funnel: FunnelStage[];
  bays: Bay[];
  analysis: string[];
  people: PersonLine[];
  alerts: UnansweredAlert[];
  reports: { emdadFresh: boolean; stockFresh: boolean; emdadLastAt: string | null };
}

const fa = (n: number, digits = 0) => (digits ? n.toFixed(digits).replace(/\.0+$/, '') : String(Math.round(n))).replace('.', '٫').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]!);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Cars and average days in each step; the bottleneck holds the most car-days. */
export function buildFunnel(folders: readonly DeskFolder[], stageDays: Readonly<Record<string, number>>): FunnelStage[] {
  const steps: JourneyStep[] = ['reception', 'assessment', 'parts', 'repair', 'delivery'];
  const rows = steps.map((key) => {
    const here = folders.filter((f) => f.journey === key);
    const days = here.map((f) => stageDays[f.caseId] ?? f.daysInShop);
    return { key, label: FUNNEL_LABELS[key], count: here.length, avgDays: Math.round(avg(days) * 10) / 10, load: days.reduce((a, b) => a + b, 0), bottleneck: false };
  });
  const top = rows.reduce((m, r) => (r.load > m.load ? r : m), rows[0]!);
  if (top.load > 0) top.bottleneck = true;
  return rows.map(({ load: _load, ...r }) => r);
}

/** State of a car on a bay: stopped (blocked, open problem or blocker), late (past the planned end), else on plan. */
export function carState(f: DeskFolder, task: DeskFolder['tasks'][number] | undefined, now = Date.now()): BayCarState {
  if (task?.status === 'blocked' || f.openBlockers > 0 || f.next.text.startsWith('تکنسین:')) return 'stop';
  if (task && task.status !== 'done' && task.plannedEndAt && Date.parse(task.plannedEndAt) < now) return 'late';
  if (!task && f.behind) return 'late';
  return 'ok';
}

/** Live workshop map: each active bay with the cars on it, plus a «انتظار قطعه» bay. */
export function buildBays(folders: readonly DeskFolder[], stations: readonly { id: string; code: string; name: string; department?: string | null }[], now = Date.now()): Bay[] {
  const bays: Bay[] = stations.map((s) => ({ key: s.id, label: s.name || s.code, department: s.department ?? null, cars: [], tone: 'free' }));
  const byId = new Map(bays.map((b) => [b.key, b]));
  const waiting: Bay = { key: 'parts', label: 'انتظار قطعه', department: null, cars: [], tone: 'free' };
  for (const f of folders) {
    const onBay = f.tasks.find((t) => t.stationId && byId.has(t.stationId) && (t.status === 'in_progress' || t.status === 'blocked' || t.status === 'done'));
    if (onBay) {
      byId.get(onBay.stationId!)!.cars.push({ caseId: f.caseId, plate: f.plate, vehicle: f.vehicle, state: carState(f, onBay, now), step: onBay.department });
    } else if (f.journey === 'parts' || (f.parts.inProgress > 0 && !f.tasks.some((t) => t.status === 'in_progress'))) {
      waiting.cars.push({ caseId: f.caseId, plate: f.plate, vehicle: f.vehicle, state: f.parts.emdadLate > 0 ? 'late' : carState(f, undefined, now), step: 'قطعه' });
    }
  }
  const all = [...bays, waiting];
  for (const b of all) b.tone = !b.cars.length ? 'free' : b.cars.some((c) => c.state !== 'ok') ? 'warn' : 'ok';
  return all;
}

/** Three to five plain sentences: where cars wait and why. Rules only; no blame. */
export function analysisSentences(input: {
  funnel: readonly FunnelStage[];
  bays: readonly Bay[];
  folders: readonly DeskFolder[];
  alerts: readonly UnansweredAlert[];
  emdadLateDays: number;
  emdadFresh: boolean;
  afterNoon: boolean;
}): string[] {
  const out: string[] = [];
  const b = input.funnel.find((s) => s.bottleneck);
  if (b) {
    let s = `بیشترین توقف در «${b.label}» است: ${fa(b.count)} خودرو، به‌طور میانگین ${fa(b.avgDays, 1)} روز.`;
    if (b.key === 'parts') {
      const late = input.folders.filter((f) => f.journey === 'parts' && f.parts.emdadLate > 0).length;
      if (late) s += ` ${fa(late)} مورد منتظر امداد ویژه‌ای‌اند که بیش از ${fa(input.emdadLateDays)} روز از ثبتش گذشته.`;
    }
    out.push(s);
  }
  for (const bay of input.bays.filter((x) => x.key !== 'parts' && x.cars.some((c) => c.state === 'stop')).slice(0, 2)) {
    const stopped = bay.cars.filter((c) => c.state === 'stop');
    const problem = input.alerts.some((a) => a.kind === 'technician_problem' && stopped.some((c) => c.caseId === a.caseId));
    out.push(`جایگاه «${bay.label}» ${fa(stopped.length)} خودروی متوقف دارد${problem ? '؛ تکنسین «قطعه ندارم» زده و هنوز پاسخی ثبت نشده' : ''}.`);
  }
  const behind = input.folders.filter((f) => f.behind);
  if (behind.length) out.push(`${fa(behind.length)} خودرو عقب‌تر از برنامه است؛ برنامهٔ آن‌ها را کارشناس مسئول می‌تواند اصلاح کند.`);
  const free = input.bays.filter((x) => x.key !== 'parts' && x.tone === 'free');
  if (free.length) {
    const names = free.slice(0, 2).map((x) => x.label).join(' و ');
    const depts = new Set(free.map((x) => x.department).filter(Boolean));
    // Cars whose next step (first unfinished one) is the trade of a free bay.
    const queued = input.folders.filter((f) => { const nextTask = f.tasks.find((t) => t.status !== 'approved' && t.status !== 'done'); return !!nextTask && nextTask.status === 'pending' && depts.has(nextTask.department); }).length;
    out.push(`${names} الان ظرفیت آزاد ${free.length > 1 ? 'دارند' : 'دارد'}${queued ? `؛ ${fa(queued)} خودرو آمادهٔ همین کار است` : ''}.`);
  }
  if (input.afterNoon && !input.emdadFresh) out.push('گزارش امداد ویژهٔ امروز هنوز بارگذاری نشده؛ وضعیت قطعه‌ها با تاریخ آخرین گزارش است.');
  if (input.alerts.length) {
    const oldest = Math.max(...input.alerts.map((a) => a.waitingHours));
    out.push(`${fa(input.alerts.length)} هشدار بی‌پاسخ است؛ قدیمی‌ترین ${fa(oldest)} ساعت منتظر مانده.`);
  } else out.push('همهٔ هشدارها پاسخ گرفته‌اند.');
  if (!input.folders.length) return ['الان خودرویی در تعمیرگاه ثبت نشده است.'];
  return out.slice(0, 5);
}
