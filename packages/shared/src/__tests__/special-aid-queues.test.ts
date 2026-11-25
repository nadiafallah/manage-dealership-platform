import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONTACT_OUTCOME_LABELS, dossierQueue, NON_CONSUMPTION_LABELS, NON_CONSUMPTION_REASONS, nonConsumptionSchema, TECHNICAL_REASONS, failedAttemptDays, isUnreached, SPECIAL_AID_QUEUE_LABELS, SPECIAL_AID_QUEUES, type AidItemFacts } from '../index';

const item = (over: Partial<AidItemFacts>): AidItemFacts => ({ id: 'i', state: 'pending', receivedAt: null, arrivalObservedAt: null, informedAt: null, groupId: null, ...over });

test('«خاموش» and «شماره اشتباه» are recorded and count as not reached, like «پاسخ نداد»', () => {
  assert.equal(CONTACT_OUTCOME_LABELS.switched_off, 'خاموش بود');
  assert.equal(CONTACT_OUTCOME_LABELS.wrong_number, 'شماره اشتباه است');
  assert.equal(isUnreached('switched_off'), true);
  assert.equal(isUnreached('answered'), false);
  const contacts = [
    { at: '2026-01-10T06:00:00Z', outcome: 'no_answer' as const, itemIds: [] },
    { at: '2026-01-11T06:00:00Z', outcome: 'switched_off' as const, itemIds: [] },
    { at: '2026-01-12T06:00:00Z', outcome: 'wrong_number' as const, itemIds: [] },
  ];
  assert.equal(failedAttemptDays(contacts), 3);
  assert.equal(failedAttemptDays([...contacts, { at: '2026-01-13T06:00:00Z', outcome: 'answered', itemIds: [] }]), 0);
});

test('the four queues of the scenario', () => {
  assert.deepEqual(SPECIAL_AID_QUEUES.map((q) => SPECIAL_AID_QUEUE_LABELS[q]), ['در انتظار تأمین', 'آمادهٔ دعوت', 'نوبت‌داده‌شده', 'تعیین تکلیف‌شده']);
  assert.equal(dossierQueue([], []), null);
  assert.equal(dossierQueue([item({ state: 'pending' })], []), 'awaiting_supply');
  const arrived = item({ state: 'reserved', receivedAt: '2026-01-10T06:00:00Z' });
  assert.equal(dossierQueue([arrived, item({ state: 'pending' })], []), 'to_invite');
  // A coordinated appointment before the part arrived does not count.
  assert.equal(dossierQueue([arrived], [{ at: '2026-01-09T06:00:00Z', outcome: 'appointment_coordinated' }]), 'to_invite');
  assert.equal(dossierQueue([arrived], [{ at: '2026-01-11T06:00:00Z', outcome: 'appointment_coordinated' }]), 'appointed');
  assert.equal(dossierQueue([arrived], [{ at: '2026-01-11T06:00:00Z', outcome: 'promised_visit' }, { at: '2026-01-12T06:00:00Z', outcome: 'no_answer' }]), 'to_invite');
  assert.equal(dossierQueue([item({ state: 'installed', receivedAt: '2026-01-10T06:00:00Z' }), item({ state: 'released' })], []), 'settled');
  assert.equal(dossierQueue([item({ state: 'pending', officialCancelled: true })], []), null);
});

test('the scenario reasons are recorded with the requesting station; «سایر» still needs a note', () => {
  for (const r of ['defective_part', 'technician_diagnosis', 'replaced_from_stock', 'vehicle_transferred'] as const) {
    assert.ok(NON_CONSUMPTION_REASONS.includes(r));
    assert.ok(NON_CONSUMPTION_LABELS[r]);
  }
  assert.equal(NON_CONSUMPTION_REASONS.at(-1), 'other');
  assert.ok(TECHNICAL_REASONS.includes('technician_diagnosis'));
  assert.equal(nonConsumptionSchema.parse({ reason: 'technician_diagnosis', requestingStation: ' مکانیکی 99 ', expectedVersion: 1 }).requestingStation, 'مکانیکی 99');
  assert.equal(nonConsumptionSchema.safeParse({ reason: 'other', expectedVersion: 1 }).success, false);
});
