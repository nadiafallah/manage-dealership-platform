import { normalizeRoles, type Role } from './enums';

// Permission strings checked by the API (authoritative) and used by the web
// app only to hide controls the user could not use anyway.
export const PERMISSIONS = [
  'case.release_authorize',
  'workshop.read', 'workshop.manage', 'calendar.manage', 'task.execute', 'part.quote', 'part.price_authorize',
  'case.read',
  'case.create',
  'case.update',
  'customer.pii.read', // full phone numbers and contact details
  'task.manage', // create tasks, record start/complete on behalf of technicians
  'task.approve', // supervisor approval of completed work
  'blocker.report',
  'blocker.manage', // acknowledge / resolve
  'assessment.manage', // draft and finalize assessments and supplements
  'assessment.authorize', // record an external authorization decision
  'part.request', // register part needs (manual, from assessment, Excel import)
  'part.manage', // stock, reservation, order, receipt, handover
  'finance.propose', // customer/insurer shares, propose advance or exception
  'finance.approve', // approve spending (never one's own proposal)
  'finance.payment', // confirm receipt of an advance, record settlement payments
  'finance.close', // financial close; closing with a balance due also needs finance.approve
  'qc.inspect', // record a QC round; failed items open corrective work
  'case.technical_close', // technical close after a passed QC round
  'case.deliver', // vehicle handover to the recipient
  'case.import', // bulk import of existing vehicles from Excel (preview, apply, results)
  'report.manager', // dealership-wide report of the service manager
  'dashboard.read',
  'audit.read',
  'user.manage',
  'settings.manage',
  'reference.parts.read',
  'reference.parts.manage',
  'reference.customers.read',
  'reference.customers.manage',
  'daily_reports.upload', // upload and preview the daily stock and Emdad files (no customer contact data)
  'daily_reports.apply', // publish a previewed daily file
  'daily_reports.settings', // reminder time/assignee; stock confirmations also need the owner
  'stock.read', // stock options, availability and Manage reservations
  'stock.reserve', // reserve an exact stock code for a part need
  'stock.release', // release a reservation or cancel a recorded issue
  'stock.issue', // record the issue from the warehouse and its reflection in the stock report
  'emdad.read', // Emdad Vijeh follow-up list and history
  'emdad.manage', // internal follow-up fields and review of case matching
  'wage.manage', // technician wage per job, independent from the assessment labour
  'wage.report', // paid wages against assessment labour, per technician and month (with Excel)
] as const;
export type Permission = (typeof PERMISSIONS)[number];

// Permissions of each role follow the table in docs/PRODUCT_SPEC_FA.md section 3.
// The accident expert also took over the work of the retired coordinator,
// supervisor, QC and cashier roles. Supply state (reserve, Emdad, market, cancel)
// stays with the parts clerk; the expert adds needs and only reads supply.
const ACCIDENT_EXPERT: readonly Permission[] = ['case.read','case.create','case.update','customer.pii.read','case.import','task.manage','task.approve','blocker.report','blocker.manage','assessment.manage','assessment.authorize','part.request','part.price_authorize','finance.propose','finance.payment','finance.close','case.release_authorize','qc.inspect','case.technical_close','case.deliver','dashboard.read','audit.read','reference.parts.read','reference.customers.read','stock.read','emdad.read','workshop.read','wage.manage'];
const PARTS_CLERK: readonly Permission[] = ['case.read','blocker.report','part.manage','part.quote','dashboard.read','reference.parts.read','reference.parts.manage','stock.read','stock.reserve','stock.release','stock.issue','emdad.read','emdad.manage','workshop.read','daily_reports.upload','daily_reports.apply'];
// The service manager only views, analyses and sends reminders (reminders need no permission).
const SERVICE_MANAGER: readonly Permission[] = ['case.read','report.manager','dashboard.read','audit.read','workshop.read','stock.read','emdad.read','wage.report'];
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  accident_expert: ACCIDENT_EXPERT,
  parts_clerk: PARTS_CLERK,
  technician: ['task.execute'],
  service_manager: SERVICE_MANAGER,
  // Unblocks work and may act for any role. Inviting staff (user.manage) is on by
  // default and the owner can take it away per administrator (owner controls).
  system_admin: PERMISSIONS,
};

export type PermissionTemplates = Partial<Record<Role, Permission[]>>;
export type PermissionOverrides = { allow: Permission[]; deny: Permission[] };

export function permissionsFor(roles: readonly string[], templates: PermissionTemplates = {}, overrides?: PermissionOverrides | null, isOwner = false): Set<Permission> {
  if (isOwner) return new Set(PERMISSIONS);
  const result = new Set<Permission>();
  for (const role of normalizeRoles(roles)) {
    for (const p of templates[role] ?? ROLE_PERMISSIONS[role] ?? []) if (PERMISSIONS.includes(p)) result.add(p);
  }
  for (const p of overrides?.allow ?? []) if (PERMISSIONS.includes(p)) result.add(p);
  for (const p of overrides?.deny ?? []) result.delete(p);
  return result;
}

export function hasPermission(roles: readonly string[], permission: Permission): boolean {
  return permissionsFor(roles).has(permission);
}

/** Roles that sign in with username + 4-digit PIN on a trusted device. Never the owner or a system administrator. */
export const PIN_LOGIN_ROLES = ['accident_expert', 'parts_clerk', 'technician', 'service_manager'] as const satisfies readonly Role[];
export type PinLoginRole = (typeof PIN_LOGIN_ROLES)[number];
export const isPinEligible = (roles: readonly string[], isOwner = false) => {
  const current = normalizeRoles(roles);
  return !isOwner && current.length > 0 && current.every((r) => (PIN_LOGIN_ROLES as readonly string[]).includes(r));
};
/**
 * Never available in a PIN session, whatever templates or overrides say. Removed from every PIN session: administration belongs to the owner and the system administrator,
 * who always sign in with email + Authenticator. Everything else follows the person's role, so a
 * service manager or coordinator keeps their approvals when they sign in with the 4-digit PIN.
 */
export const PIN_DENIED_PERMISSIONS: readonly Permission[] = ['user.manage', 'settings.manage', 'daily_reports.settings'];
