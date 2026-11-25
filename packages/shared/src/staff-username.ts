import { toLatinDigits } from './text';

/** Display spacing/digits only; legacy punctuation (X30-0) remains exact. */
export function normalizeStaffUsername(value: string): string {
  return toLatinDigits(value.trim()).toLowerCase().replace(/^(tech|exp|mgr|gst)\s+(?=[a-z0-9])/, '$1');
}

export function technicianUsernameForStation(code: string): string {
  const suffix = toLatinDigits(code.trim()).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,27}$/.test(suffix)) throw new Error('INVALID_STATION_CODE');
  return `tech${suffix}`;
}

export function expertUsernameForCode(code: string): string {
  return staffUsernameForCode(code, 'exp');
}

/**
 * Sign-in name prefixes of the reconstruction scenario (owner, 2026-11-25): MGR for the service
 * manager, GST for guests, EXP for every other PIN role. Technicians follow their station (TECH).
 */
export type StaffCodePrefix = 'exp' | 'mgr' | 'gst';
const EXPERT_ROLES = ['accident_expert', 'parts_clerk', 'special_aid_operator', 'special_aid_supply'];

/** The prefix of an owner-chosen two-digit code for a person with these roles. Operational roles win over manager and guest. */
export function staffCodePrefixForRoles(roles: readonly string[]): StaffCodePrefix {
  if (roles.some((r) => EXPERT_ROLES.includes(r))) return 'exp';
  if (roles.includes('service_manager')) return 'mgr';
  if (roles.includes('guest')) return 'gst';
  return 'exp';
}

export function staffUsernameForCode(code: string, prefix: StaffCodePrefix): string {
  const suffix = toLatinDigits(code.trim());
  if (!/^[0-9]{2}$/.test(suffix)) throw new Error('INVALID_PERSONNEL_CODE');
  return `${prefix}${suffix}`;
}

export function displayStaffUsername(value: string): string {
  return value.replace(/^(tech|exp|mgr|gst)([0-9]+)$/i, (_, prefix: string, code: string) => `${prefix.toUpperCase()} ${code}`);
}
