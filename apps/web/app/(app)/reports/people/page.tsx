'use client';
import { useState } from 'react';
import useSWR from 'swr';
import type { ResponsibilityReport, WageReport } from '@manage/shared';
import { errorMessage, fetcher } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { faNum, rial, toPersianDigits } from '@/lib/format';
import { BackLink } from '@/components/BackLink';

/** Service manager and owner: paid technician wages against assessment labour, and each coordinator's share of responsibility. */
export default function PeopleReportsPage() {
  const { me, can } = useAuth();
  const [month, setMonth] = useState('');
  const q = month ? `?month=${month}` : '';
  const { data: wages, error: wageError } = useSWR<WageReport>(can('wage.report') ? `/reports/wages${q}` : null, fetcher);
  const { data: duty, error: dutyError } = useSWR<ResponsibilityReport>(can('report.manager') ? `/reports/responsibility${q}` : null, fetcher);
  if (!can('wage.report') && !can('report.manager')) return <p className="callout">این گزارش برای مدیر خدمات و مالک است.</p>;
  const months = wages?.months ?? duty?.months ?? [];
  const current = month || wages?.month || duty?.month || '';
  return (
    <div className="stack people-report">
      <BackLink href={me.isOwner ? '/accidents/owner' : '/accidents/manager'} />
      <header className="page-head">
        <div>
          <h1>اجرت تعمیرکاران و مسئولیت پرونده‌ها</h1>
          <p className="muted">اجرت فقط برای کارهای تأییدشده در ماه حساب می‌شود؛ آمار هر مسئول به سهم دورهٔ مسئولیت خودش است.</p>
        </div>
        <label className="field">
          <span>ماه</span>
          <select className="input" value={current} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </label>
      </header>

      {can('wage.report') && (
        <section className="panel" aria-label="اجرت پرداختی در برابر اجرت کارشناسی">
          <div className="panel-head">
            <div>
              <h2>اجرت پرداختی در برابر اجرت کارشناسی</h2>
              <p className="muted small">اجرت کارشناسی هر رشته بین کارهای همان رشته در پرونده به‌طور مساوی تقسیم می‌شود.</p>
            </div>
            {wages && <a className="btn" href={`/api/v1/reports/wages/export?month=${wages.month}`}>خروجی Excel</a>}
          </div>
          <div className="panel-body">
            {wageError && <p role="alert" className="callout callout-red">{errorMessage(wageError)}</p>}
            {!wages && !wageError && <p role="status" className="muted">در حال دریافت…</p>}
            {wages && !wages.rows.length && <p className="muted">در {wages.label} کار تأییدشده‌ای برای تعمیرکاران ثبت نشده است.</p>}
            {wages && wages.rows.length > 0 && (
              <div className="table-scroll">
                <table className="table">
                  <thead><tr><th>تعمیرکار</th><th>کار تأییدشده</th><th>اجرت پرداختی</th><th>اجرت کارشناسی</th><th>تفاوت</th><th>بدون اجرت</th></tr></thead>
                  <tbody>
                    {wages.rows.map((r) => (
                      <tr key={r.technician.id}>
                        <td data-label="تعمیرکار">{r.technician.displayName}</td>
                        <td data-label="کار تأییدشده" className="num">{faNum(r.jobs)}</td>
                        <td data-label="اجرت پرداختی" className="num">{rial(r.paidRial)}</td>
                        <td data-label="اجرت کارشناسی" className="num">{rial(r.expertRial)}</td>
                        <td data-label="تفاوت" className={`num ${r.differenceRial > 0 ? 'tone-red' : ''}`}>{r.differenceRial < 0 ? `−${rial(-r.differenceRial)}` : rial(r.differenceRial)}</td>
                        <td data-label="بدون اجرت" className="num">{faNum(r.missingWage)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><th>جمع</th><td className="num">{faNum(wages.totals.jobs)}</td><td className="num">{rial(wages.totals.paidRial)}</td><td className="num">{rial(wages.totals.expertRial)}</td><td className="num">{wages.totals.differenceRial < 0 ? `−${rial(-wages.totals.differenceRial)}` : rial(wages.totals.differenceRial)}</td><td /></tr></tfoot>
                </table>
              </div>
            )}
          </div>
        </section>
      )}

      {can('report.manager') && (
        <section className="panel" aria-label="مسئولیت پرونده‌ها">
          <div className="panel-head"><div><h2>سهم هر کارشناس تصادفات</h2><p className="muted small">روزهای مسئولیت، کارهای تأییدشده و تحویل‌ها در دورهٔ مسئولیت هر نفر؛ با انتقال پرونده، سهم هر نفر جدا حساب می‌شود.</p></div></div>
          <div className="panel-body">
            {dutyError && <p role="alert" className="callout callout-red">{errorMessage(dutyError)}</p>}
            {duty && !duty.rows.length && <p className="muted">در {duty.label} پرونده‌ای با مسئول ثبت‌شده نیست.</p>}
            {duty && duty.rows.length > 0 && (
              <div className="table-scroll">
                <table className="table">
                  <thead><tr><th>مسئول</th><th>پرونده</th><th>روز مسئولیت</th><th>کار تأییدشده</th><th>تحویل</th></tr></thead>
                  <tbody>
                    {duty.rows.map((r) => (
                      <tr key={r.user.id}>
                        <td data-label="مسئول">{r.user.displayName}</td>
                        <td data-label="پرونده" className="num">{faNum(r.cases)}</td>
                        <td data-label="روز مسئولیت" className="num">{toPersianDigits(r.heldDays)}</td>
                        <td data-label="کار تأییدشده" className="num">{faNum(r.approvedTasks)}</td>
                        <td data-label="تحویل" className="num">{faNum(r.delivered)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
