'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  FINANCE_APPROVAL_KIND_LABELS,
  FINANCE_APPROVAL_STATUS_LABELS,
  type CaseDetail,
  type CaseFinance,
  type FinanceApproval,
  type FinanceApprovalKind,
  type FinanceApprovalStatus,
} from '@manage/shared';
import { api, errorMessage, fetcher } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatJalali, parseAmount, rial } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Dialog } from './Dialog';
import { JalaliInput } from './JalaliInput';

const STATUS_TONE: Record<FinanceApprovalStatus, string> = {
  proposed: 'chip-amber',
  approved: 'chip-blue',
  rejected: 'chip-red',
  paid: 'chip-green',
};

type Mode =
  | { kind: 'shares' }
  | { kind: 'propose' }
  | { kind: 'decide'; a: FinanceApproval; decision: 'approve' | 'reject' }
  | { kind: 'pay'; a: FinanceApproval }
  | { kind: 'settle' }
  | null;

const amountText = (n: number | null) => (n === null ? '' : String(n));
const amountOrNull = (s: string) => (s.trim() === '' ? null : parseAmount(s));

export function FinancePanel({ kase, onChange }: { kase: CaseDetail; onChange: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data: f, mutate } = useSWR<CaseFinance>(`/cases/${kase.id}/finance`, fetcher);
  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState(false);
  const [customer, setCustomer] = useState('');
  const [insurer, setInsurer] = useState('');
  const [company, setCompany] = useState('');
  const [kind, setKind] = useState<FinanceApprovalKind>('advance');
  const [amount, setAmount] = useState('');
  const [text, setText] = useState('');
  const [at, setAt] = useState<string | null>(null);

  const editable = kase.status === 'open';
  if (!f) {
    return (
      <section className="panel">
        <div className="panel-head">
          <h2>مالی و پیش‌پرداخت</h2>
        </div>
        <div className="panel-body muted small">در حال بارگذاری…</div>
      </section>
    );
  }

  function open(m: NonNullable<Mode>) {
    if (!f) return;
    setMode(m);
    setText('');
    setAt(new Date().toISOString());
    if (m.kind === 'shares') {
      setCustomer(amountText(f.shares.customerShareRial));
      setInsurer(amountText(f.shares.insurerShareRial));
      setCompany(amountText(f.shares.companyShareRial));
    } else if (m.kind === 'propose') {
      setKind('advance');
      setAmount(f.balanceRial ? String(f.balanceRial) : '');
    } else if (m.kind === 'settle') {
      setAmount(f.balanceRial ? String(f.balanceRial) : '');
    }
  }

  async function submit() {
    if (!mode || !f) return;
    setBusy(true);
    try {
      if (mode.kind === 'shares') {
        await api(`/cases/${kase.id}/finance/shares`, {
          method: 'PUT',
          body: {
            customerShareRial: amountOrNull(customer),
            insurerShareRial: amountOrNull(insurer),
            companyShareRial: amountOrNull(company),
            note: text || null,
            expectedVersion: f.shares.version ?? undefined,
          },
        });
        toast('سهم پرداخت‌کنندگان ثبت شد');
      } else if (mode.kind === 'propose') {
        await api(`/cases/${kase.id}/finance/approvals`, { body: { kind, amountRial: parseAmount(amount), reason: text } });
        toast('پیشنهاد برای تأیید مدیر ثبت شد');
      } else if (mode.kind === 'decide') {
        await api(`/financial-approvals/${mode.a.id}/decision`, {
          body: { decision: mode.decision, expectedVersion: mode.a.version, note: text || null },
        });
        toast(mode.decision === 'approve' ? 'تأیید مدیر ثبت شد' : 'پیشنهاد رد شد');
      } else if (mode.kind === 'settle') {
        await api(`/cases/${kase.id}/finance/payments`, {
          body: { amountRial: parseAmount(amount), paymentRef: text, at },
        });
        toast('دریافت وجه مشتری ثبت شد');
      } else {
        await api(`/financial-approvals/${mode.a.id}/payment`, {
          body: { expectedVersion: mode.a.version, paymentRef: text, at },
        });
        toast('دریافت پیش‌پرداخت ثبت شد');
      }
      setMode(null);
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
      void mutate();
      onChange();
    }
  }

  const canSubmit =
    mode?.kind === 'propose'
      ? parseAmount(amount) > 0 && !!text.trim()
      : mode?.kind === 'decide'
        ? mode.decision === 'approve' || !!text.trim()
        : mode?.kind === 'pay'
          ? !!text.trim()
          : mode?.kind === 'settle'
            ? parseAmount(amount) > 0 && !!text.trim()
            : true;

  return (
    <section className="panel" data-testid="finance-panel">
      <div className="panel-head">
        <h2>مالی و پیش‌پرداخت</h2>
        {editable && can('finance.propose') && (
          <div className="row" style={{ gap: 6 }}>
            <button className="btn btn-sm" onClick={() => open({ kind: 'shares' })}>
              سهم پرداخت‌کنندگان
            </button>
          </div>
        )}
      </div>
      <div className="panel-body stack" style={{ gap: 10 }}>
        <div className="callout callout-blue small" data-testid="finance-gate">
          تصمیم پیش‌پرداخت روی هشدار هزینهٔ همین پرونده ثبت می‌شود و هیچ کاری را متوقف نمی‌کند. فاکتور رسمی و دریافت وجه در سامانهٔ حسابداری ثبت می‌شود.
        </div>
        <dl className="dl">
          <dt>برآورد کارشناسی</dt>
          <dd className="num">{rial(f.estimateRial)}</dd>
          <dt>سهم مشتری</dt>
          <dd className="num">
            {f.customerShareRial === null ? <span className="missing">مشخص نشده</span> : rial(f.customerShareRial)}
            {f.customerShareDerived && f.customerShareRial !== null && <span className="xs muted"> (بر اساس نوع پوشش)</span>}
          </dd>
          {f.shares.insurerShareRial !== null && (
            <>
              <dt>سهم بیمه</dt>
              <dd className="num">{rial(f.shares.insurerShareRial)}</dd>
            </>
          )}
          {f.shares.companyShareRial !== null && (
            <>
              <dt>سهم شرکت</dt>
              <dd className="num">{rial(f.shares.companyShareRial)}</dd>
            </>
          )}
          <dt>دریافت‌شده</dt>
          <dd className="num">{rial(f.paidRial)}</dd>
          <dt>مانده سهم مشتری</dt>
          <dd className="num">{f.balanceRial === null ? '—' : rial(f.balanceRial)}</dd>
          <dt>خرید قطعه ثبت‌شده</dt>
          <dd className="num">{rial(f.purchasesRial)}</dd>
        </dl>

        {f.approvals.map((a) => {
          return (
            <div key={a.id} className="finance-item" data-testid="finance-approval">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div className="row" style={{ gap: 6 }}>
                  <b>{FINANCE_APPROVAL_KIND_LABELS[a.kind]}</b>
                  <span className="num">{rial(a.amountRial)}</span>
                  <span className={`chip ${STATUS_TONE[a.status]}`}>{FINANCE_APPROVAL_STATUS_LABELS[a.status]}</span>
                </div>
                <span className="xs muted">سابقهٔ روال قبلی (فقط خواندنی)</span>
              </div>
              <div className="xs muted meta">
                <span>
                  پیشنهاد: {a.proposedBy.displayName}، {formatJalali(a.proposedAt, { time: true })} — {a.reason}
                </span>
                <span>برای برآورد {rial(a.coversEstimateRial)}</span>
                {a.kind === 'exception' && a.status === 'approved' && <span>مصرف‌شده: {rial(a.spentRial)}</span>}
                {a.decidedBy && (
                  <span>
                    تصمیم: {a.decidedBy.displayName}، {formatJalali(a.decidedAt, { time: true })}
                    {a.decisionNote ? `؛ ${a.decisionNote}` : ''}
                  </span>
                )}
                {a.paidAt && (
                  <span>
                    دریافت: {formatJalali(a.paidAt, { time: true })} — {a.paymentRef} ({a.paymentConfirmedBy?.displayName})
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {f.payments.map((p) => (
          <div key={p.id} className="finance-item" data-testid="settlement-payment">
            <div className="row" style={{ gap: 6 }}>
              <b>دریافت تسویه</b>
              <span className="num">{rial(p.amountRial)}</span>
              <span className="chip chip-green">دریافت شد</span>
            </div>
            <div className="xs muted meta">
              <span>
                {formatJalali(p.paidAt, { time: true })} — {p.paymentRef} ({p.recordedBy.displayName})
                {p.note ? `؛ ${p.note}` : ''}
              </span>
            </div>
          </div>
        ))}
      </div>

      <Dialog
        open={!!mode}
        title={
          mode?.kind === 'shares'
            ? 'سهم پرداخت‌کنندگان'
            : mode?.kind === 'propose'
              ? 'پیشنهاد مالی'
              : mode?.kind === 'decide'
                ? mode.decision === 'approve'
                  ? 'تأیید هزینه توسط مدیر'
                  : 'رد پیشنهاد'
                : mode?.kind === 'settle'
                  ? 'ثبت دریافت از مشتری'
                  : 'تأیید دریافت پیش‌پرداخت'
        }
        onClose={() => setMode(null)}
        footer={
          <>
            <button className="btn btn-primary" disabled={busy || !canSubmit} onClick={submit}>
              ثبت
            </button>
            <button className="btn" onClick={() => setMode(null)}>
              انصراف
            </button>
          </>
        }
      >
        {mode?.kind === 'shares' && (
          <>
            <div className="small muted">برای پوشش ترکیبی یا نامشخص، سهم مشتری باید ثبت شود. خالی یعنی هنوز مشخص نیست.</div>
            {(
              [
                ['سهم مشتری (ریال)', customer, setCustomer],
                ['سهم بیمه (ریال)', insurer, setInsurer],
                ['سهم شرکت / کارت طلایی (ریال)', company, setCompany],
              ] as const
            ).map(([label, value, set]) => (
              <label key={label} className="field">
                <span>{label}</span>
                <input className="input ltr-input" inputMode="numeric" value={value} onChange={(e) => set(e.target.value)} />
              </label>
            ))}
            <label className="field">
              <span>توضیح</span>
              <textarea className="input" value={text} onChange={(e) => setText(e.target.value)} />
            </label>
          </>
        )}
        {mode?.kind === 'propose' && (
          <>
            <div className="segmented" role="group" aria-label="نوع پیشنهاد">
              {(['advance', 'exception'] as const).map((k) => (
                <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
                  {FINANCE_APPROVAL_KIND_LABELS[k]}
                </button>
              ))}
            </div>
            <label className="field">
              <span>{kind === 'advance' ? 'مبلغ پیش‌پرداخت (ریال) *' : 'سقف خرید بدون پیش‌پرداخت (ریال) *'}</span>
              <input className="input ltr-input" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label className="field">
              <span>دلیل *</span>
              <textarea className="input" value={text} onChange={(e) => setText(e.target.value)} />
            </label>
            <div className="xs muted">مدیر خدمات تأیید می‌کند؛ پیشنهاددهنده نمی‌تواند پیشنهاد خود را تأیید کند.</div>
          </>
        )}
        {mode?.kind === 'decide' && (
          <>
            <div className="small">
              {FINANCE_APPROVAL_KIND_LABELS[mode.a.kind]} {rial(mode.a.amountRial)} — {mode.a.reason}
            </div>
            <label className="field">
              <span>{mode.decision === 'reject' ? 'دلیل رد *' : 'توضیح'}</span>
              <textarea className="input" value={text} onChange={(e) => setText(e.target.value)} />
            </label>
          </>
        )}
        {mode?.kind === 'pay' && (
          <>
            <div className="small">مبلغ: {rial(mode.a.amountRial)}</div>
            <label className="field">
              <span>شماره پیگیری / رسید پرداخت *</span>
              <input className="input ltr-input" value={text} onChange={(e) => setText(e.target.value)} />
            </label>
            <JalaliInput label="زمان دریافت" value={at} onChange={setAt} withTime nowButton />
          </>
        )}
        {mode?.kind === 'settle' && (
          <>
            <div className="small">مانده سهم مشتری: {rial(f.balanceRial ?? 0)}</div>
            <label className="field">
              <span>مبلغ دریافتی (ریال) *</span>
              <input className="input ltr-input" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label className="field">
              <span>شماره پیگیری / رسید پرداخت *</span>
              <input className="input ltr-input" value={text} onChange={(e) => setText(e.target.value)} />
            </label>
            <JalaliInput label="زمان دریافت" value={at} onChange={setAt} withTime nowButton />
          </>
        )}
      </Dialog>
    </section>
  );
}
