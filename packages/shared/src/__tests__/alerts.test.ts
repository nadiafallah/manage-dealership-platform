import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alertSettingsOf, DEFAULT_ALERT_SETTINGS, openAlerts, type AlertKind } from '../index';

const none = () => false;

test('defaults: parts total 1,000,000,000 Rial (spec decision 1), invalid stored values fall back', () => {
  assert.equal(DEFAULT_ALERT_SETTINGS.partsAlertThresholdRial, 1_000_000_000);
  assert.deepEqual(alertSettingsOf({}), DEFAULT_ALERT_SETTINGS);
  assert.deepEqual(alertSettingsOf({ partsAlertThresholdRial: 5_000_000, emdadLateDays: 0, expensivePartThresholdRial: 'x' }), { ...DEFAULT_ALERT_SETTINGS, partsAlertThresholdRial: 5_000_000 });
});

test('parts amount: each further multiple of the threshold asks again', () => {
  const settings = { ...DEFAULT_ALERT_SETTINGS, partsAlertThresholdRial: 5_000_000 };
  const lines = [{ description: 'درب', quantity: 1, unitRial: 8_000_000 }, { description: 'قاب', quantity: 1, unitRial: 3_000_000 }, { description: 'بدون قیمت', quantity: 2, unitRial: null }];
  assert.deepEqual(openAlerts({ coverageType: 'golden_card', lines, settings, answered: none }), [
    { kind: 'parts_amount', level: 2, totalRial: 11_000_000, thresholdRial: 5_000_000, partDescription: null },
  ]);
  assert.deepEqual(openAlerts({ coverageType: 'golden_card', lines, settings, answered: (k, l) => k === 'parts_amount' && l === 2 }), []);
  assert.deepEqual(openAlerts({ coverageType: 'golden_card', lines: lines.slice(1), settings, answered: none }), []);
});

test('expensive part: personal coverage only, one question per further expensive line', () => {
  const settings = { ...DEFAULT_ALERT_SETTINGS, expensivePartThresholdRial: 6_000_000 };
  const lines = [{ description: 'اتاق کامل', quantity: 1, unitRial: 9_000_000 }, { description: 'پیچ', quantity: 10, unitRial: 10_000 }];
  const personal = openAlerts({ coverageType: 'personal', lines, settings, answered: none });
  assert.deepEqual(personal, [{ kind: 'expensive_part', level: 1, totalRial: 9_000_000, thresholdRial: 6_000_000, partDescription: 'اتاق کامل' }]);
  assert.deepEqual(openAlerts({ coverageType: 'insurance', lines, settings, answered: none }), []);
  const answered = (k: AlertKind, l: number) => k === 'expensive_part' && l === 1;
  assert.deepEqual(openAlerts({ coverageType: 'personal', lines, settings, answered }), []);
  const more = [...lines, { description: 'درب جلو', quantity: 2, unitRial: 3_000_000 }];
  assert.deepEqual(openAlerts({ coverageType: 'personal', lines: more, settings, answered }).map((a) => [a.kind, a.level, a.partDescription]), [['expensive_part', 2, 'درب جلو']]);
});
