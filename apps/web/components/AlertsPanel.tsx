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
  if (a.kind === 'expensive_part') {
    return {
      title: `قطعهٔ گران: ${a.partDescription ?? 'قطعه'} (${faNum(a.totalRial ?? 0)} ریال)`,
      detail: 'خودروی شخصی است. پیش‌پرداخت از مشتری گرفته شده؟ کار متوقف نمی‌شود؛ فقط تصمیم شما ثبت می‌شود.',
    };
  }
  return {
    title: `هزینهٔ قطعات به ${faNum(a.totalRial ?? 0)} ریال رسید`,
    detail: `از سقف ${faNum(a.thresholdRial ?? 0)} ریال گذشته است. پیش‌پرداخت از مشتری، بیمه یا کارت طلایی گرفته شده؟`,
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
    <section className={`panel${caseId ? ' cf-alert' : ''}`} aria-labelledby="alerts-title">
      <div className="panel-head">
        <div>
          <h2 id="alerts-title">{caseId ? 'هشدار هزینهٔ قطعات' : 'هشدارها'}</h2>
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

type AlertSettingsView = { partsAlertThresholdRial: number; expensivePartThresholdRial: number; emdadLateDays: number; defaults: { partsAlertThresholdRial: number; expensivePartThresholdRial: number; emdadLateDays: number } };

/** One setting with large up/down controls (spec section 9: «کنترل بالا/پایین»). */
function Stepper({ label, hint, value, step, min, unit, onChange }: { label: string; hint: string; value: number; step: number; min: number; unit: string; onChange: (v: number) => void }) {
  return (
    <div className="field" style={{ flex: '1 1 260px' }}>
      <span>{label}</span>
      <div className="row" style={{ gap: 6, alignItems: 'center' }}>
        <button type="button" className="btn" aria-label={`کم کردن ${label}`} disabled={value - step < min} onClick={() => onChange(value - step)} style={{ minWidth: 44, minHeight: 44 }}>−</button>
        <output className="num" style={{ minWidth: 150, textAlign: 'center', fontWeight: 700 }}>{faNum(value)} {unit}</output>
        <button type="button" className="btn" aria-label={`افزودن ${label}`} onClick={() => onChange(value + step)} style={{ minWidth: 44, minHeight: 44 }}>+</button>
      </div>
      <small className="muted">{hint}</small>
    </div>
  );
}

/** System administrator and owner: cost alert thresholds and the late-Emdad days. */
export function AlertSettingsPanel() {
  const { can } = useAuth();
  const { data, mutate } = useSWR<AlertSettingsView>(can('settings.manage') ? '/settings/alerts' : null, fetcher);
  const [draft, setDraft] = useState<Partial<AlertSettingsView>>({});
  const [message, setMessage] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  if (!can('settings.manage') || !data) return null;
  const v = { ...data, ...draft };
  const changed = v.partsAlertThresholdRial !== data.partsAlertThresholdRial || v.expensivePartThresholdRial !== data.expensivePartThresholdRial || v.emdadLateDays !== data.emdadLateDays;
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api('/settings/alerts', { method: 'PUT', body: { partsAlertThresholdRial: v.partsAlertThresholdRial, expensivePartThresholdRial: v.expensivePartThresholdRial, emdadLateDays: v.emdadLateDays } });
      await mutate();
      setDraft({});
      setMessage('سقف‌ها ذخیره شد.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel" aria-labelledby="alert-settings-title">
      <div className="panel-head">
        <div>
          <h2 id="alert-settings-title">سقف‌ها و آستانه‌های هشدار</h2>
          <p className="muted small">همهٔ مبالغ به ریال است. هیچ هشداری کار را قفل نمی‌کند؛ فقط از کارشناس تصادفات دربارهٔ پیش‌پرداخت پرسیده و جوابش ثبت می‌شود.</p>
        </div>
      </div>
      <form className="panel-body" onSubmit={save} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 16 }}>
        <Stepper label="سقف هزینهٔ قطعات هر پرونده" unit="ریال" step={100_000_000} min={100_000_000} value={v.partsAlertThresholdRial} onChange={(n) => setDraft((d) => ({ ...d, partsAlertThresholdRial: n }))} hint={`پیش‌فرض ${faNum(data.defaults.partsAlertThresholdRial)} ریال؛ هر مضرب تازه دوباره می‌پرسد.`} />
        <Stepper label="قطعهٔ گران در خودروی شخصی" unit="ریال" step={50_000_000} min={50_000_000} value={v.expensivePartThresholdRial} onChange={(n) => setDraft((d) => ({ ...d, expensivePartThresholdRial: n }))} hint={`پیش‌فرض ${faNum(data.defaults.expensivePartThresholdRial)} ریال برای یک قلم (قیمت × تعداد).`} />
        <Stepper label="امداد ویژهٔ دیرشده بعد از" unit="روز" step={1} min={1} value={v.emdadLateDays} onChange={(n) => setDraft((d) => ({ ...d, emdadLateDays: n }))} hint={`پیش‌فرض ${faNum(data.defaults.emdadLateDays)} روز بدون تغییر در گزارش روزانه.`} />
        <div className="row" style={{ gap: 8, alignItems: 'center', flexBasis: '100%' }}>
          <button type="submit" className="btn btn-primary" disabled={busy || !changed}>{busy ? 'در حال ذخیره…' : 'ذخیره'}</button>
          {changed && <button type="button" className="btn" onClick={() => setDraft({})}>برگرداندن</button>}
          {message && <p role="status" className="small" style={{ margin: 0 }}>{message}</p>}
          {error && <p role="alert" className="callout callout-red" style={{ margin: 0 }}>{error}</p>}
        </div>
      </form>
    </section>
  );
}
