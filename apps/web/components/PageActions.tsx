'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import type { Action } from '@/lib/workspaces';
import { AppIcon, type IconName } from './AppIcon';

/**
 * Page-level shortcuts that the sidebar does not already offer. Desks, the case
 * folder, the control room, parts and settings carry their own header, so only
 * the pages below get a context bar (owner references: no duplicate navigation).
 */
const CONTEXT: { match: (p: string) => boolean; label: string; href: string; icon: IconName; actions: Action[] }[] = [
  { match: (p) => p === '/users', label: 'مدیریت کارکنان', href: '/users', icon: 'team', actions: [{ label: 'افزودن کارمند', detail: '', href: '#invite-staff', icon: 'add', permission: 'user.manage' }, { label: 'افزودن تعمیرکار', detail: '', href: '#technicians', icon: 'add', permission: 'user.manage' }] },
  { match: (p) => p === '/reference-data', label: 'اطلاعات پایه', href: '/reference-data', icon: 'database', actions: [] },
  { match: (p) => p === '/cases' || p === '/cases/import', label: 'پرونده‌ها', href: '/cases', icon: 'folder', actions: [{ label: 'پذیرش جدید', detail: '', href: '/cases/new', icon: 'add', permission: 'case.create' }] },
];

export function PageActions() {
  const path = usePathname();
  const { can } = useAuth();
  const ctx = CONTEXT.find((c) => c.match(path));
  if (!ctx) return null;
  const actions = ctx.actions.filter((a) => !a.permission || can(a.permission));
  return (
    <div className="page-context no-print">
      <Link className="context-unit" href={ctx.href}><AppIcon name={ctx.icon} />{ctx.label}</Link>
      {actions.length > 0 && (
        <nav aria-label="دسترسی سریع صفحه" className="page-actions">
          {actions.map((a) => (a.href.startsWith('#') ? <a key={a.href} href={a.href}><AppIcon name={a.icon} />{a.label}</a> : <Link key={a.href} href={a.href}><AppIcon name={a.icon} />{a.label}</Link>))}
        </nav>
      )}
    </div>
  );
}
