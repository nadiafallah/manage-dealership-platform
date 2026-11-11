'use client';
import { useState } from 'react';
import useSWR from 'swr';
import type { CaseDetail, ResponsibilityPeriod, UserRef } from '@manage/shared';
import { api, errorMessage, fetcher } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatJalali, duration } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Dialog } from './Dialog';

/** Who was responsible for the case from when to when, and "انتقال پرونده" to another active coordinator. */
export function ResponsibilityBar({ kase, onChange }: { kase: CaseDetail; onChange: () => void }) {
  const { me, can } = useAuth();
  const toast = useToast();
  const { data, mutate } = useSWR<ResponsibilityPeriod[]>(`/cases/${kase.id}/responsibility`, fetcher);
  const canTransfer = can('case.update') && kase.status === 'open' && kase.stage !== 'delivered';
  const { data: assignable } = useSWR<(UserRef & { roles?: string[] })[]>(canTransfer ? '/users/assignable' : null, fetcher);
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const support = !me.isOwner && me.roles.includes('system_admin');
  const choices = (assignable ?? []).filter((u) => u.id !== kase.responsible?.id && (!u.roles || u.roles.some((r) => r === 'accident_expert')));

  async function transfer() {
    if (!to || busy) return;
    setBusy(true);
    setError('');
    try {
      await api(`/cases/${kase.id}/transfer`, { body: { toUserId: to, expectedVersion: kase.version, ...(reason.trim() ? { reason: reason.trim() } : {}) } });
      toast('پرونده منتقل شد');
      setOpen(false);
      setTo('');
      setReason('');
      void mutate();
      onChange();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const periods = data ?? [];
  const now = new Date().toISOString();
  return (
    <section className="panel responsibility-bar" aria-label="نوار مسئولین پرونده" data-testid="responsibility-bar">
      <div className="panel-head">
        <div>
          <h2>مسئولین پرونده</h2>
          <p className="muted small">آمار هر مسئول به سهم دورهٔ مسئولیت خودش حساب می‌شود.</p>
        </div>
        {canTransfer && <button type="button" className="btn" onClick={() => setOpen(true)}>انتقال پرونده</button>}
      </div>
      <ol className="responsibility-periods">
        {!data && <li className="muted small">در حال دریافت…</li>}
        {data && !periods.length && <li className="muted small">مسئول این پرونده هنوز تعیین نشده است.</li>}
        {periods.map((p, i) => (
          <li key={`${p.userId}-${p.startedAt}`} className={p.endedAt ? '' : 'current'}>
            <strong>{p.displayName}</strong>
            <span className="small">از {formatJalali(p.startedAt, { time: true })} {p.endedAt ? `تا ${formatJalali(p.endedAt, { time: true })}` : 'تا امروز'}</span>
            <span className="xs muted">{duration(p.startedAt, p.endedAt ?? now)}{p.derived ? ' · از زمان پذیرش با مسئول فعلی' : ''}{p.reason ? ` · دلیل: ${p.reason}` : ''}{i === periods.length - 1 && !p.endedAt ? ' · مسئول فعلی' : ''}</span>
          </li>
        ))}
      </ol>
      <Dialog
        open={open}
        title="انتقال پرونده"
        onClose={() => !busy && setOpen(false)}
        footer={<><button type="button" className="btn" disabled={busy} onClick={() => setOpen(false)}>انصراف</button><button type="button" className="btn btn-primary" disabled={busy || !to} onClick={() => void transfer()}>{busy ? 'در حال انتقال…' : 'انتقال'}</button></>}
      >
        <label className="field">
          <span>مسئول تازه</span>
          <select className="input" value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">انتخاب از مسئولان تصادفات فعال</option>
            {choices.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
          </select>
        </label>
        <label className="field">
          <span>دلیل {support ? '(برای مدیر سیستم الزامی)' : '(اختیاری)'}</span>
          <input className="input" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <p className="xs muted">دورهٔ مسئول فعلی همین حالا بسته و دورهٔ مسئول تازه باز می‌شود؛ سابقهٔ قبلی تغییر نمی‌کند.</p>
        {error && <p role="alert" className="callout callout-red">{error}</p>}
      </Dialog>
    </section>
  );
}
