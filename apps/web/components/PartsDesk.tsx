'use client';
import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { parseStockCode, toLatinDigits, toPersianDigits, type CaseDetail, type DeskFolder, type Part, type StockOption, type StockSnapshotInfo } from '@manage/shared';
import { fetcher } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { faNum } from '@/lib/format';
import { AppIcon } from './AppIcon';
import { PartsLedger } from './PartsLedger';
import { PartsWorkbench } from './PartsWorkbench';

// Parts desk (spec §3, §7; owner reference «میز قطعات»): the cars that have part lines
// on the side, the single parts list of the chosen car in a folder, the usable stock of
// the open line, and one «گام بعدی». The parts clerk acts; others read.
const order = (f: DeskFolder) => (f.parts.undecided ? 0 : f.parts.emdadLate ? 1 : f.parts.ready ? 2 : f.parts.inProgress ? 3 : 4);

export function PartsDesk() {
  const { can } = useAuth();
  const params = useSearchParams();
  const { data: folders, error, mutate: reload } = useSWR<DeskFolder[]>('/desk/folders', fetcher, { refreshInterval: 60_000 });
  const [picked, setPicked] = useState<string | null>(params.get('case'));
  const [focus, setFocus] = useState<Part | null>(null);
  const [q, setQ] = useState('');
  const cars = useMemo(
    () => (folders ?? []).filter((f) => f.parts.total > 0).sort((a, b) => order(a) - order(b) || a.admittedAt.localeCompare(b.admittedAt)),
    [folders],
  );
  const term = toLatinDigits(q).trim().toLowerCase();
  const listed = cars.filter((f) => !term || [f.plate, f.caseNumber, f.admissionNo, f.vehicle, f.customerName].some((v) => v && toLatinDigits(v).toLowerCase().includes(term)));
  const selected = cars.find((f) => f.caseId === picked) ?? cars[0] ?? null;
  const { data: kase, mutate } = useSWR<CaseDetail>(selected ? `/cases/${selected.caseId}` : null, fetcher);
  const manage = can('part.manage');

  return (
    <section className="pdesk" aria-labelledby="pdesk-title">
      <header className="page-title">
        <span className="page-title-ico" aria-hidden="true"><AppIcon name="box" /></span>
        <div>
          <h1 id="pdesk-title">میز قطعات</h1>
          <p>مدیریت تأمین، موجودی و تحویل قطعات خودروهای تصادفی</p>
        </div>
      </header>
      {error && <p role="alert" className="m-error">فهرست خودروها خوانده نشد. <button type="button" className="m-btn-s" onClick={() => void reload()}>تلاش دوباره</button></p>}
      <div className="pdesk-grid">
        <aside className="pdesk-side" aria-label="خودروها و وضعیت">
          <section className="side-card">
            <h2><AppIcon name="folder" />پرونده‌های خودرو</h2>
            {cars.length > 6 && (
              <label className="srch side-srch"><AppIcon name="search" /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="پلاک، نام یا شماره" aria-label="جست‌وجو در خودروهای میز قطعات" /></label>
            )}
            {!folders && !error && <p className="m-empty" role="status">در حال خواندن…</p>}
            {folders && !cars.length && <p className="m-empty">خودرویی با قلم قطعه نیست.</p>}
            <ul className="car-list">
              {listed.map((f) => (
                <li key={f.caseId}>
                  <button type="button" className={selected?.caseId === f.caseId ? 'on' : ''} aria-pressed={selected?.caseId === f.caseId} onClick={() => { setPicked(f.caseId); setFocus(null); }}>
                    <AppIcon name="folder" />
                    <span className="car-name"><b>{f.vehicle}</b> · پرونده <bdi>{toPersianDigits(f.caseNumber)}</bdi></span>
                    {f.parts.undecided > 0 && <span className="cnt cnt-warn" title="تعیین تکلیف نشده">{faNum(f.parts.undecided)}</span>}
                    {f.parts.ready > 0 && <span className="cnt cnt-ok" title="آمادهٔ تحویل">{faNum(f.parts.ready)}</span>}
                    <AppIcon name="chevron-left" className="chev" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
          {can('stock.read') && <StockCard part={focus} />}
          {selected && (
            <section className="side-card next-card" aria-label="گام بعدی">
              <h2><AppIcon name="target" />گام بعدی</h2>
              <p>{nextText(selected, manage)}</p>
            </section>
          )}
        </aside>
        <div className="pdesk-main">
          {kase ? (
            <PartsLedger key={kase.id} kase={kase} title={`قطعات ${selected?.vehicle ?? 'این خودرو'}`} onChange={() => void mutate()} onFocusPart={setFocus} />
          ) : selected ? <p className="m-empty" role="status">در حال باز کردن پوشهٔ خودرو…</p> : null}
        </div>
      </div>
      {manage && (
        <details className="panel compact-disclosure desk-more">
          <summary>برنامه‌ریزی گروهی قطعات همهٔ خودروها با دستیار منیج</summary>
          <div className="panel-body"><PartsWorkbench /></div>
        </details>
      )}
    </section>
  );
}

function nextText(f: DeskFolder, manage: boolean): string {
  if (!manage) return 'وضعیت تأمین را اینجا می‌بینید؛ رزرو، امداد ویژه، خرید بازار و تحویل با مسئول قطعات است.';
  if (f.parts.undecided) return `برای ${faNum(f.parts.undecided)} قطعهٔ تعیین تکلیف نشده مسیر تأمین را انتخاب کنید.`;
  if (f.parts.emdadLate) return `${faNum(f.parts.emdadLate)} قطعهٔ امداد ویژه دیر کرده؛ پیگیری کنید.`;
  if (f.parts.ready) return `${faNum(f.parts.ready)} قطعه آماده است؛ به واحد تعمیر تحویل دهید.`;
  if (f.parts.inProgress) return `${faNum(f.parts.inProgress)} قطعه در راه است؛ با رسیدن، «ثبت رسید» را بزنید.`;
  return 'همهٔ قطعه‌های این خودرو تحویل شده‌اند.';
}

/** Usable stock of the open line's 8-digit code (spec §7 formula), summed over supplier suffixes. */
function StockCard({ part }: { part: Part | null }) {
  const code = part?.partNumber ? toLatinDigits(part.partNumber) : '';
  const base = code ? parseStockCode(code)?.basePartNumber ?? (/^\d{8}/.test(code) ? code.slice(0, 8) : null) : null;
  const { data, error } = useSWR<{ snapshot: StockSnapshotInfo | null; items: StockOption[] }>(base ? `/stock/options?base=${base}&pageSize=50` : null, fetcher);
  const sum = (k: 'available' | 'reported' | 'reserved') => (data?.items ?? []).reduce((n, o) => n + Number(o[k] || 0), 0);
  return (
    <section className="side-card stock-card" aria-label="وضعیت موجودی">
      <h2><AppIcon name="layers" />وضعیت موجودی {part ? 'این قطعه' : ''}</h2>
      {!part && <p className="muted small">یک قطعه را در فهرست باز کنید تا موجودی کد آن دیده شود.</p>}
      {part && !base && <p className="muted small">این قلم کد فنی ۸ رقمی ندارد.</p>}
      {error && <p className="small">موجودی خوانده نشد.</p>}
      {base && data && !data.snapshot && <p className="muted small">هنوز گزارش موجودی بارگذاری نشده است.</p>}
      {base && data?.snapshot && (
        <dl className="stock-nums">
          <div><dt>قابل استفاده</dt><dd>{faNum(sum('available'))}</dd></div>
          <div><dt>موجودی گزارش</dt><dd>{faNum(sum('reported'))}</dd></div>
          <div><dt>رزرو فعال</dt><dd>{faNum(sum('reserved'))}</dd></div>
        </dl>
      )}
    </section>
  );
}
