import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareNightRows, NIGHT_LIST_COLUMNS, NIGHT_LIST_REASONS, NIGHT_LIST_REASON_LABELS, nightListLate, nightListMissing, nightListSheet, type NightListRow } from '../index';

const row = (over: Partial<NightListRow>): NightListRow => ({
  id: 'i', version: 1, receptionId: 'r', admissionNo: '100', plate: '11 ب 111 - 11', vehicleName: 'دنا پلاس', ownerName: 'مشتری ساختگی', daysIn: 2, isOpen: true, accident: false,
  labour: [], currentStation: null, nextStations: null, reason: null, reasonNote: null, carried: false, setByName: null, setAt: null, ...over,
});

test('every standard reason of the scenario has a label; «سایر» is last', () => {
  assert.equal(NIGHT_LIST_REASONS.length, 9);
  for (const r of NIGHT_LIST_REASONS) assert.ok(NIGHT_LIST_REASON_LABELS[r]);
  assert.equal(NIGHT_LIST_REASONS.at(-1), 'other');
});

test('missing reasons, lateness after 18:45 only while a draft, longest stay first', () => {
  assert.equal(nightListMissing([row({}), row({ reason: 'station_load' }), row({ reason: 'waiting_parts', carried: true })]), 1);
  const deadline = '2026-01-10T15:15:00.000Z';
  assert.equal(nightListLate('draft', deadline, new Date('2026-01-10T15:14:59Z')), false);
  assert.equal(nightListLate('draft', deadline, new Date('2026-01-10T15:15:00Z')), true);
  assert.equal(nightListLate('sent', deadline, new Date('2026-01-10T16:00:00Z')), false);
  const sorted = [row({ daysIn: 1, admissionNo: '9' }), row({ daysIn: 4, admissionNo: '20' }), row({ daysIn: 1, admissionNo: '10' })].sort(compareNightRows);
  assert.deepEqual(sorted.map((r) => r.admissionNo), ['20', '9', '10']);
});

test('the Excel sheet keeps the scenario column order and marks carried reasons', () => {
  const sheet = nightListSheet([row({ reason: 'waiting_parts', carried: true, labour: ['صافکاری (باز)'], currentStation: 'باتری‌سازی 36', nextStations: 'مکانیکی 99', accident: true, isOpen: false })]);
  assert.deepEqual(sheet[0], [...NIGHT_LIST_COLUMNS]);
  assert.deepEqual(sheet[1], ['دنا پلاس', '11 ب 111 - 11', 'مشتری ساختگی', '100', 2, 'باتری‌سازی 36', 'صافکاری (باز)', 'مکانیکی 99', 'منتظر قطعه از انبار (از دیروز)', '', 'بله', 'ترخیص شد']);
  assert.equal(nightListSheet([row({})])[1]![8], 'ثبت نشده');
});
