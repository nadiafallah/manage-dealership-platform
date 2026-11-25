import assert from 'node:assert/strict';
import { test } from 'node:test';
import { displayStaffUsername, expertUsernameForCode, normalizeStaffUsername, staffCodePrefixForRoles, staffUsernameForCode, technicianUsernameForStation } from '../index';

test('station code determines TECH; selected two-digit code determines EXP', () => {
  assert.equal(technicianUsernameForStation('۰۳'), 'tech03');
  assert.equal(technicianUsernameForStation('02'), 'tech02');
  assert.equal(expertUsernameForCode('۰۰'), 'exp00');
  assert.equal(expertUsernameForCode('20'), 'exp20');
  assert.throws(() => expertUsernameForCode('2'));
  assert.throws(() => expertUsernameForCode('200'));
  assert.equal(displayStaffUsername('tech03'), 'TECH 03');
  assert.equal(normalizeStaffUsername(' EXP ۰۰ '), 'exp00');
  assert.equal(normalizeStaffUsername('X30-0'), 'x30-0');
  assert.equal(normalizeStaffUsername('legacy.name'), 'legacy.name');
});

test('MGR for a service manager and GST for a guest; operational roles keep EXP (scenario 2026-11-25)', () => {
  assert.equal(staffCodePrefixForRoles(['service_manager']), 'mgr');
  assert.equal(staffCodePrefixForRoles(['guest']), 'gst');
  assert.equal(staffCodePrefixForRoles(['parts_clerk']), 'exp');
  assert.equal(staffCodePrefixForRoles(['service_manager', 'special_aid_operator']), 'exp');
  assert.equal(staffUsernameForCode('۳۰', 'mgr'), 'mgr30');
  assert.equal(staffUsernameForCode('05', 'gst'), 'gst05');
  assert.throws(() => staffUsernameForCode('5', 'gst'));
  assert.equal(displayStaffUsername('mgr30'), 'MGR 30');
  assert.equal(displayStaffUsername('gst05'), 'GST 05');
  assert.equal(normalizeStaffUsername('MGR ۳۰'), 'mgr30');
  assert.equal(normalizeStaffUsername(' gst 05 '), 'gst05');
  // Legacy names stay valid: an EXP manager keeps signing in with EXP until the code is changed.
  assert.equal(normalizeStaffUsername('EXP 20'), 'exp20');
});
