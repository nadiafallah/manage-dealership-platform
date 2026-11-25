import { z } from 'zod';
import { formatJalali } from './jalali';
import { NIGHT_LIST_REASONS } from './night-list';
import { toLatinDigits, toPersianDigits } from './text';
import type { Paged } from './types';

// Manage Pulse («منیج پالس», spec section 26): a read-only worker that signs in to ISACO
// «کسب‌وکار» with the dealership's own account, reads every admission (repair card) every few
// minutes and keeps one reception folder per card in Manage. Nothing is ever written to کسب‌وکار.

export const PULSE_STATES = ['off', 'active', 'captcha', 'login_failed', 'unreachable', 'password_change'] as const;
export type PulseState = (typeof PULSE_STATES)[number];
export const PULSE_STATE_LABELS: Record<PulseState, string> = {
  off: 'خاموش',
  active: 'فعال',
  captcha: 'در انتظار کد امنیتی',
  login_failed: 'خطای ورود',
  unreachable: 'کسب‌وکار در دسترس نیست',
  password_change: 'نیاز به تغییر رمز در کسب‌وکار',
};
/** States in which the worker makes no login attempt until the system administrator acts. */
export const PULSE_ATTENTION_STATES: readonly PulseState[] = ['captcha', 'login_failed', 'password_change'];

export const PULSE_RUN_KINDS = ['today', 'open', 'lines', 'backfill', 'test', 'login', 'codes', 'stock', 'emdad', 'appointments'] as const;
export type PulseRunKind = (typeof PULSE_RUN_KINDS)[number];
export const PULSE_RUN_KIND_LABELS: Record<PulseRunKind, string> = {
  today: 'پذیرش‌های امروز',
  open: 'پذیرش‌های باز',
  lines: 'قطعات، اجرت و ایراد',
  backfill: 'بارگذاری اولیه',
  test: 'آزمایش اتصال',
  login: 'ورود به کسب‌وکار',
  codes: 'متن وضعیت‌ها',
  stock: 'گزارش موجودی انبار',
  emdad: 'گزارش امداد ویژه',
  appointments: 'لیست نوبت پذیرش',
};
export type PulseRunOutcome = 'running' | 'ok' | 'error';

export const PULSE_COMMAND_KINDS = ['test', 'sync_now', 'backfill', 'captcha_answer', 'stock_now', 'emdad_now', 'appointments_now'] as const;
export type PulseCommandKind = (typeof PULSE_COMMAND_KINDS)[number];
export const PULSE_COMMAND_LABELS: Record<PulseCommandKind, string> = {
  test: 'آزمایش اتصال',
  sync_now: 'همین الان بخوان',
  backfill: 'بارگذاری اولیه',
  captcha_answer: 'ورود با کد امنیتی',
  stock_now: 'خواندن موجودی انبار',
  emdad_now: 'خواندن گزارش امداد ویژه',
  appointments_now: 'خواندن لیست نوبت پذیرش',
};
export type PulseCommandStatus = 'pending' | 'running' | 'done' | 'failed';

/** Stable error codes of the connection; never carry a password, token or response body. */
export const PULSE_ERROR_LABELS: Record<string, string> = {
  KASB_UNREACHABLE: 'کسب‌وکار پاسخ نداد (شبکه یا سرور در دسترس نیست).',
  KASB_TIMEOUT: 'پاسخ کسب‌وکار در زمان مجاز نرسید (۳۰ ثانیه برای درخواست عادی، تا ۵ دقیقه برای فایل گزارش).',
  KASB_KEYS: 'کلید رمزنگاری کسب‌وکار در فایل سایت پیدا نشد؛ احتمالاً نسخهٔ سایت عوض شده است.',
  KASB_DECRYPT: 'پاسخ کسب‌وکار رمزگشایی نشد؛ احتمالاً نسخهٔ سایت عوض شده است.',
  KASB_PROTOCOL: 'پاسخ کسب‌وکار قالب غیرمنتظره داشت.',
  KASB_REJECTED: 'کسب‌وکار درخواست خواندن را نپذیرفت.',
  KASB_AUTH: 'نشست کسب‌وکار منقضی شد و ورود دوباره هم پذیرفته نشد.',
  KASB_LOGIN_FAILED: 'کد نمایندگی، نام کاربری یا کلمه عبور در کسب‌وکار پذیرفته نشد.',
  KASB_CAPTCHA: 'کسب‌وکار کد امنیتی (کپچا) خواست.',
  KASB_PASSWORD_CHANGE: 'کسب‌وکار می‌خواهد کلمه عبور این حساب عوض شود.',
  KASB_NOT_ALLOWED: 'درخواست بیرون از فهرست مجاز فقط‌خواندنی بود و فرستاده نشد.',
  PULSE_NOT_CONFIGURED: 'اطلاعات ورود کسب‌وکار هنوز ثبت نشده است.',
  PULSE_SECRET_MISSING: 'کلید رمزگذاری پالس (PULSE_SECRET_KEY) روی سرور تنظیم نشده یا عوض شده است؛ کلمه عبور را دوباره ثبت کنید.',
  PULSE_DISABLED: 'منیج پالس روی این سرور خاموش است (PULSE_ENABLED).',
  PULSE_NO_CAPTCHA: 'کد امنیتی‌ای در انتظار پاسخ نبود.',
  PULSE_BAD_DATE: 'تاریخ شروع بارگذاری اولیه معتبر نیست.',
  PULSE_UNKNOWN_COMMAND: 'فرمان ناشناخته.',
  KASB_REPORT_PEAK: 'کسب‌وکار این گزارش را ساعت ۷ تا ۱۰ و ۱۶ تا ۱۸ نمی‌دهد؛ بعد از این بازه دوباره خوانده می‌شود.',
  KASB_REPORT_FAILED: 'کسب‌وکار ساختن این گزارش را تمام نکرد؛ ساعتی بعد دوباره درخواست می‌شود.',
  PULSE_LAYOUT_UNCONFIRMED: 'ستون‌های «لیست نوبت پذیرش» هنوز یک بار تأیید نشده‌اند: یک بار این فایل را دستی در «اطلاعات پایه ← نوبت‌های پذیرش» بارگذاری و تأیید کنید؛ از آن پس پالس خودش می‌خواند.',
  PULSE_INTERNAL: 'خطای داخلی پالس؛ جزئیات در گزارش سرور است.',
};
export const pulseErrorText = (code: string | null | undefined) => (code ? PULSE_ERROR_LABELS[code] ?? 'خطای ناشناخته در اتصال کسب‌وکار.' : null);

export interface PulseSettings {
  /** Minutes between two reads of today's admissions (minimum 2). */
  intervalMinutes: number;
  /** 'calendar' follows the dealership work calendar (work_calendars); 'custom' uses hoursFrom–hoursTo on working days. */
  hoursMode: 'calendar' | 'custom';
  hoursFrom: string;
  hoursTo: string;
  /** Days back that count as «open admissions» (re-read every 15 minutes). */
  openWindowDays: number;
  /** Read the stock report (موجودی انبار) once a working day and stage it for confirmation (default on). */
  stockAuto?: boolean;
  /** Earliest Tehran time of the daily stock read (default 10:00). */
  stockAfter?: string;
  /** ISACO warehouse code (DssdSsd); empty = the parts warehouse («انبار قطعات…»). */
  stockWarehouse?: string | null;
  /** Request «گزارش امداد ویژه» once a day and stage it for confirmation (default on). */
  emdadAuto?: boolean;
  /** Earliest Tehran time of the daily special-aid request (default 10:05; never 07–10 or 16–18). */
  emdadAfter?: string;
  /** Read «لیست نوبت پذیرش» once a day and prepare its preview (default on). */
  appointmentsAuto?: boolean;
  /** Earliest Tehran time of the daily appointment read (default 10:10). */
  appointmentsAfter?: string;
  /**
   * Confirm what Pulse read without a person (default on, owner 2026-11-24): stock and special-aid
   * files and the appointment list are applied as soon as their preview is ready, unless the
   * preview needs a decision (changed columns, many missing items, many rejected rows).
   */
  autoApply?: boolean;
}
export const DEFAULT_PULSE_SETTINGS: PulseSettings = { intervalMinutes: 3, hoursMode: 'calendar', hoursFrom: '07:00', hoursTo: '19:00', openWindowDays: 60 };

/** Worker bookkeeping kept with the connection (no secrets). */
export interface PulseCursor {
  todayAt?: string;
  openAt?: string;
  codesAt?: string;
  /** Official text of each admission status code (domain CAR_STATE_REC of Sec/Code). */
  statusTexts?: Record<string, string>;
  /** Tehran day of the last staged stock report, and which warehouse it was. */
  stockDay?: string;
  stockTriedAt?: string;
  stockWarehouse?: { value: string; text: string };
  /** Special-aid report: Tehran day of the last staged file; a request the server is still building. */
  emdadDay?: string;
  emdadTriedAt?: string;
  emdadPending?: { from: string; to: string; since: string };
  /** Appointment list: Tehran day of the last prepared preview. */
  appointmentsDay?: string;
  appointmentsTriedAt?: string;
  /** Column names (never values) of the first non-empty answer of each list. */
  structures?: Partial<Record<'cards' | 'parts' | 'repairs' | 'defects', string[]>>;
}

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'ساعت را به شکل ۰۸:۰۰ وارد کنید');
export const pulseSettingsSchema = z.object({
  expectedVersion: z.number().int().min(1),
  intervalMinutes: z.number().int().min(2, 'فاصلهٔ خواندن حداقل ۲ دقیقه است').max(60),
  hoursMode: z.enum(['calendar', 'custom']),
  hoursFrom: hhmm,
  hoursTo: hhmm,
  openWindowDays: z.number().int().min(1).max(180),
  stockAuto: z.boolean().optional(),
  stockAfter: hhmm.optional(),
  stockWarehouse: z.string().trim().max(20).nullable().optional(),
  emdadAuto: z.boolean().optional(),
  emdadAfter: hhmm.optional(),
  appointmentsAuto: z.boolean().optional(),
  appointmentsAfter: hhmm.optional(),
  autoApply: z.boolean().optional(),
}).strict().refine((v) => v.hoursFrom < v.hoursTo, { message: 'ساعت پایان باید بعد از ساعت شروع باشد', path: ['hoursTo'] });
export type PulseSettingsInput = z.infer<typeof pulseSettingsSchema>;

/**
 * کسب‌وکار accepts only Latin digits. A code, username or password typed on a Persian keyboard
 * («۴۰۰۱۳۰۷») or pasted with invisible direction marks is rejected there, so every credential is
 * normalised before it is stored and again before each login (owner's first test, 2026-11-23).
 */
export function kasbCredentialText(value: string): string {
  return toLatinDigits(value.replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, ''));
}
const credentialField = (max: number) => z.string().transform((v) => kasbCredentialText(v).trim()).pipe(z.string().min(1).max(max));

export const pulseCredentialsSchema = z.object({
  /** 0 when the connection is created for the first time. */
  expectedVersion: z.number().int().min(0),
  dealerCode: credentialField(16).transform((v) => v.replace(/\s+/g, '')),
  username: credentialField(64),
  /** Write-only. Omitted to keep the stored password. Digits are made Latin; nothing else changes. */
  password: z.string().transform(kasbCredentialText).pipe(z.string().min(1).max(128)).optional(),
}).strict();
export type PulseCredentialsInput = z.infer<typeof pulseCredentialsSchema>;

export const pulseToggleSchema = z.object({ expectedVersion: z.number().int().min(1) }).strict();
export const pulseCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('test') }).strict(),
  z.object({ kind: z.literal('sync_now') }).strict(),
  z.object({ kind: z.literal('stock_now') }).strict(),
  z.object({ kind: z.literal('emdad_now') }).strict(),
  z.object({ kind: z.literal('appointments_now') }).strict(),
  z.object({ kind: z.literal('backfill'), from: z.string().trim().min(8).max(10) }).strict(),
]);
export type PulseCommandInput = z.infer<typeof pulseCommandSchema>;
export const pulseCaptchaSchema = z.object({ answer: z.string().trim().regex(/^[0-9۰-۹]{3,8}$/, 'فقط ارقام تصویر را وارد کنید') }).strict();

export interface PulseRunView {
  id: string;
  kind: PulseRunKind;
  startedAt: string;
  finishedAt: string | null;
  outcome: PulseRunOutcome;
  read: number;
  created: number;
  changed: number;
  errorCode: string | null;
  /** Column names (never values), client version, auth scheme, bundle warnings, official message code. */
  details: Record<string, unknown> | null;
}
export interface PulseCommandView {
  id: string;
  kind: PulseCommandKind;
  status: PulseCommandStatus;
  createdAt: string;
  finishedAt: string | null;
  progress: { done: number; total: number } | null;
  resultCode: string | null;
}
export interface PulseStatus {
  /** PULSE_ENABLED on the server: the reception module is visible. */
  featureEnabled: boolean;
  /** PULSE_SECRET_KEY is set: passwords can be stored. */
  secretReady: boolean;
  configured: boolean;
  dealerCode: string | null;
  username: string | null;
  /** The password is write-only; the browser only learns whether one is stored. */
  hasPassword: boolean;
  enabled: boolean;
  state: PulseState;
  version: number;
  settings: PulseSettings;
  lastReadAt: string | null;
  lastErrorCode: string | null;
  /** Last heartbeat of the worker process (null: never seen). */
  workerSeenAt: string | null;
  todayReceptions: number;
  todayChanges: number;
  captchaImage: string | null;
  reviewCount: number;
  runs: PulseRunView[];
  commands: PulseCommandView[];
}

/** Admissions whose accident-case link is ambiguous (never linked automatically). */
export interface PulseReviewRow {
  receptionId: string;
  admissionNo: string | null;
  plate: string | null;
  vehicleName: string | null;
  candidates: { caseId: string; caseNumber: string }[];
}

function minutesAgo(iso: string, now: Date): string {
  const m = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (m < 1) return 'همین الان';
  if (m < 60) return `${toPersianDigits(m)} دقیقه پیش`;
  if (m < 24 * 60) return `${toPersianDigits(Math.floor(m / 60))} ساعت پیش`;
  return formatJalali(iso, { time: true });
}
export const pulseAgo = (iso: string | null | undefined, now: Date = new Date()) => (iso ? minutesAgo(iso, now) : 'هنوز خوانده نشده');

/** The one-line status of the settings card and the support desk. */
export function pulseSentence(s: Pick<PulseStatus, 'enabled' | 'state' | 'lastReadAt' | 'todayReceptions' | 'todayChanges' | 'configured'>, now: Date = new Date()): string {
  if (!s.configured) return 'پالس هنوز تنظیم نشده است · اطلاعات ورود کسب‌وکار را وارد کنید';
  const counts = `امروز ${toPersianDigits(s.todayReceptions)} پذیرش، ${toPersianDigits(s.todayChanges)} تغییر`;
  const last = `آخرین خواندن ${pulseAgo(s.lastReadAt, now)}`;
  if (!s.enabled) return `پالس خاموش است · ${last}`;
  if (s.state === 'active' || s.state === 'off') return `پالس فعال است · ${last} · ${counts}`;
  return `پالس متوقف شد: ${PULSE_STATE_LABELS[s.state]} · ${last}`;
}

// ---------------------------------------------------------------- reception module

export const RECEPTION_VIEWS = ['today', 'open', 'released'] as const;
export type ReceptionView = (typeof RECEPTION_VIEWS)[number];
export const RECEPTION_VIEW_LABELS: Record<ReceptionView, string> = { today: 'پذیرش‌های امروز', open: 'پذیرش‌های باز', released: 'ترخیص‌شده‌ها' };
/** Open receptions by Tehran admission day: yesterday, the day before, three days or more (scenario 2026-11-25). */
export const RECEPTION_STAY_FILTERS = ['1', '2', '3plus'] as const;
export type ReceptionStay = (typeof RECEPTION_STAY_FILTERS)[number];
export const RECEPTION_STAY_LABELS: Record<ReceptionStay, string> = { '1': 'مانده از دیروز', '2': 'مانده از پریروز', '3plus': '۳ روز و بیشتر' };
const receptionDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ نامعتبر است');
export const receptionSearchSchema = z.object({
  view: z.enum(RECEPTION_VIEWS),
  q: z.string().trim().max(80).optional(),
  stay: z.enum(RECEPTION_STAY_FILTERS).optional(),
  /** Admission day range on the Tehran calendar (YYYY-MM-DD), both ends included. */
  from: receptionDay.optional(),
  to: receptionDay.optional(),
  page: z.number().int().min(1).max(10_000).default(1),
  pageSize: z.number().int().min(10).max(100).default(30),
}).strict().refine((v) => !v.from || !v.to || v.from <= v.to, { message: 'ابتدای بازه بعد از انتهای آن است', path: ['to'] });
export type ReceptionSearchInput = z.infer<typeof receptionSearchSchema>;
/** Daily statistics of one Tehran day (today when omitted). */
export const receptionStatsQuerySchema = z.object({ date: receptionDay.optional() }).strict();
/** Labour codes of periodic service and oil change (owner or system administrator). */
export const receptionSettingsSchema = z.object({
  serviceLaborCodes: z.array(z.string().trim().min(1).max(32)).max(500),
}).strict();
export type ReceptionSettingsInput = z.infer<typeof receptionSettingsSchema>;
export interface ReceptionSettings { serviceLaborCodes: string[] }

/** «لیست شب» (scenario 2026-11-25): the list of one Tehran day (today when omitted). */
export const nightListQuerySchema = z.object({ day: receptionDay.optional() }).strict();
export const nightListItemSchema = z.object({
  expectedVersion: z.number().int().min(1),
  reason: z.enum(NIGHT_LIST_REASONS).nullable(),
  reasonNote: z.string().trim().max(300).optional(),
  currentStation: z.string().trim().max(60).optional(),
  nextStations: z.string().trim().max(120).optional(),
}).strict().refine((v) => v.reason !== 'other' || !!v.reasonNote?.trim(), { message: 'برای «سایر» توضیح کوتاه بنویسید', path: ['reasonNote'] });
export type NightListItemInput = z.infer<typeof nightListItemSchema>;
export const nightListSendSchema = z.object({ expectedVersion: z.number().int().min(1) }).strict();

export interface ReceptionRow {
  id: string;
  admissionNo: string | null;
  plate: string | null;
  vehicleName: string | null;
  customerName: string | null;
  statusText: string | null;
  isOpen: boolean;
  admittedAt: string | null;
  releasedAt: string | null;
  /** Calendar days in the dealership (Tehran days; 0 = admitted today). */
  daysIn: number | null;
  partsCount: number;
  caseId: string | null;
  caseNumber: string | null;
}
export interface ReceptionList extends Paged<ReceptionRow> {
  lastReadAt: string | null;
}

export interface ReceptionPart {
  id: string;
  lineId: string;
  name: string | null;
  code: string | null;
  qtyRequested: string | null;
  qtyFinal: string | null;
  unitPriceRial: number | null;
  state: string | null;
  specialAid: boolean;
  warranty: string | null;
  /** «علت رد» of the line; a rejected line is shown grey with its reason. */
  rejectReason: string | null;
  removedAt: string | null;
}
export interface ReceptionRepair {
  id: string;
  lineId: string;
  code: string | null;
  description: string | null;
  state: string | null;
  finalPriceRial: number | null;
  warranty: string | null;
  removedAt: string | null;
}
export interface ReceptionDefect {
  id: string;
  lineId: string;
  customerText: string | null;
  expertText: string | null;
  state: string | null;
  type: string | null;
  removedAt: string | null;
}

export const RECEPTION_EXTERNAL_STATES = ['sent', 'done', 'cancelled'] as const;
export type ReceptionExternalState = (typeof RECEPTION_EXTERNAL_STATES)[number];
export const RECEPTION_EXTERNAL_STATE_LABELS: Record<ReceptionExternalState, string> = { sent: 'ارسال‌شده', done: 'انجام شد', cancelled: 'لغو' };
export interface ReceptionExternalWork {
  id: string;
  contractorId: string | null;
  contractorName: string;
  description: string;
  sentAt: string;
  doneAt: string | null;
  amountRial: number | null;
  status: ReceptionExternalState;
  note: string | null;
  cancelReason: string | null;
  invoices: { id: string; fileName: string; mime: string; size: number }[];
  createdByName: string | null;
  version: number;
}
export interface ReceptionNote { id: string; text: string; createdAt: string; createdByName: string | null }
export const RECEPTION_EVENT_KINDS = ['created', 'status', 'released', 'reopened', 'case_linked', 'part_added', 'part_changed', 'part_removed', 'part_restored', 'external_added', 'external_updated', 'external_cancelled', 'note'] as const;
export type ReceptionEventKind = (typeof RECEPTION_EVENT_KINDS)[number];
export const RECEPTION_EVENT_LABELS: Record<ReceptionEventKind, string> = {
  created: 'پذیرش از کسب‌وکار خوانده شد',
  status: 'وضعیت رسمی تغییر کرد',
  released: 'ترخیص شد',
  reopened: 'دوباره باز شد',
  case_linked: 'به پروندهٔ تصادفی وصل شد',
  part_added: 'قطعهٔ تازه روی کارت',
  part_changed: 'قطعه تغییر کرد',
  part_removed: 'قطعه در کسب‌وکار حذف شد',
  part_restored: 'قطعه دوباره روی کارت آمد',
  external_added: 'کار خارج از نمایندگی ثبت شد',
  external_updated: 'کار خارج از نمایندگی ویرایش شد',
  external_cancelled: 'کار خارج از نمایندگی لغو شد',
  note: 'یادداشت',
};
export interface ReceptionEvent { id: string; kind: ReceptionEventKind; at: string; text: string | null; actorName: string | null }

export interface ReceptionDetail {
  id: string;
  version: number;
  admissionNo: string | null;
  cardNo: string | null;
  plate: string | null;
  isOpen: boolean;
  statusCode: string | null;
  statusText: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  vehicle: {
    shortName: string | null;
    fullModel: string | null;
    productCode: string | null;
    modelCode: string | null;
    color: string | null;
    chassis: string | null;
    vin: string | null;
    engineNo: string | null;
    entranceKm: number | null;
    deliveredOn: string | null;
    goldCard: { type: string | null; id: string | null; expires: string | null } | null;
    accident: string | null;
  };
  customer: {
    name: string | null;
    phone: string | null;
    mobile: string | null;
    nationalId: string | null;
    address: string | null;
    delivererName: string | null;
    delivererMobile: string | null;
  };
  admission: {
    admittedAt: string | null;
    entryType: string | null;
    recordType: string | null;
    station: string | null;
    receptionist: string | null;
    exitEstimate: string | null;
    releasedAt: string | null;
    description: string | null;
    warrantyStatus: string | null;
    costEstimateRial: number | null;
    finalCostRial: number | null;
  };
  defects: ReceptionDefect[];
  repairs: ReceptionRepair[];
  parts: ReceptionPart[];
  externalWork: ReceptionExternalWork[];
  notes: ReceptionNote[];
  events: ReceptionEvent[];
  case: { id: string; caseNumber: string } | null;
  linkState: 'none' | 'linked' | 'ambiguous';
}

const contractorRefine = (v: { contractorId?: string | null; contractorName?: string }) => !!v.contractorId || !!v.contractorName?.trim();
export const receptionExternalWorkSchema = z.object({
  contractorId: z.uuid().nullable().optional(),
  contractorName: z.string().trim().max(120).optional(),
  description: z.string().trim().min(2, 'شرح کار را بنویسید').max(500),
  sentAt: z.iso.datetime({ offset: true }),
  amountRial: z.number().int().min(0).max(1e13).nullable().optional(),
  note: z.string().trim().max(1000).optional(),
}).strict().refine(contractorRefine, { message: 'انجام‌دهنده را انتخاب کنید یا نامش را بنویسید', path: ['contractorName'] });
export type ReceptionExternalWorkInput = z.infer<typeof receptionExternalWorkSchema>;
export const receptionExternalUpdateSchema = z.object({
  expectedVersion: z.number().int().min(1),
  contractorId: z.uuid().nullable().optional(),
  contractorName: z.string().trim().max(120).optional(),
  description: z.string().trim().min(2).max(500),
  sentAt: z.iso.datetime({ offset: true }),
  doneAt: z.iso.datetime({ offset: true }).nullable().optional(),
  amountRial: z.number().int().min(0).max(1e13).nullable().optional(),
  status: z.enum(['sent', 'done']),
  note: z.string().trim().max(1000).optional(),
}).strict().refine(contractorRefine, { message: 'انجام‌دهنده را انتخاب کنید یا نامش را بنویسید', path: ['contractorName'] });
export type ReceptionExternalUpdateInput = z.infer<typeof receptionExternalUpdateSchema>;
export const receptionExternalCancelSchema = z.object({ expectedVersion: z.number().int().min(1), reason: z.string().trim().min(3, 'علت لغو را بنویسید').max(500) }).strict();
export const receptionInvoiceSchema = z.object({
  expectedVersion: z.number().int().min(1),
  fileName: z.string().min(1).max(180),
  mime: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
  dataBase64: z.string().min(1).max(4_200_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
}).strict();
export const receptionNoteSchema = z.object({ text: z.string().trim().min(2, 'یادداشت خالی است').max(2000) }).strict();
