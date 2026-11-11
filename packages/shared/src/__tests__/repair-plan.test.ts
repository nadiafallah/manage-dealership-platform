import assert from 'node:assert/strict';
import { test } from 'node:test';
import { repairDurationDays, repairPlanStepsSchema, stepDependencies } from '../index';

// Spec example: mechanic (engine out) → body (chassis) → battery (wiring) → suspension → mechanic (engine in) → paint.
const example = [
  { days: 1 }, { days: 2 }, { days: 1 }, { days: 1 }, { days: 1 }, { days: 2 },
];

test('free sequence: a bay may repeat; duration is the sum of the steps', () => {
  assert.equal(repairDurationDays(example), 8);
  assert.deepEqual(stepDependencies(example, ['m1', 'b', 'e', 's', 'm2', 'p'], ['old']), [['old'], ['m1'], ['b'], ['e'], ['s'], ['m2']]);
});

test('a concurrent step waits for the same steps and the group lasts as long as its longest step', () => {
  const steps = [{ days: 2 }, { days: 2 }, { days: 1, concurrentWithPrevious: true }, { days: 1 }];
  assert.equal(repairDurationDays(steps), 5);
  assert.deepEqual(stepDependencies(steps, ['a', 'b', 'c', 'd'], []), [[], ['a'], ['a'], ['b', 'c']]);
});

test('a wage needs the person of the step', () => {
  const dep = '0190a6f1-7b8c-7c3d-9e4f-0a1b2c3d4e5f';
  assert.equal(repairPlanStepsSchema.safeParse({ steps: [{ departmentId: dep, days: 1, wageRial: 100 }] }).success, false);
  assert.equal(repairPlanStepsSchema.safeParse({ steps: [{ departmentId: dep, days: 1.25, wageRial: 100, assignedUserId: dep }] }).success, true);
  assert.equal(repairPlanStepsSchema.safeParse({ steps: [{ departmentId: dep, days: 0.1 }] }).success, false);
});
