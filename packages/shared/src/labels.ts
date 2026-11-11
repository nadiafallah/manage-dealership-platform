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

export const ROLE_LABELS: Record<Role, string> = {
  accident_expert: 'کارشناس تصادفات',
  parts_clerk: 'مسئول قطعات',
  technician: 'تکنسین جایگاه',
  service_manager: 'مدیر خدمات',
  system_admin: 'مدیر سیستم',
};
/** The owner is a flag on the account, not a role code. */
export const OWNER_LABEL = 'مالک';

export const COVERAGE_LABELS: Record<CoverageType, string> = {
  golden_card: 'کارت طلایی / امداد خودرو',
  insurance: 'بیمه بدنه',
  personal: 'شخصی (مشتری)',
  mixed: 'ترکیبی',
  unknown: 'نامشخص',
};

export const STAGE_LABELS: Record<CaseStage, string> = {
  reception: 'پذیرش',
  assessment: 'کارشناسی',
  awaiting_approval: 'در انتظار مجوز / تأیید',
  awaiting_parts: 'در انتظار قطعه',
  in_repair: 'در حال تعمیر',
  quality_control: 'کنترل کیفیت',
  ready_for_delivery: 'آماده تحویل',
  delivered: 'تحویل‌شده',
};

export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  open: 'باز',
  closed: 'بسته',
  cancelled: 'لغوشده',
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: 'شروع‌نشده',
  in_progress: 'در حال انجام',
  blocked: 'دارای مانع',
  done: 'اتمام (منتظر تأیید)',
  approved: 'تأییدشده',
};

export const BLOCKER_REASON_LABELS: Record<BlockerReason, string> = {
  part_not_arrived: 'قطعه نرسیده',
  part_wrong_or_defective: 'قطعه اشتباه یا معیوب',
  authorization: 'مجوز',
  financial: 'مالی / پیش‌پرداخت',
  capacity: 'ظرفیت',
  technical_issue: 'مشکل فنی',
  reassessment: 'کارشناسی مجدد',
  staffing: 'نیروی انسانی',
  customer: 'مشتری',
  no_follow_up: 'عدم پیگیری',
  other: 'سایر',
};

export const ASSESSMENT_KIND_LABELS: Record<AssessmentKind, string> = {
  initial: 'کارشناسی اولیه',
  supplement: 'الحاقیه',
};

export const ASSESSMENT_STATUS_LABELS: Record<AssessmentStatus, string> = {
  draft: 'پیش‌نویس',
  final: 'نهایی',
  superseded: 'جایگزین‌شده با الحاقیه',
};

export const ASSESSMENT_ITEM_ACTION_LABELS: Record<AssessmentItemAction, string> = {
  replace: 'تعویض',
  repair: 'تعمیر',
};

export const AUTHORIZATION_STATUS_LABELS: Record<AuthorizationStatus, string> = {
  not_required: 'نیاز به مجوز جدید ندارد',
  pending: 'در انتظار مجوز',
  approved: 'مجوز ثبت شد',
  partially_approved: 'مجوز جزئی',
  rejected: 'مجوز رد شد',
};

export const AUTHORIZATION_SOURCE_LABELS: Record<AuthorizationSource, string> = {
  golden_card: 'سامانه کارت طلایی',
  insurer: 'شرکت بیمه',
  customer: 'مشتری',
};

export const AUTHORIZATION_METHOD_LABELS: Record<AuthorizationMethod, string> = {
  official_system: 'ثبت در سامانه رسمی',
  written: 'کتبی',
  phone: 'تلفنی',
  in_person: 'حضوری',
};

export const ITEM_APPROVAL_LABELS: Record<ItemApprovalStatus, string> = {
  pending: 'در انتظار',
  approved: 'تأییدشده',
  rejected: 'ردشده',
};

export const PART_SOURCE_LABELS: Record<PartSource, string> = {
  company: 'قطعه شرکت (ایران‌خودرو)',
  stock: 'انبار نمایندگی',
  external: 'خرید بیرونی مجاز',
  insurer_supplier: 'تأمین‌کننده معرفی‌شده بیمه',
  customer: 'قطعه مشتری',
};

export const PART_STATUS_LABELS: Record<PartStatus, string> = {
  needed: 'نیاز ثبت شد',
  reserved: 'رزرو از انبار',
  ordered: 'سفارش داده شد',
  received: 'رسید و کنترل شد',
  rejected: 'اشتباه یا معیوب — سفارش مجدد',
  handed_over: 'تحویل واحد تعمیر',
  cancelled: 'لغوشده',
};

export const PART_INSPECTION_LABELS: Record<PartInspection, string> = {
  ok: 'سالم و صحیح',
  wrong: 'اشتباه',
  defective: 'معیوب',
};

export const FINANCE_APPROVAL_KIND_LABELS: Record<FinanceApprovalKind, string> = {
  advance: 'پیش‌پرداخت',
  exception: 'استثنا (بدون پیش‌پرداخت)',
};

export const FINANCE_APPROVAL_STATUS_LABELS: Record<FinanceApprovalStatus, string> = {
  proposed: 'پیشنهاد — منتظر تأیید مدیر',
  approved: 'تأیید مدیر',
  rejected: 'ردشده',
  paid: 'دریافت شد',
};

export const FINANCE_GATE_LABELS: Record<FinanceGateReason, string> = {
  no_customer_share: 'خرید مجاز: سهم مشتری ندارد',
  advance_paid: 'خرید مجاز: پیش‌پرداخت دریافت شده',
  exception: 'خرید مجاز با استثنای تأییدشده',
  shares_unknown: 'هشدار: سهم مشتری مشخص نشده؛ خرید متوقف نمی‌شود',
  no_estimate: 'هشدار: کارشناسی نهایی نشده؛ خرید متوقف نمی‌شود',
  advance_missing: 'هشدار: پیش‌پرداخت ثبت نشده؛ تصمیم با کارشناس تصادفات است',
  re_approval_required: 'هشدار: هزینه افزایش یافته؛ پیش‌پرداخت را با کارشناس تصادفات بررسی کنید',
};

export const MODULE_LABELS: Record<ModuleKey, string> = {
  accident: 'خودروهای تصادفی',
  reception: 'پذیرش و خدمات عمومی',
  periodic_service: 'سرویس دوره‌ای و تعمیرات عادی',
  warranty: 'گارانتی',
  parts_inventory: 'انبار، قطعات و تأمین‌کنندگان',
  finance: 'مالی پیشرفته و حسابداری',
  workforce: 'کارکنان، ظرفیت و کارتابل تکنسین',
  customer_comms: 'اطلاع‌رسانی و رضایت مشتری',
  multi_dealership: 'چندنمایندگی و چندبرند',
  integrations: 'اتصال به سامانه‌های رسمی',
  ai_assistant: 'دستیار هوشمند',
};

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'part_quote.proposed':'ثبت قیمت بازار برای تأیید','part_quote.approved':'ثبت تأیید قیمت از پرداخت‌کننده','part_quote.rejected':'ثبت رد قیمت','part_quote.superseded':'جایگزینی پیشنهاد قیمت','part.quote_version_changed':'به‌روزرسانی نسخه نیاز قطعه پس از قیمت‌گیری','work_calendar.created':'ثبت نسخه تقویم کاری','workshop_station.created':'تعریف جایگاه','workshop_station.updated':'ویرایش جایگاه',
  'case.created': 'ایجاد پرونده',
  'case.updated': 'ویرایش پرونده',
  'case.stage_changed': 'تغییر مرحله',
  'task.created': 'ایجاد فعالیت',
  'task.updated': 'ویرایش فعالیت',
  'task.started': 'شروع فعالیت',
  'task.completed': 'اتمام فعالیت',
  'task.approved': 'تأیید سرپرست',
  'task.reopened': 'بازگشایی فعالیت',
  'task.blocked': 'ثبت مانع',
  'blocker.created': 'ثبت مانع',
  'blocker.acknowledged': 'اقدام روی مانع',
  'blocker.resolved': 'رفع مانع',
  'assessment.created': 'شروع کارشناسی',
  'assessment.supplement_created': 'شروع الحاقیه (آسیب پنهان)',
  'assessment.item_added': 'افزودن قلم کارشناسی',
  'assessment.items_imported': 'ورود اقلام کارشناسی از اکسل',
  'assessment.item_updated': 'ویرایش قلم کارشناسی',
  'assessment.item_removed': 'حذف قلم از پیش‌نویس',
  'assessment.finalized': 'نهایی‌شدن کارشناسی',
  'assessment.superseded': 'جایگزینی با الحاقیه',
  'assessment.authorization_recorded': 'ثبت مجوز',
  'part.created': 'ثبت نیاز قطعه',
  'part.stock_checked': 'بررسی موجودی انبار',
  'part.reserved': 'رزرو قطعه از انبار',
  'part.ordered': 'سفارش قطعه',
  'part.eta_changed': 'تغییر زمان رسیدن قطعه',
  'part.received': 'رسید و کنترل قطعه',
  'part.rejected': 'قطعه اشتباه یا معیوب',
  'part.handed_over': 'تحویل قطعه به واحد تعمیر',
  'part.cancelled': 'لغو قطعه',
  'part.emdad_requested': 'ثبت امداد ویژه',
  'part.market_ordered': 'خرید بازار',
  'part.emdad_arrived': 'امداد ویژه رسید (گزارش روزانه)',
  'part.returned': 'مرجوعی قطعه',
  'part.price_changed': 'تغییر قیمت فروش',
  'part.price_announced': 'اعلام قیمت به کارشناس',
  'part.price_notice_answered': 'پاسخ کارشناس به اعلام قیمت',
  'part.quantity_increased': 'افزایش تعداد همان قلم',
  'emdad.linked_by_request_no': 'اتصال امداد ویژه با شمارهٔ درخواست',
  'stock.returned': 'برگشت مرجوعی به موجودی',
  'stock.finished_with_case': 'پایان کار: توقف کسر از موجودی',
  'case.alert_answered': 'ثبت تصمیم پیش‌پرداخت',
  'finance.shares_set': 'ثبت سهم پرداخت‌کنندگان',
  'finance.proposed': 'پیشنهاد مالی',
  'finance.approved': 'تأیید مالی مدیر',
  'finance.rejected': 'رد پیشنهاد مالی',
  'finance.paid': 'تأیید دریافت پیش‌پرداخت',
  'finance.payment_recorded': 'ثبت دریافت تسویه',
  'qc.recorded': 'ثبت کنترل کیفیت',
  'case.technical_closed': 'بستن فنی',
  'case.financial_closed': 'بستن مالی',
  'case.delivered': 'تحویل خودرو',
  'case.imported': 'ورود از اکسل',
  'vehicle_import.applied': 'ثبت ورود اکسل خودروها',
  'discrepancy.assigned': 'تعیین مسئول بررسی مغایرت',
  'discrepancy.detected': 'شناسایی خودکار مغایرت',
  'discrepancy.condition_cleared': 'رفع نشانه ناسازگاری؛ نیازمند بررسی مسئول',
  'discrepancy.condition_returned': 'بازگشت نشانه ناسازگاری',
  'discrepancy.resolved': 'رفع مغایرت قطعه',
  'discrepancy.dismissed': 'رد مغایرت (اختلاف واقعی نبود)',
  // Phase 3
  'case.transferred': 'انتقال پرونده به مسئول دیگر',
  'reminder.sent': 'ارسال تذکر',
  'reminder.seen': 'دیدن تذکر',
  'reminder.done': 'انجام تذکر',
  'reminder.replied': 'جواب تذکر',
  'wage.set': 'ثبت اجرت تعمیرکار',
  'wage.changed': 'تغییر اجرت تعمیرکار',
  'user.technician_created': 'ساخت حساب تعمیرکار',
  'user.technician_pin_reset': 'رمز تازه و باز کردن قفل تعمیرکار',
  'user.technician_activated': 'فعال کردن تعمیرکار',
  'user.technician_deactivated': 'غیرفعال کردن تعمیرکار',
  'user.technician_signed_out': 'خروج اجباری کارمند از همهٔ دستگاه‌ها',
  'auth.device_registered': 'ثبت دستگاه تازه برای ورود با رمز ۴ رقمی',
  'user.invited': 'دعوت کارمند',
  'user.staff_admin_granted': 'دادن دسترسی دعوت و غیرفعال کردن کارکنان به مدیر سیستم',
  'user.staff_admin_revoked': 'گرفتن دسترسی دعوت و غیرفعال کردن کارکنان از مدیر سیستم',
};

// Keys produced by the API in CaseListItem.missingFields ('نیازمند تکمیل').
export const MISSING_FIELD_LABELS: Record<string, string> = {
  customer_name: 'نام مالک',
  customer_phone: 'تلفن مالک',
  vehicle_model: 'مدل خودرو',
  vehicle_identity: 'پلاک یا VIN',
  odometer: 'کیلومتر',
  damage_description: 'شرح خسارت',
  responsible: 'مسئول پرونده',
  coverage_type: 'نوع پوشش',
  golden_card_file_no: 'شماره پرونده کارت طلایی',
  official_deadline: 'مهلت رسمی',
  insurer: 'شرکت بیمه',
  insurance_claim_no: 'شماره خسارت بیمه',
};

export const QC_CHECK_LABELS: Record<QcCheckItem, string> = {
  body_fit: 'درز، تنظیم و نصب قطعات بدنه',
  paint: 'رنگ، همرنگی و پولیش',
  lights_electrical: 'چراغ‌ها و سیستم برق',
  warning_lamps: 'چراغ‌های هشدار پشت آمپر',
  brakes_steering: 'ترمز، فرمان و جلوبندی',
  safety_restraints: 'کیسه هوا و کمربند ایمنی',
  fluids_leaks: 'مایعات و نشتی',
  road_test: 'تست جاده',
  cleanliness: 'نظافت داخل و بیرون خودرو',
  old_parts: 'تعیین تکلیف قطعات اسقاط',
};

export const QC_RESULT_LABELS: Record<QcResult, string> = {
  ok: 'قبول',
  fail: 'رد',
  na: 'بررسی نشد / موضوعیت ندارد',
};

export const QC_OUTCOME_LABELS: Record<QcOutcome, string> = {
  passed: 'قبول',
  failed: 'رد — نیازمند کار اصلاحی',
};

export const COMPLETION_ISSUE_LABELS: Record<CompletionIssueCode, string> = {
  tasks_unapproved: 'فعالیت‌هایی هنوز تأیید سرپرست نگرفته‌اند',
  open_blockers: 'مانع باز روی پرونده وجود دارد',
  assessment_draft: 'پیش‌نویس کارشناسی یا الحاقیه هنوز نهایی نشده است',
  authorization_pending: 'مجوز آخرین نسخه کارشناسی هنوز ثبت نشده است',
  parts_open: 'قطعه‌هایی هنوز به واحد تعمیر تحویل یا لغو نشده‌اند',
  lines_without_part: 'اقلام تعویضی تأییدشده بدون قطعه تحویل‌شده به واحد',
  labour_without_task: 'اجرت تأییدشده برای واحدی که فعالیت تأییدشده ندارد',
  qc_missing: 'کنترل کیفیت ثبت نشده است',
  qc_failed: 'آخرین کنترل کیفیت رد شده است؛ پس از کار اصلاحی دوباره کنترل شود',
  qc_stale: 'پس از آخرین کنترل کیفیت کار تأیید شده است؛ دوباره کنترل شود',
  no_final_assessment: 'کارشناسی نهایی‌شده وجود ندارد',
  shares_unknown: 'سهم مشتری مشخص نشده است',
  finance_pending: 'پیشنهاد مالی منتظر تصمیم مدیر است',
  balance_due: 'سهم مشتری کامل دریافت نشده است',
  technical_not_closed: 'بستن فنی انجام نشده یا باید دوباره انجام شود',
  financial_not_closed: 'بستن مالی انجام نشده یا باید دوباره انجام شود',
};

export const RECIPIENT_RELATION_LABELS: Record<RecipientRelation, string> = {
  owner: 'مالک',
  agent: 'نماینده مالک (با معرفی‌نامه)',
  insurer: 'نماینده بیمه',
  other: 'سایر',
};

export const VEHICLE_IMPORT_OUTCOME_LABELS: Record<VehicleImportOutcome, string> = {
  new: 'جدید',
  update: 'موجود — به‌روزرسانی',
  unchanged: 'موجود — بدون تغییر',
  duplicate: 'تکراری در فایل',
  incomplete: 'ناقص — نیازمند تصمیم',
  needs_review: 'نیازمند بررسی',
  error: 'دارای خطا',
};

export const IMPORT_DEADLINE_TARGET_LABELS: Record<ImportDeadlineTarget, string> = {
  none: 'ثبت نشود (فقط در سابقه ورود)',
  forecast: 'پیش‌بینی تحویل (برآورد داخلی)',
  official: 'مهلت رسمی / تعهد',
};

export const REPORT_VIEW_LABELS: Record<ReportView, string> = {
  manager: 'مدیر خدمات',
  parts: 'انبار و قطعات',
  accident: 'تصادفات',
  workshop: 'واحدهای تعمیر و کنترل کیفیت',
};

export const WORK_PRIORITY_LABELS: Record<WorkPriority, string> = {
  overdue: 'موعد گذشته',
  today: 'موعد امروز',
  soon: 'موعد نزدیک',
  later: 'موعد بعدی',
  none: 'بدون موعد',
};

export const DISCREPANCY_KIND_LABELS: Record<DiscrepancyKind, string> = {
  handover_vs_shortage: 'تحویل ثبت‌شده، اما واحد تعمیر کمبود اعلام کرده',
  wrong_or_defective: 'قطعه اشتباه یا معیوب',
  supply_inconsistent: 'ناسازگاری سوابق تأمین و تحویل',
};

export const DISCREPANCY_STATUS_LABELS: Record<DiscrepancyStatus, string> = {
  open: 'باز — بدون مسئول',
  in_review: 'در حال بررسی',
  resolved: 'رفع شد',
  dismissed: 'اختلاف واقعی نبود',
};
