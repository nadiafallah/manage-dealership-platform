'use client';

import Link from 'next/link';
import { QuotePanel, QuoteProposal } from './WorkshopQuotes';
import { useState } from 'react';
import useSWR from 'swr';
import {
  PART_INSPECTION_LABELS,
  PART_SOURCE_LABELS,
  PART_SOURCES,
  PART_STATUS_LABELS,
  type CaseDetail,
  type CaseFinance,
  type Department,
  type Part,
  type PartAction,
  type PartImportResult,
  type PartInspection,
  type PartSource,
  type PartStatus,
} from '@manage/shared';
import { api, errorMessage, fetcher } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { faNum, formatJalali, parseAmount, rial, toPersianDigits } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { StockFamilyPreview, PartStockActions, PartEmdadPreview } from './CaseStockPanel';
import { Dialog } from './Dialog';
import { JalaliInput } from './JalaliInput';
import { ReferenceLookup } from './ReferenceLookup';

const STATUS_TONE: Record<PartStatus, string> = {
  needed: 'chip-amber',
  reserved: 'chip-blue',
  ordered: 'chip-blue',
  received: 'chip-blue',
  rejected: 'chip-red',
  handed_over: 'chip-green',
  cancelled: '',
};

const ACTION_TITLES: Record<PartAction, string> = {
  check_stock: 'بررسی موجودی انبار',
  reserve: 'رزرو از انبار',
  order: 'سفارش قطعه',
  update_eta: 'تغییر زمان رسیدن',
  receive: 'رسید و کنترل قطعه',
  hand_over: 'تحویل به واحد تعمیر',
  cancel: 'لغو قطعه',
};

/** Actions offered for each status (the API enforces the same transitions). */
function actionsFor(p: Part): PartAction[] {
  switch (p.status) {
    case 'needed':
      return [p.inStock === null ? 'check_stock' : null, p.inStock ? 'reserve' : null, 'order', 'cancel'].filter(
        Boolean,
      ) as PartAction[];
    case 'reserved':
      return ['hand_over', 'cancel'];
    case 'ordered':
      return ['receive', 'update_eta', 'cancel'];
    case 'received':
      return ['hand_over'];
    case 'rejected':
      return ['order', 'cancel'];
    default:
      return [];
  }
}

type Mode =
  | { kind: 'action'; part: Part; action: PartAction }
  | { kind: 'new' }
  | { kind: 'import' }
  | null;

const sampleHref = '/samples/parts-import-sample.xlsx';

export function PartsPanel({ kase, onChange }: { kase: CaseDetail; onChange: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data: parts, mutate } = useSWR<Part[]>(`/cases/${kase.id}/parts`, fetcher);
  const { data: finance, mutate: mutateFinance } = useSWR<CaseFinance>(`/cases/${kase.id}/finance`, fetcher);
  const { data: departments } = useSWR<Department[]>('/departments', fetcher);
  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState(false);

  // Dialog fields.
  const [at, setAt] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [inStock, setInStock] = useState(true);
  const [source, setSource] = useState<PartSource>('company');
  const [supplier, setSupplier] = useState('');
  const [orderRef, setOrderRef] = useState('');
  const [price, setPrice] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [eta, setEta] = useState<string | null>(null);
  const [receiptDocNo, setReceiptDocNo] = useState('');
  const [inspection, setInspection] = useState<PartInspection>('ok');
  const [departmentId, setDepartmentId] = useState('');
  const [recipient, setRecipient] = useState('');
  const [description, setDescription] = useState('');
  const [partNumber, setPartNumber] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [preview, setPreview] = useState<{ fileBase64: string; result: PartImportResult } | null>(null);

  const request = can('part.request');
  const manage = can('part.manage');
  const editable = kase.status === 'open' && kase.stage !== 'delivered';
  const list = parts ?? [];

  function open(m: NonNullable<Mode>) {
    setMode(m);
    setAt(new Date().toISOString());
    setNote('');
    setPreview(null);
    if (m.kind === 'action') {
      const p = m.part;
      setInStock(true);
      setSource(p.source === 'stock' ? 'company' : p.source);
      setSupplier(p.supplier ?? '');
      setOrderRef(p.orderRef ?? '');
      setPrice(p.unitPriceRial ? String(p.unitPriceRial) : p.approvedUnitPriceRial ? String(p.approvedUnitPriceRial) : '');
      setSalePrice(p.salePriceRial === null && p.unitPriceRial === null ? '' : String(p.salePriceRial ?? p.unitPriceRial));
      setEta(p.etaAt);
      setReceiptDocNo('');
      setInspection('ok');
      setDepartmentId('');
      setRecipient('');
    } else if (m.kind === 'new') {
      setDescription('');
      setPartNumber('');
      setQuantity('1');
      setSource('company');
      setPrice('');
    }
  }

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await fn();
      toast(done);
      setMode(null);
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
      void mutate();
      void mutateFinance();
      onChange();
    }
  }

  async function submit() {
    if (!mode) return;
    if (mode.kind === 'new') {
      await run(
        () =>
          api(`/cases/${kase.id}/parts`, {
            body: {
              description,
              partNumber: partNumber || null,
              quantity: Math.max(1, parseAmount(quantity)),
              source,
              approvedUnitPriceRial: price ? parseAmount(price) : null,
            },
          }),
        'نیاز قطعه ثبت شد',
      );
      return;
    }
    if (mode.kind === 'import') {
      if (!preview) return;
      await run(
        () => api(`/cases/${kase.id}/parts/import`, { body: { fileBase64: preview.fileBase64, dryRun: false } }),
        `${toPersianDigits(preview.result.rows.length)} قطعه از اکسل وارد شد`,
      );
      return;
    }
    const { part, action } = mode;
    const body: Record<string, unknown> = { action, expectedVersion: part.version, at, note: note || null };
    if (action === 'check_stock') body.inStock = inStock;
    if (action === 'order') {
      Object.assign(body, {
        source,
        supplier: supplier || null,
        orderRef: orderRef || null,
        unitPriceRial: source === 'customer' ? undefined : parseAmount(price),
        etaAt: eta,
      });
    }
    if (action === 'update_eta') body.etaAt = eta;
    if (action === 'receive') Object.assign(body, { receiptDocNo: receiptDocNo || null, inspection });
    if (action === 'hand_over') Object.assign(body, { departmentId: departmentId || null, recipientName: recipient, salePriceRial: parseAmount(salePrice) ?? undefined });
    await run(() => api(`/parts/${part.id}/actions`, { body }), `${ACTION_TITLES[action]} ثبت شد`);
  }

  async function readFile(file: File) {
    if (file.size > 1_000_000) {
      toast('حجم فایل باید کمتر از ۱ مگابایت باشد', 'error');
      return;
    }
    const buffer = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let i = 0; i < buffer.length; i += 0x8000) binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
    const fileBase64 = btoa(binary);
    try {
      const result = await api<PartImportResult>(`/cases/${kase.id}/parts/import`, { body: { fileBase64, dryRun: true } });
      setPreview({ fileBase64, result });
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  const ordering = mode?.kind === 'action' && mode.action === 'order' ? mode.part : null;
  const canSubmit = (() => {
    if (!mode) return false;
    if (mode.kind === 'new') return !!description.trim();
    if (mode.kind === 'import') return !!preview && !preview.result.errors.length && preview.result.rows.length > 0;
    switch (mode.action) {
      case 'order':
        return source === 'customer' || !!price;
      case 'update_eta':
        return !!eta;
      case 'receive':
        return inspection === 'ok' || !!note.trim();
      case 'hand_over':
        return !!recipient.trim() && !!salePrice.trim();
      case 'cancel':
        return !!note.trim();
      default:
        return true;
    }
  })();

  const title = !mode
    ? ''
    : mode.kind === 'new'
      ? 'ثبت نیاز قطعه'
      : mode.kind === 'import'
        ? 'ورود قطعات از اکسل'
        : `${ACTION_TITLES[mode.action]}: ${mode.part.description}`;

  return (
    <section className="panel" data-testid="parts-panel">
      {editable&&<QuoteProposal parts={parts??[]} onChange={onChange}/>}
      <QuotePanel caseId={kase.id}/>
      <div className="panel-head">
        <h2>
          قطعات{' '}
          {can('part.manage') && (
            <Link className="xs no-print" href="/reports?view=parts">
              گزارش انبار
            </Link>
          )}
        </h2>
        {request && editable && (
          <div className="row" style={{ gap: 6 }}>
            <a className="btn btn-sm" href="#case-assessment">انتخاب و ارسال از کارشناسی</a>
            <button className="btn btn-sm" onClick={() => open({ kind: 'new' })}>
              افزودن قطعه
            </button>
            <button className="btn btn-sm" onClick={() => open({ kind: 'import' })}>
              ورود از اکسل
            </button>
          </div>
        )}
      </div>

      {finance && list.some((p) => p.status === 'needed' || p.status === 'rejected') && (
        <div className={`callout ${finance.gate.open ? 'callout-blue' : 'callout-amber'} small parts-gate`}>
          {finance.gate.message}
          {!finance.gate.open && ' — رزرو از انبار، برنامه‌ریزی و کار تعمیر ادامه دارد.'}
        </div>
      )}

      {!parts && <div className="panel-body muted small">در حال بارگذاری…</div>}
      {parts && !list.length && (
        <div className="panel-body muted small">
          قطعه‌ای ثبت نشده است.
          {request && editable ? ' اقلام را در بخش کارشناسی انتخاب و به قطعات و تأمین ارسال کنید.' : ''}
        </div>
      )}

      {list.map((p) => (
        <div key={p.id} className={`part${p.overdue ? ' is-late' : ''}`} data-testid="part">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="row" style={{ gap: 6 }}>
              <b>{p.description}</b>
              {p.quantity > 1 && <span className="small">× {toPersianDigits(p.quantity)}</span>}
              <span className={`chip ${STATUS_TONE[p.status]}`}>{PART_STATUS_LABELS[p.status]}</span>
              {p.overdue && <span className="chip chip-red">دیرکرد</span>}
              <span className="chip">{PART_SOURCE_LABELS[p.source]}</span>
            </div>
            {manage && editable && (
              <div className="row" style={{ gap: 6 }}>
                {actionsFor(p).map((a) => (
                  <button
                    key={a}
                    className={`btn btn-sm${a === 'cancel' ? ' btn-ghost' : a === 'hand_over' || a === 'receive' ? ' btn-primary' : ''}`}
                    onClick={() => open({ kind: 'action', part: p, action: a })}
                  >
                    {a === 'order' && p.status === 'rejected' ? 'سفارش مجدد' : ACTION_TITLES[a]}
                  </button>
                ))}
              </div>
            )}
          </div>
          {p.partNumber && <div className="small muted"><bdi>{p.partNumber}</bdi></div>}
          <PartStockActions part={p} caseId={kase.id} editable={editable}/>
          {p.partNumber && <PartEmdadPreview caseId={kase.id} partId={p.id} />}
          <details className="compact-disclosure"><summary>جزئیات پیگیری قطعه</summary><div className="xs muted meta">
            {p.partNumber && <span className="ltr">{p.partNumber}</span>}
            <span>نیاز: {formatJalali(p.createdAt, { time: true })}</span>
            {p.stockCheckedAt && <span>انبار: {p.inStock ? 'موجود' : 'ناموجود'}</span>}
            {p.reservedAt && <span>رزرو: {formatJalali(p.reservedAt, { time: true })}</span>}
            {p.orderedAt && (
              <span>
                سفارش: {formatJalali(p.orderedAt, { time: true })}
                {p.supplier ? ` از ${p.supplier}` : ''}
                {p.orderRef ? ` (${p.orderRef})` : ''}
              </span>
            )}
            {p.unitPriceRial !== null && (
              <span>
                قیمت: {rial(p.unitPriceRial)}
                {p.approvedUnitPriceRial !== null && p.unitPriceRial !== p.approvedUnitPriceRial
                  ? ` (تأییدشده ${faNum(p.approvedUnitPriceRial)}${p.priceApprovalRef ? `؛ تأیید ${p.priceApprovedBy} شماره ${p.priceApprovalRef}` : ''})`
                  : ''}
              </span>
            )}
            {p.unitPriceRial === null && p.approvedUnitPriceRial !== null && (
              <span>برآورد کارشناسی: {rial(p.approvedUnitPriceRial)}</span>
            )}
            {p.etaAt && p.status === 'ordered' && (
              <span>
                رسیدن: {formatJalali(p.etaAt, { time: true })}
                {p.firstEtaAt && p.firstEtaAt !== p.etaAt ? ` (وعده اول ${formatJalali(p.firstEtaAt)})` : ''}
              </span>
            )}
            {p.receivedAt && (
              <span>
                رسید: {formatJalali(p.receivedAt, { time: true })}
                {p.inspection ? ` — ${PART_INSPECTION_LABELS[p.inspection]}` : ''}
                {p.inspectionNote ? `؛ ${p.inspectionNote}` : ''}
              </span>
            )}
            {p.handedOverAt && (
              <span>
                تحویل: {formatJalali(p.handedOverAt, { time: true })} به {p.recipientName}
                {p.handedOverDepartment ? ` (${p.handedOverDepartment.name})` : ''}
              </span>
            )}
            {p.cancelReason && <span>لغو: {p.cancelReason}</span>}
          </div>
          </details>
        </div>
      ))}

      <Dialog
        open={!!mode}
        title={title}
        onClose={() => setMode(null)}
        footer={
          <>
            <button className="btn btn-primary" disabled={busy || !canSubmit} onClick={submit}>
              {mode?.kind === 'import' && preview ? `ورود ${toPersianDigits(preview.result.rows.length)} ردیف` : 'ثبت'}
            </button>
            <button className="btn" onClick={() => setMode(null)}>
              انصراف
            </button>
          </>
        }
      >
        {mode?.kind === 'new' && (
          <>
            {can('reference.parts.read') && <details className="compact-disclosure"><summary>انتخاب از کاتالوگ قطعات</summary><ReferenceLookup kind="parts" onSelect={r=>{setPartNumber(r.data.partNumber||'');setDescription(r.data.description||'');toast('کد و نام قطعه انتخاب شد؛ تعداد و منبع را مشخص کنید');}}/></details>}
            <label className="field">
              <span>شرح قطعه *</span>
              <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
            <div className="grid-2">
              <label className="field">
                <span>شماره فنی</span>
                <input className="input ltr-input" value={partNumber} onChange={(e) => setPartNumber(e.target.value)} />
              </label>
              <label className="field">
                <span>تعداد</span>
                <input className="input ltr-input" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </label>
            </div>
            <StockFamilyPreview partNumber={partNumber} />
            <SourceSelect value={source} onChange={setSource} />
            <label className="field">
              <span>برآورد واحد کارشناسی (ریال)</span>
              <input className="input ltr-input" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
              <span className="hint">خرید بالاتر از این مبلغ به تأیید کارشناس نیاز دارد.</span>
            </label>
          </>
        )}

        {mode?.kind === 'import' && (
          <>
            <div className="small">
              <p>برای خروجی کارشناسی کپی‌شده از PDF، از «دریافت اکسل کارشناسی» در بخش کارشناسی و الحاقیه استفاده کنید. این قالب مخصوص درخواست قطعه است.</p>
              ستون‌های ردیف اول: شرح قطعه، شماره فنی، تعداد، منبع، قیمت تأییدشده واحد (ریال)، توضیح.{' '}
              <a href={sampleHref} download>
                دریافت فایل نمونه
              </a>
            </div>
            <label className="field">
              <span>فایل اکسل (.xlsx)</span>
              <input
                className="input"
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void readFile(f);
                }}
              />
            </label>
            {preview && (
              <div className="stack" style={{ gap: 8 }} data-testid="import-preview">
                {preview.result.errors.length > 0 && (
                  <div className="callout callout-red small">
                    فایل خطا دارد و هیچ ردیفی وارد نمی‌شود:
                    <ul style={{ margin: '4px 0 0', paddingInlineStart: 18 }}>
                      {preview.result.errors.map((e) => (
                        <li key={e.row}>
                          ردیف {toPersianDigits(e.row)}: {e.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {preview.result.rows.length > 0 && (
                  <div className="small">
                    {toPersianDigits(preview.result.rows.length)} ردیف آماده ورود:{' '}
                    {preview.result.rows.map((r) => `${r.description} (${PART_SOURCE_LABELS[r.source]})`).join('، ')}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {mode?.kind === 'action' && (
          <>
            {mode.action === 'check_stock' && (
              <div className="segmented" role="group" aria-label="نتیجه موجودی">
                <button type="button" aria-pressed={inStock} onClick={() => setInStock(true)}>
                  در انبار موجود است
                </button>
                <button type="button" aria-pressed={!inStock} onClick={() => setInStock(false)}>
                  موجود نیست
                </button>
              </div>
            )}
            {mode.action === 'order' && (
              <>
                <SourceSelect value={source} onChange={setSource} exclude="stock" />
                <div className="grid-2">
                  <label className="field">
                    <span>تأمین‌کننده</span>
                    <input className="input" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
                  </label>
                  <label className="field">
                    <span>شماره سفارش</span>
                    <input className="input ltr-input" value={orderRef} onChange={(e) => setOrderRef(e.target.value)} />
                  </label>
                </div>
                {source !== 'customer' && (
                  <label className="field">
                    <span>قیمت واحد خرید (ریال) *</span>
                    <input className="input ltr-input" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
                    {ordering?.approvedUnitPriceRial !== null && ordering?.approvedUnitPriceRial !== undefined && (
                      <span className="hint">برآورد کارشناسی: {rial(ordering.approvedUnitPriceRial)}</span>
                    )}
                  </label>
                )}
                {source==='external'&&<p className="callout callout-amber small">پس از عدم تأمین انبار، شرکت و امداد، پیشنهاد قیمت بازار را ثبت کنید. خرید بیرون فقط با تأیید ثبت‌شده همان قیمت، تعداد و فروشنده توسط کارشناس تصادفات انجام می‌شود.</p>}
                <JalaliInput label="زمان پیش‌بینی رسیدن" value={eta} onChange={setEta} withTime />
                {finance && !finance.gate.open && source !== 'customer' && (
                  <div className="callout callout-red small">{finance.gate.message}</div>
                )}
              </>
            )}
            {mode.action === 'update_eta' && <JalaliInput label="زمان جدید رسیدن *" value={eta} onChange={setEta} withTime />}
            {mode.action === 'receive' && (
              <>
                <label className="field">
                  <span>شماره رسید انبار</span>
                  <input className="input ltr-input" value={receiptDocNo} onChange={(e) => setReceiptDocNo(e.target.value)} />
                </label>
                <div className="segmented" role="group" aria-label="نتیجه کنترل">
                  {(['ok', 'wrong', 'defective'] as const).map((k) => (
                    <button key={k} type="button" aria-pressed={inspection === k} onClick={() => setInspection(k)}>
                      {PART_INSPECTION_LABELS[k]}
                    </button>
                  ))}
                </div>
              </>
            )}
            {mode.action === 'hand_over' && (
              <div className="grid-2">
                <label className="field">
                  <span>واحد تعمیر</span>
                  <select className="input" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                    <option value="">—</option>
                    {(departments ?? [])
                      .filter((d) => d.isActive)
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="field">
                  <span>تحویل‌گیرنده *</span>
                  <input className="input" value={recipient} onChange={(e) => setRecipient(e.target.value)} />
                </label>
                <label className="field">
                  <span>قیمت فروش (ریال) *</span>
                  <input className="input ltr-input" inputMode="numeric" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} />
                </label>
              </div>
            )}
            {mode.action !== 'update_eta' && <JalaliInput label="زمان" value={at} onChange={setAt} withTime nowButton />}
            <label className="field">
              <span>
                {mode.action === 'cancel'
                  ? 'دلیل لغو *'
                  : mode.action === 'receive' && inspection !== 'ok'
                    ? 'شرح ایراد *'
                    : 'توضیح'}
              </span>
              <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </>
        )}
      </Dialog>
    </section>
  );
}

function SourceSelect({
  value,
  onChange,
  exclude,
}: {
  value: PartSource;
  onChange: (s: PartSource) => void;
  exclude?: PartSource;
}) {
  return (
    <label className="field">
      <span>منبع</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value as PartSource)}>
        {PART_SOURCES.filter((s) => s !== exclude).map((s) => (
          <option key={s} value={s}>
            {PART_SOURCE_LABELS[s]}
          </option>
        ))}
      </select>
    </label>
  );
}
