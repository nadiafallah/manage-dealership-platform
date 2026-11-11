import { z } from 'zod';
import { ROLES, type CoverageType, type Role } from './enums';
import { AUDIT_ACTION_LABELS } from './labels';

// Phase 3 of the role-based plan: reminders between desks, technician wages
// and monthly work, case responsibility periods, owner and system-admin limits.

const version = z.number().int().positive();
const line = (max: number) => z.string().trim().min(1).max(max);

// ------------------------------------------------------------------ reminders

export const REMINDER_MAX_LENGTH = 300;
/** Working minutes (dealership calendar) after which an unseen reminder is sent again as a notification. */
export const REMINDER_NUDGE_WORKING_MINUTES = 120;

export const REMINDER_URGENCIES = ['normal', 'urgent'] as const;
export type ReminderUrgency = (typeof REMINDER_URGENCIES)[number];
export const REMINDER_URGENCY_LABELS: Record<ReminderUrgency, string> = { normal: 'عادی', urgent: 'فوری' };

export const REMINDER_STATUSES = ['sent', 'seen', 'done'] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];
export const REMINDER_STATUS_LABELS: Record<ReminderStatus, string> = { sent: 'ارسال‌شده', seen: 'دیده‌شده', done: 'انجام‌شده' };

export const REMINDER_SOURCES = ['manual', 'manager_report', 'technician_problem'] as const;
export type ReminderSource = (typeof REMINDER_SOURCES)[number];

/** Ready-made texts; the sender may also write a short text of their own. */
export const REMINDER_PRESETS = [
  'لطفاً امروز پیگیری کن.',
  'وضعیت این خودرو را به‌روز کن.',
  'هشدار بی‌جواب مانده؛ تکلیفش را روشن کن.',
  'مشتری منتظر است؛ زمان تحویل را مشخص کن.',
  'قطعه آماده است؛ تحویل بگیر.',
] as const;

export const TECHNICIAN_PROBLEMS = ['no_part', 'part_late', 'extra_damage', 'no_tool_or_bay'] as const;
export type TechnicianProblem = (typeof TECHNICIAN_PROBLEMS)[number];
export const TECHNICIAN_PROBLEM_LABELS: Record<TechnicianProblem, string> = {
  no_part: 'قطعه ندارم',
  part_late: 'قطعه دیر شد',
  extra_damage: 'آسیب اضافه دیدم',
  no_tool_or_bay: 'ابزار یا جایگاه ندارم',
};

export const reminderSendSchema = z
  .object({
    userIds: z.array(z.uuid()).max(50).default([]),
    role: z.enum(ROLES).optional(),
    caseId: z.uuid().optional(),
    /** One part line of that car (spec §9: «وصل به خودرو یا قطعه»); needs caseId. */
    partId: z.uuid().optional(),
    plate: z.string().trim().max(32).optional(),
    body: line(REMINDER_MAX_LENGTH),
    urgency: z.enum(REMINDER_URGENCIES).default('normal'),
    // Only informational: a reminder sent from a report row or finding of the service manager.
    source: z.enum(['manual', 'manager_report']).default('manual'),
  })
  .strict()
  .refine((v) => v.userIds.length > 0 || !!v.role, { message: 'گیرنده را انتخاب کنید', path: ['userIds'] })
  .refine((v) => !v.partId || !!v.caseId, { message: 'قطعه فقط همراه خودروی خودش وصل می‌شود', path: ['partId'] });
export type ReminderSendInput = z.infer<typeof reminderSendSchema>;

export const reminderRespondSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('seen'), expectedVersion: version }).strict(),
  z.object({ action: z.literal('done'), expectedVersion: version, reply: line(REMINDER_MAX_LENGTH).optional() }).strict(),
  z.object({ action: z.literal('reply'), expectedVersion: version, reply: line(REMINDER_MAX_LENGTH) }).strict(),
]);
export type ReminderRespondInput = z.infer<typeof reminderRespondSchema>;

export const technicianProblemSchema = z.object({ problem: z.enum(TECHNICIAN_PROBLEMS) }).strict();
export type TechnicianProblemInput = z.infer<typeof technicianProblemSchema>;

export interface ReminderPerson {
  id: string;
  displayName: string;
  roles: Role[];
}
export interface ReminderCaseRef {
  id: string;
  caseNumber: string;
}
export interface ReceivedReminder {
  /** Id of this recipient's copy (used for seen / done / reply). */
  id: string;
  reminderId: string;
  sender: { id: string; displayName: string; roleLabel: string };
  body: string;
  urgency: ReminderUrgency;
  source: ReminderSource;
  case: ReminderCaseRef | null;
  /** The part line the reminder is about, when one was attached. */
  part?: { id: string; description: string } | null;
  plate: string | null;
  status: ReminderStatus;
  seenAt: string | null;
  doneAt: string | null;
  reply: string | null;
  createdAt: string;
  /** Not seen within two working hours; a notification went out again. */
  overdue: boolean;
  version: number;
}
export interface SentReminder {
  id: string;
  body: string;
  urgency: ReminderUrgency;
  source: ReminderSource;
  case: ReminderCaseRef | null;
  part?: { id: string; description: string } | null;
  plate: string | null;
  targetRole: Role | null;
  createdAt: string;
  recipients: { id: string; userId: string; displayName: string; status: ReminderStatus; seenAt: string | null; doneAt: string | null; reply: string | null }[];
}
export interface MyReminders {
  received: ReceivedReminder[];
  sent: SentReminder[];
}

// --------------------------------------------------------------------- wages

const rial = z.number().int().min(0).max(1_000_000_000_000);

export const wageSetSchema = z
  .object({
    amountRial: rial,
    // Required by the API when an existing wage changes; kept in the history.
    reason: z.string().trim().max(300).optional(),
    /** 0 when the job has no wage yet. */
    expectedVersion: z.number().int().min(0),
  })
  .strict();
export type WageSetInput = z.infer<typeof wageSetSchema>;
export const wageSeenSchema = z.object({ expectedVersion: version }).strict();
export const monthQuerySchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() });
export type MonthQuery = z.infer<typeof monthQuerySchema>;

export const COVERAGE_BUCKETS = ['golden_card', 'insurance', 'personal', 'other'] as const;
export type CoverageBucket = (typeof COVERAGE_BUCKETS)[number];
export const COVERAGE_BUCKET_LABELS: Record<CoverageBucket, string> = { golden_card: 'کارت طلایی', insurance: 'بیمه', personal: 'شخصی', other: 'سایر' };
export function coverageBucket(coverage: CoverageType | string): CoverageBucket {
  return coverage === 'golden_card' || coverage === 'insurance' || coverage === 'personal' ? coverage : 'other';
}

/** The technician's own wage on a job card; never carries assessment or other people's amounts. */
export interface TaskWage {
  amountRial: number;
  /** Changed after the technician saw it; previousRial is the amount seen. */
  changed: boolean;
  previousRial: number | null;
  seen: boolean;
  version: number;
}
export interface CaseWageRow {
  taskId: string;
  title: string | null;
  departmentName: string;
  stationCode: string | null;
  technician: { id: string; displayName: string } | null;
  status: string;
  approvedAt: string | null;
  wageRial: number | null;
  reason: string | null;
  setAt: string | null;
  setBy: string | null;
  /** 0 when the job has no wage yet. */
  version: number;
  /** Assessment labour of the same trade, shared equally by the jobs of that trade in the case. */
  expertShareRial: number | null;
}
export interface WageHistoryEntry {
  at: string;
  actor: string | null;
  beforeRial: number | null;
  afterRial: number;
  reason: string | null;
}
export interface MonthOption {
  key: string;
  label: string;
}
export interface MyWorkRow {
  taskId: string;
  plate: string | null;
  vehicleLabel: string;
  title: string;
  approvedAt: string;
  wageRial: number | null;
  coverage: CoverageBucket;
}
export interface MyWorkMonth {
  month: string;
  label: string;
  months: MonthOption[];
  rows: MyWorkRow[];
  totalRial: number;
  byCoverage: Record<CoverageBucket, number>;
  /** Approved jobs whose wage is not recorded yet (not counted). */
  missingWage: number;
}
export interface WageReportRow {
  technician: { id: string; displayName: string };
  jobs: number;
  paidRial: number;
  expertRial: number;
  differenceRial: number;
  missingWage: number;
}
export interface WageReport {
  month: string;
  label: string;
  months: MonthOption[];
  rows: WageReportRow[];
  totals: { jobs: number; paidRial: number; expertRial: number; differenceRial: number };
}

// ------------------------------------------------------------ responsibility

export const caseTransferSchema = z
  .object({
    toUserId: z.uuid(),
    reason: z.string().trim().max(300).optional(),
    expectedVersion: version,
  })
  .strict();
export type CaseTransferInput = z.infer<typeof caseTransferSchema>;

export interface ResponsibilityPeriod {
  userId: string;
  displayName: string;
  startedAt: string;
  endedAt: string | null;
  reason: string | null;
  /** Computed for a case without recorded periods: admission to now with the current responsible. */
  derived: boolean;
}
export interface ResponsibilityReportRow {
  user: { id: string; displayName: string };
  cases: number;
  heldDays: number;
  approvedTasks: number;
  delivered: number;
}
export interface ResponsibilityReport {
  month: string;
  label: string;
  months: MonthOption[];
  rows: ResponsibilityReportRow[];
}

// ------------------------------------------------- owner and system admin

/** Grants or removes "invite and deactivate staff" (user.manage) of one system administrator. */
export const staffAdminSchema = z.object({ granted: z.boolean(), expectedVersion: version }).strict();
export type StaffAdminInput = z.infer<typeof staffAdminSchema>;
export const adminActionsQuerySchema = monthQuerySchema;

export interface SystemAdminAccount {
  id: string;
  displayName: string;
  isActive: boolean;
  canManageStaff: boolean;
  version: number;
}
export interface AdminActionRow {
  id: string;
  occurredAt: string;
  actor: { id: string; displayName: string };
  action: string;
  actionLabel: string;
  entityType: string;
  caseId: string | null;
  caseNumber: string | null;
  reason: string | null;
}
export interface AdminActions {
  month: string;
  label: string;
  months: MonthOption[];
  admins: SystemAdminAccount[];
  rows: AdminActionRow[];
}

/** Persian name of an audited action (the same names as the case history). */
export const auditActionLabel = (action: string): string => AUDIT_ACTION_LABELS[action] ?? action;
