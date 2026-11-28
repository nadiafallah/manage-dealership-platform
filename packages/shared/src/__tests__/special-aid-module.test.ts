import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedItemActions, arrivalAge, dossierTasks, failedAttemptDays, isContactFailed, nextItemState, permissionsFor, tehranDay, unansweredStreak,
  type AidContactFacts, type AidItemFacts, contactSchema, itemActionSchema, nonConsumptionSchema,
} from '../index';

// Synthetic facts only. Times are fixed in UTC; Tehran is +03:30.
const now = new Date('2026-11-22T08:00:00Z'); // 11:30 Tehran
const days = (n: number, base = now) => new Date(base.getTime() - n * 86_400_000).toISOString();
const item = (over: Partial<AidItemFacts> = {}): AidItemFacts => ({ id: over.id ?? 'a', state: 'reserved', receivedAt: days(1), arrivalObservedAt: days(1), informedAt: null, groupId: null, ...over });
const call = (at: string, outcome: AidContactFacts['outcome'], itemIds = ['a'], promisedAt: string | null = null): AidContactFacts => ({ at, outcome, itemIds, promisedAt });

test('the state machine never marks a part installed because it left the warehouse', () => {
  assert.equal(nextItemState('reserved', 'deliver'), 'delivered');
  assert.equal(nextItemState('reserved', 'installed'), null);
  assert.equal(nextItemState('delivered', 'installed'), 'installed');
  assert.equal(nextItemState('pending', 'reserve'), null);
  assert.equal(nextItemState('installed', 'release'), null);
  // An arrived part that Manage could not hold can still be released for another customer.
  assert.equal(nextItemState('arrived', 'release'), 'released');
  assert.deepEqual(allowedItemActions('not_installed').sort(), ['release', 'return_to_stock_hold']);
});

test('an arrived part not announced is the most urgent contact task, grouped per vehicle', () => {
  const t = dossierTasks({ items: [item(), item({ id: 'b' }), item({ id: 'c', state: 'pending', receivedAt: null, arrivalObservedAt: null })], contacts: [] }, now);
  const inform = t.find((x) => x.kind === 'inform_arrival');
  assert.ok(inform);
  assert.deepEqual(inform.itemIds.sort(), ['a', 'b']);
  assert.equal(inform.urgent, true);
});

test('a no-answer is retried on another working day; two unanswered calls make a failed contact (spec 29.5)', () => {
  const sameDay = dossierTasks({ items: [item()], contacts: [call(days(0), 'no_answer')] }, now);
  assert.ok(!sameDay.some((x) => x.kind === 'no_answer_retry' || x.kind === 'inform_arrival'), 'no second attempt is asked for on the same day');
  const nextDay = dossierTasks({ items: [item({ receivedAt: days(3) })], contacts: [call(days(1), 'no_answer')] }, now);
  assert.ok(nextDay.some((x) => x.kind === 'no_answer_retry'));
  // Two attempts the same day count once as days, twice as calls.
  const twice = [call(days(2), 'no_answer'), call(new Date(Date.parse(days(2)) + 3600_000).toISOString(), 'no_answer')];
  assert.equal(failedAttemptDays([...twice, call(days(1), 'no_answer')]), 2);
  assert.equal(unansweredStreak(twice), 2);
  assert.equal(isContactFailed(twice), true);
  assert.equal(isContactFailed([call(days(2), 'no_answer')]), false);
  // After a failed contact no daily retry is asked for; only the ten-day call remains.
  const failed = dossierTasks({ items: [item({ receivedAt: days(4) })], contacts: [call(days(3), 'no_answer'), call(days(2), 'no_answer')] }, now);
  assert.ok(!failed.some((x) => x.kind === 'no_answer_retry' || x.kind === 'inform_arrival'));
  // A reached contact resets the streak.
  assert.equal(unansweredStreak([...twice, call(days(0), 'answered')]), 0);
  assert.equal(failedAttemptDays([...twice, call(days(0), 'answered')]), 0);
});

test('informed parts get a recurring call every ten days', () => {
  const informed = item({ informedAt: days(11), receivedAt: days(12) });
  assert.ok(dossierTasks({ items: [informed], contacts: [call(days(10), 'answered')] }, now).some((x) => x.kind === 'recurring_contact'));
  assert.ok(!dossierTasks({ items: [informed], contacts: [call(days(9), 'answered')] }, now).some((x) => x.kind === 'recurring_contact'));
});

test('the 20-working-day flags come from the official receipt date and never move with a postponement', () => {
  // 2026-10-20 → 2026-11-22: 29 working days (Fridays off) → expired.
  const old = item({ informedAt: days(25), receivedAt: '2026-10-20T08:00:00Z', arrivalObservedAt: days(2) });
  const t = dossierTasks({ items: [old], contacts: [call(days(5), 'answered')], postponedUntil: days(-5) }, now);
  const expired = t.find((x) => x.kind === 'deadline_expired');
  assert.ok(expired && expired.urgent && !expired.postponed && expired.section === 'deadline', 'a deadline is never postponed');
  assert.equal(arrivalAge(old, now), 33);
  // Without the official date the first observation is used.
  assert.equal(arrivalAge(item({ receivedAt: null, arrivalObservedAt: days(21) }), now), 21);
});

test('a postponement hides contact tasks but keeps their original deadline', () => {
  const t = dossierTasks({ items: [item({ receivedAt: days(3) })], contacts: [], postponedUntil: days(-2) }, now);
  const inform = t.find((x) => x.kind === 'inform_arrival')!;
  assert.equal(inform.postponed, true);
  assert.equal(inform.overdue, true, 'the deadline is still the original one');
});

test('a partially arrived group waits for the operator decision; no invitation is implied', () => {
  const items = [item({ id: 'a', groupId: 'g' }), item({ id: 'b', groupId: 'g', state: 'pending', receivedAt: null, arrivalObservedAt: null })];
  const undecided = dossierTasks({ items, contacts: [], groups: [{ id: 'g', decision: null }] }, now);
  assert.ok(undecided.some((x) => x.kind === 'group_decision'));
  assert.ok(!undecided.some((x) => x.kind === 'inform_arrival'));
  const wait = dossierTasks({ items, contacts: [], groups: [{ id: 'g', decision: 'wait' }] }, now);
  assert.ok(!wait.some((x) => x.kind === 'inform_arrival' || x.kind === 'group_decision'));
  const partial = dossierTasks({ items, contacts: [], groups: [{ id: 'g', decision: 'partial' }] }, now);
  assert.ok(partial.some((x) => x.kind === 'inform_arrival'));
});

test('a promised visit day that arrived without attendance is a task', () => {
  const t = dossierTasks({ items: [item({ informedAt: days(3) })], contacts: [call(days(3), 'promised_visit', ['a'], days(0))] }, now);
  assert.ok(t.some((x) => x.kind === 'promised_visit'));
  assert.ok(!dossierTasks({ items: [item({ informedAt: days(3) })], contacts: [call(days(3), 'promised_visit', ['a'], days(0))], attendedAt: days(0) }, now).some((x) => x.kind === 'promised_visit'));
});

test('installed, released and officially cancelled parts need no follow-up', () => {
  for (const state of ['installed', 'released'] as const) assert.deepEqual(dossierTasks({ items: [item({ state, receivedAt: days(40) })], contacts: [] }, now), []);
  assert.deepEqual(dossierTasks({ items: [item({ officialCancelled: true, receivedAt: days(40) })], contacts: [] }, now), []);
});

test('input rules: promise date, release reason and «other» explanation', () => {
  const id = '0190f0f0-0000-7000-8000-000000000001';
  assert.equal(contactSchema.safeParse({ outcome: 'promised_visit', itemIds: [id], expectedVersion: 1 }).success, false);
  assert.equal(itemActionSchema.safeParse({ action: 'release', expectedVersion: 1 }).success, false);
  assert.equal(itemActionSchema.safeParse({ action: 'release', expectedVersion: 1, reason: 'مشتری انصراف داد' }).success, true);
  assert.equal(nonConsumptionSchema.safeParse({ reason: 'other', expectedVersion: 1 }).success, false);
});

test('Tehran day boundary', () => {
  assert.equal(tehranDay('2026-11-21T20:29:00Z'), '2026-11-21');
  assert.equal(tehranDay('2026-11-21T20:31:00Z'), '2026-11-22');
});

test('special-aid roles: operator calls customers, supply expert exports, release stays with authorized staff', () => {
  const op = permissionsFor(['special_aid_operator']);
  assert.ok(op.has('special_aid.operate') && op.has('customer.pii.read'));
  assert.ok(!op.has('special_aid.release') && !op.has('stock.release'));
  const supply = permissionsFor(['special_aid_supply']);
  assert.ok(supply.has('special_aid.supply') && !supply.has('special_aid.operate') && !supply.has('customer.pii.read'));
  const both = permissionsFor(['special_aid_operator', 'parts_clerk']);
  assert.ok(both.has('special_aid.operate') && both.has('part.manage'), 'one person may hold several roles');
  assert.ok(permissionsFor(['system_admin']).has('special_aid.release'));
  assert.ok(permissionsFor(['service_manager']).has('special_aid.report') && !permissionsFor(['service_manager']).has('special_aid.operate'));
});

import { appointmentInstant, appointmentState, endOfNextWorkingDay, feedbackAckSchema, cardMatchSchema, headerSignature, ROLE_PERMISSIONS, PIN_LOGIN_ROLES, accessUpdateSchema } from '../index';

test('customer notice deadline: end of the next working day (Friday and holidays skipped)', () => {
  // Thursday 2026-11-19 10:00 Tehran → Friday is off → end of Saturday 2026-11-21.
  assert.equal(endOfNextWorkingDay('2026-11-19T06:30:00Z').toISOString(), '2026-11-21T20:29:59.999Z');
  // Sunday → Monday.
  assert.equal(endOfNextWorkingDay('2026-11-22T06:30:00Z').toISOString(), '2026-11-23T20:29:59.999Z');
  // A recorded holiday on Monday moves it to Tuesday.
  const holiday = (d: string) => d !== '2026-11-23' && new Date(d + 'T12:00:00Z').getUTCDay() !== 5;
  assert.equal(endOfNextWorkingDay('2026-11-22T06:30:00Z', holiday).toISOString(), '2026-11-24T20:29:59.999Z');
  // The inform task uses the calendar passed with the dossier.
  const arrivedSunday = { id: 'a', state: 'reserved' as const, receivedAt: '2026-11-22T06:30:00Z', arrivalObservedAt: null, informedAt: null, groupId: null };
  const [t] = dossierTasks({ items: [arrivedSunday], contacts: [], isWorkingDay: holiday }, new Date('2026-11-22T08:00:00Z'));
  assert.equal(t!.kind, 'inform_arrival');
  assert.equal(t!.dueAt, '2026-11-24T20:29:59.999Z');
  assert.equal(t!.overdue, false);
  const [late] = dossierTasks({ items: [arrivedSunday], contacts: [], isWorkingDay: holiday }, new Date('2026-11-25T08:00:00Z'));
  assert.equal(late!.overdue, true);
});

test('appointment report: date parsing and state never assumes the VIN appointment is related', () => {
  assert.equal(appointmentInstant('1405/09/03', '10:30'), '2026-11-24T07:00:00.000Z');
  assert.equal(appointmentInstant('۱۴۰۵/۰۹/۰۳ 10:30'), '2026-11-24T07:00:00.000Z');
  assert.equal(appointmentInstant('2026-11-24'), new Date('2026-11-24').toISOString());
  assert.equal(appointmentInstant('فردا'), null);
  const now = new Date('2026-11-22T08:00:00Z');
  const fresh = '2026-11-22T05:00:00Z';
  const future = { id: 'x', at: '2026-11-24T07:00:00.000Z', relation: null };
  assert.equal(appointmentState({ appointments: [], lastReportAt: null, attendedAt: null, now }), 'no_report');
  assert.equal(appointmentState({ appointments: [], lastReportAt: fresh, attendedAt: null, now }), 'none_recent');
  assert.equal(appointmentState({ appointments: [future], lastReportAt: fresh, attendedAt: null, now }), 'ambiguous');
  assert.equal(appointmentState({ appointments: [{ ...future, relation: 'related' }], lastReportAt: fresh, attendedAt: null, now }), 'confirmed');
  assert.equal(appointmentState({ appointments: [{ ...future, relation: 'unrelated' }], lastReportAt: fresh, attendedAt: null, now }), 'none_recent');
  const past = { id: 'p', at: '2026-11-20T07:00:00.000Z', relation: 'related' as const };
  assert.equal(appointmentState({ appointments: [past], lastReportAt: fresh, attendedAt: null, now }), 'passed_unverified');
  assert.equal(appointmentState({ appointments: [past], lastReportAt: fresh, attendedAt: '2026-11-20T09:00:00Z', now }), 'attended');
  assert.equal(appointmentState({ appointments: [], lastReportAt: '2026-11-10T05:00:00Z', attendedAt: null, now }), 'stale');
});

test('cards, feedback, header signatures, guest and job titles', () => {
  assert.equal(cardMatchSchema.safeParse({ expectedVersion: 1 }).success, false);
  assert.equal(cardMatchSchema.safeParse({ admissionNo: '1405-77', expectedVersion: 1 }).success, true);
  assert.equal(feedbackAckSchema.safeParse({ expectedVersion: 1 }).success, true);
  assert.equal(headerSignature(['شماره  شاسی', 'كد', '']), headerSignature(['شمارهشاسی', 'کد']));
  assert.deepEqual([...ROLE_PERMISSIONS.guest], ['special_aid.read']);
  assert.ok(!permissionsFor(['guest']).has('customer.pii.read'));
  assert.ok((PIN_LOGIN_ROLES as readonly string[]).includes('guest'));
  const base = { expectedVersion: 1, expectedTemplateVersion: 1, roles: ['guest'], allow: [], deny: [] };
  assert.equal(accessUpdateSchema.safeParse({ ...base, jobTitles: ['کارشناس', 'کارشناس'] }).success, false);
  assert.equal(accessUpdateSchema.safeParse({ ...base, jobTitles: ['کارشناس امداد', 'مسئول تماس'], accessExpiresAt: '2026-12-01T00:00:00+03:30' }).success, true);
});

import { suggestReferenceMapping } from '../index';
test('first-import column suggestions: exact names first, each column once, nothing for unknown headers', () => {
  const m = suggestReferenceMapping('appointments', ['ردیف', 'شماره نوبت', 'تاریخ نوبت', 'ساعت', 'وضعیت', 'شماره شاسی', 'نام مشتری', 'موبایل']);
  assert.deepEqual(m, { appointmentNo: 1, appointmentDate: 2, appointmentTime: 3, status: 4, chassis: 5, fullName: 6, phone: 7 });
  const c = suggestReferenceMapping('customers', ['شماره شاسی', 'نام مشتری', 'تلفن همراه', 'شماره پلاک', 'مدل خودرو', 'شماره کارت پذيرش']);
  assert.deepEqual(c, { chassis: 0, fullName: 1, phone: 2, plate: 3, model: 4, admissionNo: 5 });
  assert.deepEqual(suggestReferenceMapping('appointments', ['ستون یک', 'ستون دو']), {});
});
