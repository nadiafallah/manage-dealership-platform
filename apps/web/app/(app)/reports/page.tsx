'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import useSWR from 'swr';
import {
  BLOCKER_REASONS,
  BLOCKER_REASON_LABELS,
  CASE_STAGES,
  COVERAGE_LABELS,
  COVERAGE_TYPES,
  PART_STATUSES,
  PART_STATUS_LABELS,
  REPORT_VIEW_LABELS,
  STAGE_LABELS,
  WORK_PRIORITY_LABELS,
  type Department,
  type ReportResult,
  type ReportView,
  type UserRef,
} from '@manage/shared';
import { ApiError, fetcher } from '@/lib/api';
import { faNum, formatJalali, toPersianDigits } from '@/lib/format';
import { DiscrepancyQueue } from '@/components/DiscrepancyQueue';
import { ReportChart } from '@/components/ReportChart';
import { ReminderComposer, type ReminderDefaults } from '@/components/ReminderComposer';
import { useAuth } from '@/lib/auth';

type Views = { views: ReportView[]; defaultView: ReportView | null; defaultResponsible: 'me' | null };
const PRIORITY_TONE: Record<string, string> = { overdue: 'chip-red', today: 'chip-amber', soon: 'chip-amber', later: 'chip-blue', none: '' };
// Report-specific keys kept in the URL (filters survive opening a case and coming back).
const KEYS = ['view', 'tab', 'period', 'from', 'to', 'responsibleUserId', 'departmentId', 'stationCode', 'stage', 'coverage', 'blockerReason', 'partStatus', 'q', 'kind', 'page'] as const;

function ReportsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { data: meta, error: metaError } = useSWR<Views>('/reports/views', fetcher);
  const view = (params.get('view') as ReportView | null) ?? meta?.defaultView ?? null;
  const tab = params.get('tab') === 'stats' ? 'stats' : 'today';
  const { can } = useAuth();
  // Service manager: a reminder beside each row and finding goes to the executive role, never to the manager.
  const [remind, setRemind] = useState<ReminderDefaults | null>(null);
  const remindRow = (i: ReportResult['items']['rows'][number]) => {
    const partsWork = !!i.partId || /part|discrepanc/.test(i.kind);
    setRemind({
      caseId: i.caseId,
      caseLabel: i.caseNumber,
      plate: i.plate,
      source: 'manager_report',
      body: `پیگیری: ${i.nextAction}`.slice(0, 300),
      ...(partsWork ? { role: 'parts_clerk' as const } : i.responsible ? { userIds: [i.responsible.id] } : { role: 'accident_expert' as const }),
    });
  };

  // First visit: apply the role's default view (and "my cases" for an accident expert).
  useEffect(() => {
    if (!meta?.defaultView || params.get('view')) return;
    const next = new URLSearchParams(params.toString());
    next.set('view', meta.defaultView);
    if (meta.defaultView === 'accident' && meta.defaultResponsible) next.set('responsibleUserId', meta.defaultResponsible);
    router.replace(`${pathname}?${next}`);
  }, [meta, params, pathname, router]);

  // Built from the live URL, not the render-time params: two quick changes (view, then a
  // filter) must not overwrite each other.
  const set = (patch: Record<string, string | null>, keepPage = false) => {
    const next = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    if (!keepPage) next.delete('page');
    router.push(`${pathname}?${next}`, { scroll: false });
  };

  const apiQuery = new URLSearchParams();
  for (const k of KEYS) {
    const v = params.get(k);
    if (v && k !== 'tab') apiQuery.set(k, v);
  }
  if (view) apiQuery.set('view', view);
  const ready = !!view && (params.get('period') !== 'custom' || (!!params.get('from') && !!params.get('to')));
  const { data, error, isLoading } = useSWR<ReportResult>(ready ? `/reports?${apiQuery}` : null, fetcher, { keepPreviousData: true });
  const { data: departments } = useSWR<Department[]>('/departments', fetcher);
  const { data: people } = useSWR<UserRef[]>('/users/assignable', fetcher);

  if (metaError) return <p className="callout callout-red">فهرست گزارش‌ها دریافت نشد. صفحه را تازه کنید.</p>;
  if (!meta) return <p className="muted">در حال بارگذاری…</p>;
  if (!meta.views.length) return <p className="callout callout-amber">برای نقش شما گزارشی تعریف نشده است.</p>;

  const exportQuery = new URLSearchParams(apiQuery);
  exportQuery.delete('page');
  const pages = data ? Math.max(1, Math.ceil(data.items.total / data.items.pageSize)) : 1;

  return (
    <div className="stack report-page">
      <div className="page-head">
        <div>
          <h1>گزارش‌ها{view ? ` — ${REPORT_VIEW_LABELS[view]}` : ''}</h1>
          <p className="muted small" aria-live="polite">
            {data ? `تهیه‌شده ${formatJalali(data.generatedAt, { time: true })}؛ برای به‌روزرسانی صفحه را تازه کنید.` : ' '}
            {data?.isTestData && <span className="chip chip-amber" style={{ marginInlineStart: 8 }}>داده آزمایشی</span>}
          </p>
        </div>
        <div className="row no-print" style={{ gap: 6 }}>
          <button className="btn" type="button" onClick={() => window.print()}>
            چاپ
          </button>
          {data && (
            <a className="btn" href={`/api/v1/reports/export?${exportQuery}`} download>
              خروجی Excel ({faNum(Math.min(data.items.total, 5000))} ردیف{data.items.total > 5000 ? ' از ' + faNum(data.items.total) : ''})
            </a>
          )}
          {data && (
            <a className="btn" href={`/api/v1/reports/pdf?${exportQuery}`} download>
              خروجی PDF ({faNum(Math.min(data.items.total, 1000))} ردیف{data.items.total > 1000 ? ' از ' + faNum(data.items.total) : ''})
            </a>
          )}
        </div>
      </div>

      {meta.views.length > 1 && (
        <nav className="segmented no-print" aria-label="نوع گزارش">
          {meta.views.map((v) => (
            <button key={v} type="button" aria-pressed={v === view} onClick={() => set({ view: v, kind: null, departmentId: null, partStatus: null })}>
              {REPORT_VIEW_LABELS[v]}
            </button>
          ))}
        </nav>
      )}

      <section className="panel no-print" aria-label="فیلترها">
        <div className="panel-body report-filters">
          <label className="field">
            <span>بازه رویدادها</span>
            <select className="input" value={params.get('period') ?? 'month'} onChange={(e) => set({ period: e.target.value })}>
              <option value="today">امروز</option>
              <option value="week">این هفته</option>
              <option value="month">این ماه</option>
              <option value="custom">بازه دلخواه</option>
            </select>
          </label>
          {params.get('period') === 'custom' && (
            <>
              <label className="field">
                <span>از (۱۴۰۵/۰۸/۰۱)</span>
                <input className="input ltr-input" defaultValue={params.get('from') ?? ''} onBlur={(e) => set({ from: e.target.value })} />
              </label>
              <label className="field">
                <span>تا</span>
                <input className="input ltr-input" defaultValue={params.get('to') ?? ''} onBlur={(e) => set({ to: e.target.value })} />
              </label>
            </>
          )}
          <label className="field">
            <span>مسئول</span>
            <select className="input" value={params.get('responsibleUserId') ?? ''} onChange={(e) => set({ responsibleUserId: e.target.value })}>
              <option value="">همه</option>
              <option value="me">خودم</option>
              <option value="none">بدون مسئول</option>
              {people?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
            </select>
          </label>
          {view === 'workshop' && (
            <label className="field">
              <span>واحد</span>
              <select className="input" value={params.get('departmentId') ?? ''} onChange={(e) => set({ departmentId: e.target.value })}>
                <option value="">همه واحدها</option>
                {departments?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <form className="field" key={params.get('stationCode')??'any-station'} onSubmit={e=>{e.preventDefault();const value=String(new FormData(e.currentTarget).get('stationCode')??'').trim();set({stationCode:value});}}><label className="field"><span>کد جایگاه ارجاع</span><input className="input" name="stationCode" maxLength={32} defaultValue={params.get('stationCode')??''}/></label><button type="submit" className="btn btn-sm">اعمال کد جایگاه</button></form>
          <label className="field">
            <span>مرحله</span>
            <select className="input" value={params.get('stage') ?? ''} onChange={(e) => set({ stage: e.target.value })}>
              <option value="">همه</option>
              {CASE_STAGES.filter((s) => s !== 'delivered').map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>پوشش</span>
            <select className="input" value={params.get('coverage') ?? ''} onChange={(e) => set({ coverage: e.target.value })}>
              <option value="">همه</option>
              {COVERAGE_TYPES.map((c) => (
                <option key={c} value={c}>
                  {COVERAGE_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>مانع</span>
            <select className="input" value={params.get('blockerReason') ?? ''} onChange={(e) => set({ blockerReason: e.target.value })}>
              <option value="">همه</option>
              {BLOCKER_REASONS.map((r) => (
                <option key={r} value={r}>
                  {BLOCKER_REASON_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
          {view === 'parts' && (
            <label className="field">
              <span>وضعیت قطعه</span>
              <select className="input" value={params.get('partStatus') ?? ''} onChange={(e) => set({ partStatus: e.target.value })}>
                <option value="">همه</option>
                {PART_STATUSES.filter((s) => !['handed_over', 'cancelled'].includes(s)).map((s) => (
                  <option key={s} value={s}>
                    {PART_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            <span>جست‌وجو (پرونده، پذیرش، پلاک، شاسی)</span>
            <input className="input" type="search" defaultValue={params.get('q') ?? ''} onKeyDown={(e) => e.key === 'Enter' && set({ q: e.currentTarget.value })} onBlur={(e) => e.target.value !== (params.get('q') ?? '') && set({ q: e.target.value })} />
          </label>
        </div>
      </section>

      {error && (
        <p className="callout callout-red" role="alert">
          {error instanceof ApiError ? error.message : 'گزارش دریافت نشد.'}{' '}
          <button className="btn btn-sm" type="button" onClick={() => router.refresh()}>
            تلاش دوباره
          </button>
        </p>
      )}
      {!data && !error && (isLoading || !ready) && <p className="muted">{ready ? 'در حال تهیه گزارش…' : 'تاریخ شروع و پایان بازه دلخواه را وارد کنید.'}</p>}

      {data && (
        <>
          <p className="small print-only">
            {REPORT_VIEW_LABELS[data.view]} — تهیه {formatJalali(data.generatedAt, { time: true })} — بازه: {data.period.label} — فیلترها:{' '}
            {data.filters.map((f) => `${f.label}: ${f.value}`).join('، ')}
          </p>
          <div className="kpis" aria-label="شاخص‌های اصلی">
            {data.kpis.map((k) => {
              const body = (
                <>
                  <span className="kpi-value">{faNum(k.value)}</span>
                  <span className="kpi-label">{k.label}</span>
                  <span className="xs muted">
                    {k.unit}
                    {k.quantity !== undefined && ` — ${faNum(k.quantity)} عدد قطعه`}
                  </span>
                </>
              );
              const title = k.definition;
              if (k.listQuery !== undefined) {
                return (
                  <Link key={k.key} className="kpi" href={`/cases${k.listQuery ? `?${k.listQuery}` : ''}`} title={title}>
                    {body}
                  </Link>
                );
              }
              return (
                <button key={k.key} type="button" className="kpi" title={title} onClick={() => set({ tab: 'today', kind: k.itemKind ?? null })}>
                  {body}
                </button>
              );
            })}
          </div>

          {can('report.manager') && view === 'manager' && data.kpis.some((k) => k.value > 0) && (
            <div className="kpi-reminders no-print" role="group" aria-label="تذکر دربارهٔ یافته‌ها">
              <span className="xs muted">تذکر دربارهٔ یافته‌ها:</span>
              {data.kpis.filter((k) => k.value > 0).map((k) => (
                <button key={k.key} type="button" className="btn btn-sm" onClick={() => setRemind({ role: /part|قطعه/.test(k.key + k.label) ? 'parts_clerk' : 'accident_expert', source: 'manager_report', body: `${k.label}: ${faNum(k.value)} ${k.unit}؛ لطفاً امروز پیگیری کن.`.slice(0, 300) })}>
                  تذکر · {k.label}
                </button>
              ))}
            </div>
          )}

          <nav className="segmented no-print" aria-label="نما">
            <button type="button" aria-pressed={tab === 'today'} onClick={() => set({ tab: null }, true)}>
              کارهای امروز ({faNum(data.items.total)})
            </button>
            <button type="button" aria-pressed={tab === 'stats'} onClick={() => set({ tab: 'stats' }, true)}>
              آمار و روند
            </button>
          </nav>

          {tab === 'today' && (view === 'parts' || view === 'manager') && <DiscrepancyQueue />}

          {tab === 'today' ? (
            <section className="panel" data-testid="work-list">
              <div className="panel-head">
                <h2>کارهای امروز</h2>
                {data.items.kinds.length > 1 && (
                  <div className="row no-print" style={{ gap: 6 }} role="group" aria-label="نوع کار">
                    <button className="btn btn-sm" aria-pressed={!params.get('kind')} onClick={() => set({ kind: null })}>
                      همه
                    </button>
                    {data.items.kinds.map((k) => (
                      <button key={k.kind} className="btn btn-sm" aria-pressed={params.get('kind') === k.kind} onClick={() => set({ kind: k.kind })}>
                        {k.label} ({faNum(k.count)})
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="panel-body">
                {data.items.total === 0 ? (
                  <p className="muted">با این فیلترها موردی برای اقدام نیست.</p>
                ) : (
                  <div className="table-scroll">
                    <table className="table static work-table">
                      <thead>
                        <tr>
                          <th>اولویت</th>
                          <th>پرونده / خودرو</th>
                          <th>شرح</th>
                          <th>وضعیت</th>
                          <th>موعد</th>
                          <th>مسئول</th>
                          <th>علت توقف</th>
                          <th>اقدام بعدی</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.items.rows.map((i) => (
                          <tr key={`${i.kind}-${i.caseId}-${i.partId ?? i.taskId ?? ''}`} data-testid="work-row">
                            <td data-label="اولویت">
                              <span className={`chip ${PRIORITY_TONE[i.priority]}`}>{WORK_PRIORITY_LABELS[i.priority]}</span>
                              <div className="xs muted">{toPersianDigits(i.priorityReason)}</div>
                            </td>
                            <td data-label="پرونده">
                              <Link href={`/cases/${i.caseId}`}>
                                <bdi>{i.caseNumber}</bdi>
                              </Link>
                              <div className="small">پذیرش ایران‌خودرو: <bdi>{i.admissionNo?toPersianDigits(i.admissionNo):'ثبت نشده'}</bdi></div>
                              <div className="xs muted">
                                {i.vehicleLabel}
                                {i.plate ? ` — ${toPersianDigits(i.plate)}` : ''}
                              </div>
                            </td>
                            <td data-label="شرح" className="wide">
                              {toPersianDigits(i.description)}
                              <div className="xs muted">جایگاه: {i.stationCodes?.join('، ')||'نامعلوم'}</div>
                              {i.partNumber && <div className="xs muted">شماره فنی: <bdi>{i.partNumber}</bdi></div>}
                              {i.quantity !== undefined && <div className="xs muted">تعداد: {faNum(i.quantity)}</div>}
                              <div className="xs muted">{i.kindLabel}</div>
                            </td>
                            <td data-label="وضعیت">{i.status}</td>
                            <td data-label="موعد">
                              {i.dueAt ? formatJalali(i.dueAt, { time: true }) : 'بدون موعد'}
                              {i.dueLabel && <div className="xs muted">{i.dueLabel}</div>}
                            </td>
                            <td data-label="مسئول">{i.responsible?.displayName ?? <span className="missing">تعیین نشده</span>}</td>
                            <td data-label="علت توقف">{i.stoppedBy ? toPersianDigits(i.stoppedBy) : '—'}</td>
                            <td data-label="اقدام بعدی">
                              {i.nextAction}
                              {can('report.manager') && (
                                <div className="no-print">
                                  <button type="button" className="btn btn-sm" aria-label={`تذکر دربارهٔ ${i.caseNumber}`} onClick={() => remindRow(i)}>تذکر</button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {pages > 1 && (
                  <div className="row no-print" style={{ gap: 6, marginBlockStart: 12 }}>
                    <button className="btn btn-sm" disabled={data.items.page <= 1} onClick={() => set({ page: String(data.items.page - 1) }, true)}>
                      قبلی
                    </button>
                    <span className="small">
                      صفحه {faNum(data.items.page)} از {faNum(pages)}
                    </span>
                    <button className="btn btn-sm" disabled={data.items.page >= pages} onClick={() => set({ page: String(data.items.page + 1) }, true)}>
                      بعدی
                    </button>
                  </div>
                )}
              </div>
            </section>
          ) : (
            <div className="stack">
              {data.events.length > 0 && (
                <section className="panel">
                  <div className="panel-head">
                    <h2>رویدادهای بازه: {data.period.label}</h2>
                  </div>
                  <div className="panel-body">
                    <table className="table static">
                      <thead>
                        <tr>
                          <th>رویداد</th>
                          <th>بازه فعلی</th>
                          <th>بازه قبل هم‌طول</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.events.map((e) => (
                          <tr key={e.key}>
                            <td>
                              {e.label} ({e.unit})
                            </td>
                            <td className="num">{faNum(e.current)}</td>
                            <td className="num">{faNum(e.previous)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="xs muted">
                      بازه قبل: {formatJalali(data.period.previousFrom, { time: true })} تا {formatJalali(data.period.previousTo, { time: true })} — هم‌طول با بازه فعلی، تا مقایسه با یک دوره کامل گمراه‌کننده نباشد.
                    </p>
                  </div>
                </section>
              )}
              {data.charts.map((c) => (
                <ReportChart key={c.key} chart={c} onFilter={(query) => set(Object.fromEntries(new URLSearchParams(query)))} />
              ))}
            </div>
          )}
          <p className="xs muted">
            تعریف هر شاخص با نگه‌داشتن نشانگر روی آن نمایش داده می‌شود. «نامعلوم» با صفر فرق دارد و نبود موعد، تأخیر حساب نمی‌شود.
          </p>
        </>
      )}
      <ReminderComposer open={!!remind} onClose={() => setRemind(null)} defaults={remind ?? undefined} />
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<p className="muted">در حال بارگذاری…</p>}>
      <ReportsPage />
    </Suspense>
  );
}
