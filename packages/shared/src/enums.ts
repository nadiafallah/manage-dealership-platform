// Domain vocabulary. Values are stable identifiers stored in the database and
// used in the API; Persian display labels live in labels.ts.

// Five role codes plus the owner flag on the account = the six roles of the
// product specification (docs/PRODUCT_SPEC_FA.md, section 3).
export const ROLES = [
  'accident_expert', // کارشناس تصادفات (several people)
  'parts_clerk', // مسئول قطعات
  'technician', // تکنسین جایگاه
  'service_manager', // مدیر خدمات — view, analyse, remind only
  'system_admin', // مدیر سیستم
] as const;
export type Role = (typeof ROLES)[number];

/**
 * Role codes retired by migration 0020. accident_coordinator, accident_supervisor
 * and qc_inspector became accident_expert; cashier has no successor (its work
 * moved to the accident expert and the account is deactivated if nothing remains).
 */
export const LEGACY_ROLE_SUCCESSORS: Readonly<Record<string, Role | null>> = {
  accident_coordinator: 'accident_expert',
  accident_supervisor: 'accident_expert',
  qc_inspector: 'accident_expert',
  cashier: null,
};

/** Current roles of a stored role list: legacy codes mapped, unknown codes dropped, order of ROLES, no duplicates. */
export function normalizeRoles(raw: readonly string[] | null | undefined): Role[] {
  const out = new Set<Role>();
  for (const r of raw ?? []) {
    if ((ROLES as readonly string[]).includes(r)) out.add(r as Role);
    else if (Object.prototype.hasOwnProperty.call(LEGACY_ROLE_SUCCESSORS, r)) {
      const next = LEGACY_ROLE_SUCCESSORS[r];
      if (next) out.add(next);
    }
  }
  return ROLES.filter((r) => out.has(r));
}

export const COVERAGE_TYPES = ['golden_card', 'insurance', 'personal', 'mixed', 'unknown'] as const;
export type CoverageType = (typeof COVERAGE_TYPES)[number];

// Ordered pipeline of an accident case. Stage is set explicitly by staff in
// phase 1; later phases derive parts of it from tasks, approvals and QC.
export const CASE_STAGES = [
  'reception',
  'assessment',
  'awaiting_approval',
  'awaiting_parts',
  'in_repair',
  'quality_control',
  'ready_for_delivery',
  'delivered',
] as const;
export type CaseStage = (typeof CASE_STAGES)[number];

export const CASE_STATUSES = ['open', 'closed', 'cancelled'] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const TASK_STATUSES = ['pending', 'in_progress', 'blocked', 'done', 'approved'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_ACTIONS = ['start', 'complete', 'approve', 'reopen'] as const;
export type TaskAction = (typeof TASK_ACTIONS)[number];

export const BLOCKER_REASONS = [
  'part_not_arrived',
  'part_wrong_or_defective',
  'authorization',
  'financial',
  'capacity',
  'technical_issue',
  'reassessment',
  'staffing',
  'customer',
  'no_follow_up',
  'other',
] as const;
export type BlockerReason = (typeof BLOCKER_REASONS)[number];

// Assessment versions: the initial assessment and each supplement (الحاقیه)
// raised by hidden damage. A final version is immutable; a supplement is a new
// version that copies the previous items and adds or changes lines.
export const ASSESSMENT_KINDS = ['initial', 'supplement'] as const;
export type AssessmentKind = (typeof ASSESSMENT_KINDS)[number];

export const ASSESSMENT_STATUSES = ['draft', 'final', 'superseded'] as const;
export type AssessmentStatus = (typeof ASSESSMENT_STATUSES)[number];

export const ASSESSMENT_ITEM_ACTIONS = ['replace', 'repair'] as const;
export type AssessmentItemAction = (typeof ASSESSMENT_ITEM_ACTIONS)[number];

// Authorization is granted outside Manage (golden-card system, insurer,
// customer); Manage records the decision and its official reference only.
export const AUTHORIZATION_STATUSES = [
  'not_required',
  'pending',
  'approved',
  'partially_approved',
  'rejected',
] as const;
export type AuthorizationStatus = (typeof AUTHORIZATION_STATUSES)[number];

export const AUTHORIZATION_DECISIONS = ['approved', 'partially_approved', 'rejected'] as const;
export type AuthorizationDecision = (typeof AUTHORIZATION_DECISIONS)[number];

export const AUTHORIZATION_SOURCES = ['golden_card', 'insurer', 'customer'] as const;
export type AuthorizationSource = (typeof AUTHORIZATION_SOURCES)[number];

export const AUTHORIZATION_METHODS = ['official_system', 'written', 'phone', 'in_person'] as const;
export type AuthorizationMethod = (typeof AUTHORIZATION_METHODS)[number];

export const ITEM_APPROVAL_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type ItemApprovalStatus = (typeof ITEM_APPROVAL_STATUSES)[number];

// Parts: one row per needed part of a case. Source decides who supplies and
// pays; status follows need → (stock) → order → receipt with inspection →
// handover to the repair unit.
export const PART_SOURCES = ['company', 'stock', 'external', 'insurer_supplier', 'customer'] as const;
export type PartSource = (typeof PART_SOURCES)[number];

export const PART_STATUSES = ['needed', 'reserved', 'ordered', 'received', 'rejected', 'handed_over', 'cancelled'] as const;
export type PartStatus = (typeof PART_STATUSES)[number];

export const PART_ACTIONS = ['check_stock', 'reserve', 'order', 'update_eta', 'receive', 'hand_over', 'cancel'] as const;
export type PartAction = (typeof PART_ACTIONS)[number];

export const PART_INSPECTIONS = ['ok', 'wrong', 'defective'] as const;
export type PartInspection = (typeof PART_INSPECTIONS)[number];

// Financial gate: an advance is proposed by the expert, approved by the
// service manager and its receipt confirmed by the cashier. An exception lets
// purchases continue up to a limit without the advance.
export const FINANCE_APPROVAL_KINDS = ['advance', 'exception'] as const;
export type FinanceApprovalKind = (typeof FINANCE_APPROVAL_KINDS)[number];

export const FINANCE_APPROVAL_STATUSES = ['proposed', 'approved', 'rejected', 'paid'] as const;
export type FinanceApprovalStatus = (typeof FINANCE_APPROVAL_STATUSES)[number];

// Why purchases are allowed or blocked for a case (see FinanceService.gate).
export const FINANCE_GATE_REASONS = [
  'no_customer_share',
  'advance_paid',
  'exception',
  'shares_unknown',
  'no_estimate',
  'advance_missing',
  're_approval_required',
] as const;
export type FinanceGateReason = (typeof FINANCE_GATE_REASONS)[number];

// Default repair departments seeded per tenant; each tenant can rename,
// disable or add departments.
export const DEFAULT_DEPARTMENTS = [
  { code: 'body', name: 'صافکاری' },
  { code: 'paint', name: 'نقاشی' },
  { code: 'mechanical', name: 'مکانیکی' },
  { code: 'electrical', name: 'برق و باتری‌سازی' },
  { code: 'suspension', name: 'جلوبندی' },
  { code:'engine_tuning',name:'تنظیم موتور' },
  { code: 'assembly', name: 'مونتاژ و دمونتاژ' },
  { code: 'qc', name: 'کنترل کیفیت' },
] as const;

// Platform modules. Only modules marked "active" are implemented; the rest are
// visible in navigation as roadmap items and must not expose fake actions.
export const MODULES = [
  { key: 'accident', status: 'active' },
  { key: 'reception', status: 'planned' },
  { key: 'periodic_service', status: 'planned' },
  { key: 'warranty', status: 'planned' },
  { key: 'parts_inventory', status: 'planned' },
  { key: 'finance', status: 'planned' },
  { key: 'workforce', status: 'planned' },
  { key: 'customer_comms', status: 'planned' },
  { key: 'multi_dealership', status: 'planned' },
  { key: 'integrations', status: 'planned' },
  { key: 'ai_assistant', status: 'planned' },
] as const;
export type ModuleKey = (typeof MODULES)[number]['key'];

// Quality control: one checklist per QC round. A failed item opens a
// corrective activity; the case returns to repair until a new round passes.
export const QC_CHECK_ITEMS = [
  'body_fit',
  'paint',
  'lights_electrical',
  'warning_lamps',
  'brakes_steering',
  'safety_restraints',
  'fluids_leaks',
  'road_test',
  'cleanliness',
  'old_parts',
] as const;
export type QcCheckItem = (typeof QC_CHECK_ITEMS)[number];

// Safety items are always inspected: "not applicable" is refused.
export const QC_SAFETY_ITEMS: readonly QcCheckItem[] = ['warning_lamps', 'brakes_steering', 'safety_restraints'];

export const QC_RESULTS = ['ok', 'fail', 'na'] as const;
export type QcResult = (typeof QC_RESULTS)[number];

export const QC_OUTCOMES = ['passed', 'failed'] as const;
export type QcOutcome = (typeof QC_OUTCOMES)[number];

// Why a technical or financial close (or the delivery) is not possible yet.
export const COMPLETION_ISSUES = [
  'tasks_unapproved',
  'open_blockers',
  'assessment_draft',
  'authorization_pending',
  'parts_open',
  'lines_without_part',
  'labour_without_task',
  'qc_missing',
  'qc_failed',
  'qc_stale',
  'no_final_assessment',
  'shares_unknown',
  'finance_pending',
  'balance_due',
  'technical_not_closed',
  'financial_not_closed',
] as const;
export type CompletionIssueCode = (typeof COMPLETION_ISSUES)[number];

export const RECIPIENT_RELATIONS = ['owner', 'agent', 'insurer', 'other'] as const;
export type RecipientRelation = (typeof RECIPIENT_RELATIONS)[number];

// Existing-vehicle Excel import: what happens to each sheet row.
export const VEHICLE_IMPORT_OUTCOMES = [
  'new',
  'update',
  'unchanged',
  'duplicate',
  'incomplete',
  'needs_review',
  'error',
] as const;
export type VehicleImportOutcome = (typeof VEHICLE_IMPORT_OUTCOMES)[number];

// Where the delivery date of the sheet goes; official deadline and internal
// forecast are never assumed to be the same thing.
export const IMPORT_DEADLINE_TARGETS = ['none', 'forecast', 'official'] as const;
export type ImportDeadlineTarget = (typeof IMPORT_DEADLINE_TARGETS)[number];

// Reports center: one view per responsibility (see docs/REPORTS_FA.md).
export const REPORT_VIEWS = ['manager', 'parts', 'accident', 'workshop'] as const;
export type ReportView = (typeof REPORT_VIEWS)[number];

export const REPORT_PERIODS = ['today', 'week', 'month', 'custom'] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

// Order of the "today" work list; the reason is shown on every row.
export const WORK_PRIORITIES = ['overdue', 'today', 'soon', 'later', 'none'] as const;
export type WorkPriority = (typeof WORK_PRIORITIES)[number];

// Parts discrepancy queue (#11): the system flags; a person reviews and decides.
export const DISCREPANCY_KINDS = ['handover_vs_shortage', 'wrong_or_defective', 'supply_inconsistent'] as const;
export type DiscrepancyKind = (typeof DISCREPANCY_KINDS)[number];

export const DISCREPANCY_STATUSES = ['open', 'in_review', 'resolved', 'dismissed'] as const;
export type DiscrepancyStatus = (typeof DISCREPANCY_STATUSES)[number];
