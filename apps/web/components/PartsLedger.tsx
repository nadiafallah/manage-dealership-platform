'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  PART_FLOW_FILTER_LABELS,
  PART_FLOW_FILTERS,
  PART_FLOW_NEXT_STEP,
  PART_FLOW_STATE_LABELS,
  formatJalaliDay,
  parseStockCode,
  partActionLabel,
  partFlowFilter,
  toLatinDigits,
  type CaseDetail,
  type Part,
  type PartFlowAction,
  type PartFlowActionInput,
  type PartFlowFilter,
  type PartFlowState,
  type PartImportResult,
  type StockOption,
  type StockSnapshotInfo,
} from '@manage/shared';
import { api, errorMessage, fetcher, newKey } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { faNum, parseAmount, toPersianDigits } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { QuotePanel, QuoteProposal } from './WorkshopQuotes';

const STATE_TONE: Record<PartFlowState, string> = {
  needed: 'wait',
  reserved: 'ok',
  emdad: 'em',
  dealer_supply: 'stop',
  market: 'em',
  ready: 'ok',
  handed_over: 'ok',
  consumed: 'mute',
  cancelled: 'mute',
  returned: 'mute',
};

const rialText = (n: number | null | undefined) => (n == null ? '—' : `${faNum(n)} ریال`);
const dayText = (iso: string | null | undefined) => (iso ? formatJalaliDay(iso) : '');
const keyOf = (s: string) => toLatinDigits(s).replace(/[\s\-‌_./]/g, '').toUpperCase();

/** One-line status under the state tag: official Emdad text and report date, ETA, handover… */
function stateDetail(p: Part): string {
  switch (p.flowState) {
    case 'emdad':
    case 'dealer_supply':
      return p.emdad ? `${p.emdad.statusText ?? 'بدون متن وضعیت'} · ${dayText(p.emdad.reportAt)}` : `درخواست ${toPersianDigits(p.orderRef ?? '—')} · ${dayText(p.orderedAt)}`;
    case 'market':
      return `${p.supplier ?? 'بازار'}${p.etaAt ? ` · رسیدن ${dayText(p.etaAt)}` : ''}`;
    case 'reserved':
      return `رزرو ${dayText(p.reservedAt)}`;
    case 'ready':
      return p.source === 'company' ? `امداد ویژه رسید · ${dayText(p.receivedAt)}` : `رسید ${dayText(p.receivedAt)}`;
    case 'handed_over':
    case 'consumed':
      return `${p.recipientName ?? ''}${p.handedOverDepartment ? ` (${p.handedOverDepartment.name})` : ''} · ${dayText(p.handedOverAt)}`;
    case 'cancelled':
      return p.cancelReason ?? '';
    case 'returned':
      return p.returnReason ?? '';
    default:
      return '';
  }
}

/** The one button shown on the closed row; the rest live inside the row. */
function primaryAction(p: Part): PartFlowAction | 'decide' | null {
  if (p.flowState === 'needed' || p.flowState === 'dealer_supply') return 'decide';
  for (const a of ['hand_over', 'receive'] as const) if (p.allowedActions.includes(a)) return a;
  return null;
}

/**
 * The single parts list of a vehicle (spec section 7): first assessment,
 * supplements, reservation, Emdad Vijeh, market purchase, price and handover —
 * all on one list. The parts clerk acts; the accident expert reads, adds needs
 * and answers price announcements. Each row is one line; details open on demand.
 */
export function PartsLedger({ kase, onChange }: { kase: CaseDetail; onChange?: () => void }) {
  const { can } = useAuth();
  const { data: parts, mutate, error } = useSWR<Part[]>(`/cases/${kase.id}/parts`, fetcher);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<PartFlowFilter | 'all'>('all');
  const [showClosed, setShowClosed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const editable = kase.status === 'open';
  const manage = editable && can('part.manage');

  const counts = useMemo(() => {
    const c: Record<PartFlowFilter, number> = { undecided: 0, in_progress: 0, ready: 0, delivered: 0 };
    for (const p of parts ?? []) {
      const f = partFlowFilter(p.flowState);
      if (f) c[f] += 1;
    }
    return c;
  }, [parts]);

  const visible = useMemo(() => {
    const term = keyOf(q.trim());
    const words = q.trim().split(/\s+/).filter(Boolean);
    return (parts ?? []).filter((p) => {
      const f = partFlowFilter(p.flowState);
      if (!showClosed && f === null) return false;
      if (filter !== 'all' && f !== filter) return false;
      if (!q.trim()) return true;
      const hay = `${p.description} ${p.notes ?? ''} ${p.supplier ?? ''}`;
      return (!!term && (keyOf(p.partNumber ?? '').includes(term) || keyOf(p.orderRef ?? '').includes(term) || keyOf(p.emdad?.requestNo ?? '').includes(term))) || words.every((w) => hay.includes(w));
    });
  }, [parts, q, filter, showClosed]);

  const closedCount = (parts ?? []).filter((p) => partFlowFilter(p.flowState) === null).length;
  const refresh = async () => {
    await mutate();
    onChange?.();
  };

  return (
    <section className="m-paper m-sheet" data-testid="parts-ledger" aria-labelledby="parts-ledger-title">
      <div className="m-head">
        <div>
          <h2 id="parts-ledger-title">فهرست قطعات</h2>
          <span className="m-lbl">یک فهرست برای این خودرو · {faNum(parts?.length ?? 0)} قلم</span>
        </div>
        {editable && can('part.request') && <AddPart caseId={kase.id} onDone={refresh} />}
      </div>
      <div className="m-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <label className="m-search">
            <span className="m-lbl" aria-hidden="true">جست‌وجو</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="نام، کد فنی یا شمارهٔ درخواست" aria-label="جست‌وجو در قطعات" />
          </label>
        </div>
        <div className="m-chips" role="group" aria-label="صافی قطعات">
          <button type="button" className="m-chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            همه <span>{faNum((parts?.length ?? 0) - closedCount)}</span>
          </button>
          {PART_FLOW_FILTERS.map((f) => (
            <button key={f} type="button" className="m-chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {PART_FLOW_FILTER_LABELS[f]} <span>{faNum(counts[f])}</span>
            </button>
          ))}
          {closedCount > 0 && (
            <button type="button" className="m-chip" aria-pressed={showClosed} onClick={() => setShowClosed((v) => !v)}>
              لغوشده و مرجوعی <span>{faNum(closedCount)}</span>
            </button>
          )}
        </div>
        {error && <p className="m-error" role="alert">دریافت فهرست قطعات ناموفق بود؛ صفحه را تازه کنید.</p>}
        {!parts && !error && <p className="m-empty" role="status">در حال دریافت قطعات…</p>}
        {parts && visible.length === 0 && <p className="m-empty">{parts.length ? 'قطعه‌ای با این صافی نیست.' : 'هنوز قطعه‌ای برای این خودرو ثبت نشده است.'}</p>}
        <div className="m-rows">
          {visible.map((p) => (
            <PartRow key={p.id} kase={kase} part={p} manage={manage} expanded={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} onDone={refresh} />
          ))}
        </div>
        {/* Payer authorization for golden card / insurance (spec section 7): the clerk proposes a market price, the expert records the payer's answer. */}
        {manage && (kase.coverageType === 'golden_card' || kase.coverageType === 'insurance') && <QuoteProposal parts={(parts ?? []).filter((p) => p.flowState === 'needed')} onChange={() => void refresh()} />}
        <QuotePanel caseId={kase.id} />
      </div>
    </section>
  );
}

function PartRow({ kase, part: p, manage, expanded, onToggle, onDone }: { kase: CaseDetail; part: Part; manage: boolean; expanded: boolean; onToggle: () => void; onDone: () => Promise<void> }) {
  const { can } = useAuth();
  const [form, setForm] = useState<PartFlowAction | null>(null);
  const primary = manage ? primaryAction(p) : null;
  const detail = stateDetail(p);
  const choose = (a: PartFlowAction) => {
    if (!expanded) onToggle();
    setForm(a);
  };
  const decideActions = p.allowedActions.filter((a) => a !== 'set_price' && a !== 'announce_price');
  return (
    <div className="m-row" id={`part-${p.id}`} data-testid="part" data-state={p.flowState}>
      <div className="m-row-head" role="button" tabIndex={0} aria-expanded={expanded} onClick={onToggle} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}>
        <div className="m-row-name">
          <span>{p.description}</span>
          <small className="m-num">× {faNum(p.quantity)}</small>
          {p.fromSupplement && <span className="m-badge">الحاقیه</span>}
          {p.priceNotice && <span className="m-tag wait">اعلام قیمت</span>}
        </div>
        <div className="m-row-state">
          <span className={`m-tag ${STATE_TONE[p.flowState]}`}>{PART_FLOW_STATE_LABELS[p.flowState]}</span>
          {detail && <small>{detail}</small>}
        </div>
        <div className="m-row-action" onClick={(e) => e.stopPropagation()}>
          {primary === 'decide' && <button type="button" className="m-btn-s" aria-expanded={expanded} onClick={onToggle}>تعیین تکلیف</button>}
          {primary && primary !== 'decide' && <button type="button" className="m-btn-s" onClick={() => choose(primary)}>{partActionLabel(p.flowState, primary)}</button>}
        </div>
      </div>
      {expanded && (
        <div className="m-row-body">
          {manage && <div className="m-next"><b>قدم بعدی</b>{PART_FLOW_NEXT_STEP[p.flowState]}</div>}
          <dl className="m-dl">
            <dt>کد فنی</dt>
            <dd><bdi className="m-num">{toPersianDigits(p.partNumber ?? '—')}</bdi></dd>
            {(p.orderRef || p.emdad?.requestNo) && (<><dt>شمارهٔ درخواست امداد ویژه</dt><dd><bdi>{toPersianDigits(p.emdad?.requestNo ?? p.orderRef ?? '')}</bdi>{p.orderedAt ? ` · ${dayText(p.orderedAt)}` : ''}</dd></>)}
            {p.emdad && (<><dt>گزارش امداد ویژه</dt><dd>{p.emdad.statusText ?? '—'} · {dayText(p.emdad.reportAt)}</dd></>)}
            <dt>قیمت فروش</dt>
            <dd className="m-num">{rialText(p.salePriceRial)}</dd>
            {p.unitPriceRial != null && (<><dt>قیمت خرید</dt><dd className="m-num">{rialText(p.unitPriceRial)}{p.supplier ? ` · ${p.supplier}` : ''}</dd></>)}
            {p.approvedUnitPriceRial != null && (<><dt>مبلغ کارشناسی</dt><dd className="m-num">{rialText(p.approvedUnitPriceRial)}</dd></>)}
            <dt>ثبت نیاز</dt>
            <dd>{p.createdBy.displayName} · {dayText(p.createdAt)}</dd>
          </dl>
          {p.priceNotice && <PriceNoticeBox part={p} canAnswer={kase.status === 'open' && can('case.update')} onDone={onDone} />}
          {manage && decideActions.length > 0 && (
            <div className="m-actions" role="group" aria-label={`اقدام‌های ${p.description}`}>
              {decideActions.map((a) => (
                <button key={a} type="button" className={form === a ? 'm-btn-s' : a === 'cancel' || a === 'return' ? 'm-btn2-s warn' : 'm-btn2-s'} aria-pressed={form === a} onClick={() => setForm(form === a ? null : a)}>
                  {partActionLabel(p.flowState, a)}
                </button>
              ))}
              {(['set_price', 'announce_price'] as const).filter((a) => p.allowedActions.includes(a)).map((a) => (
                <button key={a} type="button" className={form === a ? 'm-btn-s' : 'm-btn2-s'} aria-pressed={form === a} onClick={() => setForm(form === a ? null : a)}>
                  {partActionLabel(p.flowState, a)}
                </button>
              ))}
            </div>
          )}
          {manage && form && <FlowForm kase={kase} part={p} action={form} onCancel={() => setForm(null)} onDone={async () => { setForm(null); await onDone(); }} />}
        </div>
      )}
    </div>
  );
}

/** One small form per action; the API checks the state machine again. */
function FlowForm({ kase, part: p, action, onCancel, onDone }: { kase: CaseDetail; part: Part; action: PartFlowAction; onCancel: () => void; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [key] = useState(newKey);
  const [v, setV] = useState<Record<string, string>>({});
  const [option, setOption] = useState<{ o: StockOption; snapshot: StockSnapshotInfo } | null>(null);
  const set = (k: string) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const amount = (k: string) => (v[k]?.trim() ? parseAmount(v[k]!) : undefined);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    let body: PartFlowActionInput;
    const base = { expectedVersion: p.version };
    switch (action) {
      case 'reserve':
        if (!option) return setErr('یکی از کدهای موجود را انتخاب کنید');
        body = { ...base, action, snapshotId: option.snapshot.id, fullStockCode: option.o.fullStockCode, locationAddress: option.o.locationAddress, saleUnitRial: amount('sale') };
        break;
      case 'emdad':
        body = { ...base, action, requestNo: toLatinDigits(v.requestNo ?? '').trim(), requestedCode: v.code?.trim() ? toLatinDigits(v.code) : undefined };
        break;
      case 'market':
        body = { ...base, action, supplier: v.supplier ?? '', purchaseUnitRial: amount('purchase') ?? 0, saleUnitRial: amount('sale') ?? 0 };
        break;
      case 'receive':
        body = { ...base, action, receiptDocNo: v.doc?.trim() || undefined };
        break;
      case 'hand_over':
        body = { ...base, action, recipientName: v.recipient ?? '', taskId: v.task || null, saleUnitRial: amount('sale') };
        break;
      case 'cancel':
      case 'return':
        body = { ...base, action, reason: v.reason ?? '' };
        break;
      case 'set_price':
        body = { ...base, action, saleUnitRial: amount('sale') ?? 0 };
        break;
      case 'announce_price':
        body = { ...base, action, saleUnitRial: amount('sale') ?? 0, note: v.note?.trim() || undefined };
        break;
    }
    setBusy(true);
    setErr('');
    try {
      await api<Part>(`/parts/${p.id}/flow`, { body, idempotencyKey: key });
      toast(`${partActionLabel(p.flowState, action)} ثبت شد`);
      await onDone();
    } catch (x) {
      setErr(errorMessage(x));
    } finally {
      setBusy(false);
    }
  }

  const openTasks = (kase.tasks ?? []).filter((t) => t.status !== 'approved');
  const salePlaceholder = p.salePriceRial != null ? toPersianDigits(String(p.salePriceRial)) : '';
  return (
    <form className="m-form" onSubmit={submit} aria-label={partActionLabel(p.flowState, action)}>
      {action === 'reserve' && <StockChoice part={p} value={option} onChange={setOption} />}
      {action === 'emdad' && (
        <>
          <label className="m-field">شمارهٔ درخواست امداد ویژه *<input required inputMode="numeric" dir="ltr" value={v.requestNo ?? ''} onChange={set('requestNo')} /></label>
          <label className="m-field">کد اختصاصی درخواست‌شده<input dir="ltr" value={v.code ?? ''} onChange={set('code')} placeholder={p.partNumber ?? ''} /></label>
        </>
      )}
      {action === 'market' && (
        <>
          <label className="m-field">فروشنده *<input required value={v.supplier ?? ''} onChange={set('supplier')} /></label>
          <label className="m-field">قیمت خرید واحد (ریال) *<input required inputMode="numeric" dir="ltr" value={v.purchase ?? ''} onChange={set('purchase')} /></label>
          <label className="m-field">قیمت فروش واحد (ریال) *<input required inputMode="numeric" dir="ltr" value={v.sale ?? ''} onChange={set('sale')} /></label>
          {(kase.coverageType === 'golden_card' || kase.coverageType === 'insurance') && <p className="m-warn" style={{ flexBasis: '100%', margin: 0 }}>کارت طلایی / بیمه: اگر از مبلغ کارشناسی گران‌تر است، کارشناس تصادفات مجوز پرداخت‌کننده را ثبت می‌کند. کار متوقف نمی‌شود.</p>}
        </>
      )}
      {action === 'receive' && <label className="m-field">شمارهٔ رسید (اختیاری)<input dir="ltr" value={v.doc ?? ''} onChange={set('doc')} /></label>}
      {action === 'hand_over' && (
        <>
          <label className="m-field">جایگاه / قدم تعمیر
            <select value={v.task ?? ''} onChange={set('task')}>
              <option value="">— بدون انتخاب —</option>
              {openTasks.map((t) => <option key={t.id} value={t.id}>{t.stationName ?? t.department.name}{t.title ? ` · ${t.title}` : ''}</option>)}
            </select>
          </label>
          <label className="m-field">تحویل‌گیرنده *<input required value={v.recipient ?? ''} onChange={set('recipient')} /></label>
          {p.salePriceRial == null && <label className="m-field">قیمت فروش واحد (ریال) *<input required inputMode="numeric" dir="ltr" value={v.sale ?? ''} onChange={set('sale')} /></label>}
        </>
      )}
      {(action === 'cancel' || action === 'return') && (
        <label className="m-field" style={{ flexBasis: '100%' }}>علت {action === 'return' ? 'مرجوعی' : 'لغو'} *<input required minLength={3} value={v.reason ?? ''} onChange={set('reason')} /></label>
      )}
      {(action === 'set_price' || action === 'announce_price') && (
        <>
          <label className="m-field">قیمت فروش واحد (ریال) *<input required inputMode="numeric" dir="ltr" value={v.sale ?? ''} onChange={set('sale')} placeholder={salePlaceholder} /></label>
          {action === 'announce_price' && <label className="m-field">توضیح برای کارشناس<input value={v.note ?? ''} onChange={set('note')} /></label>}
        </>
      )}
      {err && <p className="m-error" role="alert" style={{ flexBasis: '100%', margin: 0 }}>{err}</p>}
      <div className="m-actions" style={{ flexBasis: '100%' }}>
        <button type="submit" className="m-btn-s" disabled={busy}>{busy ? 'در حال ثبت…' : action === 'set_price' ? 'ذخیرهٔ قیمت' : partActionLabel(p.flowState, action)}</button>
        <button type="button" className="m-btn2-s" onClick={onCancel}>انصراف</button>
        {action === 'set_price' && (
          <span className="m-lbl" style={{ alignSelf: 'center' }}>تغییر قیمت بی‌پیام است؛ برای خبر دادن به کارشناس «اعلام قیمت» را بزنید.</span>
        )}
      </div>
    </form>
  );
}

/**
 * Reservation by the first 8 digits of the code (spec section 7): every supplier
 * suffix in stock with its usable quantity, price and place; one is preselected
 * when it is the only one. A code held by another open case shows who holds it.
 */
function StockChoice({ part, value, onChange }: { part: Part; value: { o: StockOption; snapshot: StockSnapshotInfo } | null; onChange: (v: { o: StockOption; snapshot: StockSnapshotInfo } | null) => void }) {
  const base = part.partNumber ? parseStockCode(toLatinDigits(part.partNumber))?.basePartNumber ?? (/^\d{8}/.test(toLatinDigits(part.partNumber)) ? toLatinDigits(part.partNumber).slice(0, 8) : null) : null;
  const [q, setQ] = useState(base ? '' : part.description);
  const url = base ? `/stock/options?base=${base}&pageSize=50` : q.trim().length >= 2 ? `/stock/options?q=${encodeURIComponent(q.trim())}&pageSize=30` : null;
  const { data, error } = useSWR<{ snapshot: StockSnapshotInfo | null; items: StockOption[] }>(url, fetcher, {
    onSuccess: (d) => {
      const usable = d.items.filter((o) => Number(o.available) >= part.quantity);
      if (!value && d.snapshot && usable.length === 1) onChange({ o: usable[0]!, snapshot: d.snapshot });
    },
  });
  return (
    <div style={{ flexBasis: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {base ? (
        <span className="m-lbl">کدهای موجود با ۸ رقم اول <bdi>{toPersianDigits(base)}</bdi> (کد اختصاصی سازنده‌های مختلف)</span>
      ) : (
        <label className="m-field">جست‌وجوی موجودی (کد یا نام)<input value={q} onChange={(e) => setQ(e.target.value)} /></label>
      )}
      {error && <p className="m-error" role="alert">دریافت موجودی ناموفق بود.</p>}
      {data && !data.snapshot && <p className="m-warn">گزارش موجودی امروز بارگذاری نشده است.</p>}
      {data?.snapshot && data.items.length === 0 && <p className="m-empty">موجودی قابل‌استفاده‌ای برای این کد نیست.</p>}
      {data?.snapshot && data.items.map((o) => {
        const enough = Number(o.available) >= part.quantity;
        const held = (o.reservedFor ?? []).filter((h) => h.caseId !== part.caseId);
        const selected = !!value && value.o.fullStockCode === o.fullStockCode && value.o.locationAddress === o.locationAddress;
        return (
          <label key={`${o.fullStockCode}@${o.locationAddress}`} className="m-option" aria-disabled={!enough}>
            <input type="radio" name={`stock-${part.id}`} disabled={!enough} checked={selected} onChange={() => onChange({ o, snapshot: data.snapshot! })} />
            <span>
              <bdi className="m-num" style={{ fontWeight: 700 }}>{toPersianDigits(o.fullStockCode)}</bdi> · {o.description ?? ''}
              <br />
              <small className="m-muted">محل {o.locationText || toPersianDigits(o.locationAddress) || '—'}{held.length ? ` · رزرو فعال برای پروندهٔ ${held.map((h) => toPersianDigits(h.caseNumber)).join('، ')}` : ''}</small>
            </span>
            <span style={{ textAlign: 'end' }}>
              <b className="m-num">{toPersianDigits(o.available)}</b> <small className="m-muted">قابل‌استفاده</small>
              <br />
              <small className="m-num">{o.salePrice ? `${toPersianDigits(Number(o.salePrice).toLocaleString('en-US'))} ریال` : 'بی‌قیمت'}</small>
            </span>
          </label>
        );
      })}
    </div>
  );
}

function PriceNoticeBox({ part, canAnswer, onDone }: { part: Part; canAnswer: boolean; onDone: () => Promise<void> }) {
  const n = part.priceNotice!;
  const toast = useToast();
  const [mode, setMode] = useState<'instruction' | null>(null), [text, setText] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  async function answer(response: 'approved' | 'instruction') {
    setBusy(true);
    setErr('');
    try {
      await api(`/price-notices/${n.id}/respond`, { body: { expectedVersion: n.version, response, instruction: response === 'instruction' ? text.trim() : undefined } });
      toast('پاسخ ثبت شد');
      await onDone();
    } catch (x) {
      setErr(errorMessage(x));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="m-warn" data-testid="price-notice">
      <b>اعلام قیمت:</b> «این را به <span className="m-num">{rialText(n.saleUnitRial)}</span> می‌فروشم» — {n.announcedBy.displayName} · {dayText(n.announcedAt)}
      {n.note && <div>{n.note}</div>}
      {canAnswer && (
        <div className="m-actions" style={{ marginBlockStart: 8 }}>
          <button type="button" className="m-btn-s" disabled={busy} onClick={() => answer('approved')}>تأیید قیمت</button>
          <button type="button" className="m-btn2-s" disabled={busy} onClick={() => setMode(mode ? null : 'instruction')}>دستور دیگر</button>
        </div>
      )}
      {mode === 'instruction' && (
        <div className="m-form" style={{ marginBlockStart: 8 }}>
          <label className="m-field">دستور (مثلاً از فروشگاه فلان بخرید یا امداد ویژه بزنید)<input value={text} onChange={(e) => setText(e.target.value)} /></label>
          <button type="button" className="m-btn-s" disabled={busy || !text.trim()} onClick={() => answer('instruction')}>ثبت دستور</button>
        </div>
      )}
      {err && <p className="m-error" role="alert">{err}</p>}
      <div className="m-lbl" style={{ marginBlockStart: 4 }}>پاسخ ندادن کار را متوقف نمی‌کند؛ فقط ثبت می‌شود.</div>
    </div>
  );
}

/** The expert adds a need (single) or a sheet with preview; the same code never makes a second row. */
function AddPart({ caseId, onDone }: { caseId: string; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [open, setOpen] = useState<'one' | 'sheet' | null>(null);
  const [desc, setDesc] = useState(''), [code, setCode] = useState(''), [qty, setQty] = useState('1');
  const [file, setFile] = useState<string | null>(null), [preview, setPreview] = useState<PartImportResult | null>(null);
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  async function addOne(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api(`/cases/${caseId}/parts`, { body: { description: desc.trim(), partNumber: code.trim() ? toLatinDigits(code.trim()) : null, quantity: Math.max(1, parseAmount(qty) || 1), source: 'company' } });
      toast('قطعه به فهرست اضافه شد');
      setDesc('');
      setCode('');
      setQty('1');
      await onDone();
    } catch (x) {
      setErr(errorMessage(x));
    } finally {
      setBusy(false);
    }
  }
  async function pick(f: File | undefined) {
    setPreview(null);
    setErr('');
    if (!f) return setFile(null);
    const buf = new Uint8Array(await f.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    const b64 = btoa(bin);
    setFile(b64);
    setBusy(true);
    try {
      setPreview(await api<PartImportResult>(`/cases/${caseId}/parts/import`, { body: { fileBase64: b64, dryRun: true } }));
    } catch (x) {
      setErr(errorMessage(x));
    } finally {
      setBusy(false);
    }
  }
  async function importSheet() {
    if (!file) return;
    setBusy(true);
    setErr('');
    try {
      const r = await api<PartImportResult>(`/cases/${caseId}/parts/import`, { body: { fileBase64: file, dryRun: false } });
      toast(`${faNum(r.created)} قلم تازه وارد شد${r.duplicates.length ? `؛ ${faNum(r.duplicates.length)} قلم تکراری کنار گذاشته شد` : ''}`);
      setOpen(null);
      setFile(null);
      setPreview(null);
      await onDone();
    } catch (x) {
      setErr(errorMessage(x));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="m-actions">
      <button type="button" className="m-btn2-s" aria-pressed={open === 'one'} onClick={() => setOpen(open === 'one' ? null : 'one')}>افزودن قطعه</button>
      <button type="button" className="m-btn2-s" aria-pressed={open === 'sheet'} onClick={() => setOpen(open === 'sheet' ? null : 'sheet')}>ورود از اکسل</button>
      {open === 'one' && (
        <form className="m-form" onSubmit={addOne} style={{ flexBasis: '100%' }} aria-label="افزودن قطعه">
          <label className="m-field">نام قطعه *<input required value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
          <label className="m-field">کد فنی<input dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} /></label>
          <label className="m-field" style={{ flex: '0 1 90px' }}>تعداد<input inputMode="numeric" dir="ltr" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
          <button type="submit" className="m-btn-s" disabled={busy || !desc.trim()}>افزودن</button>
          {err && <p className="m-error" role="alert" style={{ flexBasis: '100%', margin: 0 }}>{err}</p>}
        </form>
      )}
      {open === 'sheet' && (
        <div className="m-form" style={{ flexBasis: '100%' }}>
          <label className="m-field">فایل اکسل (.xlsx)<input type="file" accept=".xlsx" onChange={(e) => void pick(e.target.files?.[0])} /></label>
          {preview && (
            <p data-testid="import-preview" style={{ flexBasis: '100%', margin: 0 }}>
              {faNum(preview.rows.length)} قلم تازه{preview.duplicates.length ? `، ${faNum(preview.duplicates.length)} قلم تکراری کنار گذاشته شد` : ''}
              {preview.errors.length ? ` · ${faNum(preview.errors.length)} خطا` : ''}
            </p>
          )}
          {preview && !preview.errors.length && preview.rows.length > 0 && <button type="button" className="m-btn-s" disabled={busy} onClick={importSheet}>تأیید و ورود</button>}
          {err && <p className="m-error" role="alert" style={{ flexBasis: '100%', margin: 0 }}>{err}</p>}
        </div>
      )}
    </div>
  );
}
