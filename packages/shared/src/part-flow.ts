// One parts list per vehicle (spec section 7). The flow state of a line is
// derived from the stored row (status, source, consumption) and from the latest
// official Emdad Vijeh report linked to it, so existing rows need no migration.
// Only the action valid in the current state is offered in the UI, and the API
// refuses every other action with a Persian message (smart button rule, section 2).

export const PART_FLOW_STATES = [
  'needed',
  'reserved',
  'emdad',
  'dealer_supply',
  'market',
  'ready',
  'handed_over',
  'consumed',
  'cancelled',
  'returned',
] as const;
export type PartFlowState = (typeof PART_FLOW_STATES)[number];

export const PART_FLOW_STATE_LABELS: Record<PartFlowState, string> = {
  needed: 'تعیین تکلیف نشده',
  reserved: 'رزرو از موجودی',
  emdad: 'امداد ویژه · در حال تأمین',
  dealer_supply: 'امداد ویژه: تأمین توسط نمایندگی',
  market: 'خرید بازار · در راه',
  ready: 'آمادهٔ تحویل',
  handed_over: 'تحویل‌شده به جایگاه',
  consumed: 'مصرف‌شده',
  cancelled: 'لغوشده',
  returned: 'مرجوعی',
};

export const PART_FLOW_ACTIONS = ['reserve', 'emdad', 'market', 'receive', 'hand_over', 'cancel', 'return', 'set_price', 'announce_price'] as const;
export type PartFlowAction = (typeof PART_FLOW_ACTIONS)[number];

export const PART_FLOW_ACTION_LABELS: Record<PartFlowAction, string> = {
  reserve: 'رزرو از موجودی',
  emdad: 'ثبت امداد ویژه',
  market: 'خرید بازار',
  receive: 'ثبت رسید',
  hand_over: 'تحویل به واحد تعمیر',
  cancel: 'لغو قطعه',
  return: 'مرجوعی',
  set_price: 'تغییر قیمت',
  announce_price: 'اعلام قیمت',
};

/** Status transitions of the specification table; price actions are added for every active state. */
export const PART_FLOW_TRANSITIONS: Record<PartFlowState, readonly PartFlowAction[]> = {
  needed: ['reserve', 'emdad', 'market', 'cancel'],
  reserved: ['hand_over', 'cancel'],
  // Status changes only through the daily Emdad report; the clerk may still cancel with a reason.
  emdad: ['cancel'],
  dealer_supply: ['market', 'reserve'],
  market: ['receive', 'cancel'],
  ready: ['hand_over', 'cancel'],
  handed_over: ['return'],
  consumed: [],
  cancelled: [],
  returned: [],
};

export const ACTIVE_PART_FLOW_STATES: readonly PartFlowState[] = ['needed', 'reserved', 'emdad', 'dealer_supply', 'market', 'ready', 'handed_over'];
const PRICE_ACTIONS: readonly PartFlowAction[] = ['set_price', 'announce_price'];

/** Emdad categories that mean «arrived»: the part becomes ready for handover automatically. */
export const EMDAD_ARRIVED_CATEGORIES = ['in_dealer_stock', 'received_by_dealer'] as const;
/** The company has no stock: the dealer must price and supply it (market or stock). */
export const EMDAD_DEALER_SUPPLY_CATEGORY = 'supplied_by_dealer';

export interface PartFlowRow {
  status: string;
  source: string;
  consumedAt?: string | Date | null;
  /** statusCategory of the latest Emdad request linked to this line, if any. */
  emdadCategory?: string | null;
}

export function partFlowState(p: PartFlowRow): PartFlowState {
  switch (p.status) {
    case 'cancelled':
      return 'cancelled';
    case 'returned':
      return 'returned';
    case 'handed_over':
      return p.consumedAt ? 'consumed' : 'handed_over';
    case 'reserved':
      return 'reserved';
    case 'received':
      return 'ready';
    case 'ordered':
      if (p.source === 'company') return p.emdadCategory === EMDAD_DEALER_SUPPLY_CATEGORY ? 'dealer_supply' : 'emdad';
      return 'market';
    // A part rejected at receipt (wrong/defective) needs a new decision.
    case 'rejected':
    case 'needed':
    default:
      return 'needed';
  }
}

export function allowedPartActions(state: PartFlowState): PartFlowAction[] {
  const base = [...PART_FLOW_TRANSITIONS[state]];
  return ACTIVE_PART_FLOW_STATES.includes(state) ? [...base, ...PRICE_ACTIONS] : base;
}

export function isPartActionAllowed(state: PartFlowState, action: PartFlowAction): boolean {
  return allowedPartActions(state).includes(action);
}

/** «لغو قطعه» becomes «لغو رزرو» once stock is reserved for it (spec section 2, example). */
export function partActionLabel(state: PartFlowState, action: PartFlowAction): string {
  if (action === 'cancel' && (state === 'reserved' || state === 'ready')) return 'لغو رزرو';
  if (action === 'cancel' && state === 'emdad') return 'لغو (با علت)';
  return PART_FLOW_ACTION_LABELS[action];
}

/** Filter chips above the list (spec section 7). */
export const PART_FLOW_FILTERS = ['undecided', 'in_progress', 'ready', 'delivered'] as const;
export type PartFlowFilter = (typeof PART_FLOW_FILTERS)[number];
export const PART_FLOW_FILTER_LABELS: Record<PartFlowFilter, string> = {
  undecided: 'تعیین تکلیف نشده',
  in_progress: 'در جریان',
  ready: 'آمادهٔ تحویل',
  delivered: 'تحویل‌شده',
};
export function partFlowFilter(state: PartFlowState): PartFlowFilter | null {
  if (state === 'needed') return 'undecided';
  if (state === 'emdad' || state === 'dealer_supply' || state === 'market') return 'in_progress';
  if (state === 'reserved' || state === 'ready') return 'ready';
  if (state === 'handed_over' || state === 'consumed') return 'delivered';
  return null;
}

/** One sentence for the parts clerk: what to do now and what happens next (spec section 2, rule 4). */
export const PART_FLOW_NEXT_STEP: Record<PartFlowState, string> = {
  needed: 'تعیین تکلیف کنید: رزرو از موجودی، امداد ویژه یا خرید بازار.',
  reserved: 'قطعه آماده است؛ با «تحویل به واحد تعمیر» به جایگاه بدهید.',
  emdad: 'منتظر گزارش روزانهٔ امداد ویژه؛ با «وارد موجودی» یا «رسید نمایندگی» خودکار آمادهٔ تحویل می‌شود.',
  dealer_supply: 'شرکت موجود ندارد؛ قیمت بدهید و از بازار یا موجودی تأمین کنید.',
  market: 'وقتی پیک آورد، «ثبت رسید» بزنید تا آمادهٔ تحویل شود.',
  ready: 'با «تحویل به واحد تعمیر» به جایگاه بدهید؛ کارشناس و جایگاه خبر دارند.',
  handed_over: 'در خودرو مصرف می‌شود؛ با پایان کار پرونده بسته می‌شود.',
  consumed: 'پرونده بسته شد؛ این قلم دیگر از موجودی کم نمی‌شود.',
  cancelled: 'از فهرست فعال بیرون است و در تاریخچه می‌ماند.',
  returned: 'به موجودی قابل‌استفاده برگشت و در تاریخچه می‌ماند.',
};

/** Matching key of a technical code for the anti-duplicate rule (digits latinized; spaces, dashes and dots ignored). */
export function partCodeKey(code: string | null | undefined): string | null {
  if (!code) return null;
  const key = code
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\s\u200c\-_./]/g, '')
    .toUpperCase();
  return key || null;
}

/** One vehicle card on the parts clerk's desk (spec section 3): what is open on its list. */
export interface PartsDeskCard {
  caseId: string;
  caseNumber: string;
  admissionNo: string | null;
  plate: string | null;
  vehicleLabel: string;
  customerName: string | null;
  coverageType: string;
  admittedAt: string;
  counts: Record<PartFlowFilter, number>;
  /** Lines the Emdad report marked «تأمین توسط نمایندگی». */
  dealerSupply: number;
  oldestUndecidedAt: string | null;
}

// ----------------------------------------------------------- usable stock

export interface StockCommitment {
  quantity: number;
  /** reserved | issued (handed over) | released | cancelled | returned */
  status: string;
  /** Set when the case was finished: the business system's own report already shows the consumption. */
  reflected: boolean;
}

/** A reservation or a handover that still lowers the usable quantity. */
export const isActiveCommitment = (c: Pick<StockCommitment, 'status' | 'reflected'>) =>
  c.status === 'reserved' || (c.status === 'issued' && !c.reflected);

/**
 * Usable = quantity in today's report − active reservations − handed over to open cases
 * (spec section 7, owner-approved). A finished case stops lowering it automatically,
 * because from then on the business system's report shows the consumption itself.
 */
export function usableQuantity(reported: number, commitments: readonly StockCommitment[]): number {
  return reported - commitments.filter(isActiveCommitment).reduce((n, c) => n + c.quantity, 0);
}
