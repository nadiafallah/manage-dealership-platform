// «لیست شب» — vehicles staying overnight (reconstruction scenario, owner 2026-11-25).
// At 18:00 Tehran on a working day Manage builds the list from the open receptions Pulse reads;
// the receptionist only picks the stay reason (and the stations while کسب‌وکار has no technician
// data); the reception supervisor sends it by 18:45, otherwise the service manager is told.
// Warnings never block (spec section 2): the list can be sent with reasons missing.

export const NIGHT_LIST_GENERATE_AT = '18:00';
export const NIGHT_LIST_DEADLINE = '18:45';

export const NIGHT_LIST_REASONS = [
  'waiting_parts',
  'waiting_special_aid',
  'station_load',
  'unfinished',
  'waiting_diagnosis',
  'waiting_customer_approval',
  'waiting_outside_work',
  'ready_customer_absent',
  'other',
] as const;
export type NightListReason = (typeof NIGHT_LIST_REASONS)[number];
export const NIGHT_LIST_REASON_LABELS: Record<NightListReason, string> = {
  waiting_parts: 'منتظر قطعه از انبار',
  waiting_special_aid: 'منتظر امداد ویژه',
  station_load: 'حجم کار جایگاه',
  unfinished: 'کار نیمه‌تمام',
  waiting_diagnosis: 'منتظر عیب‌یابی فنی',
  waiting_customer_approval: 'منتظر تأیید مشتری',
  waiting_outside_work: 'منتظر کار خارج از نمایندگی',
  ready_customer_absent: 'آمادهٔ تحویل (مشتری نیامده)',
  other: 'سایر',
};

export const NIGHT_LIST_STATUSES = ['draft', 'sent'] as const;
export type NightListStatus = (typeof NIGHT_LIST_STATUSES)[number];
export const NIGHT_LIST_STATUS_LABELS: Record<NightListStatus, string> = { draft: 'پیش‌نویس', sent: 'ارسال‌شده' };

export interface NightListRow {
  /** The list item; the reception is `receptionId`. */
  id: string;
  version: number;
  receptionId: string;
  admissionNo: string | null;
  plate: string | null;
  vehicleName: string | null;
  ownerName: string | null;
  /** Days in the dealership on the Tehran calendar, counting the admission day (1 = admitted today). */
  daysIn: number | null;
  /** Still open in کسب‌وکار now; a vehicle released after 18:00 stays on the list, marked. */
  isOpen: boolean;
  /** Linked to an accident case (the accident module keeps its own plan). */
  accident: boolean;
  /** Labour lines of the card as written in کسب‌وکار (description and state). */
  labour: string[];
  currentStation: string | null;
  nextStations: string | null;
  reason: NightListReason | null;
  reasonNote: string | null;
  /** The reason was copied from the previous list (shown as «از دیروز» until someone changes or confirms it). */
  carried: boolean;
  setByName: string | null;
  setAt: string | null;
}

export interface NightListView {
  id: string;
  /** Tehran calendar day, YYYY-MM-DD. */
  day: string;
  status: NightListStatus;
  version: number;
  generatedAt: string;
  sentAt: string | null;
  sentByName: string | null;
  /** 18:45 Tehran of the day. */
  deadline: string;
  late: boolean;
  missingReasons: number;
  rows: NightListRow[];
}

/** No list yet for the day (before 18:00, or not a working day). */
export interface NightListPending {
  day: string;
  status: 'not_generated';
  generatesAt: string;
  workingDay: boolean;
}

/** Rows without a reason. A reason carried from the previous list counts as given (one click less per vehicle). */
export const nightListMissing = (rows: readonly Pick<NightListRow, 'reason'>[]) => rows.filter((r) => !r.reason).length;

/** Late once the deadline passed while the list is still a draft. */
export function nightListLate(status: NightListStatus, deadline: string | Date, now: Date): boolean {
  return status === 'draft' && now.getTime() >= new Date(deadline).getTime();
}

/** Ordering on the list: longest stay first, then admission number. */
export function compareNightRows(a: Pick<NightListRow, 'daysIn' | 'admissionNo'>, b: Pick<NightListRow, 'daysIn' | 'admissionNo'>): number {
  return (b.daysIn ?? -1) - (a.daysIn ?? -1) || (a.admissionNo ?? '').localeCompare(b.admissionNo ?? '', 'en', { numeric: true });
}

export const NIGHT_LIST_COLUMNS = ['نوع خودرو', 'پلاک', 'نام مالک', 'شماره پذیرش', 'روزهای ماندن', 'جایگاه فعلی', 'اجرت‌های کارت', 'جایگاه‌های بعدی', 'علت ماندن', 'توضیح', 'تصادفی', 'وضعیت فعلی'] as const;

/** Header and rows of the Excel export, in the column order of the scenario. */
export function nightListSheet(rows: readonly NightListRow[]): (string | number)[][] {
  return [
    [...NIGHT_LIST_COLUMNS],
    ...rows.map((r) => [
      r.vehicleName ?? '',
      r.plate ?? '',
      r.ownerName ?? '',
      r.admissionNo ?? '',
      r.daysIn ?? '',
      r.currentStation ?? '',
      r.labour.join(' · '),
      r.nextStations ?? '',
      r.reason ? NIGHT_LIST_REASON_LABELS[r.reason] + (r.carried ? ' (از دیروز)' : '') : 'ثبت نشده',
      r.reasonNote ?? '',
      r.accident ? 'بله' : '',
      r.isOpen ? 'باز' : 'ترخیص شد',
    ]),
  ];
}
