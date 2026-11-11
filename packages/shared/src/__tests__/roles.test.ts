import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPinEligible, normalizeRoles, PERMISSIONS, permissionsFor, ROLE_LABELS, ROLES } from '../index';

test('six roles: five role codes plus the owner flag', () => {
  assert.deepEqual([...ROLES], ['accident_expert', 'parts_clerk', 'technician', 'service_manager', 'system_admin']);
  assert.equal(ROLE_LABELS.accident_expert, 'کارشناس تصادفات');
  assert.equal(ROLE_LABELS.parts_clerk, 'مسئول قطعات');
});

test('legacy role codes map to the accident expert; cashier has no successor', () => {
  assert.deepEqual(normalizeRoles(['accident_coordinator', 'accident_supervisor', 'qc_inspector']), ['accident_expert']);
  assert.deepEqual(normalizeRoles(['cashier']), []);
  assert.deepEqual(normalizeRoles(['cashier', 'parts_clerk', 'accident_expert', 'accident_coordinator']), ['accident_expert', 'parts_clerk']);
  assert.deepEqual(normalizeRoles(['unknown', 'system_admin']), ['system_admin']);
  assert.deepEqual(normalizeRoles(null), []);
});

test('service manager has no operational mutation; owner and system admin have every permission', () => {
  const m = permissionsFor(['service_manager']);
  for (const p of ['case.create', 'case.update', 'task.manage', 'task.approve', 'part.manage', 'part.request', 'finance.propose', 'stock.reserve', 'assessment.manage'] as const) assert.equal(m.has(p), false, p);
  assert.equal(permissionsFor([], {}, null, true).size, PERMISSIONS.length);
  assert.equal(permissionsFor(['system_admin']).size, PERMISSIONS.length);
});

test('PIN sign-in for operational roles only, never owner or system admin', () => {
  assert.equal(isPinEligible(['accident_expert']), true);
  assert.equal(isPinEligible(['parts_clerk', 'technician']), true);
  assert.equal(isPinEligible(['service_manager']), true);
  assert.equal(isPinEligible(['accident_coordinator']), true); // legacy row, normalized
  assert.equal(isPinEligible(['system_admin']), false);
  assert.equal(isPinEligible(['accident_expert'], true), false);
  assert.equal(isPinEligible(['cashier']), false); // nothing left after migration
});
