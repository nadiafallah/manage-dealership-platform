'use client';
import { useState } from 'react';
import useSWR from 'swr';
import { COVERAGE_BUCKETS, COVERAGE_BUCKET_LABELS, type MyWorkMonth } from '@manage/shared';
import { useAuth } from '@/lib/auth';
import { errorMessage, fetcher } from '@/lib/api';
import { formatJalali, rial, toPersianDigits } from '@/lib/format';
import { BackLink } from '@/components/BackLink';
import { Plate } from '@/components/Plate';

const COVERAGE_TONE = { golden_card: 'chip-amber', insurance: 'chip-blue', personal: 'chip-green', other: '' } as const;

/** "کارکرد من": own approved jobs of a Jalali month with the wage of each and totals per coverage. */
export default function MyWorkPage() {
  const { can } = useAuth();
  const [month, setMonth] = useState('');
  const { data, error, isLoading } = useSWR<MyWorkMonth>(can('task.execute') ? `/workshop/my-work${month ? `?month=${month}` : ''}` : null, fetcher);
  if (!can('task.execute')) return <p className="callout">کارکرد ماه فقط برای حساب تعمیرکار است.</p>;
  return (
    <div className="technician-page my-work">
      <BackLink href="/workshop/technician" label="بازگشت به کارهای من" />
      <header className="technician-head">
        <p className="technician-kicker"><span>کارکرد ماه</span><span>{data?.label ?? ''}</span></p>
        <h1>کارکرد من</h1>
        <p>اجرت هر کار بعد از تأیید تحویل آن توسط کارشناس تصادفات حساب می‌شود.</p>
      </header>
      <label className="field">
        <span>ماه</span>
        <select className="input" value={month || data?.month || ''} onChange={(e) => setMonth(e.target.value)}>
          {(data?.months ?? []).map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
      </label>
      {error && <p role="alert" className="callout callout-red">{errorMessage(error)}</p>}
      {isLoading && <p role="status">در حال دریافت کارکرد…</p>}
      {data && (
        <>
          <section className="my-work-total" aria-label="جمع کارکرد">
            <div className="my-work-sum"><span>جمع کل</span><strong data-testid="my-work-total">{rial(data.totalRial)}</strong></div>
            <dl className="my-work-buckets">
              {COVERAGE_BUCKETS.filter((b) => b !== 'other' || data.byCoverage.other > 0).map((b) => (
                <div key={b}><dt>{COVERAGE_BUCKET_LABELS[b]}</dt><dd>{rial(data.byCoverage[b])}</dd></div>
              ))}
            </dl>
            {data.missingWage > 0 && <p className="xs muted">{toPersianDigits(data.missingWage)} کار تأییدشده هنوز اجرت ثبت‌شده ندارد و در جمع نیامده است.</p>}
          </section>
          <section aria-label="ریز کارها" className="stack">
            {data.rows.length === 0 && <p className="callout">در این ماه کار تأییدشده‌ای ندارید.</p>}
            {data.rows.map((r) => (
              <article key={r.taskId} className="my-work-row" data-testid="my-work-row">
                <div className="row"><Plate value={r.plate ?? ''} /><span className={`chip ${COVERAGE_TONE[r.coverage]}`}>{COVERAGE_BUCKET_LABELS[r.coverage]}</span></div>
                <p><strong>{r.title}</strong> <span className="muted small">{r.vehicleLabel}</span></p>
                <div className="row my-work-meta"><span className="small muted">تأیید: {formatJalali(r.approvedAt)}</span><strong>{r.wageRial === null ? <span className="muted">اجرت ثبت نشده</span> : rial(r.wageRial)}</strong></div>
              </article>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
