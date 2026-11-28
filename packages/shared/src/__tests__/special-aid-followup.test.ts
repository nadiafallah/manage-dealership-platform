import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AID_DEADLINE_LABELS, SPECIAL_AID_RULES, SPECIAL_AID_TASK_SECTION_LABELS, SPECIAL_AID_TASK_SECTION_OF, SPECIAL_AID_TASK_KINDS,
  aidDeadline, appointmentState, autoLinkedAppointments, dossierQueue, dossierTasks, effectiveRelation, onWorkingDay, openArrivalSince, worstDeadline,
  type AidContactFacts, type AidItemFacts,
} from '../index';

// Special-aid follow-up rules of the owner (spec 29.2–29.5, mission of 2026-11-28). Synthetic facts only.
// 2026-11-22 is a Sunday; with the default calendar Friday is the only day off.
const now = new Date('2026-11-22T08:00:00Z'); // 11:30 Tehran
const midnight = (day: string) => `${day}T00:00:00+03:30`; // a date-only report value (Tehran)
const days = (n: number, base = now) => new Date(base.getTime() - n * 86_400_000).toISOString();
const item = (over: Partial<AidItemFacts> = {}): AidItemFacts => ({ id: over.id ?? 'a', state: 'reserved', receivedAt: null, arrivalObservedAt: null, informedAt: null, groupId: null, ...over });
const call = (at: string, outcome: AidContactFacts['outcome'], itemIds = ['a']): AidContactFacts => ({ at, outcome, itemIds, promisedAt: null });

test('rules of the owner: 20 working days, yellow from 11, red from 18, two unanswered calls, a call every ten days', () => {
  assert.deepEqual({ ...SPECIAL_AID_RULES }, { informWithinDays: 1, recurringContactDays: 10, deadlineWorkingDays: 20, yellowFromDay: 11, redFromDay: 18, failedAfterUnanswered: 2 });
  assert.match(AID_DEADLINE_LABELS.expired, /۲۰ روز کاری/);
});

test('deadline counts working days after the arrival day (Friday off): ok → yellow on day 11 → red on day 18 → expired after day 20', () => {
  const level = (arrival: string) => { const d = aidDeadline(item({ receivedAt: midnight(arrival) }), now)!; return [d.day, d.remaining, d.level]; };
  assert.deepEqual(level('2026-11-22'), [0, 20, 'ok']); // arrived today
  assert.deepEqual(level('2026-11-10'), [10, 10, 'ok']);
  assert.deepEqual(level('2026-11-09'), [11, 9, 'yellow']);
  assert.deepEqual(level('2026-11-02'), [17, 3, 'yellow']);
  assert.deepEqual(level('2026-11-01'), [18, 2, 'red']);
  assert.deepEqual(level('2026-10-29'), [20, 0, 'red'], 'today is the last working day of the deadline');
  assert.deepEqual(level('2026-10-28'), [21, 0, 'expired']);
  // The deadline ends with the 20th working day after the arrival day (Tehran).
  assert.equal(aidDeadline(item({ receivedAt: midnight('2026-11-01') }), now)!.endsAt, '2026-11-24T20:29:59.999Z');
  // A recorded holiday is not a working day.
  const holiday = (d: string) => d !== '2026-11-16' && new Date(d + 'T12:00:00Z').getUTCDay() !== 5;
  assert.equal(aidDeadline(item({ receivedAt: midnight('2026-11-09') }), now, holiday)!.level, 'ok');
});

test('deadline: official receipt first, otherwise the first observation; only parts that still wait have one', () => {
  const official = aidDeadline(item({ receivedAt: midnight('2026-11-09'), arrivalObservedAt: midnight('2026-11-20') }), now)!;
  assert.equal(official.official, true);
  assert.equal(official.level, 'yellow');
  const observed = aidDeadline(item({ receivedAt: null, arrivalObservedAt: midnight('2026-11-09') }), now)!;
  assert.equal(observed.official, false);
  assert.equal(observed.day, 11);
  for (const state of ['pending', 'delivered', 'installation_pending', 'installed', 'released'] as const) assert.equal(aidDeadline(item({ state, receivedAt: midnight('2026-10-01') }), now), null, state);
  assert.equal(aidDeadline(item({ state: 'not_installed', receivedAt: midnight('2026-10-01') }), now)!.level, 'expired');
  assert.equal(aidDeadline(item({ officialCancelled: true, receivedAt: midnight('2026-10-01') }), now), null);
  assert.equal(aidDeadline(item({ receivedAt: null, arrivalObservedAt: null }), now), null);
  // A calendar without any working day invents no deadline.
  assert.equal(aidDeadline(item({ receivedAt: midnight('2026-11-09') }), now, () => false), null);
  assert.equal(worstDeadline([aidDeadline(item({ receivedAt: midnight('2026-11-09') }), now), null, aidDeadline(item({ receivedAt: midnight('2026-11-01') }), now)])!.level, 'red');
  assert.equal(worstDeadline([]), null);
});

test('today: yellow, red and expired parts are deadline tasks; red and expired are urgent; a postponement never hides them', () => {
  const informed = { informedAt: days(20) };
  const t = dossierTasks({
    items: [item({ id: 'y', receivedAt: midnight('2026-11-09'), ...informed }), item({ id: 'r', receivedAt: midnight('2026-11-01'), ...informed }), item({ id: 'x', receivedAt: midnight('2026-10-20'), ...informed })],
    contacts: [call(days(2), 'answered', ['y', 'r', 'x'])], postponedUntil: days(-3),
  }, now);
  assert.deepEqual(t.map((x) => x.kind), ['deadline_expired', 'deadline_red', 'deadline_yellow']);
  assert.deepEqual(t.map((x) => [x.section, x.urgent, x.postponed]), [['deadline', true, false], ['deadline', true, false], ['deadline', false, false]]);
  assert.deepEqual(t.map((x) => x.itemIds), [['x'], ['r'], ['y']]);
  // Every task kind belongs to one of the three parts of «کارهای امروز».
  for (const k of SPECIAL_AID_TASK_KINDS) assert.ok(SPECIAL_AID_TASK_SECTION_LABELS[SPECIAL_AID_TASK_SECTION_OF[k]]);
  assert.deepEqual(Object.values(SPECIAL_AID_TASK_SECTION_LABELS), ['تماس‌های سررسیده', 'قطعه‌های تازه‌رسیده برای دعوت', 'پرونده‌های زرد و قرمز']);
});

test('a call every ten days from the registration of the request, before the part arrives', () => {
  const pending = (registeredAt: string) => item({ state: 'pending', registeredAt });
  const due = dossierTasks({ items: [pending(midnight('2026-11-12'))], contacts: [] }, now);
  assert.deepEqual(due.map((x) => [x.kind, x.section, x.dueAt]), [['recurring_contact', 'calls', '2026-11-21T20:30:00.000Z']]);
  assert.deepEqual(dossierTasks({ items: [pending(midnight('2026-11-13'))], contacts: [] }, now), []);
  // A reached call starts the next ten days.
  assert.deepEqual(dossierTasks({ items: [pending(midnight('2026-11-01'))], contacts: [call(days(9), 'answered')] }, now), []);
  assert.equal(dossierTasks({ items: [pending(midnight('2026-11-01'))], contacts: [call(days(10), 'answered')] }, now)[0]!.kind, 'recurring_contact');
  // A due day that is a Friday moves to the next working day.
  const friday = { items: [pending(midnight('2026-11-17'))], contacts: [] };
  assert.equal(onWorkingDay('2026-11-26T20:30:00.000Z').toISOString(), '2026-11-27T20:30:00.000Z');
  assert.deepEqual(dossierTasks(friday, new Date('2026-11-27T10:00:00Z')), []);
  assert.equal(dossierTasks(friday, new Date('2026-11-28T06:00:00Z'))[0]!.dueAt, '2026-11-27T20:30:00.000Z');
  // Without a registration date and before arrival nothing is guessed.
  assert.deepEqual(dossierTasks({ items: [item({ state: 'pending' })], contacts: [] }, now), []);
});

test('two unanswered calls make a failed contact: no daily retry, the ten-day call continues from the last attempt', () => {
  const pending = item({ state: 'pending', registeredAt: midnight('2026-10-20') });
  const one = dossierTasks({ items: [pending], contacts: [call(days(1), 'no_answer')] }, now);
  assert.deepEqual(one.map((x) => [x.kind, x.dueAt]), [['no_answer_retry', '2026-11-21T20:30:00.000Z']]);
  const failedRecent = dossierTasks({ items: [pending], contacts: [call(days(2), 'no_answer'), call(days(1), 'switched_off')] }, now);
  assert.deepEqual(failedRecent, []);
  const failedOld = dossierTasks({ items: [pending], contacts: [call(days(12), 'no_answer'), call(days(11), 'wrong_number')] }, now);
  assert.deepEqual(failedOld.map((x) => x.kind), ['recurring_contact']);
});

test('a part that arrives after earlier unanswered calls is announced again; the announcement waits a day after a no-answer', () => {
  const arrived = item({ receivedAt: days(1) });
  const t = dossierTasks({ items: [arrived], contacts: [call(days(5), 'no_answer'), call(days(4), 'no_answer')] }, now);
  assert.deepEqual(t.map((x) => [x.kind, x.section, x.urgent]), [['inform_arrival', 'invite', true]]);
  const tried = dossierTasks({ items: [arrived], contacts: [call(days(0), 'no_answer')] }, now);
  assert.deepEqual(tried, [], 'tried today: nothing more today');
  const twice = dossierTasks({ items: [item({ receivedAt: days(4) })], contacts: [call(days(3), 'no_answer'), call(days(2), 'no_answer')] }, now);
  assert.ok(!twice.some((x) => x.kind === 'inform_arrival' || x.kind === 'no_answer_retry'), 'after two unanswered calls the contact has failed');
});

test('appointments of the vehicle are linked automatically after arrival; an uncertain match is not guessed (spec 29.3)', () => {
  const since = midnight('2026-11-10');
  const a1 = { id: 'a1', at: '2026-11-24T07:00:00.000Z', relation: null };
  const a2 = { id: 'a2', at: '2026-11-25T07:00:00.000Z', relation: null };
  const before = { id: 'a0', at: '2026-11-05T07:00:00.000Z', relation: null };
  assert.deepEqual([...autoLinkedAppointments([a1, before], since)], ['a1']);
  assert.deepEqual([...autoLinkedAppointments([a1, a2], since)], [], 'two candidates: left for review');
  assert.deepEqual([...autoLinkedAppointments([{ ...a1, relation: 'unrelated' as const }, a2], since)], ['a2'], 'the operator decision wins');
  assert.deepEqual([...autoLinkedAppointments([a1], null)], [], 'no part waits: nothing to invite for');
  const auto = autoLinkedAppointments([a1], since);
  assert.equal(effectiveRelation(a1, auto), 'related');
  assert.equal(effectiveRelation({ ...a1, relation: 'unrelated' }, auto), 'unrelated');
  const fresh = '2026-11-22T05:00:00Z';
  assert.equal(appointmentState({ appointments: [{ ...a1, relation: effectiveRelation(a1, auto) }], lastReportAt: fresh, attendedAt: null, now }), 'confirmed');
  assert.equal(appointmentState({ appointments: [a1, a2], lastReportAt: fresh, attendedAt: null, now }), 'ambiguous');
});

test('a linked appointment moves the vehicle to «نوبت‌داده‌شده»', () => {
  const arrived = item({ receivedAt: midnight('2026-11-10') });
  assert.equal(openArrivalSince([arrived, item({ id: 'p', state: 'pending' })]), midnight('2026-11-10'));
  assert.equal(openArrivalSince([item({ state: 'installed', receivedAt: midnight('2026-11-10') })]), null);
  assert.equal(dossierQueue([arrived], []), 'to_invite');
  assert.equal(dossierQueue([arrived], [], { linkedAppointment: true }), 'appointed');
  assert.equal(dossierQueue([item({ state: 'pending' })], [], { linkedAppointment: true }), 'awaiting_supply');
});
