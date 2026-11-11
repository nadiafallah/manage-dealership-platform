'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MODULE_LABELS, ROLE_LABELS, type AppNotification, type ModuleKey, type ReceivedReminder } from '@manage/shared';
import useSWR from 'swr';
import { api, fetcher } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { visibleWorkspaces, workspaceHome } from '@/lib/workspaces';
import { AppIcon, type IconName } from './AppIcon';
import { BackLink } from './BackLink';
import { NotificationBar } from './NotificationBar';
import { PageActions } from './PageActions';
import { InstallButton } from './InstallApp';

// App shell of the approved design (owner references, Nov 2026): brand and five
// destinations on the inline-start side, a top bar with the global search (Ctrl+K),
// reminders and the account menu. The control room switches the shell to the dark space.
interface NavItem { href: string; label: string; icon: IconName; show: boolean; match?: (p: string) => boolean }

export function Shell({ children }: { children: ReactNode }) {
  const { me, can } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false), [mobile, setMobile] = useState(false);
  const menu = useRef<HTMLButtonElement>(null);
  useEffect(() => { const media = window.matchMedia('(max-width: 960px)'); const sync = () => setMobile(media.matches); sync(); media.addEventListener('change', sync); return () => media.removeEventListener('change', sync); }, []);
  useEffect(() => { if (!open || !mobile) return; const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); menu.current?.focus(); } }; document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key); }, [open, mobile]);
  useEffect(() => { document.title = `${pageTitle(pathname)} | Manage by HEDAX`; setOpen(false); }, [pathname]);

  const technicianOnly = me.roles.length === 1 && me.roles[0] === 'technician';
  const home = workspaceHome(me);
  const { data: inbox } = useSWR<ReceivedReminder[]>('/reminders/inbox', fetcher, { refreshInterval: 60_000 });
  const { data: notes } = useSWR<{ unread: number; items: AppNotification[] }>('/notifications', fetcher, { refreshInterval: 60_000 });
  const unseen = (inbox?.filter((r) => r.status === 'sent').length ?? 0) + (notes?.unread ?? 0);
  const dark = ['/control-room', '/accidents/manager', '/accidents/owner'].includes(pathname);
  const desks = visibleWorkspaces(me);

  const primary: NavItem[] = technicianOnly
    ? [
        { href: '/workshop/technician', label: 'کارهای من', icon: 'grid', show: true, match: (p) => p === '/workshop/technician' },
        { href: '/workshop/technician/work', label: 'کارکرد ماه', icon: 'calendar', show: true },
      ]
    : [
        { href: home, label: 'میز کار', icon: 'grid', show: true, match: (p) => p === home || (p.startsWith('/accidents') && !dark) },
        { href: '/control-room', label: 'اتاق کنترل', icon: 'gauge', show: can('report.manager'), match: (p) => p === '/control-room' || (dark && p !== home) },
        { href: '/cases', label: 'پرونده‌ها', icon: 'folder', show: can('case.read'), match: (p) => p.startsWith('/cases') },
        { href: '/parts', label: 'قطعات', icon: 'box', show: can('case.read') && (can('part.manage') || can('part.request') || can('stock.read')), match: (p) => p === '/parts' || p === '/stock' || p === '/emdad' },
        { href: '/reports', label: 'گزارش‌ها', icon: 'chart', show: can('report.manager') || can('part.manage') || can('case.update') || can('task.manage') || can('wage.report'), match: (p) => p.startsWith('/reports') },
        { href: '/settings', label: 'تنظیمات', icon: 'gear', show: me.isOwner || can('user.manage') || can('calendar.manage') || can('workshop.manage') || can('settings.manage') || can('reference.parts.read') || can('daily_reports.upload') || can('workshop.read'), match: (p) => ['/settings', '/users', '/workshop/settings', '/reference-data', '/daily-reports'].includes(p) },
      ];
  const more: NavItem[] = technicianOnly ? [] : [
    { href: '/accidents', label: 'همهٔ میزهای کار', icon: 'desk', show: desks.length > 1, match: (p) => p === '/accidents' },
    { href: '/workshop', label: 'برنامه و گزارش تعمیر', icon: 'wrench', show: can('workshop.read'), match: (p) => p === '/workshop' },
    { href: '/daily-reports', label: 'گزارش‌های روزانه', icon: 'upload', show: can('daily_reports.upload') || can('daily_reports.apply') },
    { href: '/stock', label: 'موجودی و رزرو', icon: 'layers', show: can('stock.read') },
    { href: '/emdad', label: 'پیگیری امداد ویژه', icon: 'truck', show: can('emdad.read') },
    { href: '/', label: 'داشبورد شمارشی', icon: 'chart', show: can('dashboard.read'), match: (p) => p === '/' },
  ];
  const planned = me.modules.filter((m) => m.status === 'planned');
  const link = (i: NavItem) => {
    if (!i.show) return null;
    const active = i.match ? i.match(pathname) : pathname === i.href;
    return <Link key={i.href + i.label} href={i.href} aria-current={active ? 'page' : undefined}><AppIcon name={i.icon} /><span>{i.label}</span></Link>;
  };
  async function logout() { await api('/auth/logout', { method: 'POST' }).catch(() => {}); router.replace('/login'); }
  const back = backTarget(pathname, home);

  return (
    <div className={`shell app-shell${dark ? ' shell-dark' : ''}`}>
      <a className="skip-link" href="#page-content">رفتن به محتوای صفحه</a>
      {open && mobile && <button type="button" className="nav-scrim" aria-label="بستن منو" onClick={() => { setOpen(false); menu.current?.focus(); }} />}
      <aside className={`sidebar app-side${open ? ' open' : ''}`} aria-label="منوی اصلی" inert={mobile && !open}>
        <Link href={home} className="brand-mark" aria-label="Manage by HEDAX، میز کار">
          <span className="brand-slashes" aria-hidden="true"><i /><i /></span>
          <span className="brand-word">Manage</span>
          <span className="brand-by">by <b>HEDAX</b></span>
        </Link>
        <nav className="side-nav" id="main-navigation" aria-label="بخش‌های منیج">{primary.map(link)}</nav>
        {(more.some((i) => i.show) || planned.length > 0) && (
          <details className="side-more" open={more.some((i) => i.show && (i.match ? i.match(pathname) : pathname === i.href))}>
            <summary><AppIcon name="list" /><span>ابزارهای بیشتر</span></summary>
            <nav className="side-nav sub" aria-label="ابزارهای بیشتر">
              {more.map(link)}
              {planned.map((m) => <Link key={m.key} href={`/modules/${m.key}`} className="planned" aria-current={pathname === `/modules/${m.key}` ? 'page' : undefined}><AppIcon name="box" /><span>{MODULE_LABELS[m.key]}</span><span className="tag-dev">در دست توسعه</span></Link>)}
            </nav>
          </details>
        )}
        <div className="side-foot">{me.tenant.name}</div>
      </aside>
      <div className="main">
        <header className="app-top no-print">
          <button ref={menu} type="button" className="icon-btn menu-btn" aria-controls="main-navigation" aria-expanded={open} onClick={() => setOpen(!open)}>
            <AppIcon name={open ? 'close' : 'menu'} /><span>منو</span>
          </button>
          {!technicianOnly && can('case.read') && <GlobalSearch />}
          <div className="top-end">
            <span className="top-tenant" title="نمایندگی">{me.tenant.name}</span>
            <Link href="/reminders" className="icon-btn bell" aria-label={unseen ? `تذکرها و اعلان‌ها، ${unseen.toLocaleString('fa-IR')} مورد تازه` : 'تذکرها و اعلان‌ها'} aria-current={pathname === '/reminders' ? 'page' : undefined}>
              <AppIcon name="bell" />{unseen > 0 && <span className="dot" aria-hidden="true" />}
            </Link>
            <details className="account-menu">
              <summary aria-label={`حساب ${me.displayName}`}><span className="avatar" aria-hidden="true">{initials(me.displayName)}</span><span className="who">{me.displayName}</span><AppIcon name="chevron-down" className="chev" /></summary>
              <div className="account-pop" role="group" aria-label="حساب کاربری">
                <div className="account-head"><strong>{me.displayName}</strong><span>{me.isOwner ? 'مالک سامانه' : me.roles.map((r) => ROLE_LABELS[r]).join('، ')}</span><span>{me.tenant.name}</span></div>
                <Link href="/reminders">تذکرهای من</Link>
                <InstallButton />
                <button type="button" className="m-btn2-s" onClick={logout}><AppIcon name="logout" />خروج</button>
              </div>
            </details>
          </div>
        </header>
        {me.environment !== 'production' && <div className="env-banner" role="note">نسخهٔ آزمایشی — داده‌های این محیط ساختگی‌اند و جای سامانه‌های رسمی را نمی‌گیرند.</div>}
        <main className="page" id="page-content" tabIndex={-1}>
          <NotificationBar />
          {back && <BackLink href={back.href} label={back.label} />}
          <PageActions />
          {children}
        </main>
      </div>
    </div>
  );
}

/** Every page has a way back (spec §12): to the case for its edit page, otherwise to the own desk. Pages with their own back link and the desks themselves get none. */
export function backTarget(pathname: string, home: string): { href: string; label: string } | null {
  if (pathname === home || pathname === '/launch' || pathname === '/control-room') return null;
  // Sidebar destinations are top-level places: no «back» link above them.
  if (['/reminders', '/reports/people', '/workshop/technician/work', '/parts', '/settings', '/reports', '/cases'].includes(pathname)) return null;
  if (/^\/cases\/(?!new$|import$)[^/]+$/.test(pathname)) return null;
  const edit = /^\/cases\/([^/]+)\/edit$/.exec(pathname);
  if (edit) return { href: `/cases/${edit[1]}`, label: 'بازگشت به پرونده' };
  if (['/users', '/workshop/settings', '/reference-data', '/daily-reports'].includes(pathname)) return { href: '/settings', label: 'بازگشت به تنظیمات' };
  return { href: home, label: 'بازگشت به میز کار' };
}

const PAGE_TITLES: [RegExp, string][] = [[/^\/launch$/, 'انتخاب میز کار'], [/^\/control-room/, 'اتاق کنترل'], [/^\/parts/, 'میز قطعات'], [/^\/settings/, 'تنظیمات'], [/^\/$/, 'داشبورد'], [/^\/workshop\/settings/, 'تقویم و جایگاه‌ها'], [/^\/workshop\/technician/, 'کارهای من'], [/^\/workshop/, 'برنامه و گزارش تعمیر'], [/^\/accidents/, 'میز کار'], [/^\/cases\/new/, 'پذیرش خودرو'], [/^\/cases\/import/, 'ورود خودروها از اکسل'], [/^\/cases\/[^/]+/, 'پوشهٔ پرونده'], [/^\/cases/, 'پرونده‌ها'], [/^\/reports/, 'گزارش‌ها'], [/^\/daily-reports/, 'گزارش‌های روزانه'], [/^\/stock/, 'موجودی روزانه و رزرو'], [/^\/emdad/, 'پیگیری امداد ویژه'], [/^\/users/, 'کارکنان'], [/^\/reference-data/, 'اطلاعات پایه'], [/^\/reminders/, 'تذکرها']];
/** Browser tab title for each area, so several open tabs can be told apart. */
export function pageTitle(pathname: string): string {
  const module = /^\/modules\/([^/]+)/.exec(pathname)?.[1];
  if (module) return MODULE_LABELS[module as ModuleKey] ?? 'واحدها';
  return PAGE_TITLES.find(([re]) => re.test(pathname))?.[1] ?? 'Manage';
}

/** First letters of the first two words of a display name, for the avatar. */
export function initials(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('‌') || '؟';
}

/** Search from any page: plate, name, case or admission number. Opens the filtered case list. Ctrl+K (or "/") focuses it. */
function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !e.ctrlKey && !e.metaKey && !t.closest('input,textarea,select,[contenteditable="true"]'))) { e.preventDefault(); input.current?.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);
  return (
    <form role="search" className="global-search top-search" onSubmit={(e) => { e.preventDefault(); const v = q.trim(); if (!v) return; router.push(`/cases?q=${encodeURIComponent(v)}`); setQ(''); }}>
      <label className="sr-only" htmlFor="global-search">جست‌وجوی سریع از هر صفحه</label>
      <AppIcon name="search" />
      <input ref={input} id="global-search" type="search" value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} placeholder="جست‌وجوی پرونده، پلاک یا نام مشتری…" autoComplete="off" />
      <kbd aria-hidden="true">Ctrl K</kbd>
    </form>
  );
}
