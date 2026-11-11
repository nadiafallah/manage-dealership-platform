import type { PartFlowAction, PartFlowState } from './part-flow';
import type {
  AssessmentItemAction,
  AssessmentKind,
  AssessmentStatus,
  AuthorizationMethod,
  AuthorizationSource,
  AuthorizationStatus,
  BlockerReason,
  CompletionIssueCode,
  DiscrepancyKind,
  DiscrepancyStatus,
  ReportPeriod,
  ReportView,
  WorkPriority,
  ImportDeadlineTarget,
  VehicleImportOutcome,
  FinanceApprovalKind,
  FinanceApprovalStatus,
  FinanceGateReason,
  ItemApprovalStatus,
  PartInspection,
  PartSource,
  PartStatus,
  QcCheckItem,
  QcOutcome,
  QcResult,
  RecipientRelation,
  CaseStage,
  CaseStatus,
  CoverageType,
  ModuleKey,
  Role,
  TaskStatus,
} from './enums';
import type { Permission } from './permissions';

// Response contracts returned by the API.

export interface Me {
  id: string;
  isOwner?: boolean;
  authentication?: 'password' | 'totp' | 'pin';
  username: string;
  displayName: string;
  roles: Role[];
  permissions: Permission[];
  tenant: { id: string; code: string; name: string };
  environment: string;
  modules: { key: ModuleKey; status: 'active' | 'planned' }[];
}

export interface UserRef {
  id: string;
  displayName: string;
}

export interface CaseListItem {
  id: string;
  caseNumber: string;
  admissionNo: string | null;
  stage: CaseStage;
  status: CaseStatus;
  coverageType: CoverageType;
  admittedAt: string;
  officialDeadlineAt: string | null;
  forecastDeliveryAt: string | null;
  customerName: string | null;
  vehicleLabel: string;
  /** Compact list label from brand/model only; never inferred from the manufacturer trim. */
  vehicleSummary?: string;
  plate: string | null;
  vin: string | null;
  responsible: UserRef | null;
  openBlockers: number;
  progressPercent: number;
  missingFields: string[];
  isLegacyEntry: boolean;
  isTest: boolean;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Task {
  stationId?: string | null;
  stationCode?: string | null;
  stationName?: string | null;
  assignedUserId?: string | null;
  baselineEndAt?: string | null;
  id: string;
  caseId: string;
  department: { id: string; code: string; name: string };
  title: string | null;
  technicianName: string | null;
  technicianCode: string | null;
  status: TaskStatus;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  actualStartAt: string | null;
  actualEndAt: string | null;
  approvedAt: string | null;
  approvedBy: UserRef | null;
  dependsOn: string[];
  /** QC round whose failed item opened this corrective activity. */
  qcInspectionId: string | null;
  weight: number;
  notes: string | null;
  version: number;
}

export interface Blocker {
  id: string;
  caseId: string;
  taskId: string | null;
  reason: BlockerReason;
  description: string | null;
  occurredAt: string;
  recordedAt: string;
  recordedBy: UserRef;
  lastFollowUpAt: string | null;
  followUpCount: number;
  resolvedAt: string | null;
  resolvedBy: UserRef | null;
  resolutionNote: string | null;
  partRequestId: string | null;
}

export interface AssessmentItem {
  id: string;
  lineNo: number;
  action: AssessmentItemAction;
  description: string;
  partNumber: string | null;
  quantity: number;
  unitPriceRial: number;
  labourDepartment: { id: string; name: string } | null;
  labourRial: number;
  evidence: string | null;
  approvalStatus: ItemApprovalStatus;
  /** Item of the previous version this line was copied from; null = new in this version. */
  originItemId: string | null;
  /** True when the line is new or changed compared with the previous version. */
  changed: boolean;
}

export interface AssessmentTotals {
  partsRial: number;
  labourRial: number;
  totalRial: number;
  /** Total minus rejected items; equals totalRial until a decision is recorded. */
  approvedRial: number;
}

export interface Assessment {
  id: string;
  caseId: string;
  versionNo: number;
  kind: AssessmentKind;
  status: AssessmentStatus;
  assessorName: string;
  assessorOrg: string | null;
  assessedAt: string;
  reason: string | null;
  discoveredAt: string | null;
  notes: string | null;
  finalizedAt: string | null;
  finalizedBy: UserRef | null;
  authorizationStatus: AuthorizationStatus;
  authorization: {
    source: AuthorizationSource;
    method: AuthorizationMethod;
    reference: string | null;
    at: string;
    note: string | null;
    recordedBy: UserRef;
  } | null;
  /** Blocker that keeps the case waiting until the authorization is recorded. */
  blockerId: string | null;
  items: AssessmentItem[];
  totals: AssessmentTotals;
  /** Difference with the previous final version (supplements only). */
  deltaRial: number | null;
  /** Final supplement that raises the cost: the financial gate (issue #10) must re-approve. */
  requiresFinancialReview: boolean;
  createdAt: string;
  createdBy: UserRef;
  version: number;
}

export interface Part {
  id: string;
  caseId: string;
  assessmentItemId: string | null;
  description: string;
  partNumber: string | null;
  quantity: number;
  source: PartSource;
  status: PartStatus;
  inStock: boolean | null;
  stockCheckedAt: string | null;
  reservedAt: string | null;
  approvedUnitPriceRial: number | null;
  salePriceRial: number | null;
  unitPriceRial: number | null;
  priceApprovalRef: string | null;
  priceApprovedBy: string | null;
  supplier: string | null;
  orderRef: string | null;
  orderedAt: string | null;
  etaAt: string | null;
  firstEtaAt: string | null;
  receivedAt: string | null;
  receiptDocNo: string | null;
  inspection: PartInspection | null;
  inspectionNote: string | null;
  handedOverAt: string | null;
  handedOverDepartment: { id: string; name: string } | null;
  recipientName: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  /** Why the purchase was allowed when it was ordered. */
  financeBasis: FinanceGateReason | 'not_purchase' | null;
  notes: string | null;
  createdAt: string;
  createdBy: UserRef;
  /** Ordered and past its expected arrival. */
  overdue: boolean;
  version: number;
  /** Unified list (spec section 7): derived flow state and the only actions valid now. */
  flowState: PartFlowState;
  allowedActions: PartFlowAction[];
  /** The line came from a supplement (الحاقیه), or a supplement raised its quantity. */
  fromSupplement: boolean;
  consumedAt: string | null;
  returnedAt: string | null;
  returnReason: string | null;
  /** Latest official Emdad Vijeh status linked to this line (text and date of the report). */
  emdad: { requestNo: string | null; category: string; statusText: string | null; reportAt: string } | null;
  /** Open price announcement of the parts clerk, waiting for the expert. */
  priceNotice: PriceNotice | null;
}

export interface PriceNotice {
  id: string;
  partId: string;
  saleUnitRial: number;
  note: string | null;
  announcedBy: UserRef;
  announcedAt: string;
  response: 'approved' | 'instruction' | null;
  instruction: string | null;
  respondedBy: UserRef | null;
  respondedAt: string | null;
  version: number;
}

export interface PartImportRow {
  row: number;
  description: string;
  partNumber: string | null;
  quantity: number;
  source: PartSource;
  approvedUnitPriceRial: number | null;
  notes: string | null;
}

export interface PartImportResult {
  dryRun: boolean;
  /** Fresh lines only. */
  rows: PartImportRow[];
  errors: { row: number; message: string }[];
  created: number;
  /** Same technical code as a line already in the list (or earlier in the file): set aside, never a new row. */
  duplicates: PartImportRow[];
}

export interface FinanceApproval {
  id: string;
  kind: FinanceApprovalKind;
  status: FinanceApprovalStatus;
  amountRial: number;
  /** Estimate the approval was given for; a larger estimate needs a new approval. */
  coversEstimateRial: number;
  /** Exceptions: amount already spent on purchases under this exception. */
  spentRial: number;
  reason: string;
  proposedAt: string;
  proposedBy: UserRef;
  decidedAt: string | null;
  decidedBy: UserRef | null;
  decisionNote: string | null;
  paidAt: string | null;
  paymentRef: string | null;
  paymentConfirmedBy: UserRef | null;
  version: number;
}

export interface FinanceGate {
  open: boolean;
  reason: FinanceGateReason;
  message: string;
}

export interface CaseFinance {
  caseId: string;
  /** Approved amount of the current assessment version (0 without one). */
  estimateRial: number;
  shares: {
    customerShareRial: number | null;
    insurerShareRial: number | null;
    companyShareRial: number | null;
    note: string | null;
    version: number | null;
  };
  /** Customer share used by the gate: recorded, or derived from the coverage type. */
  customerShareRial: number | null;
  customerShareDerived: boolean;
  paidRial: number;
  /** Customer share still to collect. */
  balanceRial: number | null;
  /** Committed purchases (ordered parts). */
  purchasesRial: number;
  gate: FinanceGate;
  approvals: FinanceApproval[];
  /** Settlement payments recorded by the cashier (advances are in approvals). */
  payments: SettlementPayment[];
}

export interface SettlementPayment {
  id: string;
  amountRial: number;
  paymentRef: string;
  paidAt: string;
  note: string | null;
  recordedBy: UserRef;
}

export interface TimelineEvent {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  occurredAt: string;
  actor: UserRef | null;
  reason: string | null;
  summary: Record<string, unknown> | null;
}

/** Row status as written in the official assessment export (column «وضعیت»). */
export type AssessmentImportStatus = 'final' | 'rejected' | 'correction' | 'unknown' | 'blank';
interface AssessmentImportOrigin {
  sheet: string;
  /** Excel row number in the sheet. */
  row: number;
  /** Printed page from the «صفحه x از y» header, when the export has one. */
  page: number | null;
}
export interface AssessmentImportCounts { final: number; rejected: number; correction: number; unknown: number }
export interface AssessmentImportPreview {
  /** Final rows that can be added to the draft (parts and main labour). */
  rows: (AssessmentImportOrigin & { action: 'replace' | 'repair'; description: string; partNumber: string | null; quantity: number; unitPriceRial: number; labourRial: number; evidence: string; date: string | null; unit: string | null; outcome?: 'new' | 'unchanged' | 'updated' })[];
  errors: (AssessmentImportOrigin & { message: string })[];
  warnings: (AssessmentImportOrigin & { message: string })[];
  /** Section titles and sheets without a table: informational notes only. */
  skipped: (AssessmentImportOrigin & { reason: string })[];
  /** Parts and main labour that are rejected or awaiting correction: shown, never added or dispatched. */
  setAside: (AssessmentImportOrigin & { kind: 'part' | 'labour'; status: AssessmentImportStatus; statusText: string; description: string; code: string | null; quantity: number | null; amountRial: number | null; date: string | null; reason: string })[];
  /** Equivalent labour lines: listed with status; no amount is invented and nothing is added to the totals. */
  equivalents: (AssessmentImportOrigin & { status: AssessmentImportStatus; statusText: string; description: string; code: string | null; date: string | null; amountRial: number | null })[];
  summary: {
    sheets: number;
    pages: number | null;
    dates: string[];
    parts: AssessmentImportCounts;
    labour: AssessmentImportCounts;
    equivalents: AssessmentImportCounts;
    partsRial: number;
    labourRial: number;
    totalRial: number;
    /** Totals printed in the file, when present, already checked against the rows. */
    declared: { partsRial: number | null; labourRial: number | null; totalRial: number | null };
  };
  applied: boolean;
}

export interface CaseDetail extends Omit<CaseListItem, 'customerName'> {
  repairPlan?: import('./workshop').RepairPlan | null;
  version: number;
  customer: { id: string; fullName: string | null; phone: string | null; phoneMasked: boolean } | null;
  vehicle: {
    id: string;
    brand: string | null;
    model: string | null;
    trim: string | null;
    modelYear: number | null;
    plate: string | null;
    vin: string | null;
    color: string | null;
    /** Chassis number as recorded on the admission sheet (may be short; not a VIN). */
    chassisRef: string | null;
  };
  /** Workshop admission card number (not the Manage case number). */
  admissionNo: string | null;
  /** 'date' when only the admission day is known (imported record). */
  admittedAtPrecision: 'minute' | 'date';
  origin: 'manual' | 'excel_import';
  odometerKm: number | null;
  damageDescription: string | null;
  vehicleLocation: string | null;
  goldenCardFileNo: string | null;
  insurerName: string | null;
  insuranceClaimNo: string | null;
  coverageNotes: string | null;
  actualDeliveryAt: string | null;
  createdAt: string;
  createdBy: UserRef;
  updatedAt: string;
  tasks: Task[];
  blockers: Blocker[];
}

export interface DashboardSummary {
  generatedAt: string;
  activeCases: number;
  overdue: number;
  dueSoon: number;
  blockedCases: number;
  needsCompletion: number;
  unassigned: number;
  readyForDelivery: number;
  legacyEntries: number;
  byStage: { stage: CaseStage; count: number }[];
  byCoverage: { coverage: CoverageType; count: number }[];
  openBlockersByReason: { reason: BlockerReason; count: number }[];
  staleBlockers: number;
  awaitingAuthorization: number;
  partsOverdue: number;
  partsToOrder: number;
  financePending: number;
  departments: { id: string; name: string; inProgress: number; blocked: number; pending: number }[];
}

export interface Department {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

export interface ApiError {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
}

export interface QcCheck {
  item: QcCheckItem;
  result: QcResult;
  note: string | null;
  departmentId: string | null;
  /** Corrective activity opened for a failed item. */
  correctiveTaskId: string | null;
}

export interface QcInspection {
  id: string;
  round: number;
  outcome: QcOutcome;
  checks: QcCheck[];
  note: string | null;
  inspectedAt: string;
  inspectedBy: UserRef;
}

export interface CompletionIssue {
  code: CompletionIssueCode;
  message: string;
  /** Number of activities, blockers, parts or lines concerned. */
  count?: number;
  amountRial?: number;
  /** Shown but does not block the close. */
  warning?: boolean;
}

export interface CloseState {
  closedAt: string | null;
  closedBy: UserRef | null;
  note: string | null;
  /** Closed and still consistent with the case (nothing changed since). */
  valid: boolean;
  /** Blocking issues and warnings evaluated now. */
  issues: CompletionIssue[];
}

export interface CaseCompletion {
  caseId: string;
  qc: QcInspection[];
  technical: CloseState;
  financial: CloseState & {
    /** Customer balance accepted as unpaid at the close (manager waiver). */
    waivedRial: number | null;
  };
  delivery: {
    deliveredAt: string;
    recipientName: string;
    recipientRelation: RecipientRelation;
    note: string | null;
    deliveredBy: UserRef;
  } | null;
  /** Issues that still prevent the handover. */
  deliveryIssues: CompletionIssue[];
}

export interface VehicleImportMessage {
  level: 'error' | 'warning' | 'info';
  text: string;
}

export interface VehicleImportChange {
  field: string;
  from: string | null;
  to: string | null;
}

export interface VehicleImportRow {
  /** Row number in the sheet (as Excel shows it). */
  rowNo: number;
  outcome: VehicleImportOutcome;
  /** Values as they appear in the file, by column header. */
  source: Record<string, string>;
  identity: string | null;
  caseId: string | null;
  caseNumber: string | null;
  changes: VehicleImportChange[];
  messages: VehicleImportMessage[];
}

export interface VehicleImport {
  id: string;
  status: 'preview' | 'applied' | 'partial';
  fileName: string;
  sheetName: string;
  headerRow: number;
  decisions: { dateWithoutTime: boolean; deadlineAs: ImportDeadlineTarget };
  counts: Record<VehicleImportOutcome, number>;
  /** Empty template rows that were skipped, by row number. */
  blankRows: number[];
  /** Columns of the file that have no destination in Manage (kept as provenance). */
  unmappedColumns: string[];
  rows: VehicleImportRow[];
  createdAt: string;
  createdBy: UserRef;
  appliedAt: string | null;
}

/** Where a case's data came from when it was created or updated by an import. */
export interface CaseProvenance {
  importId: string;
  fileName: string;
  rowNo: number;
  outcome: VehicleImportOutcome;
  appliedAt: string | null;
  appliedBy: UserRef;
  source: Record<string, string>;
}

export interface ReportKpi {
  key: string;
  label: string;
  /** What is counted: پرونده، خودرو، درخواست قطعه، فعالیت. */
  unit: string;
  value: number;
  /** Physical parts (sum of quantities) next to a part-request count. */
  quantity?: number;
  definition: string;
  /** Case-list query that shows exactly the counted cases, when one exists. */
  listQuery?: string;
  /** Work-list filter (kind) that shows the counted rows. */
  itemKind?: string;
}

export interface ReportBar {
  key: string;
  label: string;
  value: number;
  /** Case-list query of exactly these cases. */
  listQuery?: string;
  /** Same report narrowed to this bar (e.g. departmentId=…). */
  reportQuery?: string;
  itemKind?: string;
}

export interface WorkItem {
  stationCodes?:string[];
  kind: string;
  kindLabel: string;
  caseId: string;
  caseNumber: string;
  admissionNo?: string|null;
  plate: string | null;
  vehicleLabel: string;
  partId?: string;
  taskId?: string;
  description: string;
  partNumber?: string | null;
  quantity?: number;
  status: string;
  dueAt: string | null;
  dueLabel: string | null;
  priority: WorkPriority;
  priorityReason: string;
  responsible: UserRef | null;
  stoppedBy: string | null;
  nextAction: string;
}

export interface ReportResult {
  view: ReportView;
  generatedAt: string;
  isTestData: boolean;
  period: { key: ReportPeriod; from: string; to: string; label: string; previousFrom: string; previousTo: string };
  filters: { key: string; label: string; value: string }[];
  kpis: ReportKpi[];
  charts: {
    key: string;
    title: string;
    unit: string;
    kind: 'bar' | 'trend';
    bars: ReportBar[];
    /** Trend only: second series (e.g. deliveries next to admissions). */
    series?: { label: string; values: number[] }[];
    note?: string;
    /** Rows left out because the needed data does not exist. */
    excluded?: { count: number; reason: string };
  }[];
  /** Comparable figures for events in the period and the same-length period before. */
  events: { key: string; label: string; unit: string; current: number; previous: number }[];
  items: { rows: WorkItem[]; total: number; page: number; pageSize: number; kinds: { kind: string; label: string; count: number }[] };
}

export interface PartDiscrepancy {
  id: string;
  kind: DiscrepancyKind;
  status: DiscrepancyStatus;
  caseId: string;
  caseNumber: string;
  plate: string | null;
  part: { id: string; description: string; partNumber: string | null; quantity: number; status: string } | null;
  /** Facts the system found (dates and records), not a verdict. */
  detail: string;
  detectedAt: string;
  /** The condition no longer holds; still open until a person records the outcome. */
  conditionClearedAt: string | null;
  assignee: UserRef | null;
  resolvedAt: string | null;
  resolvedBy: UserRef | null;
  resolutionReason: string | null;
  version: number;
}

/** A non-blocking cost alert for the accident expert (see AlertsService and alerts.ts). */
export interface CaseAlert {
  caseId: string;
  caseNumber: string;
  plate: string | null;
  vehicleLabel: string;
  coverageType: string;
  kind: 'parts_amount' | 'expensive_part';
  level: number;
  /** parts_amount: the parts total; expensive_part: the amount of the expensive line (Rial). */
  totalRial: number | null;
  thresholdRial: number | null;
  /** expensive_part only: the line that raised the alert. */
  partDescription: string | null;
  /** The case's accident expert (who answers), when one is set. */
  responsible: { id: string; displayName: string } | null;
}

export const ALERT_RESPONSE_LABELS = { received: 'گرفتم', not_received: 'نگرفتم', not_needed: 'لازم نیست' } as const;
