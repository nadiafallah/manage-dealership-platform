import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  allowedPartActions,
  isPartActionAllowed,
  PART_FLOW_ACTIONS,
  PART_FLOW_STATES,
  partActionLabel,
  partFlowFilter,
  partFlowState,
  usableQuantity,
  type PartFlowAction,
  type PartFlowState,
  type StockCommitment,
} from '../index';

test('flow state is derived from the stored row and the linked Emdad report', () => {
  assert.equal(partFlowState({ status: 'needed', source: 'company' }), 'needed');
  assert.equal(partFlowState({ status: 'rejected', source: 'external' }), 'needed');
  assert.equal(partFlowState({ status: 'reserved', source: 'stock' }), 'reserved');
  assert.equal(partFlowState({ status: 'ordered', source: 'company' }), 'emdad');
  assert.equal(partFlowState({ status: 'ordered', source: 'company', emdadCategory: 'in_supply' }), 'emdad');
  assert.equal(partFlowState({ status: 'ordered', source: 'company', emdadCategory: 'supplied_by_dealer' }), 'dealer_supply');
  assert.equal(partFlowState({ status: 'ordered', source: 'external' }), 'market');
  assert.equal(partFlowState({ status: 'received', source: 'company' }), 'ready');
  assert.equal(partFlowState({ status: 'handed_over', source: 'stock' }), 'handed_over');
  assert.equal(partFlowState({ status: 'handed_over', source: 'stock', consumedAt: '2026-11-10T08:00:00Z' }), 'consumed');
  assert.equal(partFlowState({ status: 'cancelled', source: 'stock' }), 'cancelled');
  assert.equal(partFlowState({ status: 'returned', source: 'stock' }), 'returned');
});

test('state machine of spec section 7: exactly the allowed buttons, every other action refused', () => {
  const expected: Record<PartFlowState, PartFlowAction[]> = {
    needed: ['reserve', 'emdad', 'market', 'cancel', 'set_price', 'announce_price'],
    reserved: ['hand_over', 'cancel', 'set_price', 'announce_price'],
    emdad: ['cancel', 'set_price', 'announce_price'],
    dealer_supply: ['market', 'reserve', 'set_price', 'announce_price'],
    market: ['receive', 'cancel', 'set_price', 'announce_price'],
    ready: ['hand_over', 'cancel', 'set_price', 'announce_price'],
    handed_over: ['return', 'set_price', 'announce_price'],
    consumed: [],
    cancelled: [],
    returned: [],
  };
  for (const state of PART_FLOW_STATES) {
    assert.deepEqual(allowedPartActions(state), expected[state], state);
    for (const action of PART_FLOW_ACTIONS) assert.equal(isPartActionAllowed(state, action), expected[state].includes(action), `${state}:${action}`);
  }
  // Hand-over appears only when the part is ready (reserved counts as ready).
  assert.deepEqual(PART_FLOW_STATES.filter((s) => isPartActionAllowed(s, 'hand_over')), ['reserved', 'ready']);
});

test('the cancel button turns into «لغو رزرو» once reserved; filters group the states', () => {
  assert.equal(partActionLabel('needed', 'cancel'), 'لغو قطعه');
  assert.equal(partActionLabel('reserved', 'cancel'), 'لغو رزرو');
  assert.equal(partFlowFilter('needed'), 'undecided');
  assert.equal(partFlowFilter('emdad'), 'in_progress');
  assert.equal(partFlowFilter('reserved'), 'ready');
  assert.equal(partFlowFilter('consumed'), 'delivered');
  assert.equal(partFlowFilter('cancelled'), null);
});

test('usable stock: the owner-approved example of spec section 7, step by step', () => {
  const reservationForA: StockCommitment = { quantity: 1, status: 'reserved', reflected: false };
  // Day 1: the report shows 5; one is reserved for vehicle A → 4.
  assert.equal(usableQuantity(5, [reservationForA]), 4);
  // Day 2: the new report still shows 5 (nothing is deducted in the business system yet) → still 4.
  assert.equal(usableQuantity(5, [reservationForA]), 4);
  // Handed over to A's bay while A's case is open → still 4.
  const handedOver: StockCommitment = { ...reservationForA, status: 'issued' };
  assert.equal(usableQuantity(5, [handedOver]), 4);
  // «پایان کار»: invoice in the business system, its report now shows 4 and Manage stops deducting → 4, not 3.
  const finished: StockCommitment = { ...handedOver, reflected: true };
  assert.equal(usableQuantity(4, [finished]), 4);
  // A return goes back to usable stock; a released reservation never counts.
  assert.equal(usableQuantity(5, [{ quantity: 1, status: 'returned', reflected: false }, { quantity: 2, status: 'released', reflected: false }]), 5);
});

test('status dates read like «دوشنبه ۱۸ آبان» on the Tehran clock', async () => {
  const { formatJalaliDay } = await import('../index');
  assert.equal(formatJalaliDay('2026-11-09T07:30:00Z'), 'دوشنبه ۱۸ آبان');
  assert.equal(formatJalaliDay('2026-11-09T21:00:00Z'), 'سه‌شنبه ۱۹ آبان'); // 00:30 in Tehran
  assert.equal(formatJalaliDay(null), '—');
});

test('anti-duplicate key ignores digits script, spaces and dashes', async () => {
  const { partCodeKey } = await import('../index');
  assert.equal(partCodeKey('۱۲۳۴-۵۶۷۸ ۰۱'), '1234567801');
  assert.equal(partCodeKey(' ab.12/3 '), 'AB123');
  assert.equal(partCodeKey(''), null);
});
