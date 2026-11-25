import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeLaborCode, parseLaborCodes, receptionDayStats, receptionKind, UNKNOWN_RECEPTIONIST } from '../index';

test('labour codes are compared as text with ASCII digits and leading zeros kept', () => {
  assert.equal(normalizeLaborCode(' ۰۱۲ ab '), '012AB');
  assert.deepEqual(parseLaborCodes('۰۱۰۰، 0200\n0100 ; 0300'), ['0100', '0200', '0300']);
  assert.deepEqual(parseLaborCodes('  '), []);
});

test('only-service labour is «سرویس»; any other code is «تعمیراتی»; no labour is never guessed', () => {
  const service = ['0100', '0200'];
  assert.equal(receptionKind(['0100'], service), 'service');
  assert.equal(receptionKind(['0100', '۰۲۰۰'], service), 'service');
  assert.equal(receptionKind(['0100', '9999'], service), 'repair');
  assert.equal(receptionKind([], service), 'unclassified');
  assert.equal(receptionKind([null, ' '], service), 'unclassified');
  // Without a configured list every reception with labour is a repair.
  assert.equal(receptionKind(['0100'], []), 'repair');
});

test('daily statistics per receptionist, busiest first, blank names grouped', () => {
  const stats = receptionDayStats('2026-01-10', [
    { receptionist: 'پذیرشگر الف', codes: ['0100'] },
    { receptionist: ' پذیرشگر  الف ', codes: ['5000'] },
    { receptionist: 'پذیرشگر ب', codes: [] },
    { receptionist: null, codes: ['0100', '5000'] },
    { receptionist: 'پذیرشگر الف', codes: ['0200'] },
  ], ['0100', '0200']);
  assert.equal(stats.date, '2026-01-10');
  assert.deepEqual({ total: stats.total, repair: stats.repair, service: stats.service, unclassified: stats.unclassified }, { total: 5, repair: 2, service: 2, unclassified: 1 });
  assert.equal(stats.serviceCodesConfigured, true);
  assert.deepEqual(stats.byReceptionist[0], { name: 'پذیرشگر الف', total: 3, repair: 1, service: 2, unclassified: 0 });
  assert.ok(stats.byReceptionist.some((p) => p.name === UNKNOWN_RECEPTIONIST && p.repair === 1));
  assert.equal(stats.byReceptionist.reduce((n, p) => n + p.total, 0), stats.total);
  assert.equal(receptionDayStats('2026-01-10', [], []).serviceCodesConfigured, false);
});
