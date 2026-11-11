import { z } from 'zod';
import { parseDecimal } from './stock-code';

// Daily parts reports: the dealership's stock report (XLSX) and Iran Khodro's
// Emdad Vijeh report (SpreadsheetML). See docs/DAILY_PARTS_FA.md.

export const DAILY_REPORT_KINDS = ['stock', 'emdad'] as const;
export type DailyReportKind = (typeof DAILY_REPORT_KINDS)[number];
export const DAILY_REPORT_KIND_LABELS: Record<DailyReportKind, string> = {
  stock: 'موجودی روزانه انبار',
  emdad: 'پیگیری روزانه امداد ویژه',
};

export const DAILY_IMPORT_STATUSES = ['uploaded', 'parsing', 'preview', 'applying', 'applied', 'failed', 'discarded'] as const;
export type DailyImportStatus = (typeof DAILY_IMPORT_STATUSES)[number];
export const DAILY_IMPORT_STATUS_LABELS: Record<DailyImportStatus, string> = {
  uploaded: 'در صف پردازش',
  parsing: 'در حال خواندن فایل',
  preview: 'آماده پیش‌نمایش و تأیید',
  applying: 'در حال ثبت',
  applied: 'ثبت شد',
  failed: 'ناموفق',
  discarded: 'کنار گذاشته شد',
};

/** Per-row result of a daily file (preview and kept import result). */
export const DAILY_ROW_OUTCOMES = ['new', 'changed', 'unchanged', 'duplicate', 'needs_mapping', 'ambiguous', 'invalid', 'total_row', 'older'] as const;
export type DailyRowOutcome = (typeof DAILY_ROW_OUTCOMES)[number];
export const DAILY_ROW_OUTCOME_LABELS: Record<DailyRowOutcome, string> = {
  new: 'جدید',
  changed: 'تغییرکرده',
  unchanged: 'بدون تغییر',
  duplicate: 'تکراری (برای بررسی)',
  needs_mapping: 'نیازمند تطبیق کد',
  ambiguous: 'مبهم (برای بررسی)',
  invalid: 'نامعتبر',
  total_row: 'ردیف جمع',
  older: 'قدیمی‌تر از اطلاعات ثبت‌شده',
};

export const EMDAD_STATUS_CATEGORIES = [
  'in_dealer_stock',
  'received_by_dealer',
  'supplied_by_dealer',
  'in_supply',
  'ready_to_collect',
  'draft',
  'invoice_ready',
  'invoiced',
  'regional_office',
  'cancelled',
  'needs_interpretation',
  'missing',
] as const;
export type EmdadStatusCategory = (typeof EMDAD_STATUS_CATEGORIES)[number];
// Display grouping only. The official text is always shown next to it, and no
// category is proof of receipt, handover or delivery.
export const EMDAD_STATUS_CATEGORY_LABELS: Record<EmdadStatusCategory, string> = {
  in_dealer_stock: 'طبق گزارش: وارد موجودی',
  received_by_dealer: 'طبق گزارش: رسید نمایندگی',
  supplied_by_dealer: 'طبق گزارش: تأمین توسط نمایندگی',
  in_supply: 'طبق گزارش: در حال تأمین',
  ready_to_collect: 'طبق گزارش: آماده جمع‌آوری',
  draft: 'طبق گزارش: پیش‌نویس',
  invoice_ready: 'طبق گزارش: آماده صدور فاکتور',
  invoiced: 'طبق گزارش: فاکتور صادر شده',
  regional_office: 'طبق گزارش: دفتر منطقه‌ای',
  cancelled: 'طبق گزارش: ابطال',
  needs_interpretation: 'نیازمند تفسیر وضعیت',
  missing: 'وضعیت خالی',
};

export const EMDAD_MATCH_STATUSES = ['matched', 'needs_review', 'ambiguous', 'unmatched'] as const;
export type EmdadMatchStatus = (typeof EMDAD_MATCH_STATUSES)[number];
export const EMDAD_MATCH_LABELS: Record<EmdadMatchStatus, string> = {
  matched: 'متصل به پرونده',
  needs_review: 'نیازمند بررسی اتصال',
  ambiguous: 'چند پرونده ممکن (بررسی)',
  unmatched: 'بدون پرونده در منیج',
};

export const RESERVATION_STATUSES = ['reserved', 'issued', 'released', 'cancelled', 'returned'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];
export const RESERVATION_STATUS_LABELS: Record<ReservationStatus, string> = {
  reserved: 'رزرو داخلی منیج',
  issued: 'تحویل به جایگاه',
  released: 'آزاد شد',
  cancelled: 'خروج لغو شد',
  returned: 'مرجوعی؛ به موجودی برگشت',
};
export const RESERVATION_ACTIONS = ['issue', 'release', 'cancel', 'reflect'] as const;
export type ReservationAction = (typeof RESERVATION_ACTIONS)[number];
export const RESERVATION_ACTION_LABELS: Record<ReservationAction, string> = {
  issue: 'ثبت خروج از انبار',
  release: 'آزادکردن رزرو',
  cancel: 'لغو خروج ثبت‌شده',
  reflect: 'با پایان کار خودکار',
};

export const STOCK_CURRENCIES = ['IRR', 'IRT'] as const;
export const STOCK_CURRENCY_LABELS: Record<(typeof STOCK_CURRENCIES)[number], string> = { IRR: 'ریال', IRT: 'تومان' };
export const STOCK_COMPLETENESS_LABELS = { full: 'کامل (همه اقلام این انبار)', partial: 'بخشی از اقلام' } as const;
export const STOCK_QUANTITY_MEANING_LABELS = { on_hand: 'موجودی فیزیکی', available: 'قابل‌فروش (پس از تعهدات انبار)' } as const;

const uuid = z.uuid();
const text = (max: number) => z.string().trim().max(max);
const jalaliDate = z.string().trim().regex(/^[0-9۰-۹]{4}\/[0-9۰-۹]{1,2}\/[0-9۰-۹]{1,2}$/, 'تاریخ را به شکل ۱۴۰۵/۰۸/۱۲ وارد کنید');
const hhmm = z.string().trim().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'ساعت را به شکل ۱۱:۰۰ وارد کنید');
export const decimalString = z
  .string()
  .trim()
  .max(30)
  .refine((v) => parseDecimal(v) !== null, 'مقدار باید عدد نامنفی باشد')
  .transform((v) => parseDecimal(v)!);

export const dailyApplySchema = z
  .object({
    // The report's own date (and time when known); not the upload time.
    reportDate: jalaliDate,
    reportTime: hhmm.nullish(),
    declaration: z.literal(true, { error: 'تأیید کنید که تاریخ گزارش را خودتان بررسی کرده‌اید' }),
    acceptTemplate: z.boolean().optional(),
    // Same content as the previous report: counts for today's task only with this declaration.
    declaredToday: z.boolean().optional(),
  })
  .strict();
export type DailyApplyInput = z.infer<typeof dailyApplySchema>;

export const dailyRowsQuerySchema = z.object({
  outcome: z.enum(DAILY_ROW_OUTCOMES).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const stockProfileSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    currency: z.enum(STOCK_CURRENCIES).nullable().optional(),
    taxIncluded: z.boolean().nullable().optional(),
    completeness: z.enum(['full', 'partial']).nullable().optional(),
    scope: text(120).nullable().optional(),
    quantityMeaning: z.enum(['on_hand', 'available']).nullable().optional(),
    reminderTime: hhmm.optional(),
    reminderUserId: uuid.nullable().optional(),
  })
  .strict();
export type StockProfileInput = z.infer<typeof stockProfileSchema>;

export const stockSearchSchema = z.object({
  q: text(80).default(''),
  base: z.string().trim().regex(/^\d{8}$/).optional(),
  needsMapping: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});
export type StockSearchQuery = z.infer<typeof stockSearchSchema>;

export const reserveSchema = z
  .object({
    partRequestId: uuid,
    fullStockCode: text(40).min(1),
    locationAddress: text(200),
    snapshotId: uuid,
    quantity: decimalString.refine((v) => v !== '0', 'مقدار رزرو باید بیشتر از صفر باشد'),
    confirm: z.literal(true, { error: 'انتخاب دقیق کد کامل را تأیید کنید' }),
  })
  .strict();
export type ReserveInput = z.infer<typeof reserveSchema>;

export const reservationActionSchema = z
  .object({
    action: z.enum(RESERVATION_ACTIONS),
    expectedVersion: z.number().int().positive(),
    reason: text(500).optional(),
  })
  .strict()
  .refine((v) => !['release', 'cancel'].includes(v.action) || !!v.reason, { message: 'دلیل را بنویسید', path: ['reason'] });
export type ReservationActionInput = z.infer<typeof reservationActionSchema>;

export const emdadSearchSchema = z
  .object({
    q: text(80).optional(),
    status: z.enum(EMDAD_STATUS_CATEGORIES).optional(),
    match: z.enum(EMDAD_MATCH_STATUSES).optional(),
    assignee: z.union([uuid, z.literal('me'), z.literal('none')]).optional(),
    caseId: uuid.optional(),
    relatedPartsOnly: z.boolean().optional(),
    partRequestId: uuid.optional(),
    openOnly: z.boolean().optional(),
    dueToday: z.boolean().optional(),
    review: z.boolean().optional(),
    codeIssue: z.boolean().optional(),
    stale: z.boolean().optional(),
    page: z.number().int().min(1).max(10_000).default(1),
    pageSize: z.number().int().min(1).max(100).default(30),
  })
  .strict();
export type EmdadSearchInput = z.infer<typeof emdadSearchSchema>;

export const emdadFollowUpSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    assigneeUserId: uuid.nullable().optional(),
    dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
    note: text(2000).nullable().optional(),
    nextAction: text(500).nullable().optional(),
  })
  .strict();
export type EmdadFollowUpInput = z.infer<typeof emdadFollowUpSchema>;

export const emdadMatchSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    caseId: uuid.nullable(),
    partRequestId: uuid.nullable().optional(),
    note: text(500).min(3, 'دلیل اتصال یا جداسازی را بنویسید'),
  })
  .strict();
export type EmdadMatchInput = z.infer<typeof emdadMatchSchema>;

export interface DailyImport {
  id: string;
  kind: DailyReportKind;
  status: DailyImportStatus;
  fileName: string;
  fileSize: number;
  fileSha256: string;
  format: string;
  parserVersion: string;
  sheetName: string | null;
  headerRow: number | null;
  diagnostics: Record<string, unknown>;
  counts: Partial<Record<DailyRowOutcome | 'matched' | 'unmatched' | 'missing' | 'total', number>>;
  progress: number;
  attempts: number;
  error: string | null;
  reportAt: string | null;
  reportAtPrecision: string | null;
  uploadedBy: string;
  uploadedByName: string | null;
  createdAt: string;
  appliedAt: string | null;
  templateChanged: boolean;
  sameAsImportId: string | null;
  /** Same content as the registered report (same file, or reordered rows). */
  sameContent: boolean;
}

export interface StockOption {
  /** Open cases holding this code and location (active reservation or handed over, case still open). */
  reservedFor?: { caseId: string; caseNumber: string; quantity: string }[];
  fullStockCode: string;
  rawCode: string;
  basePartNumber: string | null;
  supplySuffix: string | null;
  codeKind: 'standard' | 'needs_mapping';
  /** Explicit human-approved grouping only, never proof of technical equivalence. */
  alias?: { id: string; basePartNumber: string | null; reason: string; version: number } | null;
  description: string | null;
  unit: string | null;
  vehicleModel: string | null;
  locationAddress: string;
  locationText: string | null;
  reported: string;
  reserved: string;
  issuedUnreflected: string;
  available: string;
  salePrice: string | null;
  avgPrice: string | null;
  /** Set when this row is absent from the newest partial report and keeps an older report's values. */
  carriedReportedAt: string | null;
}

export const stockAliasSchema = z.object({
  fullStockCode: z.string().trim().min(1).max(80).regex(/^[0-9A-Za-z]+$/),
  basePartNumber: z.string().regex(/^\d{8}$/).nullable(),
  reason: z.string().trim().min(3).max(500),
  expectedVersion: z.number().int().min(0),
}).strict();
export type StockAliasInput = z.infer<typeof stockAliasSchema>;

export interface StockSnapshotInfo {
  id: string;
  reportedAt: string;
  reportedAtPrecision: string;
  publishedAt: string;
  itemCount: number;
  currency: string | null;
  taxIncluded: boolean | null;
  completeness: string | null;
  scope: string | null;
  quantityMeaning: string | null;
  fresh: boolean;
  reservable: boolean;
}

export interface StockReservation {
  id: string;
  caseId: string;
  caseNumber: string;
  admissionNo: string | null;
  partRequestId: string;
  partDescription: string;
  partNumber: string | null;
  needQuantity: number;
  fullStockCode: string;
  locationAddress: string;
  quantity: string;
  status: ReservationStatus;
  snapshotId: string;
  unitSalePrice: string | null;
  unitAvgPrice: string | null;
  currency: string | null;
  reservedByName: string | null;
  reservedAt: string;
  issuedAt: string | null;
  closedAt: string | null;
  reason: string | null;
  reflectedAt: string | null;
  shortfall: boolean;
  version: number;
}

export interface EmdadRequest {
  id: string;
  admissionNo: string | null;
  chassis: string | null;
  emdadNo: string | null;
  requestNo: string | null;
  initialCode: string | null;
  official: Record<string, string | string[] | null>;
  statusCategory: EmdadStatusCategory;
  lastReportAt: string;
  caseId: string | null;
  caseNumber: string | null;
  caseClosed: boolean;
  partRequestId: string | null;
  matchStatus: EmdadMatchStatus;
  matchSource: string;
  matchNote: string | null;
  assigneeUserId: string | null;
  assigneeName: string | null;
  dueAt: string | null;
  note: string | null;
  nextAction: string | null;
  suggestion: string | null;
  version: number;
}

export interface DailyTaskState {
  kind: DailyReportKind;
  localDate: string;
  dueAt: string;
  status: 'pending' | 'done';
  late: boolean;
  completedAt: string | null;
  unchangedDeclared: boolean;
}

export interface DailyReportsStatus {
  stock: { lastReportAt: string | null; precision: string | null; appliedAt: string | null; fresh: boolean } | null;
  emdad: { lastReportAt: string | null; precision: string | null; appliedAt: string | null; fresh: boolean } | null;
  tasks: DailyTaskState[];
  counts: { emdadOpen: number; emdadMine: number; emdadReview: number; emdadDueToday: number; reservationsActive: number; reconciliation: number; shortfalls: number };
}

export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  createdAt: string;
  readAt: string | null;
}
