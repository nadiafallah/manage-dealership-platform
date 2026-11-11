'use client';

import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import {
  AUDIT_ACTION_LABELS,
  DISCREPANCY_KIND_LABELS,
  DISCREPANCY_STATUS_LABELS,
  type PartDiscrepancy,
  type TimelineEvent,
} from '@manage/shared';
import { api, errorMessage, fetcher } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { faNum, formatJalali, toPersianDigits } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Dialog } from './Dialog';
import { PlateText } from './Plate';

const TONE: Record<PartDiscrepancy['status'], string> = { open: 'chip-red', in_review: 'chip-amber', resolved: 'chip-green', dismissed: '' };
const FILTERS = [
  ['active', 'باز و در حال بررسی'],
  ['resolved', 'رفع‌شده'],
  ['dismissed', 'اختلاف واقعی نبود'],
  ['all', 'همه'],
] as const;

function History({ id }: { id: string }) {
  const { data } = useSWR<{ detectedAt: string; events: TimelineEvent[] }>(`/part-discrepancies/${id}/history`, fetcher);
  if (!data) return <p className="xs muted">در حال دریافت سابقه…</p>;
  return (
    <ul className="plain xs">
      <li>شناسایی خودکار: {formatJalali(data.detectedAt, { time: true })}</li>
      {data.events.map((e) => (
        <li key={e.id}>
          {AUDIT_ACTION_LABELS[e.action] ?? e.action} — {e.actor?.displayName}، {formatJalali(e.occurredAt, { time: true })}
          {e.reason ? `: ${e.reason}` : ''}
        </li>
      ))}
    </ul>
  );
}

/** Parts discrepancies: the system flags facts; a person reviews and records the outcome with a reason. */
export function DiscrepancyQueue() {
  const { me, can } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState<(typeof FILTERS)[number][0]>('active');
  const { data, error, mutate } = useSWR<PartDiscrepancy[]>(`/part-discrepancies?status=${status}`, fetcher);
  const [closing, setClosing] = useState<PartDiscrepancy | null>(null);
  const [outcome, setOutcome] = useState<'resolved' | 'dismissed'>('resolved');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await fn();
      toast(done);
      setClosing(null);
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
      void mutate();
    }
  }

  return (
    <section className="panel" data-testid="discrepancy-queue">
      <div className="panel-head">
        <h2>صف مغایرت قطعات {data && status === 'active' ? `(${faNum(data.length)})` : ''}</h2>
        <div className="row no-print" style={{ gap: 6 }} role="group" aria-label="وضعیت مغایرت">
          {FILTERS.map(([k, label]) => (
            <button key={k} className="btn btn-sm" aria-pressed={status === k} onClick={() => setStatus(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="panel-body stack" style={{ gap: 10 }}>
        <p className="xs muted">
          سامانه فقط سوابق ناسازگار را نشان می‌دهد؛ تقصیر یا رفع اختلاف را قطعی نمی‌کند. هر مورد را مسئول بررسی می‌کند و نتیجه را با دلیل ثبت می‌کند.
        </p>
        {error && <p className="callout callout-red">صف مغایرت دریافت نشد.</p>}
        {data?.length === 0 && <p className="muted small">موردی در این وضعیت نیست.</p>}
        {data?.map((d) => (
          <div key={d.id} className="finance-item" data-testid="discrepancy">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div className="row" style={{ gap: 6 }}>
                <span className={`chip ${TONE[d.status]}`}>{DISCREPANCY_STATUS_LABELS[d.status]}</span>
                <b>{DISCREPANCY_KIND_LABELS[d.kind]}</b>
                <Link href={`/cases/${d.caseId}`}>
                  <bdi>{toPersianDigits(d.caseNumber)}</bdi>
                </Link>
                {d.plate && <span className="xs muted"><PlateText value={d.plate} /></span>}
              </div>
              {can('part.manage') && (d.status === 'open' || d.status === 'in_review') && (
                <div className="row no-print" style={{ gap: 6 }}>
                  {d.assignee?.id !== me.id && (
                    <button className="btn btn-sm" disabled={busy} onClick={() => void run(() => api(`/part-discrepancies/${d.id}/assign`, { body: { expectedVersion: d.version, assigneeUserId: me.id } }), 'بررسی این مورد به شما سپرده شد')}>
                      بررسی با من
                    </button>
                  )}
                  <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => { setClosing(d); setOutcome('resolved'); setReason(''); }}>
                    ثبت نتیجه بررسی
                  </button>
                </div>
              )}
            </div>
            {d.part && (
              <div className="small">
                قطعه: {d.part.description}
                {d.part.partNumber ? <> — <bdi>{d.part.partNumber}</bdi></> : null} — تعداد {faNum(d.part.quantity)}
              </div>
            )}
            <div className="small">{toPersianDigits(d.detail)}</div>
            <div className="xs muted meta">
              <span>شناسایی: {formatJalali(d.detectedAt, { time: true })}</span>
              <span>مسئول بررسی: {d.assignee?.displayName ?? 'تعیین نشده'}</span>
              {d.conditionClearedAt && <span>شرط اختلاف از {formatJalali(d.conditionClearedAt, { time: true })} دیگر برقرار نیست؛ تأیید نتیجه با مسئول است</span>}
              {d.resolvedAt && (
                <span>
                  {DISCREPANCY_STATUS_LABELS[d.status]}: {d.resolvedBy?.displayName}، {formatJalali(d.resolvedAt, { time: true })} — {d.resolutionReason}
                </span>
              )}
            </div>
            <button className="btn btn-sm no-print" style={{ alignSelf: 'flex-start' }} aria-expanded={open === d.id} onClick={() => setOpen(open === d.id ? null : d.id)}>
              {open === d.id ? 'بستن سابقه' : 'سابقه رسیدگی'}
            </button>
            {open === d.id && <History id={d.id} />}
          </div>
        ))}
      </div>
      <Dialog
        open={!!closing}
        title="ثبت نتیجه بررسی مغایرت"
        onClose={() => setClosing(null)}
        footer={
          <>
            <button
              className="btn btn-primary"
              disabled={busy || reason.trim().length < 5}
              onClick={() => closing && void run(() => api(`/part-discrepancies/${closing.id}/resolve`, { body: { expectedVersion: closing.version, outcome, reason } }), 'نتیجه بررسی ثبت شد')}
            >
              ثبت
            </button>
            <button className="btn" onClick={() => setClosing(null)}>
              انصراف
            </button>
          </>
        }
      >
        {closing && <div className="small">{toPersianDigits(closing.detail)}</div>}
        <div className="segmented" role="group" aria-label="نتیجه">
          <button type="button" aria-pressed={outcome === 'resolved'} onClick={() => setOutcome('resolved')}>
            رفع شد (سوابق اصلاح شد)
          </button>
          <button type="button" aria-pressed={outcome === 'dismissed'} onClick={() => setOutcome('dismissed')}>
            اختلاف واقعی نبود
          </button>
        </div>
        <label className="field">
          <span>دلیل و آنچه بررسی شد *</span>
          <textarea className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      </Dialog>
    </section>
  );
}
