import type { CaseStage, CoverageType, TaskStatus } from './enums';

// Desks as folders on a table (spec §2, §12; mockups ExpertDesk / CaseFolder):
// every car is one folder card — big plate, «پرونده … · پذیرش …», short name,
// customer, stage and current bay, days in the shop, coverage tab and one
// «قدم بعدی». The sentence is derived from data by fixed rules (no AI, no blame).

export const JOURNEY_STEPS = ['reception', 'assessment', 'parts', 'repair', 'delivery'] as const;
export type JourneyStep = (typeof JOURNEY_STEPS)[number];
export const JOURNEY_LABELS: Record<JourneyStep, string> = {
  reception: 'پذیرش',
  assessment: 'کارشناسی و مجوز',
  parts: 'قطعات',
  repair: 'تعمیر',
  delivery: 'کنترل و تحویل',
};

/** The five-step journey bar of a case folder (spec §4). */
export function journeyStep(stage: CaseStage): JourneyStep {
  switch (stage) {
    case 'reception':
      return 'reception';
    case 'assessment':
    case 'awaiting_approval':
      return 'assessment';
    case 'awaiting_parts':
      return 'parts';
    case 'in_repair':
      return 'repair';
    default:
      return 'delivery';
  }
}

/** Coverage tab of a folder: gold card, insurance or personal (mixed/unknown read as their nearest). */
export function coverageTab(c: CoverageType): { key: 'gold' | 'ins' | 'own'; label: string } {
  if (c === 'golden_card') return { key: 'gold', label: 'کارت طلایی' };
  if (c === 'insurance') return { key: 'ins', label: 'بیمه' };
  if (c === 'personal') return { key: 'own', label: 'شخصی' };
  if (c === 'mixed') return { key: 'ins', label: 'ترکیبی' };
  return { key: 'own', label: 'نامشخص' };
}

export type NextActor = 'accident_expert' | 'parts_clerk' | 'technician' | 'none';
export interface NextStep {
  text: string;
  actor: NextActor;
  tone: 'ok' | 'warn' | 'stop';
}

export interface FolderTaskFact {
  department: string;
  station: string | null;
  status: TaskStatus;
  plannedEndAt: string | null;
  /** True when the step waits for unfinished steps before it. */
  waiting?: boolean;
}
export interface FolderFacts {
  stage: CaseStage;
  /** Repair steps in plan order. */
  tasks: readonly FolderTaskFact[];
  parts: { total: number; undecided: number; inProgress: number; ready: number; emdadLate: number };
  openBlockers: number;
  /** Unanswered technician problems («قطعه ندارم»…) with the hours they have waited. */
  problems?: { label: string; hours: number }[];
  officialDeadlineAt?: string | null;
}

const TEHRAN = 210 * 60_000;
const dayOf = (ms: number) => Math.floor((ms + TEHRAN) / 86_400_000);
const faDigits = (s: string | number) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]!);

/** «امروز» / «فردا» / «۳ روز دیگر» for a planned end. */
export function dayWord(iso: string, now = Date.now()): string {
  const d = dayOf(Date.parse(iso)) - dayOf(now);
  if (d <= 0) return 'امروز';
  if (d === 1) return 'فردا';
  return `${faDigits(d)} روز دیگر`;
}

const isOpenTask = (t: FolderTaskFact) => t.status !== 'done' && t.status !== 'approved';

/** Behind schedule: an unfinished step past its planned end, or the official deadline passed. */
export function folderBehind(f: FolderFacts, now = Date.now()): boolean {
  if (f.stage === 'delivered') return false;
  if (f.officialDeadlineAt && Date.parse(f.officialDeadlineAt) < now) return true;
  return f.tasks.some((t) => isOpenTask(t) && t.plannedEndAt && Date.parse(t.plannedEndAt) < now);
}

/** Where the car is now: the bay of the running step, else the stage. */
export function folderPlace(f: FolderFacts, stageLabel: string): string {
  const running = f.tasks.find((t) => t.status === 'in_progress') ?? f.tasks.find((t) => t.status === 'blocked');
  if (running) return running.station ? `${running.department} · جایگاه ${faDigits(running.station)}` : running.department;
  if (f.stage === 'awaiting_parts' || (f.parts.inProgress > 0 && !f.tasks.some(isOpenTask) && f.stage !== 'quality_control' && f.stage !== 'ready_for_delivery')) return 'انتظار قطعه';
  return stageLabel;
}

/** One sentence: what has to happen now and who does it (spec §2.4). */
export function folderNextStep(f: FolderFacts, now = Date.now()): NextStep {
  if (f.stage === 'delivered') return { text: 'تحویل شد', actor: 'none', tone: 'ok' };
  const doneIdx = f.tasks.findIndex((t) => t.status === 'done');
  if (doneIdx >= 0) {
    const t = f.tasks[doneIdx]!;
    const after = f.tasks.slice(doneIdx + 1).find(isOpenTask);
    return { text: `${t.department} تمام شد — تأیید${after ? ` و ارجاع به ${after.department}` : ' کار'}`, actor: 'accident_expert', tone: 'warn' };
  }
  const problem = [...(f.problems ?? [])].sort((a, b) => b.hours - a.hours)[0];
  if (problem) return { text: `تکنسین: «${problem.label}» — ${faDigits(Math.max(1, Math.round(problem.hours)))} ساعت بی‌پاسخ`, actor: 'accident_expert', tone: 'stop' };
  if (f.openBlockers > 0) return { text: 'کار متوقف است — علت توقف را پیگیری کنید', actor: 'accident_expert', tone: 'stop' };
  if (f.stage === 'reception' || (f.stage === 'assessment' && f.parts.total === 0 && f.tasks.length === 0)) {
    return { text: 'برآورد کارشناسی را وارد کنید', actor: 'accident_expert', tone: 'ok' };
  }
  if (f.parts.emdadLate > 0) return { text: `امداد ویژه: ${faDigits(f.parts.emdadLate)} قطعه دیر کرده — پیگیری کنید`, actor: 'parts_clerk', tone: 'stop' };
  if (f.parts.undecided > 0) return { text: `${faDigits(f.parts.undecided)} قطعه تعیین تکلیف نشده`, actor: 'parts_clerk', tone: 'warn' };
  if (f.parts.ready > 0) return { text: `${faDigits(f.parts.ready)} قطعه آماده — تحویل به جایگاه`, actor: 'parts_clerk', tone: 'ok' };
  if (f.tasks.length === 0) {
    if (f.stage === 'quality_control' || f.stage === 'ready_for_delivery') return deliveryStep(f.stage);
    return { text: 'مسیر تعمیر را بسازید', actor: 'accident_expert', tone: 'ok' };
  }
  const running = f.tasks.find((t) => t.status === 'in_progress');
  if (running) {
    if (running.plannedEndAt && Date.parse(running.plannedEndAt) < now) return { text: `عقب‌تر از برنامه — ${running.department}`, actor: 'technician', tone: 'stop' };
    return { text: `طبق برنامه — پایان ${running.department} ${running.plannedEndAt ? dayWord(running.plannedEndAt, now) : ''}`.trim(), actor: 'technician', tone: 'ok' };
  }
  const blocked = f.tasks.find((t) => t.status === 'blocked');
  if (blocked) return { text: `${blocked.department} متوقف است — پیگیری کنید`, actor: 'accident_expert', tone: 'stop' };
  const nextTask = f.tasks.find((t) => t.status === 'pending');
  if (nextTask) {
    if (f.parts.inProgress > 0 && nextTask.waiting !== false) return { text: `منتظر رسیدن ${faDigits(f.parts.inProgress)} قطعه`, actor: 'parts_clerk', tone: 'ok' };
    return { text: `منتظر شروع ${nextTask.department}`, actor: 'technician', tone: 'ok' };
  }
  if (f.stage === 'quality_control' || f.stage === 'ready_for_delivery') return deliveryStep(f.stage);
  return { text: 'کارها تمام شد — کنترل نهایی و پایان کار', actor: 'accident_expert', tone: 'warn' };
}

function deliveryStep(stage: CaseStage): NextStep {
  return stage === 'ready_for_delivery'
    ? { text: 'آمادهٔ تحویل — هماهنگی با مشتری', actor: 'accident_expert', tone: 'ok' }
    : { text: 'کنترل نهایی و پایان کار', actor: 'accident_expert', tone: 'warn' };
}

/** One folder card of a desk. */
export interface DeskFolder {
  caseId: string;
  caseNumber: string;
  admissionNo: string | null;
  plate: string | null;
  vehicle: string;
  customerName: string | null;
  coverageType: CoverageType;
  stage: CaseStage;
  journey: JourneyStep;
  place: string;
  admittedAt: string;
  daysInShop: number;
  next: NextStep;
  behind: boolean;
  responsibleUserId: string | null;
  responsibleName: string | null;
  parts: FolderFacts['parts'];
  openBlockers: number;
  /** Repair steps for maps and stage views. */
  tasks: (FolderTaskFact & { assignedUserId: string | null; stationId: string | null })[];
}

export const DESK_FILTERS = ['all', 'own', 'mine', 'parts', 'repair', 'delivery', 'behind', 'stuck'] as const;
export type DeskFilter = (typeof DESK_FILTERS)[number];
export const DESK_FILTER_LABELS: Record<DeskFilter, string> = {
  all: 'همه',
  own: 'پرونده‌های من',
  mine: 'منتظر اقدام من',
  parts: 'منتظر قطعه',
  repair: 'در تعمیر',
  delivery: 'آمادهٔ تحویل',
  behind: 'عقب‌تر از برنامه',
  stuck: 'گره‌ها',
};

/** Whether a folder belongs to a desk filter; «mine» means the next step is the viewer's role, «own» that the viewer is the case's follow-up owner. */
export function deskFilterMatch(f: DeskFolder, filter: DeskFilter, myActors: readonly NextActor[], myId?: string): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'own':
      return !!myId && f.responsibleUserId === myId;
    case 'mine':
      return myActors.includes(f.next.actor);
    case 'parts':
      return f.journey === 'parts' || f.parts.undecided + f.parts.inProgress > 0;
    case 'repair':
      return f.journey === 'repair';
    case 'delivery':
      return f.journey === 'delivery';
    case 'behind':
      return f.behind;
    case 'stuck':
      return f.next.tone === 'stop' || f.openBlockers > 0;
  }
}

/** Calendar days since admission in Tehran (at least 1 on the admission day). */
export function daysInShop(admittedAt: string, now = Date.now()): number {
  return Math.max(1, dayOf(now) - dayOf(Date.parse(admittedAt)) + 1);
}

/** Morning/afternoon/evening greeting in Tehran time: «صبح بخیر، مهدی». */
export function greeting(name: string, now = Date.now()): string {
  const h = new Date(now + TEHRAN).getUTCHours();
  const first = name.trim().split(/\s+/)[0] ?? name;
  const part = h < 12 ? 'صبح بخیر' : h < 17 ? 'روز بخیر' : 'عصر بخیر';
  return `${part}، ${first}`;
}
