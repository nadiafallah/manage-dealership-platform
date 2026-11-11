'use client';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import { ALERT_RESPONSE_LABELS, COVERAGE_LABELS, type CaseAlert } from '@manage/shared';
import { api, errorMessage, fetcher } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { faNum } from '@/lib/format';
import { Plate } from '@/components/Plate';

type Response = keyof typeof ALERT_RESPONSE_LABELS;
const RESPONSES: Response[] = ['received', 'not_received', 'not_needed'];

function question(a: CaseAlert): { title: string; detail: string } {
  if (a.kind === 'advance') {
    return a.level > 1
      ? { title: 'هزینه بالا رفته؛ پیش‌پرداخت تازه گرفته شد؟', detail: 'الحاقیه مبلغ پرونده را بیشتر کرده است.' }
      : { title: 'پیش‌پرداخت از مشتری گرفته شده؟', detail: 'سهم مشتری دارد و پیش‌پرداختی ثبت نشده است. کار متوقف نمی‌شود؛ تصمیم با شماست.' };
  }
  return {
    title: `مبلغ قطعات به ${faNum(a.totalRial ?? 0)} ریال رسید`,
    detail: `از آستانهٔ ${faNum(a.thresholdRial ?? 0)} ریال گذشته است. پیش‌پرداخت از مشتری، بیمه یا کارت طلایی گرفته شده؟`,
  };
}

/**
 * Non-blocking alerts for the accident coordinator: one card per open alert,
 * answered with one tap. Shown on the coordinator desk (all open cases) and on
 * a case page (caseId).
 */
export function AlertsPanel({ caseId, onAnswered }: { caseId?: string; onAnswered?: () => void }) {
  const { can } = useAuth();
  const key = can('case.read') ? `/alerts${caseId ? `?caseId=${caseId}` : ''}` : null;
  const { data, mutate } = useSWR<CaseAlert[]>(key, fetcher, { refreshInterval: 60000 });
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  if (!data || data.length === 0) return null;
  const canAnswer = can('case.update');

  async function answer(a: CaseAlert, response: Response) {
    const id = `${a.caseId}:${a.kind}:${a.level}`;
    setBusy(id);
    setError('');
    try {
      await api(`/cases/${a.caseId}/alerts/respond`, { body: { kind: a.kind, level: a.level, response } });
      await mutate();
      onAnswered?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy('');
    }
  }

  return (
    <section className="panel" aria-labelledby="alerts-title">
      <div className="panel-head">
        <div>
          <h2 id="alerts-title">هشدارها</h2>
          <p className="muted small">{faNum(data.length)} مورد منتظر جواب شما؛ هیچ‌کدام کار را متوقف نمی‌کند.</p>
        </div>
      </div>
      <div className="panel-body stack" style={{ gap: 12 }}>
        {error && <p role="alert" className="callout callout-red">{error}</p>}
        {data.map((a) => {
          const q = question(a);
          const id = `${a.caseId}:${a.kind}:${a.level}`;
          return (
            <article key={id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14, border: '1px solid var(--line, #E3E6EC)', borderRadius: 14, padding: '14px 16px' }}>
              {!caseId && <Plate value={a.plate ?? ''} />}
              <div style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <strong>{q.title}</strong>
                <span className="muted small">
                  {!caseId && (
                    <>
                      <Link href={`/cases/${a.caseId}`}>{a.vehicleLabel || 'پرونده'}</Link>
                      {' · '}
                    </>
                  )}
                  {COVERAGE_LABELS[a.coverageType as keyof typeof COVERAGE_LABELS] ?? a.coverageType} · {q.detail}
                </span>
              </div>
              {canAnswer && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} role="group" aria-label="جواب هشدار">
                  {RESPONSES.map((r, i) => (
                    <button key={r} type="button" className={`btn${i === 0 ? ' btn-primary' : ''}`} disabled={busy === id} onClick={() => void answer(a, r)}>
                      {ALERT_RESPONSE_LABELS[r]}
                    </button>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

/** Owner / system administrator: the parts-amount alert threshold in Rial. */
export function AlertSettingsPanel() {
  const { can } = useAuth();
  const { data, mutate } = useSWR<{ partsAlertThresholdRial: number; defaultRial: number }>(can('settings.manage') ? '/settings/alerts' : null, fetcher);
  const [value, setValue] = useState(''), [message, setMessage] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  if (!can('settings.manage') || !data) return null;
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const digits = (value || String(data!.partsAlertThresholdRial)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/[^0-9]/g, '');
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api('/settings/alerts', { method: 'PUT', body: { partsAlertThresholdRial: Number(digits) } });
      await mutate();
      setValue('');
      setMessage('آستانهٔ هشدار ذخیره شد.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>هشدار مبلغ قطعات</h2>
          <p className="muted small">وقتی جمع قطعات یک پرونده از این مبلغ بگذرد، از کارشناس تصادفات دربارهٔ پیش‌پرداخت پرسیده می‌شود. هر مضرب تازه دوباره می‌پرسد.</p>
        </div>
      </div>
      <form className="panel-body" onSubmit={save} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12 }}>
        <label className="field" style={{ flex: '1 1 240px' }}>
          آستانه (ریال) — اکنون {faNum(data.partsAlertThresholdRial)}
          <input className="input" inputMode="numeric" dir="ltr" value={value} onChange={(e) => setValue(e.target.value)} placeholder={String(data.partsAlertThresholdRial)} />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'در حال ذخیره…' : 'ذخیره'}
        </button>
        {message && <p role="status" className="small" style={{ margin: 0 }}>{message}</p>}
        {error && <p role="alert" className="callout callout-red" style={{ margin: 0 }}>{error}</p>}
      </form>
    </section>
  );
}
