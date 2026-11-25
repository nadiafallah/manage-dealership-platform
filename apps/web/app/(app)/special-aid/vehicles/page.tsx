'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { SPECIAL_AID_QUEUES, SPECIAL_AID_QUEUE_LABELS, toPersianDigits, type DossierSearchInput, type Paged, type SpecialAidCard, type SpecialAidDossierRow, type SpecialAidReviewRow } from '@manage/shared';
import { api, errorMessage, fetcher } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { faNum } from '@/lib/format';
import { AppIcon } from '@/components/AppIcon';
import { DossierFolder, SpecialAidTabs, dayText } from '@/components/SpecialAid';
import { CardList, CardUpload } from '@/components/SpecialAidRecords';

const VIEWS: { key: DossierSearchInput['view']; label: string }[] = [
  { key: 'all', label: 'همه' }, { key: 'action', label: 'نیازمند اقدام' }, { key: 'arrived', label: 'دارای قطعهٔ رسیده' }, { key: 'pending', label: 'در حال تأمین' }, { key: 'review', label: 'نیازمند بررسی رزرو' },
  // The four work queues of the reconstruction scenario (owner 2026-11-25).
  ...SPECIAL_AID_QUEUES.map((k) => ({ key: k, label: SPECIAL_AID_QUEUE_LABELS[k] })),
];

/** «پرونده خودروها»: one folder per VIN; search by VIN, plate, customer, special-aid or admission number, or code. */
export default function SpecialAidVehiclesPage() {
  return <Suspense fallback={null}><SpecialAidVehicles /></Suspense>;
}

function SpecialAidVehicles() {
  const { can } = useAuth();
  const initial = useSearchParams().get('view');
  const [view, setView] = useState<DossierSearchInput['view']>(VIEWS.some((x) => x.key === initial) ? (initial as DossierSearchInput['view']) : 'all');
  const [extra, setExtra] = useState<'cards' | 'vin' | null>(null);
  const [term, setTerm] = useState(''), [q, setQ] = useState(''), [page, setPage] = useState(1);
  const body = { view, page, pageSize: 24, ...(q ? { q } : {}) };
  // POST keeps VINs and admission numbers out of URLs and access logs.
  const { data, error, isLoading } = useSWR<Paged<SpecialAidDossierRow>>(can('special_aid.read') && !extra ? ['/special-aid/dossiers/search', JSON.stringify(body)] : null, ([p, b]: [string, string]) => api<Paged<SpecialAidDossierRow>>(p, { body: JSON.parse(b) }));
  if (!can('special_aid.read')) return <div className="callout"><h1>پرونده خودروها</h1><p>برای این بخش مجوز ندارید.</p></div>;
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / 24));
  return (
    <section className="desk" aria-labelledby="aid-vehicles">
      <header className="desk-head">
        <div className="desk-hello"><h1 id="aid-vehicles">پرونده خودروهای امداد ویژه</h1><p className="desk-sub">{data ? `${faNum(data.total)} خودرو` : 'در حال خواندن…'}</p></div>
        <p className="desk-kicker">همهٔ خودروهای نمایندگی · تصادفی و تعمیرات عمومی</p>
      </header>
      <SpecialAidTabs />
      <div className="desk-tools">
        <div className="chips" role="group" aria-label="صافی پرونده‌ها">
          {VIEWS.map((v) => <button key={v.key} type="button" className={!extra && view === v.key ? 'on' : ''} aria-pressed={!extra && view === v.key} onClick={() => { setView(v.key); setPage(1); setExtra(null); }}>{v.label}</button>)}
          <button type="button" className={extra === 'cards' ? 'on' : ''} aria-pressed={extra === 'cards'} onClick={() => setExtra('cards')}>کارت‌های پذیرش</button>
          <button type="button" className={extra === 'vin' ? 'on' : ''} aria-pressed={extra === 'vin'} onClick={() => setExtra('vin')}>شاسی نامعتبر</button>
        </div>
        <form className="srch" role="search" onSubmit={(e) => { e.preventDefault(); setQ(term.trim()); setPage(1); }}>
          <AppIcon name="search" /><span className="sr-only">جست‌وجو</span>
          <input type="search" value={term} maxLength={80} onChange={(e) => setTerm(e.target.value)} placeholder="شاسی، پلاک، مشتری، شمارهٔ امداد یا پذیرش، کد…" />
        </form>
      </div>
      {extra === 'cards' && <CardsArchive />}
      {extra === 'vin' && <VinReview />}
      {!extra && <>
      {error && <p role="alert" className="m-error">{errorMessage(error)}</p>}
      {isLoading && !data && <div className="folder-grid" aria-hidden="true">{[0, 1, 2].map((i) => <div key={i} className="folder folder-skeleton" />)}</div>}
      {data && !data.items.length && <p className="m-empty">{q ? 'خودرویی با این جست‌وجو نیست.' : 'در این صافی خودرویی نیست.'}</p>}
      <div className="folder-grid" data-testid="aid-folders">{data?.items.map((d) => <DossierFolder key={d.id} d={d} />)}</div>
      {pages > 1 && <div className="row no-print"><button type="button" className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>صفحه قبل</button><span className="small">صفحه {faNum(page)} از {faNum(pages)}</span><button type="button" className="btn btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>صفحه بعد</button></div>}
      </>}
    </section>
  );
}

/** Bulk card upload and the cards still waiting for an exact match (retried after each report). */
function CardsArchive() {
  const { can } = useAuth();
  const { data, mutate } = useSWR<SpecialAidCard[]>('/special-aid/cards?state=unmatched', fetcher);
  return (
    <section className="panel" aria-labelledby="aid-card-archive"><div className="panel-head"><div><h2 id="aid-card-archive">بایگانی کارت پذیرش</h2><p className="muted small">کارت فقط با تطابق دقیق شمارهٔ پذیرش یا VIN به پرونده وصل می‌شود؛ کارت‌های وصل‌نشده پس از هر گزارش تازه دوباره بررسی می‌شوند. خواندن خودکار متن (OCR) هنوز تنظیم نشده است.</p></div></div>
      <div className="panel-body stack">
        {can('special_aid.operate') && <CardUpload onDone={() => void mutate()} />}
        <h3 className="small">در انتظار تطبیق ({faNum(data?.length ?? 0)})</h3>
        {data ? <CardList cards={data} onChanged={() => void mutate()} /> : <p className="muted small" role="status">در حال خواندن…</p>}
      </div>
    </section>
  );
}

/** Official lines whose VIN is not 17 valid characters: no dossier is guessed for them. */
function VinReview() {
  const { data, error } = useSWR<SpecialAidReviewRow[]>('/special-aid/review-queue', fetcher);
  return (
    <section className="panel" aria-labelledby="aid-vin-review"><div className="panel-head"><div><h2 id="aid-vin-review">شاسی نامعتبر یا ناقص</h2><p className="muted small">برای این ردیف‌ها پرونده ساخته نمی‌شود. شاسی را در ایساکو اصلاح کنید؛ گزارش بعدی ردیف را به پروندهٔ درست می‌برد.</p></div></div>
      <div className="panel-body">
        {error && <p role="alert" className="m-error">{errorMessage(error)}</p>}
        {data && !data.length && <p className="m-empty">ردیفی با شاسی نامعتبر نیست.</p>}
        {!!data?.length && <div className="table-scroll"><table className="table static"><thead><tr><th>شاسی در گزارش</th><th>امداد ویژه</th><th>پذیرش</th><th>قطعه</th><th>وضعیت رسمی</th><th>آخرین گزارش</th></tr></thead><tbody>
          {data.map((r) => <tr key={r.requestId}><td><bdi dir="ltr">{r.vinText || '—'}</bdi></td><td><bdi>{toPersianDigits(r.emdadNo ?? '—')}</bdi></td><td><bdi>{toPersianDigits(r.admissionNo ?? '—')}</bdi></td><td>{r.description ?? '—'}</td><td>{r.officialStatus || '—'}</td><td>{r.lastReportAt ? dayText(r.lastReportAt) : '—'}</td></tr>)}
        </tbody></table></div>}
      </div>
    </section>
  );
}
