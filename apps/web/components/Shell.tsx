'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MODULE_LABELS, ROLE_LABELS, type ModuleKey } from '@manage/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { visibleWorkspaces, workspaceHome } from '@/lib/workspaces';
import { AppIcon, type IconName } from './AppIcon';
import { BackLink } from './BackLink';
import { NotificationCenter } from './NotificationCenter';
import { PageActions } from './PageActions';
import { InstallButton } from './InstallApp';
import { ReleaseNotice, VersionChip } from './ReleaseNotice';

// App shell of the approved design (owner references, Nov 2026): brand and five
// destinations on the inline-start side, a top bar with the global search (Ctrl+K),
// reminders and the account menu. The control room switches the shell to the dark space.
interface NavItem { href: string; label: string; icon: IconName; show: boolean; match?: (p: string) => boolean; planned?: boolean }

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
        { href: '/settings', label: 'تنظیمات', icon: 'gear', show: me.isOwner || can('user.manage') || can('calendar.manage') || can('workshop.manage') || can('settings.manage') || can('reference.parts.read') || can('daily_reports.upload') || can('workshop.read') || can('integration.manage'), match: (p) => ['/settings', '/users', '/workshop/settings', '/reference-data', '/daily-reports'].includes(p) },
      ];
  const more: NavItem[] = technicianOnly ? [] : [
    { href: '/workshop', label: 'برنامه و گزارش تعمیر', icon: 'wrench', show: can('workshop.read'), match: (p) => p === '/workshop' },
    { href: '/daily-reports', label: 'گزارش‌های روزانه', icon: 'upload', show: can('daily_reports.upload') || can('daily_reports.apply') },
    { href: '/stock', label: 'موجودی و رزرو', icon: 'layers', show: can('stock.read') },
    { href: '/emdad', label: 'پیگیری امداد ویژه', icon: 'truck', show: can('emdad.read') },
    { href: '/', label: 'داشبورد شمارشی', icon: 'chart', show: can('dashboard.read'), match: (p) => p === '/' },
  ];
  // Side menu (owner, 2026-11-19 — final structure). Every link is an existing route with its
  // existing permission; nothing duplicates the person's own workspace, and unfinished modules
  // are grouped in the owner-only roadmap. Only one group is open at a time.
  const planned = me.modules.filter((m) => m.status === 'planned');
  const plannedLink = (key: ModuleKey, icon: IconName): NavItem => ({ href: `/modules/${key}`, label: MODULE_LABELS[key], icon, show: !!me.isOwner && planned.some((m) => m.key === key), planned: true });
  const byHref = (href: string) => [...primary, ...more].find((i) => i.href === href)!;
  const manager = can('report.manager');
  const reports = byHref('/reports');
  // «پذیرش و ترخیص» (owner, 2026-11-23; spec section 26): only when the server flag made the
  // module active and only with reception.read (owner and system administrator during the trial).
  const receptionActive = me.modules.some((m) => m.key === 'reception' && m.status === 'active');
  const groups: NavGroupDef[] = technicianOnly ? [] : [
    { key: 'reception', label: 'پذیرش و ترخیص', icon: 'file', items: [
      { href: '/reception', label: 'پذیرش‌های امروز', icon: 'calendar', show: receptionActive && can('reception.read'), match: (p) => p === '/reception' },
      { href: '/reception/open', label: 'پذیرش‌های باز', icon: 'folder', show: receptionActive && can('reception.read'), match: (p) => p === '/reception/open' || (/^\/reception\/[^/]+$/.test(p) && p !== '/reception/released') },
      { href: '/reception/released', label: 'ترخیص‌شده‌ها', icon: 'check', show: receptionActive && can('reception.read'), match: (p) => p === '/reception/released' },
      { href: '/reception/night', label: 'لیست شب', icon: 'clock', show: receptionActive && can('reception.read'), match: (p) => p === '/reception/night' },
    ] },
    { key: 'accident', label: 'مدیریت تصادفات', icon: 'nav-car', items: [
      { href: '/accidents/expert', label: 'خودروهای تصادفی', icon: 'car', show: desks.some((w) => w.key === 'expert') && home !== '/accidents/expert', match: (p) => p === '/accidents/expert' },
      { ...byHref('/cases'), label: 'پرونده و کارشناسی', match: (p) => p.startsWith('/cases') && p !== '/cases/new' },
      { href: '/cases/new', label: 'پذیرش خودرو', icon: 'add', show: can('case.create'), match: (p) => p === '/cases/new' },
      { ...reports, label: 'گزارش‌ها و فرم‌های تصادفات', show: reports.show && !manager },
    ] },
    { key: 'parts', label: 'انبار قطعات یدکی', icon: 'nav-package', items: [
      { ...byHref('/parts'), label: 'درخواست و تأمین قطعات', show: byHref('/parts').show && home !== '/accidents/parts', match: (p) => p === '/parts' },
      { ...byHref('/stock'), label: 'موجودی و رزرو' },
      { ...byHref('/emdad'), label: 'امداد ویژه تصادفات' },
      { ...byHref('/daily-reports'), label: 'گزارش‌های روزانهٔ انبار' },
    ] },
    // Standalone Special Aid follow-up (owner, 2026-11-22; spec section 25): its own group, nothing else moved.
    { key: 'special_aid', label: 'پیگیری امداد ویژه', icon: 'truck', items: [
      { href: '/special-aid', label: 'کارهای امروز', icon: 'calendar', show: can('special_aid.read') && home !== '/special-aid', match: (p) => p === '/special-aid' },
      { href: '/special-aid/vehicles', label: 'پرونده خودروها', icon: 'folder', show: can('special_aid.read'), match: (p) => p.startsWith('/special-aid/vehicles') },
      { href: '/special-aid/supply', label: 'پیگیری تأمین قطعات', icon: 'truck', show: can('special_aid.supply'), match: (p) => p === '/special-aid/supply' },
      { href: '/special-aid/reports', label: 'گزارش‌ها', icon: 'chart', show: can('special_aid.report'), match: (p) => p === '/special-aid/reports' || p === '/special-aid/feedback' },
    ] },
    { key: 'workshop', label: 'مدیریت تعمیرگاه', icon: 'nav-calendar', items: [
      { ...byHref('/workshop'), label: 'برنامه و پیگیری مراحل تعمیر' },
    ] },
    { key: 'manager', label: 'مدیر خدمات', icon: 'nav-chart', items: [
      { ...byHref('/control-room'), label: 'داشبورد مدیر خدمات', show: manager && home !== '/accidents/manager' && home !== '/accidents/owner' },
      { ...reports, label: 'گزارش‌های مدیریتی', show: reports.show && manager },
      { ...byHref('/'), label: 'آمار پرونده‌ها' },
    ] },
    { key: 'settings', label: 'تنظیمات سیستم', icon: 'nav-settings', items: [
      { ...byHref('/settings'), label: 'تنظیمات سیستم', match: (p) => ['/settings', '/settings/reports', '/settings/pulse', '/workshop/settings', '/reference-data'].includes(p) },
      { href: '/users', label: 'کاربران و دسترسی‌ها', icon: 'team', show: me.isOwner || can('user.manage'), match: (p) => p === '/users' },
    ] },
    { key: 'roadmap', label: 'نقشهٔ راه', icon: 'layers', items: [
      plannedLink('parts_inventory', 'box'),
      plannedLink('periodic_service', 'calendar'),
      plannedLink('workforce', 'team'),
      plannedLink('reception', 'file'),
      plannedLink('customer_comms', 'send'),
      plannedLink('finance', 'money'),
      plannedLink('warranty', 'shield'),
      plannedLink('multi_dealership', 'grid'),
      plannedLink('integrations', 'layers'),
    ] },
  ];
  const isActive = (i: NavItem) => (i.match ? i.match(pathname) : pathname === i.href);
  const visibleGroups = groups.map((g) => ({ ...g, items: g.items.filter((i) => i.show) })).filter((g) => g.items.length);
  const activeGroup = visibleGroups.find((g) => g.items.some(isActive))?.key ?? null;
  const [openGroup, setOpenGroup] = useState<string | null>(activeGroup);
  // Navigating keeps the group of the current page open (and only that one).
  useEffect(() => { setOpenGroup(activeGroup); }, [activeGroup]);
  const [compact, setCompact] = useState(false);
  useEffect(() => { try { setCompact(localStorage.getItem('manage-nav-compact') === '1'); } catch { /* storage unavailable */ } }, []);
  const toggleCompact = () => { const next = !compact; setCompact(next); try { localStorage.setItem('manage-nav-compact', next ? '1' : '0'); } catch { /* storage unavailable */ } };
  const workspaceItem: NavItem = technicianOnly ? primary[0]! : { href: home, label: 'میزکار من', icon: 'nav-workspace', show: true, match: (p) => p === home };

  const link = (i: NavItem) => {
    if (!i.show) return null;
    const active = isActive(i);
    return <Link key={i.href + i.label} href={i.href} className={i.planned ? 'planned' : undefined} aria-current={active ? 'page' : undefined} title={compact ? i.label : undefined}><AppIcon name={i.icon} /><span>{i.label}</span>{i.planned && <span className="tag-dev">در دست توسعه</span>}</Link>;
  };
  async function logout() { await api('/auth/logout', { method: 'POST' }).catch(() => {}); router.replace('/login'); }
  const back = backTarget(pathname, home, desks.length > 1);

  return (
    <div className={`shell app-shell${compact ? ' side-compact' : ''}`}>
      <a className="skip-link" href="#page-content">رفتن به محتوای صفحه</a>
      {open && mobile && <button type="button" className="nav-scrim" aria-label="بستن منو" onClick={() => { setOpen(false); menu.current?.focus(); }} />}
      <aside className={`sidebar app-side${open ? ' open' : ''}`} aria-label="منوی اصلی" inert={mobile && !open}>
        <Link href={home} className="brand-mark" aria-label="Manage by HEDAX، میز کار">
          <span className="brand-slashes" aria-hidden="true"><i /><i /></span>
          <span className="brand-word">Manage</span>
          <span className="brand-by">by <b>HEDAX</b></span>
        </Link>
        <nav className="side-nav" id="main-navigation" aria-label="بخش‌های منیج">
          {technicianOnly ? primary.map(link) : link(workspaceItem)}
          {desks.length > 1 && link({ href: '/launch', label: 'انتخاب میزکار', icon: 'desk', show: true })}
          {visibleGroups.map((g) => (
            <NavGroup key={g.key} id={g.key} label={g.label} icon={g.icon} open={!compact && openGroup === g.key} active={activeGroup === g.key}
              onToggle={() => { if (compact) { setCompact(false); setOpenGroup(g.key); } else setOpenGroup(openGroup === g.key ? null : g.key); }}>
              {g.items.map(link)}
            </NavGroup>
          ))}
        </nav>
        {!technicianOnly && <button type="button" className="nav-compact" aria-pressed={compact} onClick={toggleCompact} title={compact ? 'باز کردن منو' : 'جمع کردن منو'}><AppIcon name={compact ? 'arrow-left' : 'arrow-right'} /><span>{compact ? 'باز کردن منو' : 'جمع کردن منو'}</span></button>}
        <div className="side-foot">{me.tenant.name}</div>
      </aside>
      <div className="main">
        <header className="app-top no-print">
          <button ref={menu} type="button" className="icon-btn menu-btn" aria-controls="main-navigation" aria-expanded={open} onClick={() => setOpen(!open)}>
            <AppIcon name={open ? 'close' : 'menu'} /><span>منو</span>
          </button>
          {!technicianOnly && can('case.read') && <GlobalSearch />}
          <div className="top-end">
            <VersionChip />
            <span className="top-tenant" title="نمایندگی">{me.tenant.name}</span>
            <NotificationCenter />
            <details className="account-menu">
              <summary aria-label={`حساب ${me.displayName}`}><span className="avatar" aria-hidden="true">{initials(me.displayName)}</span><span className="who">{me.displayName}</span><AppIcon name="chevron-down" className="chev" /></summary>
              <div className="account-pop" role="group" aria-label="حساب کاربری">
                <div className="account-head"><strong>{me.displayName}</strong><span>{me.isOwner ? 'مالک سامانه' : me.roles.map((r) => ROLE_LABELS[r]).join('، ')}</span><span>{me.tenant.name}</span></div>
                <Link href="/reminders">فیدبک‌های من</Link>
                <InstallButton />
                <button type="button" className="m-btn2-s" onClick={logout}><AppIcon name="logout" />خروج</button>
              </div>
            </details>
          </div>
        </header>
        {me.environment !== 'production' && <div className="env-banner" role="note">نسخهٔ آزمایشی — داده‌های این محیط ساختگی‌اند و جای سامانه‌های رسمی را نمی‌گیرند.</div>}
        {/* Outside <main>: a page's own actions stay the only buttons in its content. */}
        <div className="release-slot"><ReleaseNotice /></div>
        <main className="page" id="page-content" tabIndex={-1}>
          {back && <BackLink href={back.href} label={back.label} />}
          <PageActions />
          {children}
        </main>
      </div>
    </div>
  );
}

/** Every page has a way back (spec §12): to the case for its edit page, otherwise to the own desk. Pages with their own back link and the desks themselves get none. */
interface NavGroupDef { key: string; label: string; icon: IconName; items: NavItem[] }

/** A module heading of the side menu (accordion: the parent keeps one group open). */
function NavGroup({ id, label, icon, open, active, onToggle, children }: { id: string; label: string; icon: IconName; open: boolean; active: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className={`nav-group${open ? ' open' : ''}${active ? ' active' : ''}`}>
      <button type="button" className="nav-group-head" aria-expanded={open} aria-controls={`nav-${id}`} onClick={onToggle} title={label}>
        <AppIcon name={icon} /><span>{label}</span><AppIcon name="chevron-down" className="chev" />
      </button>
      {open && <div className="nav-group-items" id={`nav-${id}`} role="group" aria-label={label}>{children}</div>}
    </div>
  );
}

export function backTarget(pathname: string, home: string, canChooseDesk = false): { href: string; label: string } | null {
  if (pathname === home || pathname === '/launch' || pathname === '/control-room') return null;
  if (canChooseDesk && /^\/accidents\/[^/]+$/.test(pathname)) return { href: '/launch', label: 'بازگشت به انتخاب میزکار' };
  // Sidebar destinations are top-level places: no «back» link above them.
  if (['/reminders', '/reports/people', '/workshop/technician/work', '/parts', '/settings', '/reports', '/cases'].includes(pathname)) return null;
  // Special Aid pages carry their own workspace tabs; a dossier goes back to the vehicle list.
  if (/^\/special-aid\/vehicles\/[^/]+$/.test(pathname)) return { href: '/special-aid/vehicles', label: 'بازگشت به پرونده خودروها' };
  if (pathname.startsWith('/special-aid')) return null;
  // Reception lists carry their own tabs; a reception folder goes back to the open admissions.
  if (/^\/reception\/(?!open$|released$|night$)[^/]+$/.test(pathname)) return { href: '/reception/open', label: 'بازگشت به پذیرش‌ها' };
  if (pathname.startsWith('/reception')) return null;
  if (/^\/cases\/(?!new$|import$)[^/]+$/.test(pathname)) return null;
  const edit = /^\/cases\/([^/]+)\/edit$/.exec(pathname);
  if (edit) return { href: `/cases/${edit[1]}`, label: 'بازگشت به پرونده' };
  if (['/users', '/settings/reports', '/settings/pulse', '/workshop/settings', '/reference-data', '/daily-reports'].includes(pathname)) return { href: '/settings', label: 'بازگشت به تنظیمات' };
  return { href: home, label: 'بازگشت به میز کار' };
}

const PAGE_TITLES: [RegExp, string][] = [[/^\/reception\/open$/, 'پذیرش‌های باز'], [/^\/reception\/released$/, 'ترخیص‌شده‌ها'], [/^\/reception\/[^/]+$/, 'پروندهٔ پذیرش'], [/^\/reception$/, 'پذیرش‌های امروز'], [/^\/settings\/pulse/, 'منیج پالس'], [/^\/special-aid\/vehicles\/[^/]+/, 'پروندهٔ امداد ویژه'], [/^\/special-aid\/vehicles/, 'پرونده خودروها'], [/^\/special-aid\/supply/, 'پیگیری تأمین قطعات'], [/^\/special-aid\/reports/, 'گزارش‌های امداد ویژه'], [/^\/special-aid\/feedback/, 'بازخورد فنی و تذکر'], [/^\/special-aid/, 'کارهای امروز امداد ویژه'], [/^\/launch$/, 'انتخاب میز کار'], [/^\/control-room/, 'اتاق کنترل'], [/^\/parts/, 'میز قطعات'], [/^\/settings\/reports/, 'مرکز گزارش‌های کسب‌وکار'], [/^\/settings/, 'تنظیمات'], [/^\/$/, 'داشبورد'], [/^\/workshop\/settings/, 'تقویم و جایگاه‌ها'], [/^\/workshop\/technician/, 'کارهای من'], [/^\/workshop/, 'برنامه و گزارش تعمیر'], [/^\/accidents/, 'میز کار'], [/^\/cases\/new/, 'پذیرش خودرو'], [/^\/cases\/import/, 'ورود خودروها از اکسل'], [/^\/cases\/[^/]+/, 'پوشهٔ پرونده'], [/^\/cases/, 'پرونده‌ها'], [/^\/reports/, 'گزارش‌ها'], [/^\/daily-reports/, 'گزارش‌های روزانه'], [/^\/stock/, 'موجودی روزانه و رزرو'], [/^\/emdad/, 'پیگیری امداد ویژه'], [/^\/users/, 'کارکنان'], [/^\/reference-data/, 'اطلاعات پایه'], [/^\/reminders/, 'فیدبک‌ها']];
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
