'use client';

import Link from 'next/link';
import useSWR from 'swr';
import {
  BLOCKER_REASON_LABELS,
  CASE_STAGES,
  COVERAGE_LABELS,
  STAGE_LABELS,
  type DashboardSummary,
} from '@manage/shared';
import { fetcher } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { WorkspaceLauncher } from '@/components/WorkspaceLauncher';
import { faNum, formatJalali } from '@/lib/format';

interface Attention {
  flag: string;
  count: number;
  title: string;
  detail: string;
  tone: 'red' | 'amber' | 'green';
}

export default function DashboardPage() {
  const { can } = useAuth();
  const { data, error } = useSWR<DashboardSummary>(can('dashboard.read') ? '/dashboard' : null, fetcher, {
    refreshInterval: 60_000,
  });

  if (!can('dashboard.read')) {
    return (
      <div className="stack"><WorkspaceLauncher/><div className="callout callout-blue">
        نقش شما به داشبورد عملیات دسترسی ندارد. از منوی کناری بخش مربوط به خود را انتخاب کنید.
      </div></div>
    );
  }
  if (error) return <div className="callout callout-red">داشبورد بارگذاری نشد. صفحه را تازه کنید.</div>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;

  const pipelineStages = CASE_STAGES.filter((s) => s !== 'delivered');
  const stageCount = (s: string) => data.byStage.find((x) => x.stage === s)?.count ?? 0;
  const maxStage = Math.max(1, ...pipelineStages.map(stageCount));

  const attention: Attention[] = [
    { flag: 'overdue', count: data.overdue, title: 'مهلت گذشته', detail: 'مهلت رسمی یا پیش‌بینی تحویل سپری شده است', tone: 'red' },
    { flag: 'blocked', count: data.blockedCases, title: 'دارای مانع رفع‌نشده', detail: `${faNum(data.staleBlockers)} مانع بیش از ۲۴ ساعت بدون پیگیری`, tone: 'red' },
    { flag: 'due_soon', count: data.dueSoon, title: 'تحویل در ۴۸ ساعت آینده', detail: 'برای تحویل به‌موقع پیگیری شود', tone: 'amber' },
    { flag: 'unassigned', count: data.unassigned, title: 'بدون مسئول', detail: 'مسئول پرونده تعیین نشده است', tone: 'amber' },
    { flag: 'needs_completion', count: data.needsCompletion, title: 'نیازمند تکمیل اطلاعات', detail: 'اطلاعات پایه یا پوشش ناقص است', tone: 'amber' },
    { flag: 'awaiting_authorization', count: data.awaitingAuthorization, title: 'منتظر تأیید قیمت خرید بیرون', detail: 'هماهنگی قیمت بازار با کارت طلایی، بیمه یا مشتری باقی مانده است', tone: 'amber' },
    { flag: 'parts_overdue', count: data.partsOverdue, title: 'قطعه با دیرکرد', detail: 'زمان پیش‌بینی رسیدن قطعه گذشته است', tone: 'red' },
    { flag: 'parts_to_order', count: data.partsToOrder, title: 'قطعه سفارش‌نشده', detail: 'نیاز ثبت شده ولی سفارش یا رزرو نشده است', tone: 'amber' },
    { flag: 'finance_pending', count: data.financePending, title: 'منتظر تصمیم یا دریافت مالی', detail: 'پیش‌پرداخت یا استثنا منتظر مدیر یا صندوق است', tone: 'amber' },
    { flag: 'ready', count: data.readyForDelivery, title: 'آماده تحویل', detail: 'با مشتری برای تحویل هماهنگ شود', tone: 'green' },
  ];

  const maxReason = Math.max(1, ...data.openBlockersByReason.map((r) => r.count));

  return (
    <div className="stack">
      <header className="page-head entry-welcome">
        <div>
          <span className="entry-line" aria-hidden="true" />
          <h1>وضعیت تعمیرگاه</h1>
          <p className="muted small">
            {faNum(data.activeCases)} پرونده فعال، به‌روزرسانی {formatJalali(data.generatedAt, { time: true })}
          </p>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {can('report.manager') && (
            <Link className="btn" href="/reports?view=manager">
              گزارش مدیر خدمات
            </Link>
          )}
          {can('case.create') && (
            <Link className="btn btn-primary" href="/cases/new">
              ثبت پرونده
            </Link>
          )}
        </div>
      </header>

      <nav className="pipeline" aria-label="مراحل پرونده‌ها">
        {pipelineStages.map((s) => {
          const n = stageCount(s);
          return (
            <Link key={s} href={`/cases?stage=${s}`} className={n ? '' : 'empty'}>
              <span className="count">{faNum(n)}</span>
              <span className="label">{STAGE_LABELS[s]}</span>
              <span className="bar" aria-hidden>
                <i style={{ width: `${(n / maxStage) * 100}%` }} />
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <section className="panel">
          <div className="panel-head">
            <h2>نیازمند اقدام</h2>
          </div>
          <div className="attention">
            {attention.map((a) => (
              <Link key={a.flag} href={`/cases?flag=${a.flag}`} className={a.count ? `tone-${a.tone}` : 'tone-zero'}>
                <span className="n">{faNum(a.count)}</span>
                <span>
                  <div className="t">{a.title}</div>
                  <div className="d">{a.detail}</div>
                </span>
                <span className="attention-go" aria-hidden="true">‹</span>
              </Link>
            ))}
            {data.legacyEntries > 0 && (
              <Link href="/cases?flag=legacy" className="tone-zero">
                <span className="n" style={{ color: 'var(--steel)' }}>
                  {faNum(data.legacyEntries)}
                </span>
                <span>
                  <div className="t">ثبت‌شده از قبل از Manage</div>
                  <div className="d">خودروهایی که پیش از راه‌اندازی سامانه در تعمیرگاه بودند</div>
                </span>
                <span className="attention-go" aria-hidden="true">‹</span>
              </Link>
            )}
          </div>
        </section>

        <div className="stack">
          <section className="panel">
            <div className="panel-head">
              <h2>علت موانع باز</h2>
              <Link className="small" href="/cases?flag=blocked">
                پرونده‌ها
              </Link>
            </div>
            <div className="panel-body bars">
              {data.openBlockersByReason.length === 0 && <p className="muted small" style={{ margin: 0 }}>مانع بازی ثبت نشده است.</p>}
              {data.openBlockersByReason
                .sort((a, b) => b.count - a.count)
                .map((r) => (
                  <div className="bar-row" key={r.reason}>
                    <span>{BLOCKER_REASON_LABELS[r.reason]}</span>
                    <span className="track">
                      <i style={{ width: `${(r.count / maxReason) * 100}%` }} />
                    </span>
                    <span className="num">{faNum(r.count)}</span>
                  </div>
                ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>بار کاری واحدها</h2>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>واحد</th>
                  <th>در حال انجام</th>
                  <th>دارای مانع</th>
                  <th>در صف</th>
                </tr>
              </thead>
              <tbody>
                {data.departments.map((d) => (
                  <tr key={d.id} style={{ cursor: 'default' }}>
                    <td>{d.name}</td>
                    <td className="num">{faNum(d.inProgress)}</td>
                    <td className="num" style={{ color: d.blocked ? 'var(--red)' : undefined }}>
                      {faNum(d.blocked)}
                    </td>
                    <td className="num">{faNum(d.pending)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>نوع پوشش خودروهای فعال</h2>
            </div>
            <div className="panel-body row">
              {data.byCoverage.map((c) => (
                <Link key={c.coverage} href={`/cases?coverage=${c.coverage}`} className="chip">
                  {COVERAGE_LABELS[c.coverage]}: {faNum(c.count)}
                </Link>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
