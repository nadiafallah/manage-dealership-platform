import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatJalali,
  formatJalaliDateInput,
  hasPermission,
  maskPhone,
  normalizePersian,
  normalizePhone,
  parseJalali,
  searchKey,
  taskActionSchema,
  toLatinDigits,
} from '../index';

test('Persian and Arabic digits convert to ASCII', () => {
  assert.equal(toLatinDigits('۱۴۰۵/۰۸/۰۹ و ٣٤'), '1405/08/09 و 34');
});

test('Arabic yeh/kaf normalize to Persian forms', () => {
  assert.equal(normalizePersian('علي  كريمي'), 'علی کریمی');
});

test('search key ignores separators so plates match loosely', () => {
  assert.equal(searchKey('۱۲ ب ۳۴۵ - ۶۷'), searchKey('12ب34567'));
});

test('phone normalization', () => {
  assert.equal(normalizePhone('+98 912 123 4567'), '09121234567');
  assert.equal(normalizePhone('۰۹۱۲-۱۲۳-۴۵۶۷'), '09121234567');
  assert.equal(maskPhone('09121234567'), '0912***4567');
});

test('Jalali parse is Tehran local time and round-trips', () => {
  const d = parseJalali('۱۴۰۵/۰۸/۰۹', '۱۴:۳۰');
  assert.ok(d);
  // 1405/08/09 = 2026-10-31; 14:30 Tehran = 11:00 UTC
  assert.equal(d.toISOString(), '2026-10-31T11:00:00.000Z');
  assert.equal(formatJalaliDateInput(d), '1405/08/09');
  assert.equal(formatJalali(d, { time: true }), '۱۴۰۵/۰۸/۰۹ ۱۴:۳۰');
});

test('Jalali date near midnight UTC belongs to the next Tehran day', () => {
  assert.equal(formatJalaliDateInput(new Date('2026-10-31T21:00:00Z')), '1405/08/10');
});

test('invalid Jalali dates are rejected', () => {
  assert.equal(parseJalali('1405/13/01'), null);
  assert.equal(parseJalali('1405/07/31'), null); // month 7 has 30 days
  assert.equal(parseJalali('1405/08/09', '25:00'), null);
  assert.equal(parseJalali('not a date'), null);
});

test('RBAC: parts cannot manage repairs; system support can read cases', () => {
  assert.equal(hasPermission(['accident_expert'], 'task.manage'), true);
  assert.equal(hasPermission(['parts_clerk'], 'task.manage'), false);
  assert.equal(hasPermission(['parts_clerk'], 'customer.pii.read'), false);
  assert.equal(hasPermission(['system_admin'], 'case.read'), true);
});

test('reopening a task requires a reason', () => {
  const bad = taskActionSchema.safeParse({ action: 'reopen', expectedVersion: 1 });
  assert.equal(bad.success, false);
  const ok = taskActionSchema.safeParse({ action: 'reopen', expectedVersion: 1, note: 'کار اصلاحی' });
  assert.equal(ok.success, true);
});
