import { z } from 'zod';
import { TEHRAN_OFFSET_MINUTES, parseJalali } from './jalali';

// «پیگیری امداد ویژه» — the standalone Special Aid follow-up module (owner, 2026-11-22;
// docs/PRODUCT_SPEC_FA.md section 25). One dossier per valid VIN for every dealership
// vehicle (accident or general repair). The official special-aid report stays the only
// source of supply status; everything here is internal follow-up and never changes the
// official request, never creates a purchase order and never releases stock by itself.

/** Internal operational state of one special-aid part line (never derived from leaving the warehouse alone). */
export const SPECIAL_AID_ITEM_STATES = ['pending', 'arrived', 'reserved', 'delivered', 'installation_pending', 'installed', 'not_installed', 'released'] as const;
export type SpecialAidItemState = (typeof SPECIAL_AID_ITEM_STATES)[number];
export const SPECIAL_AID_ITEM_STATE_LABELS: Record<SpecialAidItemState, string> = {
  pending: 'در حال تأمین',
  arrived: 'رسیده',
  reserved: 'رسیده · رزرو برای همین خودرو',
  delivered: 'تحویل کارگاه',
  installation_pending: 'در انتظار نصب',
  installed: 'نصب‌شده',
  not_installed: 'نصب‌نشده',
  released: 'رزرو آزاد شد',
};
/** States in which the part still holds stock for its VIN. */
export const SPECIAL_AID_HOLDING_STATES: readonly SpecialAidItemState[] = ['reserved', 'delivered', 'installation_pending', 'not_installed'];
/** States that need no more customer follow-up. */
export const SPECIAL_AID_FINAL_STATES: readonly SpecialAidItemState[] = ['installed', 'released'];

/**
 * Operator actions on a part line. Only the listed transitions exist; the API enforces them.
 * Release needs `special_aid.release`; recording a non-consumption reason is separate and
 * never releases anything.
 */
export const SPECIAL_AID_ACTIONS = ['reserve', 'deliver', 'await_installation', 'installed', 'not_installed', 'return_to_stock_hold', 'release'] as const;
export type SpecialAidAction = (typeof SPECIAL_AID_ACTIONS)[number];
export const SPECIAL_AID_ACTION_LABELS: Record<SpecialAidAction, string> = {
  reserve: 'رزرو برای همین خودرو',
  deliver: 'تحویل به کارگاه',
  await_installation: 'در انتظار نصب',
  installed: 'نصب شد',
  not_installed: 'نصب نشد',
  return_to_stock_hold: 'برگشت به انبار (رزرو می‌ماند)',
  release: 'آزاد کردن رزرو',
};
const TRANSITIONS: Record<SpecialAidItemState, Partial<Record<SpecialAidAction, SpecialAidItemState>>> = {
  pending: {},
  arrived: { reserve: 'reserved' },
  reserved: { deliver: 'delivered', release: 'released' },
  delivered: { await_installation: 'installation_pending', installed: 'installed', not_installed: 'not_installed' },
  installation_pending: { installed: 'installed', not_installed: 'not_installed' },
  not_installed: { return_to_stock_hold: 'reserved', release: 'released' },
  installed: {},
  released: {},
};
export function nextItemState(state: SpecialAidItemState, action: SpecialAidAction): SpecialAidItemState | null {
  return TRANSITIONS[state]?.[action] ?? null;
}
export function allowedItemActions(state: SpecialAidItemState): SpecialAidAction[] {
  return Object.keys(TRANSITIONS[state] ?? {}) as SpecialAidAction[];
}

/** Why a part was not used; kept distinguishable in management reports. */
// The scenario of 2026-11-25 adds a defective part, a technician's diagnosis, a replacement from stock and a sold vehicle.
export const NON_CONSUMPTION_REASONS = ['wrong_part_number', 'wrong_diagnosis', 'not_required', 'customer_no_show', 'customer_declined', 'waiting_related_parts', 'delivered_mismatch', 'defective_part', 'technician_diagnosis', 'replaced_from_stock', 'vehicle_transferred', 'other'] as const;
export type NonConsumptionReason = (typeof NON_CONSUMPTION_REASONS)[number];
export const NON_CONSUMPTION_LABELS: Record<NonConsumptionReason, string> = {
  wrong_part_number: 'شمارهٔ فنی اشتباه',
  wrong_diagnosis: 'تشخیص فنی اشتباه',
  not_required: 'نیاز به تعویض نبود',
  customer_no_show: 'مشتری مراجعه نکرد',
  customer_declined: 'مشتری انصراف داد',
  waiting_related_parts: 'منتظر قطعات مرتبط',
  delivered_mismatch: 'قطعهٔ رسیده مغایر بود',
  defective_part: 'قطعهٔ معیوب رسید',
  technician_diagnosis: 'عیب‌یابی اشتباه تکنسین',
  replaced_from_stock: 'تعویض از موجودی',
  vehicle_transferred: 'فروش یا انتقال خودرو',
  other: 'سایر (با توضیح)',
};
/** Reasons that point at a technical decision (shown to the service manager as technical issues). */
export const TECHNICAL_REASONS: readonly NonConsumptionReason[] = ['wrong_part_number', 'wrong_diagnosis', 'not_required', 'delivered_mismatch', 'technician_diagnosis'];

export const CONTACT_OUTCOMES = ['answered', 'no_answer', 'appointment_coordinated', 'declined', 'promised_visit', 'switched_off', 'wrong_number'] as const;
export type ContactOutcome = (typeof CONTACT_OUTCOMES)[number];
export const CONTACT_OUTCOME_LABELS: Record<ContactOutcome, string> = {
  answered: 'پاسخ داد',
  no_answer: 'پاسخ نداد',
  appointment_coordinated: 'نوبت هماهنگ شد',
  declined: 'مشتری انصراف داد',
  promised_visit: 'قول مراجعه داد',
  switched_off: 'خاموش بود',
  wrong_number: 'شماره اشتباه است',
};
/**
 * The customer was not reached (scenario 2026-11-25 adds «خاموش» and «شماره اشتباه»): these count
 * exactly like «پاسخ نداد» for the retry on another day and the escalation after failed days.
 */
export const UNREACHED_OUTCOMES: readonly ContactOutcome[] = ['no_answer', 'switched_off', 'wrong_number'];
export const isUnreached = (o: ContactOutcome | string) => (UNREACHED_OUTCOMES as readonly string[]).includes(o);

/** Follow-up rules (owner, 2026-11-22). Calendar days on the Tehran calendar. */
export const SPECIAL_AID_RULES = {
  /** An arrived part is announced to the customer by the end of the next WORKING day (owner, 2026-11-22). */
  informWithinDays: 1,
  /** Repeat the call every ten days while the part waits for the vehicle. */
  recurringContactDays: 10,
  /** Warning and human review thresholds from the warehouse receipt. */
  warnDays: 20,
  reviewDays: 30,
  /** The approaching window shown before each threshold. */
  approachDays: 3,
  /** No-answer attempts on separate days before management is told. */
  failedAttemptsEscalation: 3,
} as const;

const DAY = 86_400_000;
const OFFSET = TEHRAN_OFFSET_MINUTES * 60_000;
/** Tehran calendar day (YYYY-MM-DD) of an instant. */
export const tehranDay = (d: Date | string) => new Date(new Date(d).getTime() + OFFSET).toISOString().slice(0, 10);
/** Whole calendar days between two Tehran days (b − a). */
export function daysBetween(a: Date | string, b: Date | string): number {
  return Math.round((Date.parse(tehranDay(b)) - Date.parse(tehranDay(a))) / DAY);
}
/** UTC instant of the start of the Tehran day `days` after the instant's day. */
export function tehranDayStart(d: Date | string, days = 0): Date {
  return new Date(Date.parse(tehranDay(d)) + days * DAY - OFFSET);
}

export interface AidItemFacts {
  id: string;
  state: SpecialAidItemState;
  /** Official warehouse receipt date of the report, when present. */
  receivedAt: string | null;
  /** When Manage first saw an arrived status (used only when the official date is missing, and labelled). */
  arrivalObservedAt: string | null;
  informedAt: string | null;
  groupId: string | null;
  officialCancelled?: boolean;
}
export interface AidContactFacts { at: string; outcome: ContactOutcome; promisedAt?: string | null; itemIds: readonly string[] }
export interface AidGroupFacts { id: string; decision: 'wait' | 'partial' | null }
export interface AidDossierFacts {
  items: readonly AidItemFacts[];
  contacts: readonly AidContactFacts[];
  groups?: readonly AidGroupFacts[];
  postponedUntil?: string | null;
  /** Attendance already confirmed after the latest promise or appointment. */
  attendedAt?: string | null;
  /** Working-day calendar (Friday and recorded holidays are not working days). Default: every day except Friday. */
  isWorkingDay?: (day: string) => boolean;
}

/** Default when no workshop calendar is passed: Friday is the only weekly day off. */
export const defaultWorkingDay = (day: string) => new Date(day + 'T12:00:00Z').getUTCDay() !== 5;
/** Last instant of the next working day after the instant's Tehran day (the customer-notice deadline). */
export function endOfNextWorkingDay(at: Date | string, isWorkingDay: (day: string) => boolean = defaultWorkingDay): Date {
  for (let n = 1; n <= 30; n++) {
    const start = tehranDayStart(at, n);
    if (isWorkingDay(tehranDay(start))) return new Date(tehranDayStart(at, n + 1).getTime() - 1);
  }
  return new Date(tehranDayStart(at, 2).getTime() - 1);
}

export const SPECIAL_AID_TASK_KINDS = ['age_review', 'escalation', 'inform_arrival', 'promised_visit', 'no_answer_retry', 'recurring_contact', 'age_warning', 'age_approaching', 'group_decision'] as const;
export type SpecialAidTaskKind = (typeof SPECIAL_AID_TASK_KINDS)[number];
export const SPECIAL_AID_TASK_LABELS: Record<SpecialAidTaskKind, string> = {
  age_review: 'بیش از ۳۰ روز از رسید؛ بررسی انسانی لازم است',
  escalation: 'سه تماس بی‌پاسخ در سه روز جدا؛ به مدیریت اعلام شد',
  inform_arrival: 'قطعه رسیده و مشتری هنوز خبر ندارد',
  promised_visit: 'روز قول مراجعهٔ مشتری',
  no_answer_retry: 'تماس دوباره پس از بی‌پاسخ',
  recurring_contact: 'تماس دوره‌ای ده‌روزه',
  age_warning: 'بیش از ۲۰ روز از رسید',
  age_approaching: 'نزدیک به مهلت ۲۰ یا ۳۰ روز',
  group_decision: 'بخشی از قطعات مرتبط رسیده؛ انتظار یا تعمیر بخشی؟',
};
/** Lower is more urgent. */
const PRIORITY: Record<SpecialAidTaskKind, number> = Object.fromEntries(SPECIAL_AID_TASK_KINDS.map((k, i) => [k, i])) as Record<SpecialAidTaskKind, number>;
/** Contact tasks are hidden while a follow-up is postponed; deadlines and age flags never move. */
const CONTACT_TASKS: readonly SpecialAidTaskKind[] = ['inform_arrival', 'promised_visit', 'no_answer_retry', 'recurring_contact', 'group_decision'];

export interface SpecialAidTask {
  kind: SpecialAidTaskKind;
  label: string;
  /** Original compliance deadline (never moved by a postponement). */
  dueAt: string;
  overdue: boolean;
  urgent: boolean;
  itemIds: string[];
  postponed: boolean;
}

/** Day 0 of the waiting time: the official receipt date, otherwise the first observation. */
export function arrivalOf(i: Pick<AidItemFacts, 'receivedAt' | 'arrivalObservedAt'>): { at: string | null; official: boolean } {
  if (i.receivedAt) return { at: i.receivedAt, official: true };
  return { at: i.arrivalObservedAt, official: false };
}
export function arrivalAge(i: Pick<AidItemFacts, 'receivedAt' | 'arrivalObservedAt'>, now: Date): number | null {
  const a = arrivalOf(i).at;
  return a ? Math.max(0, daysBetween(a, now)) : null;
}
const isArrived = (s: SpecialAidItemState) => s !== 'pending';
const isOpen = (i: AidItemFacts) => isArrived(i.state) && !SPECIAL_AID_FINAL_STATES.includes(i.state) && !i.officialCancelled;

/** Distinct Tehran days with a no-answer attempt since the latest reached contact. */
export function failedAttemptDays(contacts: readonly AidContactFacts[]): number {
  const sorted = [...contacts].sort((a, b) => a.at.localeCompare(b.at));
  const lastReached = sorted.reduce((acc, c, i) => (!isUnreached(c.outcome) ? i : acc), -1);
  return new Set(sorted.slice(lastReached + 1).filter((c) => isUnreached(c.outcome)).map((c) => tehranDay(c.at))).size;
}

/**
 * Today's follow-up work of one vehicle, most urgent first. Customer calls are grouped per
 * vehicle (one task lists every part it covers); part-level history stays on the parts.
 */
export function dossierTasks(d: AidDossierFacts, now: Date): SpecialAidTask[] {
  const out: SpecialAidTask[] = [];
  const nowIso = now.toISOString();
  const today = tehranDay(now);
  const postponed = !!d.postponedUntil && d.postponedUntil > nowIso;
  const add = (kind: SpecialAidTaskKind, dueAt: Date | string, itemIds: string[], urgent = false) => {
    const due = new Date(dueAt).toISOString();
    out.push({ kind, label: SPECIAL_AID_TASK_LABELS[kind], dueAt: due, overdue: tehranDay(due) < today, urgent, itemIds, postponed: postponed && CONTACT_TASKS.includes(kind) });
  };
  const open = d.items.filter(isOpen);
  const groups = new Map((d.groups ?? []).map((g) => [g.id, g]));
  const waitingGroup = (i: AidItemFacts) => {
    if (!i.groupId) return false;
    const members = d.items.filter((x) => x.groupId === i.groupId && !x.officialCancelled);
    const partial = members.some((x) => x.state === 'pending');
    return partial && groups.get(i.groupId)?.decision !== 'partial';
  };

  // 1. Age of arrived parts that still wait (warehouse receipt, never the report date).
  const review: string[] = [], warn: string[] = [], near: string[] = [];
  let reviewDue: string | null = null, warnDue: string | null = null, nearDue: string | null = null;
  for (const i of open) {
    if (!['arrived', 'reserved', 'not_installed'].includes(i.state)) continue;
    const a = arrivalOf(i).at;
    const age = arrivalAge(i, now);
    if (!a || age == null) continue;
    if (age >= SPECIAL_AID_RULES.reviewDays) { review.push(i.id); reviewDue ??= tehranDayStart(a, SPECIAL_AID_RULES.reviewDays).toISOString(); }
    else if (age >= SPECIAL_AID_RULES.warnDays) { warn.push(i.id); warnDue ??= tehranDayStart(a, SPECIAL_AID_RULES.warnDays).toISOString(); }
    else if (age >= SPECIAL_AID_RULES.warnDays - SPECIAL_AID_RULES.approachDays) {
      near.push(i.id); nearDue ??= tehranDayStart(a, SPECIAL_AID_RULES.warnDays).toISOString();
    }
  }
  if (review.length) add('age_review', reviewDue!, review, true);
  if (warn.length) add('age_warning', warnDue!, warn);
  if (near.length) add('age_approaching', nearDue!, near);

  // 2. Failed attempts on separate days.
  const failed = failedAttemptDays(d.contacts);
  const contactItems = open.map((i) => i.id);
  if (failed >= SPECIAL_AID_RULES.failedAttemptsEscalation && contactItems.length) add('escalation', nowIso, contactItems, true);

  // 3. Partially arrived related parts: the operator decides; no invitation is implied.
  const undecided = [...new Set(open.filter((i) => waitingGroup(i) && groups.get(i.groupId!)?.decision == null).map((i) => i.groupId!))];
  if (undecided.length) add('group_decision', nowIso, open.filter((i) => undecided.includes(i.groupId!)).map((i) => i.id));

  // 4. Arrived and not announced (a waiting group is announced only when complete or on a partial decision).
  const uninformed = open.filter((i) => !i.informedAt && !waitingGroup(i) && ['arrived', 'reserved'].includes(i.state));
  const sortedContacts = [...d.contacts].sort((a, b) => a.at.localeCompare(b.at));
  const last = sortedContacts.at(-1) ?? null;
  if (uninformed.length) {
    const first = uninformed.map((i) => arrivalOf(i).at ?? nowIso).sort()[0]!;
    const due = endOfNextWorkingDay(first, d.isWorkingDay).getTime();
    // After a no-answer today the retry belongs to another day (attempts must be on separate days).
    if (!(last && isUnreached(last.outcome) && tehranDay(last.at) === today)) {
      if (last && isUnreached(last.outcome)) add('no_answer_retry', tehranDayStart(last.at, 1), uninformed.map((i) => i.id), true);
      else add('inform_arrival', new Date(due), uninformed.map((i) => i.id), true);
    }
  }

  // 5. Promised visit date reached without a confirmed attendance.
  const promise = [...sortedContacts].reverse().find((c) => c.promisedAt);
  if (promise?.promisedAt && tehranDay(promise.promisedAt) <= today && !(d.attendedAt && d.attendedAt >= promise.at)) {
    const ids = promise.itemIds.filter((id) => contactItems.includes(id));
    if (ids.length || contactItems.length) add('promised_visit', tehranDayStart(promise.promisedAt), ids.length ? ids : contactItems);
  }

  // 6. Informed parts still waiting: a call every ten days; a no-answer is retried the next day.
  const informed = open.filter((i) => i.informedAt && ['arrived', 'reserved', 'not_installed'].includes(i.state));
  if (informed.length && !uninformed.length && last) {
    if (isUnreached(last.outcome)) {
      if (tehranDay(last.at) < today) add('no_answer_retry', tehranDayStart(last.at, 1), informed.map((i) => i.id));
    } else {
      const due = tehranDayStart(last.at, SPECIAL_AID_RULES.recurringContactDays);
      if (due.getTime() <= now.getTime()) add('recurring_contact', due, informed.map((i) => i.id));
    }
  }
  return out.sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || a.dueAt.localeCompare(b.dueAt));
}

// ------------------------------------------------------------------ API contracts

export const contactSchema = z.object({
  outcome: z.enum(CONTACT_OUTCOMES),
  itemIds: z.array(z.uuid()).min(1).max(100),
  note: z.string().trim().max(500).optional(),
  /** Promised visit day (promised_visit) or coordinated appointment day (appointment_coordinated). */
  promisedAt: z.iso.datetime({ offset: true }).optional(),
  expectedVersion: z.number().int().min(1),
}).refine((v) => v.outcome !== 'promised_visit' || !!v.promisedAt, { message: 'روز قول مراجعه را وارد کنید', path: ['promisedAt'] });
export type ContactInput = z.infer<typeof contactSchema>;

export const postponeSchema = z.object({
  until: z.iso.datetime({ offset: true }),
  reason: z.string().trim().min(3).max(300),
  expectedVersion: z.number().int().min(1),
});
export type PostponeInput = z.infer<typeof postponeSchema>;

export const itemActionSchema = z.object({
  action: z.enum(SPECIAL_AID_ACTIONS),
  expectedVersion: z.number().int().min(1),
  reason: z.string().trim().max(300).optional(),
  /** reserve: exact stock option chosen by the operator (procurement code and location). */
  fullStockCode: z.string().trim().min(1).max(80).optional(),
  locationAddress: z.string().max(200).optional(),
}).refine((v) => v.action !== 'release' || (v.reason?.length ?? 0) >= 3, { message: 'علت آزاد کردن رزرو را بنویسید', path: ['reason'] });
export type ItemActionInput = z.infer<typeof itemActionSchema>;

export const nonConsumptionSchema = z.object({
  reason: z.enum(NON_CONSUMPTION_REASONS).nullable(),
  note: z.string().trim().max(500).optional(),
  /** Code of the station that asked for the part (scenario 2026-11-25), e.g. «مکانیکی 99». */
  requestingStation: z.string().trim().max(60).optional(),
  expectedVersion: z.number().int().min(1),
}).refine((v) => v.reason !== 'other' || (v.note?.length ?? 0) >= 3, { message: 'برای «سایر» توضیح لازم است', path: ['note'] });
export type NonConsumptionInput = z.infer<typeof nonConsumptionSchema>;

export const groupSchema = z.object({
  itemIds: z.array(z.uuid()).min(2).max(50),
  label: z.string().trim().max(80).optional(),
});
export const groupDecisionSchema = z.object({ decision: z.enum(['wait', 'partial']), expectedVersion: z.number().int().min(1) });

/** The four work queues of the scenario (owner 2026-11-25), as views of «پرونده خودروها». */
export const SPECIAL_AID_QUEUES = ['awaiting_supply', 'to_invite', 'appointed', 'settled'] as const;
export type SpecialAidQueue = (typeof SPECIAL_AID_QUEUES)[number];
export const SPECIAL_AID_QUEUE_LABELS: Record<SpecialAidQueue, string> = {
  awaiting_supply: 'در انتظار تأمین',
  to_invite: 'آمادهٔ دعوت',
  appointed: 'نوبت‌داده‌شده',
  settled: 'تعیین تکلیف‌شده',
};
/**
 * Queue of one vehicle. Open arrived parts decide between «آمادهٔ دعوت» and «نوبت‌داده‌شده» by the
 * latest contact since the earliest open arrival («نوبت هماهنگ شد» or «قول مراجعه»). Without open arrived
 * parts, a part still being supplied means «در انتظار تأمین»; every part installed or released is
 * «تعیین تکلیف‌شده». Cancelled official requests are left out; a vehicle without parts has no queue.
 */
export function dossierQueue(items: readonly AidItemFacts[], contacts: readonly Pick<AidContactFacts, 'at' | 'outcome'>[]): SpecialAidQueue | null {
  const live = items.filter((i) => !i.officialCancelled);
  if (!live.length) return null;
  const open = live.filter((i) => isArrived(i.state) && !SPECIAL_AID_FINAL_STATES.includes(i.state));
  if (open.length) {
    const since = open.map((i) => arrivalOf(i).at).filter((a): a is string => !!a).sort().at(0) ?? null;
    const latest = [...contacts].filter((c) => !since || c.at >= since).sort((a, b) => a.at.localeCompare(b.at)).at(-1);
    return latest && (latest.outcome === 'appointment_coordinated' || latest.outcome === 'promised_visit') ? 'appointed' : 'to_invite';
  }
  if (live.some((i) => i.state === 'pending')) return 'awaiting_supply';
  return 'settled';
}

export const dossierSearchSchema = z.object({
  q: z.string().trim().max(80).optional(),
  view: z.enum(['all', 'action', 'arrived', 'pending', 'review', 'awaiting_supply', 'to_invite', 'appointed', 'settled']).default('all'),
  page: z.number().int().min(1).max(10_000).default(1),
  pageSize: z.number().int().min(5).max(100).default(25),
});
export type DossierSearchInput = z.infer<typeof dossierSearchSchema>;

export const supplySearchSchema = z.object({
  q: z.string().trim().max(80).optional(),
  status: z.string().trim().max(40).optional(),
  requestedFrom: z.iso.datetime({ offset: true }).optional(),
  requestedTo: z.iso.datetime({ offset: true }).optional(),
  /** Days without an observed change of the official status (at least). */
  minIdleDays: z.number().int().min(0).max(3650).optional(),
  page: z.number().int().min(1).max(10_000).default(1),
  pageSize: z.number().int().min(5).max(200).default(50),
});
export type SupplySearchInput = z.infer<typeof supplySearchSchema>;

export interface SpecialAidItem {
  id: string;
  requestId: string;
  admissionId: string | null;
  admissionNo: string | null;
  emdadNo: string | null;
  assessmentCode: string | null;
  procurementCode: string | null;
  description: string | null;
  quantity: string | null;
  officialStatus: string;
  officialCategory: string;
  officialRegisteredAt: string | null;
  receivedAt: string | null;
  arrivalObservedAt: string | null;
  statusObservedAt: string | null;
  state: SpecialAidItemState;
  allowedActions: SpecialAidAction[];
  informedAt: string | null;
  groupId: string | null;
  nonConsumptionReason: NonConsumptionReason | null;
  nonConsumptionNote: string | null;
  /** Station that asked for the part, recorded with the non-consumption reason. */
  requestingStation: string | null;
  holdId: string | null;
  holdNote: string | null;
  /** Linked accident part line: its reservation and delivery stay with the parts desk. */
  accidentCaseId: string | null;
  /** Earlier request of the same vehicle this one replaces (e.g. a wrong part number); both stay in history. */
  replacesItemId: string | null;
  replacedByItemId: string | null;
  accidentCaseNumber: string | null;
  version: number;
}
export interface SpecialAidContact { id: string; outcome: ContactOutcome; note: string | null; promisedAt: string | null; itemIds: string[]; byName: string; at: string }
export interface SpecialAidAdmission { id: string; admissionNo: string; admissionDate: string | null; itemCount: number }
export interface SpecialAidVehicle {
  customerName: string | null; phone: string | null;
  /** Short name for lists and cards («دنا پلاس»). */
  model: string | null;
  /** Full ISACO model and trim, shown only on request inside the dossier. */
  fullModel?: string | null;
  plate: string | null;
}
export interface SpecialAidDossierRow {
  id: string;
  vin: string;
  vehicle: SpecialAidVehicle;
  admissionCount: number;
  arrived: number;
  pending: number;
  actionCount: number;
  urgent: boolean;
  nextTask: SpecialAidTask | null;
  version: number;
}
export interface SpecialAidDossier extends SpecialAidDossierRow {
  admissions: SpecialAidAdmission[];
  items: SpecialAidItem[];
  contacts: SpecialAidContact[];
  groups: { id: string; label: string | null; decision: 'wait' | 'partial' | null; itemIds: string[]; version: number }[];
  tasks: SpecialAidTask[];
  postponedUntil: string | null;
  postponeReason: string | null;
  failedAttemptDays: number;
  appointments: SpecialAidAppointment[];
  appointmentState: AppointmentState;
  cards: SpecialAidCard[];
  feedback: SpecialAidFeedback[];
}
export interface SpecialAidTodayEntry { dossier: SpecialAidDossierRow; tasks: SpecialAidTask[] }
export interface SpecialAidSupplyRow {
  itemId: string; dossierId: string; vin: string; emdadNo: string | null; admissionNo: string | null;
  assessmentCode: string | null; procurementCode: string | null; description: string | null;
  officialStatus: string; officialCategory: string;
  /** Official registration date of the request (from the report, when present). */
  registeredAt: string | null;
  /** First time Manage saw the current official status (observation, not an official date). */
  statusObservedAt: string | null;
  idleDays: number | null;
}
export interface SpecialAidSummary {
  total: number; pending: number; overdue: number; arrivedUnused: number; reserved: number; released: number; installed: number;
  reasons: Record<NonConsumptionReason, number>;
  contactCompliance: { due: number; onTime: number };
  averageSupplyDays: number | null;
  unresolvedTechnical: number;
  weekly: { week: string; registered: number; arrived: number; installed: number }[];
  /** Pending requests whose official status has not changed for 14+ days (stalled in purchasing). */
  stalledSupply: number;
  feedbackOpen: number;
  warningsIssued: number;
  /** Customer and part funnels of the chosen period (by official registration day). */
  funnel: SpecialAidFunnel;
}

/** Owner, 2026-11-23: «۱۰۰ مشتری قطعه‌شان رسیده، ۵ نفر دعوت شده و آمده‌اند؛ ۱۰۰۰ قطعه درخواست، ۵۰۰ نصب». */
export interface SpecialAidFunnel {
  period: { from: string | null; to: string | null };
  customers: {
    registered: number; arrived: number; informed: number; invited: number; attended: number; installed: number; releasedNoShow: number;
    /** Gaps the manager acts on. */
    arrivedNotInformed: number; arrivedOver30NoVisit: number;
  };
  parts: { requested: number; pending: number; arrived: number; installed: number; releasedToOthers: number; arrivedOpen: number };
}
export const funnelPeriodSchema = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
export type FunnelPeriod = z.infer<typeof funnelPeriodSchema>;

// ------------------------------------------------------------------ replacement request

/** Links a new request (correct part number) to the earlier one of the same vehicle; nothing is overwritten. */
export const replacementSchema = z.object({ replacesItemId: z.uuid().nullable(), expectedVersion: z.number().int().min(1) });
export type ReplacementInput = z.infer<typeof replacementSchema>;

// ------------------------------------------------------------------ appointments (tracking only)

/**
 * Appointments live in ISACO only; Manage reads the imported «لیست نوبت پذیرش» report and
 * never schedules. An appointment of the same VIN is not assumed to be for special aid:
 * the operator confirms «مرتبط» or «نامرتبط».
 */
export const APPOINTMENT_STATES = ['confirmed', 'ambiguous', 'none_recent', 'stale', 'attended', 'passed_unverified', 'no_report'] as const;
export type AppointmentState = (typeof APPOINTMENT_STATES)[number];
export const APPOINTMENT_STATE_LABELS: Record<AppointmentState, string> = {
  confirmed: 'نوبت مرتبط در گزارش ایساکو',
  ambiguous: 'نوبت پیدا شد؛ ارتباط با امداد ویژه تأیید نشده',
  none_recent: 'در گزارش اخیر نوبتی پیدا نشد',
  stale: 'گزارش نوبت قدیمی است',
  attended: 'مشتری مراجعه کرد',
  passed_unverified: 'روز نوبت گذشت؛ مراجعه تأیید نشده',
  no_report: 'گزارش نوبت هنوز وارد نشده',
};
/** An appointment report older than this many days is shown as outdated. */
export const APPOINTMENT_STALE_DAYS = 3;
export type AppointmentRelation = 'related' | 'unrelated';
export interface AidAppointmentFacts { id: string; at: string | null; relation: AppointmentRelation | null }

/** Parses the file's appointment date (Jalali or ISO) and optional time; null when unreadable. */
export function appointmentInstant(dateText: string | undefined, timeText?: string): string | null {
  if (!dateText) return null;
  const time = /^\d{1,2}:\d{2}/.exec(timeText?.trim() ?? '')?.[0] ?? '00:00';
  // Gregorian ISO dates (19xx/20xx) first: a Jalali year is 13xx/14xx.
  if (/^(19|20)\d\d-\d\d-\d\d/.test(dateText.trim())) {
    const iso = Date.parse(dateText);
    return Number.isNaN(iso) ? null : new Date(iso).toISOString();
  }
  const [datePart, inlineTime] = dateText.trim().split(/\s+/);
  const jalali = parseJalali(datePart!, timeText ? time : /^\d{1,2}:\d{2}$/.test(inlineTime ?? '') ? inlineTime! : '00:00');
  return jalali ? jalali.toISOString() : null;
}

/** The appointment picture of one dossier, from the latest imported report and the operator's decisions. */
export function appointmentState(input: { appointments: readonly AidAppointmentFacts[]; lastReportAt: string | null; attendedAt: string | null; now: Date }): AppointmentState {
  const { now } = input;
  if (!input.lastReportAt) return 'no_report';
  const today = tehranDay(now);
  const candidates = input.appointments.filter((a) => a.relation !== 'unrelated' && a.at);
  const future = candidates.filter((a) => tehranDay(a.at!) >= today);
  if (future.some((a) => a.relation === 'related')) return 'confirmed';
  const past = candidates.filter((a) => tehranDay(a.at!) < today && a.relation === 'related').sort((a, b) => b.at!.localeCompare(a.at!))[0];
  if (!future.length && input.attendedAt && (!past || input.attendedAt >= tehranDayStart(past.at!).toISOString())) return 'attended';
  if (future.length) return 'ambiguous';
  if (daysBetween(input.lastReportAt, now) > APPOINTMENT_STALE_DAYS) return 'stale';
  if (past) return 'passed_unverified';
  return 'none_recent';
}
export const appointmentRelationSchema = z.object({ relation: z.enum(['related', 'unrelated']).nullable() });
export interface SpecialAidAppointment {
  id: string; at: string | null; dateText: string | null; timeText: string | null;
  status: string | null; serviceType: string | null; admissionNo: string | null; appointmentNo: string | null;
  relation: AppointmentRelation | null; relationByName: string | null; fileName: string; importedAt: string;
}

// ------------------------------------------------------------------ admission card archive

export const CARD_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export const CARD_MAX_BYTES = 4_000_000;
export const cardUploadSchema = z.object({
  files: z.array(z.object({
    fileName: z.string().trim().min(1).max(200),
    mime: z.enum(CARD_MIME_TYPES),
    dataBase64: z.string().min(4).max(5_400_000).regex(/^[A-Za-z0-9+/]*={0,2}$/),
    /** Optional numbers typed by the uploader (administrator-assisted matching). */
    admissionNo: z.string().trim().max(40).optional(),
    vin: z.string().trim().max(40).optional(),
  })).min(1).max(20),
});
export type CardUploadInput = z.infer<typeof cardUploadSchema>;
export const cardMatchSchema = z.object({
  admissionNo: z.string().trim().max(40).optional(),
  vin: z.string().trim().max(40).optional(),
  expectedVersion: z.number().int().min(1),
}).refine((v) => !!v.admissionNo || !!v.vin, { message: 'شمارهٔ پذیرش یا VIN را وارد کنید', path: ['admissionNo'] });
export type CardMatchInput = z.infer<typeof cardMatchSchema>;
export type CardState = 'unmatched' | 'matched';
export interface SpecialAidCard {
  id: string; fileName: string; mime: string; size: number; sha256: string;
  state: CardState; admissionNo: string | null; vin: string | null; dossierId: string | null;
  extraction: { provider: string; admissionNo: string | null; vin: string | null } | null;
  uploadedByName: string; uploadedAt: string; matchedAt: string | null; version: number;
}

// ------------------------------------------------------------------ technical feedback and formal warnings

export const FEEDBACK_KINDS = ['feedback', 'warning'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export const FEEDBACK_KIND_LABELS: Record<FeedbackKind, string> = { feedback: 'بازخورد فنی', warning: 'تذکر رسمی' };
export const feedbackSchema = z.object({
  recipientId: z.uuid(),
  kind: z.enum(FEEDBACK_KINDS),
  reason: z.enum(NON_CONSUMPTION_REASONS).optional(),
  dossierId: z.uuid().optional(),
  itemId: z.uuid().optional(),
  message: z.string().trim().min(3).max(1000),
});
export type FeedbackInput = z.infer<typeof feedbackSchema>;
/** Acknowledging receipt is not accepting fault; an optional reply is kept with it. */
export const feedbackAckSchema = z.object({ reply: z.string().trim().max(1000).optional(), expectedVersion: z.number().int().min(1) });
export type FeedbackAckInput = z.infer<typeof feedbackAckSchema>;
export interface SpecialAidFeedback {
  id: string; kind: FeedbackKind; reason: NonConsumptionReason | null; message: string;
  recipientId: string; recipientName: string; issuedByName: string; issuedAt: string;
  dossierId: string | null; vin: string | null; itemId: string | null;
  acknowledgedAt: string | null; reply: string | null; version: number;
}
/** A VIN that cannot open a dossier (not 17 valid characters): kept for review, never guessed. */
export interface SpecialAidReviewRow { requestId: string; vinText: string | null; emdadNo: string | null; admissionNo: string | null; description: string | null; officialStatus: string; lastReportAt: string | null }
