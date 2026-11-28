'use client';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import { NON_CONSUMPTION_LABELS, NON_CONSUMPTION_REASONS, TECHNICAL_REASONS, type SpecialAidFunnel, type SpecialAidSummary } from '@manage/shared';
import { errorMessage, fetcher } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { faNum, formatJalali } from '@/lib/format';
import { SpecialAidTabs } from '@/components/SpecialAid';

/** Read-only management view of the module: no routine operator task is asked of the manager. */
export default function SpecialAidReports() {
  const { can } = useAuth();
  const [range, setRange] = useState<keyof typeof RANGES>('all');
  const from = RANGES[range].days ? new Date(Date.now() - RANGES[range].days! * 86_400_000).toISOString().slice(0, 10) : null;
  const { data: s, error } = useSWR<SpecialAidSummary>(can('special_aid.report') ? `/special-aid/summary${from ? `?from=${from}` : ''}` : null, fetcher, { keepPreviousData: true });
  if (!can('special_aid.report')) return <div className="stack"><SpecialAidTabs /><div className="callout"><h1>گزارش‌های امداد ویژه</h1><p>برای این بخش مجوز ندارید.</p></div></div>;
  const pct = (a: number, b: number) => (b ? `${faNum(Math.round((a / b) * 100))}٪` : '—');
  const kpi = (label: string, value: string, href?: string) => href
    ? <Link className="kpi" href={href}><span className="kpi-value">{value}</span><span className="kpi-label">{label}</span></Link>
    : <div className="kpi" role="group" aria-label={label}><span className="kpi-value">{value}</span><span className="kpi-label">{label}</span></div>;
  return (
    <div className="stack">
      <header className="unit-header"><div><h1>گزارش مدیریتی امداد ویژه</h1><p className="muted">فقط نمایش؛ هر عدد به فهرست همان خودروها می‌رود. تقصیر شخصی تعیین نمی‌شود.</p></div></header>
      <SpecialAidTabs />
      {error && <p className="callout callout-red small" role="alert">{errorMessage(error)}</p>}
      {!s && !error && <p className="muted small" role="status">در حال خواندن…</p>}
      {s && <>
        <div className="row funnel-range" role="group" aria-label="بازهٔ زمانی قیف">
          <span className="small muted">بازه (روز ثبت امداد):</span>
          {(Object.keys(RANGES) as (keyof typeof RANGES)[]).map((k) => <button key={k} type="button" className={`chip${range === k ? ' active' : ''}`} aria-pressed={range === k} onClick={() => setRange(k)}>{RANGES[k].label}</button>)}
        </div>
        <Funnel f={s.funnel} />
        <section className="kpis" aria-label="شاخص‌ها">
          {kpi('کل درخواست‌ها', faNum(s.total), '/special-aid/vehicles')}
          {kpi('در حال تأمین', faNum(s.pending), '/special-aid/supply')}
          {kpi('رسیده و مصرف‌نشده', faNum(s.arrivedUnused), '/special-aid/vehicles')}
          {kpi('پایان مهلت ۲۰ روز کاری', faNum(s.deadline.expired), '/special-aid/vehicles?view=expired')}
          {kpi('رزرو فعال برای خودرو', faNum(s.reserved))}
          {kpi('رزرو آزادشده', faNum(s.released))}
          {kpi('نصب‌شده', faNum(s.installed))}
          {kpi('میانگین روز تأمین (رسمی)', s.averageSupplyDays == null ? '—' : faNum(s.averageSupplyDays))}
          {kpi('اطلاع به‌موقع به مشتری', pct(s.contactCompliance.onTime, s.contactCompliance.due))}
          {kpi('مسئلهٔ فنی حل‌نشده', faNum(s.unresolvedTechnical))}
          {kpi('مانده در مرحلهٔ خرید (۱۴+ روز بدون تغییر)', faNum(s.stalledSupply), '/special-aid/supply')}
          {kpi('شمارهٔ فنی اشتباه', faNum(s.reasons.wrong_part_number))}
          {kpi('تشخیص فنی اشتباه', faNum(s.reasons.wrong_diagnosis))}
          {kpi('عدم مراجعهٔ مشتری', faNum(s.reasons.customer_no_show))}
          {kpi('تذکر رسمی ثبت‌شده', faNum(s.warningsIssued), '/special-aid/feedback')}
          {kpi('بازخورد بدون تأیید دریافت', faNum(s.feedbackOpen), '/special-aid/feedback')}
        </section>
        <section className="panel" aria-labelledby="aid-reasons"><div className="panel-head"><h2 id="aid-reasons">علت مصرف‌نشدن قطعه</h2></div><div className="panel-body">
          <table className="table static"><thead><tr><th>علت</th><th>تعداد</th><th>نوع</th></tr></thead><tbody>{NON_CONSUMPTION_REASONS.map((r) => <tr key={r}><td>{NON_CONSUMPTION_LABELS[r]}</td><td>{faNum(s.reasons[r])}</td><td className="small">{TECHNICAL_REASONS.includes(r) ? 'فنی' : 'مشتری یا تأمین'}</td></tr>)}</tbody></table>
        </div></section>
        <section className="panel" aria-labelledby="aid-weekly"><div className="panel-head"><h2 id="aid-weekly">روند هفتگی (هشت هفتهٔ اخیر)</h2></div><div className="panel-body">
          {s.weekly.length ? <div className="table-scroll"><table className="table static"><thead><tr><th>هفتهٔ شروع</th><th>ثبت امداد</th><th>رسید</th></tr></thead><tbody>{s.weekly.map((w) => <tr key={w.week}><td>{formatJalali(`${w.week}T12:00:00Z`)}</td><td>{faNum(w.registered)}</td><td>{faNum(w.arrived)}</td></tr>)}</tbody></table></div> : <p className="muted small">در هشت هفتهٔ اخیر داده‌ای نیست.</p>}
        </div></section>
      </>}
    </div>
  );
}

const RANGES = { all: { label: 'همه', days: null }, d30: { label: '۳۰ روز اخیر', days: 30 }, d90: { label: '۹۰ روز اخیر', days: 90 }, d180: { label: '۶ ماه اخیر', days: 180 } } as const;

/** One stage: count, share of the first stage and a bar; the whole row opens the matching vehicles. */
function Stage({ label, value, base, href, tone }: { label: string; value: number; base: number; href?: string; tone?: 'warn' | 'ok' }) {
  const share = base ? Math.round((value / base) * 100) : 0;
  const body = <>
    <span className="funnel-label">{label}</span>
    <span className="funnel-bar" aria-hidden="true"><i style={{ inlineSize: `${Math.max(share, value ? 2 : 0)}%` }} /></span>
    <span className="funnel-num"><b>{faNum(value)}</b><small>{base ? `${faNum(share)}٪` : '—'}</small></span>
  </>;
  return href ? <Link className={`funnel-stage${tone ? ` tone-${tone}` : ''}`} href={href}>{body}</Link> : <div className={`funnel-stage${tone ? ` tone-${tone}` : ''}`}>{body}</div>;
}

/** Owner, 2026-11-23: how many customers got their part and came, and how many parts were really installed. */
function Funnel({ f }: { f: SpecialAidFunnel }) {
  const c = f.customers, p = f.parts;
  const v = (view: string) => `/special-aid/vehicles?view=${view}`;
  return (
    <section className="funnel-grid" aria-label="قیف امداد ویژه">
      <article className="panel funnel">
        <div className="panel-head"><h2>مشتری‌ها (خودروها)</h2><p className="small muted">از ثبت امداد تا نصب، بر اساس تعداد خودرو</p></div>
        <div className="panel-body">
          <Stage label="امداد ثبت‌شده" value={c.registered} base={c.registered} href={v('all')} />
          <Stage label="قطعه رسیده" value={c.arrived} base={c.registered} href={v('arrived')} />
          <Stage label="به مشتری اطلاع داده شده" value={c.informed} base={c.registered} />
          <Stage label="دعوت یا نوبت هماهنگ‌شده" value={c.invited} base={c.registered} />
          <Stage label="مشتری مراجعه کرده" value={c.attended} base={c.registered} />
          <Stage label="قطعه نصب شده" value={c.installed} base={c.registered} tone="ok" />
          {(c.arrivedNotInformed > 0 || c.pastDeadlineNoVisit > 0 || c.releasedNoShow > 0) && <div className="funnel-gaps" role="note">
            {c.arrivedNotInformed > 0 && <Link href={v('action')}><b>{faNum(c.arrivedNotInformed)}</b> خودرو: قطعه رسیده ولی هنوز به مشتری اطلاع داده نشده</Link>}
            {c.pastDeadlineNoVisit > 0 && <Link href={v('expired')}><b>{faNum(c.pastDeadlineNoVisit)}</b> خودرو: مهلت ۲۰ روز کاری از رسیدن قطعه تمام شده و مشتری نیامده</Link>}
            {c.releasedNoShow > 0 && <span><b>{faNum(c.releasedNoShow)}</b> خودرو: مشتری نیامد و رزرو آزاد شد</span>}
          </div>}
        </div>
      </article>
      <article className="panel funnel">
        <div className="panel-head"><h2>قطعه‌ها</h2><p className="small muted">از درخواست تا نصب، بر اساس تعداد قطعه</p></div>
        <div className="panel-body">
          <Stage label="درخواست‌شده" value={p.requested} base={p.requested} href={v('all')} />
          <Stage label="هنوز نرسیده (در حال تأمین)" value={p.pending} base={p.requested} href="/special-aid/supply" />
          <Stage label="رسیده" value={p.arrived} base={p.requested} href={v('arrived')} />
          <Stage label="رسیده و هنوز مصرف‌نشده" value={p.arrivedOpen} base={p.requested} href={v('arrived')} tone="warn" />
          <Stage label="نصب‌شده روی خودروی همان مشتری" value={p.installed} base={p.requested} tone="ok" />
          <Stage label="آزادشده برای مشتری دیگر" value={p.releasedToOthers} base={p.requested} />
        </div>
      </article>
    </section>
  );
}
