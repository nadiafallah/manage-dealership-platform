import { z } from 'zod';
import { ALERT_KINDS, ALERT_RESPONSES } from './alerts';
import { REPAIR_TRADES } from './workshop';
import { PIN_LOGIN_ROLES } from './permissions';
import {
  ASSESSMENT_ITEM_ACTIONS,
  ASSESSMENT_KINDS,
  AUTHORIZATION_DECISIONS,
  AUTHORIZATION_METHODS,
  AUTHORIZATION_SOURCES,
  BLOCKER_REASONS,
  FINANCE_APPROVAL_KINDS,
  PART_ACTIONS,
  PART_INSPECTIONS,
  PART_SOURCES,
  PART_STATUSES,
  QC_CHECK_ITEMS,
  QC_RESULTS,
  QC_SAFETY_ITEMS,
  IMPORT_DEADLINE_TARGETS,
  DISCREPANCY_STATUSES,
  REPORT_PERIODS,
  REPORT_VIEWS,
  RECIPIENT_RELATIONS,
  CASE_STAGES,
  CASE_STATUSES,
  COVERAGE_TYPES,
  TASK_ACTIONS,
} from './enums';

// Request contracts validated by the API. All timestamps travel as ISO-8601
// UTC strings; the web app converts Jalali input before sending.

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullish();

const isoDate = z.iso.datetime({ offset: true });
const optionalIsoDate = isoDate.nullish();
const uuid = z.uuid();

export const loginSchema = z.object({
  // Needed only when the same username exists in more than one dealership.
  tenantCode: z.string().trim().max(32).optional(),
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Persian/Arabic-Indic digits to ASCII, for PINs typed on a Persian keyboard. */
const asciiDigits = (v: string) =>
  v.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
const devicePasswordSchema = z.string().min(8, 'رمز ثبت دستگاه دست‌کم ۸ نویسه باشد').max(128).regex(/[A-Za-z]/, 'رمز ثبت دستگاه حرف انگلیسی داشته باشد').regex(/[0-9]/, 'رمز ثبت دستگاه عدد داشته باشد');
const pinSchema = z.string().trim().transform(asciiDigits).pipe(z.string().regex(/^[0-9]{4}$/, 'رمز باید ۴ رقم باشد'));

/** Technician sign-in: username + 4-digit PIN, no email or Authenticator. */
export const technicianLoginSchema = z.object({
  tenantCode: z.string().trim().max(32).optional(),
  username: z.string().trim().min(1).max(64),
  pin: pinSchema,
  // Needed only on a device not yet registered for this account.
  devicePassword: z.string().min(1).max(256).optional(),
});
export type TechnicianLoginInput = z.infer<typeof technicianLoginSchema>;

/** Owner/system admin creates a technician account (no email). */
export const technicianAccountSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  // Optional: without it the API picks the next free tech01, tech02, …
  username: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9._-]{2,31}$/, 'نام کاربری با حرف انگلیسی شروع شود و ۳ تا ۳۲ حرف، عدد، نقطه یا خط تیره باشد').optional(),
  pin: pinSchema,
  devicePassword: devicePasswordSchema,
  role: z.enum(PIN_LOGIN_ROLES).default('technician'),
  // The technician's unit (صافکاری، نقاشی، …) and bay code; Manage creates the bay if it is new.
  trade: z.enum(REPAIR_TRADES).optional(),
  stationCode: z.string().trim().min(1, 'کد جایگاه را وارد کنید').max(32).optional(),
}).refine((v) => !v.trade === !v.stationCode, { message: 'واحد و کد جایگاه را با هم وارد کنید', path: ['stationCode'] })
  // Unit and bay belong to technicians only.
  .refine((v) => v.role === 'technician' || (!v.trade && !v.stationCode), { message: 'واحد و جایگاه فقط برای تعمیرکار ثبت می‌شود', path: ['trade'] });
/** Next free automatic technician username (tech01, tech02, …) given the usernames in use. */
export function nextTechnicianUsername(taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let n = 1; ; n++) {
    const candidate = `tech${String(n).padStart(2, '0')}`;
    if (!used.has(candidate)) return candidate;
  }
}
export type TechnicianAccountInput = z.infer<typeof technicianAccountSchema>;

// A system administrator (not the owner) must give a reason: a new PIN also unlocks the account.
// Also enables PIN sign-in for an existing eligible staff account (no duplicate account).
export const technicianPinSchema = z
  .object({ pin: pinSchema.optional(), devicePassword: devicePasswordSchema.optional(), reason: z.string().trim().max(300).optional() })
  .refine((v) => v.pin || v.devicePassword, { message: 'رمز ۴ رقمی یا رمز ثبت دستگاه را وارد کنید', path: ['pin'] });
export const technicianSignOutSchema = z.object({ reason: z.string().trim().max(300).optional() });
export const technicianActiveSchema = z.object({ active: z.boolean(), reason: z.string().trim().max(300).optional() });
export type TechnicianActiveInput = z.infer<typeof technicianActiveSchema>;

/** The accident expert's advance decision on a non-blocking cost alert (spec section 9). */
export const alertResponseSchema = z.object({
  kind: z.enum(ALERT_KINDS),
  level: z.number().int().min(1).max(1000),
  response: z.enum(ALERT_RESPONSES),
  note: z.string().trim().max(500).optional(),
});
export type AlertResponseInput = z.infer<typeof alertResponseSchema>;

/** Thresholds set by the system administrator or the owner. Omitted fields keep their current value. */
export const alertSettingsSchema = z.object({
  partsAlertThresholdRial: z.number().int().min(1_000_000).max(1_000_000_000_000),
  expensivePartThresholdRial: z.number().int().min(1_000_000).max(1_000_000_000_000).optional(),
  emdadLateDays: z.number().int().min(1).max(60).optional(),
});
export type AlertSettingsInput = z.infer<typeof alertSettingsSchema>;
export type TechnicianPinInput = z.infer<typeof technicianPinSchema>;

export const customerInputSchema = z.object({
  fullName: optionalText(500),
  phone: optionalText(32),
});

export const vehicleInputSchema = z.object({
  brand: optionalText(200),
  model: optionalText(1000),
  trim: optionalText(1000),
  modelYear: z.number().int().min(1300).max(2100).nullish(),
  plate: optionalText(64),
  vin: optionalText(32),
  color: optionalText(100),
});

const caseFields = {
  admissionNo: optionalText(80),
  customer: customerInputSchema.optional(),
  vehicle: vehicleInputSchema.optional(),
  odometerKm: z.number().int().min(0).max(5_000_000).nullish(),
  admittedAt: isoDate,
  damageDescription: optionalText(4000),
  vehicleLocation: optionalText(200),
  coverageType: z.enum(COVERAGE_TYPES),
  goldenCardFileNo: optionalText(64),
  insurerName: optionalText(120),
  insuranceClaimNo: optionalText(64),
  coverageNotes: optionalText(2000),
  responsibleUserId: uuid.nullish(),
  repairDurationDays: z.number().min(0.25).max(365).multipleOf(0.25).optional(),
  officialDeadlineAt: optionalIsoDate,
  forecastDeliveryAt: optionalIsoDate,
  stage: z.enum(CASE_STAGES).optional(),
  isLegacyEntry: z.boolean().optional(),
};

export const createCaseSchema = z.object({
  ...caseFields,
  coverageType: caseFields.coverageType.default('unknown'),
});
export type CreateCaseInput = z.infer<typeof createCaseSchema>;

export const updateCaseSchema = z
  .object({
    ...caseFields,
    admittedAt: isoDate.optional(),
    coverageType: caseFields.coverageType.optional(),
    expectedVersion: z.number().int().min(1),
    // Required by the API when official deadline or admission time changes.
    reason: optionalText(500),
  })
  .omit({ stage: true });
export type UpdateCaseInput = z.infer<typeof updateCaseSchema>;

export const changeStageSchema = z.object({
  stage: z.enum(CASE_STAGES),
  expectedVersion: z.number().int().min(1),
  note: optionalText(500),
});
export type ChangeStageInput = z.infer<typeof changeStageSchema>;

export const CASE_FLAGS = [
  'overdue',
  'due_soon',
  'blocked',
  'needs_completion',
  'unassigned',
  'ready',
  'legacy',
  'awaiting_authorization',
  'parts_overdue',
  'parts_to_order',
  'finance_pending',
  'overdue_official',
  'overdue_forecast',
  'no_deadline',
] as const;
export type CaseFlag = (typeof CASE_FLAGS)[number];

export const caseListQuerySchema = z.object({
  vehicleIdentity: z.string().trim().min(6).max(32).optional(),
  stationCode:z.string().trim().min(1).max(32).optional(),
  q: z.string().trim().max(100).optional(),
  stage: z.enum(CASE_STAGES).optional(),
  coverage: z.enum(COVERAGE_TYPES).optional(),
  status: z.enum([...CASE_STATUSES, 'all']).default('open'),
  flag: z.enum(CASE_FLAGS).optional(),
  blockerReason: z.enum(BLOCKER_REASONS).optional(),
  responsibleUserId: uuid.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type CaseListQuery = z.infer<typeof caseListQuerySchema>;

export const createTaskSchema = z.object({
  stationId: uuid.nullish(),
  assignedUserId: uuid.nullish(),
  durationMinutes: z.number().int().min(1).max(100000).optional(),
  durationDays: z.number().min(0.25).max(180).multipleOf(0.25).optional(),
  scheduleReason: optionalText(1000),
  departmentId: uuid,
  title: optionalText(200),
  technicianName: optionalText(120),
  technicianCode: optionalText(32),
  plannedStartAt: optionalIsoDate,
  plannedEndAt: optionalIsoDate,
  dependsOn: z.array(uuid).max(20).optional(),
  weight: z.number().int().min(1).max(10).default(1),
  notes: optionalText(2000),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = createTaskSchema
  .partial()
  .omit({ weight: true })
  .extend({
    weight: z.number().int().min(1).max(10).optional(),
    expectedVersion: z.number().int().min(1),
  });
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const taskActionSchema = z
  .object({
    action: z.enum(TASK_ACTIONS),
    expectedVersion: z.number().int().min(1),
    // When the event actually happened; supervisors often record afterwards.
    at: optionalIsoDate,
    note: optionalText(1000),
  })
  .refine((v) => v.action !== 'reopen' || !!v.note, {
    message: 'برای بازگشایی فعالیت ذکر دلیل الزامی است',
    path: ['note'],
  });
export type TaskActionInput = z.infer<typeof taskActionSchema>;

export const createBlockerSchema = z.object({
  reason: z.enum(BLOCKER_REASONS),
  description: optionalText(2000),
  taskId: uuid.nullish(),
  // When the problem actually started (may be earlier than recording time).
  occurredAt: optionalIsoDate,
  // Optimistic-lock version of the task when blocking a task.
  expectedTaskVersion: z.number().int().min(1).optional(),
  // "Part not arrived": the part request it waits for; handover resolves it.
  partRequestId: uuid.nullish(),
});
export type CreateBlockerInput = z.infer<typeof createBlockerSchema>;

export const blockerFollowUpSchema = z.object({
  note: optionalText(1000),
  at: optionalIsoDate,
});
export type BlockerFollowUpInput = z.infer<typeof blockerFollowUpSchema>;

export const resolveBlockerSchema = z.object({
  note: z.string().trim().min(1).max(1000),
  at: optionalIsoDate,
});
export type ResolveBlockerInput = z.infer<typeof resolveBlockerSchema>;

// Amounts are whole Rials (no decimals), safely below Number.MAX_SAFE_INTEGER.
const rial = z.number().int().min(0).max(1_000_000_000_000);

export const createAssessmentSchema = z
  .object({
    kind: z.enum(ASSESSMENT_KINDS),
    // External assessor (insurer / golden card expert) or the dealership expert.
    assessorName: z.string().trim().min(1).max(120),
    assessorOrg: optionalText(120),
    assessedAt: optionalIsoDate,
    // Supplement only: what was found and when it was discovered.
    reason: optionalText(2000),
    discoveredAt: optionalIsoDate,
    notes: optionalText(2000),
  })
  .refine((v) => v.kind !== 'supplement' || !!v.reason, {
    message: 'برای الحاقیه شرح آسیب پنهان الزامی است',
    path: ['reason'],
  });
export type CreateAssessmentInput = z.infer<typeof createAssessmentSchema>;

const assessmentItemFields = {
  action: z.enum(ASSESSMENT_ITEM_ACTIONS),
  description: z.string().trim().min(1).max(300),
  partNumber: optionalText(64),
  quantity: z.number().int().min(1).max(999).default(1),
  unitPriceRial: rial.default(0),
  labourDepartmentId: uuid.nullish(),
  labourRial: rial.default(0),
  // References to photos or documents until file upload exists (issue #13).
  evidence: optionalText(1000),
};

export const assessmentItemSchema = z.object({
  ...assessmentItemFields,
  expectedVersion: z.number().int().min(1),
});
export type AssessmentItemInput = z.infer<typeof assessmentItemSchema>;

export const importAssessmentSchema = z.object({
  expectedVersion: z.number().int().min(1),
  fileBase64: z.string().min(1).max(7_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  dryRun: z.boolean().default(true),
  currency: z.enum(['rial', 'toman']),
}).strict();
export type ImportAssessmentInput = z.infer<typeof importAssessmentSchema>;

export const updateAssessmentItemSchema = z.object({
  action: assessmentItemFields.action.optional(),
  description: assessmentItemFields.description.optional(),
  partNumber: assessmentItemFields.partNumber,
  quantity: z.number().int().min(1).max(999).optional(),
  unitPriceRial: rial.optional(),
  labourDepartmentId: assessmentItemFields.labourDepartmentId,
  labourRial: rial.optional(),
  evidence: assessmentItemFields.evidence,
  expectedVersion: z.number().int().min(1),
});
export type UpdateAssessmentItemInput = z.infer<typeof updateAssessmentItemSchema>;

export const removeAssessmentItemSchema = z.object({
  expectedVersion: z.number().int().min(1),
});
export type RemoveAssessmentItemInput = z.infer<typeof removeAssessmentItemSchema>;

export const finalizeAssessmentSchema = z.object({
  expectedVersion: z.number().int().min(1),
  // A supplement usually moves the internal forecast; the official deadline
  // is changed only through the case form with a reason.
  forecastDeliveryAt: optionalIsoDate,
  note: optionalText(1000),
});
export type FinalizeAssessmentInput = z.infer<typeof finalizeAssessmentSchema>;

export const recordAuthorizationSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    decision: z.enum(AUTHORIZATION_DECISIONS),
    source: z.enum(AUTHORIZATION_SOURCES),
    method: z.enum(AUTHORIZATION_METHODS),
    // Reference number in the official system (golden card / insurer).
    reference: optionalText(64),
    at: optionalIsoDate,
    rejectedItemIds: z.array(uuid).max(200).default([]),
    note: optionalText(1000),
  })
  .refine((v) => v.source === 'customer' || !!v.reference, {
    message: 'تأیید کارت طلایی یا بیمه فقط با شماره ثبت در سامانه رسمی معتبر است',
    path: ['reference'],
  })
  .refine((v) => v.decision !== 'partially_approved' || v.rejectedItemIds.length > 0, {
    message: 'برای تأیید جزئی، اقلام ردشده را مشخص کنید',
    path: ['rejectedItemIds'],
  })
  .refine((v) => v.decision === 'approved' || !!v.note, {
    message: 'برای رد یا تأیید جزئی ذکر توضیح الزامی است',
    path: ['note'],
  });
export type RecordAuthorizationInput = z.infer<typeof recordAuthorizationSchema>;

export const createPartSchema = z.object({
  description: z.string().trim().min(1).max(300),
  partNumber: optionalText(64),
  quantity: z.number().int().min(1).max(999).default(1),
  source: z.enum(PART_SOURCES),
  // Price accepted by the payer (assessment line); purchases above it need approval.
  approvedUnitPriceRial: rial.nullish(),
  notes: optionalText(1000),
});
export type CreatePartInput = z.infer<typeof createPartSchema>;

export const partsFromAssessmentSchema = z.object({
  source: z.enum(PART_SOURCES).optional(),
  assessmentId: uuid.optional(),
  expectedVersion: z.number().int().min(1).optional(),
  itemIds: z.array(uuid).min(1).max(500).optional(),
}).superRefine((v,ctx)=>{if((v.itemIds||v.assessmentId||v.expectedVersion)&&(!v.itemIds||!v.assessmentId||!v.expectedVersion))ctx.addIssue({code:'custom',message:'شناسه و نسخه کارشناسی و اقلام انتخابی را با هم بفرستید'});});
export type PartsFromAssessmentInput = z.infer<typeof partsFromAssessmentSchema>;

export const importPartsSchema = z.object({
  // .xlsx file as base64 (max ~1 MB).
  fileBase64: z.string().min(1).max(1_400_000),
  dryRun: z.boolean().default(true),
});
export type ImportPartsInput = z.infer<typeof importPartsSchema>;

export const partActionSchema = z
  .object({
    action: z.enum(PART_ACTIONS),
    expectedVersion: z.number().int().min(1),
    at: optionalIsoDate,
    note: optionalText(1000),
    // check_stock
    inStock: z.boolean().optional(),
    // order
    source: z.enum(PART_SOURCES).optional(),
    supplier: optionalText(120),
    orderRef: optionalText(64),
    unitPriceRial: rial.optional(),
    etaAt: optionalIsoDate,
    priceApprovalRef: optionalText(64),
    priceApprovedBy: optionalText(120),
    // receive
    receiptDocNo: optionalText(64),
    inspection: z.enum(PART_INSPECTIONS).optional(),
    salePriceRial: rial.optional(),
    // hand_over
    departmentId: uuid.nullish(),
    recipientName: optionalText(120),
  })
  .refine((v) => v.action !== 'check_stock' || v.inStock !== undefined, {
    message: 'نتیجه بررسی موجودی را مشخص کنید',
    path: ['inStock'],
  })
  .refine((v) => v.action !== 'update_eta' || !!v.etaAt, { message: 'زمان جدید رسیدن قطعه الزامی است', path: ['etaAt'] })
  .refine((v) => v.action !== 'receive' || !!v.inspection, {
    message: 'نتیجه کنترل قطعه هنگام رسید الزامی است',
    path: ['inspection'],
  })
  .refine((v) => v.action !== 'receive' || v.inspection === 'ok' || !!v.note, {
    message: 'برای قطعه اشتباه یا معیوب توضیح الزامی است',
    path: ['note'],
  })
  .refine((v) => v.action !== 'hand_over' || !!v.recipientName, {
    message: 'نام تحویل‌گیرنده در واحد تعمیر الزامی است',
    path: ['recipientName'],
  })
  .refine((v) => v.action !== 'cancel' || !!v.note, { message: 'برای لغو ذکر دلیل الزامی است', path: ['note'] });
export type PartActionInput = z.infer<typeof partActionSchema>;

// ---- unified parts list (spec section 7): one endpoint, one action per state
const reason = z.string().trim().min(3, 'علت را بنویسید').max(500);
const flowBase = { expectedVersion: z.number().int().min(1) };
export const partFlowActionSchema = z.discriminatedUnion('action', [
  z.object({ ...flowBase, action: z.literal('reserve'), snapshotId: uuid, fullStockCode: z.string().trim().min(1).max(32), locationAddress: z.string().max(120).default(''), saleUnitRial: rial.optional() }),
  // The Emdad Vijeh request number is mandatory (per vehicle: VIN + admission number).
  z.object({ ...flowBase, action: z.literal('emdad'), requestNo: z.string().trim().min(1, 'شمارهٔ درخواست امداد ویژه را وارد کنید').max(64), requestedAt: optionalIsoDate, requestedCode: optionalText(32) }),
  z.object({ ...flowBase, action: z.literal('market'), supplier: z.string().trim().min(1, 'نام فروشنده را وارد کنید').max(120), purchaseUnitRial: rial, saleUnitRial: rial, etaAt: optionalIsoDate }),
  z.object({ ...flowBase, action: z.literal('receive'), receiptDocNo: optionalText(64) }),
  z.object({ ...flowBase, action: z.literal('hand_over'), recipientName: z.string().trim().min(1, 'نام تحویل‌گیرنده را وارد کنید').max(120), taskId: uuid.nullish(), departmentId: uuid.nullish(), saleUnitRial: rial.optional() }),
  z.object({ ...flowBase, action: z.literal('cancel'), reason }),
  z.object({ ...flowBase, action: z.literal('return'), reason }),
  z.object({ ...flowBase, action: z.literal('set_price'), saleUnitRial: rial }),
  z.object({ ...flowBase, action: z.literal('announce_price'), saleUnitRial: rial, note: optionalText(300) }),
]);
export type PartFlowActionInput = z.infer<typeof partFlowActionSchema>;

/** The accident expert answers a price announcement: confirm, or give another instruction. Never blocks. */
export const priceNoticeResponseSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    response: z.enum(['approved', 'instruction']),
    instruction: optionalText(300),
  })
  .refine((v) => v.response !== 'instruction' || !!v.instruction, { message: 'دستور را بنویسید (مثلاً از فروشگاه فلان بخرید یا امداد ویژه بزنید)', path: ['instruction'] });
export type PriceNoticeResponseInput = z.infer<typeof priceNoticeResponseSchema>;

export const financeSharesSchema = z.object({
  // Payer split of the estimate; null = not decided yet.
  customerShareRial: rial.nullable(),
  insurerShareRial: rial.nullable(),
  companyShareRial: rial.nullable(),
  note: optionalText(1000),
  // Omit when the case has no shares recorded yet.
  expectedVersion: z.number().int().min(1).optional(),
});
export type FinanceSharesInput = z.infer<typeof financeSharesSchema>;

export const proposeFinanceSchema = z.object({
  kind: z.enum(FINANCE_APPROVAL_KINDS),
  // Advance amount, or the spending limit of an exception.
  amountRial: rial.refine((v) => v > 0, 'مبلغ باید بیشتر از صفر باشد'),
  reason: z.string().trim().min(1).max(1000),
});
export type ProposeFinanceInput = z.infer<typeof proposeFinanceSchema>;

export const financeDecisionSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    expectedVersion: z.number().int().min(1),
    note: optionalText(1000),
  })
  .refine((v) => v.decision === 'approve' || !!v.note, { message: 'برای رد ذکر دلیل الزامی است', path: ['note'] });
export type FinanceDecisionInput = z.infer<typeof financeDecisionSchema>;

export const financePaymentSchema = z.object({
  expectedVersion: z.number().int().min(1),
  paymentRef: z.string().trim().min(1).max(64),
  at: optionalIsoDate,
});
export type FinancePaymentInput = z.infer<typeof financePaymentSchema>;

export const settlementPaymentSchema = z.object({
  amountRial: rial.refine((v) => v > 0, 'مبلغ باید بیشتر از صفر باشد'),
  paymentRef: z.string().trim().min(1).max(64),
  at: optionalIsoDate,
  note: optionalText(500),
});
export type SettlementPaymentInput = z.infer<typeof settlementPaymentSchema>;

// ------------------------------------------------- QC, closes and delivery

export const qcCheckSchema = z
  .object({
    item: z.enum(QC_CHECK_ITEMS),
    result: z.enum(QC_RESULTS),
    note: optionalText(500),
    // Unit that does the corrective work for a failed item.
    departmentId: uuid.nullish(),
  })
  .refine((v) => v.result !== 'fail' || !!v.note, { message: 'برای مورد ردشده شرح ایراد الزامی است', path: ['note'] })
  .refine((v) => v.result !== 'fail' || !!v.departmentId, {
    message: 'برای مورد ردشده واحد انجام کار اصلاحی را انتخاب کنید',
    path: ['departmentId'],
  })
  .refine((v) => v.result !== 'na' || !QC_SAFETY_ITEMS.includes(v.item), {
    message: 'موارد ایمنی باید بازبینی شوند و «بررسی نشد» برای آن‌ها پذیرفته نیست',
    path: ['result'],
  });
export type QcCheckInput = z.infer<typeof qcCheckSchema>;

export const recordQcSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    checks: z.array(qcCheckSchema).length(QC_CHECK_ITEMS.length),
    at: optionalIsoDate,
    note: optionalText(1000),
  })
  .refine((v) => new Set(v.checks.map((c) => c.item)).size === QC_CHECK_ITEMS.length, {
    message: 'همه موارد چک‌لیست کنترل کیفیت باید یک بار تعیین شوند',
    path: ['checks'],
  });
export type RecordQcInput = z.infer<typeof recordQcSchema>;

export const technicalCloseSchema = z.object({
  expectedVersion: z.number().int().min(1),
  note: optionalText(1000),
});
export type TechnicalCloseInput = z.infer<typeof technicalCloseSchema>;

export const financialCloseSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    // Close although part of the customer share is unpaid (manager only, reason required).
    waiveBalance: z.boolean().default(false),
    note: optionalText(1000),
  })
  .refine((v) => !v.waiveBalance || !!v.note, {
    message: 'برای بستن با مانده بدهی ذکر دلیل الزامی است',
    path: ['note'],
  });
export type FinancialCloseInput = z.infer<typeof financialCloseSchema>;

export const deliverySchema = z.object({
  expectedVersion: z.number().int().min(1),
  recipientName: z.string().trim().min(2).max(120),
  recipientRelation: z.enum(RECIPIENT_RELATIONS),
  // Recipient checked the vehicle and confirmed the handover (signed form).
  handoverConfirmed: z.literal(true, { error: 'تأیید تحویل‌گیرنده الزامی است' }),
  at: optionalIsoDate,
  note: optionalText(1000),
});
export type DeliveryInput = z.infer<typeof deliverySchema>;

// ------------------------------------------------- existing-vehicle import

export const vehicleImportDecisionsSchema = z.object({
  // Rows with a date but no time: record the day only (time shown as unknown).
  dateWithoutTime: z.boolean().default(false),
  deadlineAs: z.enum(IMPORT_DEADLINE_TARGETS).default('none'),
});
export type VehicleImportDecisions = z.infer<typeof vehicleImportDecisionsSchema>;

export const vehicleImportSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  // base64 of an .xlsx up to ~1 MB.
  fileBase64: z.string().min(1).max(1_400_000),
  decisions: vehicleImportDecisionsSchema.default({ dateWithoutTime: false, deadlineAs: 'none' }),
});
export type VehicleImportInput = z.infer<typeof vehicleImportSchema>;

// ------------------------------------------------------------------ reports

const jalaliDay = z
  .string()
  .trim()
  .regex(/^[0-9۰-۹]{4}[/-][0-9۰-۹]{1,2}[/-][0-9۰-۹]{1,2}$/, 'تاریخ را به شکل ۱۴۰۵/۰۸/۱۰ وارد کنید');

export const reportQuerySchema = z.object({
  stationCode:z.string().trim().min(1).max(32).optional(),
  view: z.enum(REPORT_VIEWS),
  period: z.enum(REPORT_PERIODS).default('month'),
  // Jalali days (Tehran), inclusive; only for period=custom.
  from: jalaliDay.optional(),
  to: jalaliDay.optional(),
  responsibleUserId: z.union([uuid, z.literal('me'), z.literal('none')]).optional(),
  departmentId: uuid.optional(),
  stage: z.enum(CASE_STAGES).optional(),
  coverage: z.enum(COVERAGE_TYPES).optional(),
  blockerReason: z.enum(BLOCKER_REASONS).optional(),
  partStatus: z.enum(PART_STATUSES).optional(),
  // Case number, admission number, plate, VIN or chassis.
  q: z.string().trim().max(100).optional(),
  // Work-list rows of one kind only (a KPI or chart bar opens its rows).
  kind: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;

// ---------------------------------------------------- parts discrepancies

export const discrepancyListSchema = z.object({
  status: z.enum([...DISCREPANCY_STATUSES, 'active', 'all']).default('active'),
  caseId: uuid.optional(),
});
export type DiscrepancyListQuery = z.infer<typeof discrepancyListSchema>;

export const discrepancyAssignSchema = z.object({
  expectedVersion: z.number().int().min(1),
  // null releases the item back to "open".
  assigneeUserId: uuid.nullable(),
});
export type DiscrepancyAssignInput = z.infer<typeof discrepancyAssignSchema>;

export const discrepancyResolveSchema = z.object({
  expectedVersion: z.number().int().min(1),
  // resolved: the records were checked and corrected; dismissed: not a real discrepancy.
  outcome: z.enum(['resolved', 'dismissed']),
  reason: z.string().trim().min(5, 'دلیل و سابقه رسیدگی را بنویسید').max(1000),
});
export type DiscrepancyResolveInput = z.infer<typeof discrepancyResolveSchema>;
