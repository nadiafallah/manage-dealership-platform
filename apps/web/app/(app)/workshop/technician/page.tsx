'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { TECHNICIAN_PROBLEMS, TECHNICIAN_PROBLEM_LABELS, type MyWorkMonth, type TechnicianProblem, type WorkshopTask } from '@manage/shared';
import { useAuth } from '@/lib/auth';
import { api, errorMessage, fetcher } from '@/lib/api';
import { faNum, formatJalali, rial, toPersianDigits } from '@/lib/format';
import { Plate } from '@/components/Plate';
import { Dialog } from '@/components/Dialog';
import { ReminderCards } from '@/components/ReminderCards';

// Technician desk (spec §9, mockup Technician.dc.html): this month's wage on top,
// the current job as one card with a single big button that changes
// «شروع کار» → «پایان کار» → «منتظر تأیید کارشناس», a direct «قطعه ندارم»,
// «قطعه آماده است، تحویل بگیرید» when a part is ready, and the next jobs with their wage.
const DAY = 86_400_000;
const tehranDay = (ms: number) => Math.floor((ms + 210 * 60_000) / DAY);

/** "۲ روز" / "امروز" / "موعد گذشته" from the planned end of the job. */
function timeLeft(end: string | null | undefined): { text: string; tone: 'ok' | 'soon' | 'late' } | null {
  if (!end) return null;
  if (Date.parse(end) < Date.now()) return { text: 'موعد گذشته', tone: 'late' };
  const days = tehranDay(Date.parse(end)) - tehranDay(Date.now());
  if (days <= 0) return { text: 'امروز', tone: 'soon' };
  return { text: `${toPersianDigits(days)} روز`, tone: 'ok' };
}
const clock = (iso: string) => toPersianDigits(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Tehran', hour12: false }).format(new Date(iso)));

export default function TechnicianPage() {
  const { me, can } = useAuth();
  const { data, error, mutate } = useSWR<WorkshopTask[]>(can('task.execute') ? '/workshop/my-tasks' : null, fetcher, { refreshInterval: 30000 });
  const { data: month } = useSWR<MyWorkMonth>(can('task.execute') ? '/workshop/my-work' : null, fetcher, { refreshInterval: 120000 });
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [failure, setFailure] = useState('');
  const [problemFor, setProblemFor] = useState<WorkshopTask | null>(null);
  const confirmed = useRef(new Set<string>());
  // The first time an amount is shown it counts as seen; a later change shows "تغییر کرد" until confirmed.
  useEffect(() => {
    for (const t of data ?? []) {
      const w = t.wage;
      if (w && !w.seen && !confirmed.current.has(`${t.id}:${w.version}`)) {
        confirmed.current.add(`${t.id}:${w.version}`);
        void api(`/workshop/my-tasks/${t.id}/wage-seen`, { body: { expectedVersion: w.version } }).catch(() => {});
      }
    }
  }, [data]);

  async function run(fn: () => Promise<unknown>, done: string) {
    if (busy) return;
    setBusy(true); setFailure(''); setMessage('');
    try { await fn(); setMessage(done); } catch (e) { setFailure(errorMessage(e)); } finally { await mutate(); setBusy(false); }
  }
  const act = (t: WorkshopTask) =>
    run(() => api(`/workshop/my-tasks/${t.id}/actions`, { body: { action: t.status === 'pending' ? 'start' : 'complete', expectedVersion: t.version } }),
      t.status === 'pending' ? 'شروع کار ثبت شد.' : 'پایان کار ثبت شد؛ منتظر تأیید کارشناس.');
  const pickup = (taskId: string, partId: string, expectedVersion: number) => run(() => api(`/tasks/${taskId}/part-pickup`, { body: { partId, expectedVersion } }), 'تحویل قطعه ثبت شد.');
  const wageSeen = (t: WorkshopTask) => t.wage && run(() => api(`/workshop/my-tasks/${t.id}/wage-seen`, { body: { expectedVersion: t.wage!.version } }), '');
  const report = (t: WorkshopTask, problem: TechnicianProblem) =>
    run(async () => { await api(`/workshop/my-tasks/${t.id}/problem`, { body: { problem } }); setProblemFor(null); },
      `«${TECHNICIAN_PROBLEM_LABELS[problem]}» برای کارشناس این خودرو و انباردار فرستاده شد.`);

  if (!can('task.execute')) return <p className="callout">کارتابل تعمیرکار برای شما فعال نیست.</p>;
  const open = (data ?? []).filter((t) => t.status !== 'approved');
  const current = open.find((t) => t.status === 'in_progress') ?? open.find((t) => t.status === 'pending' && t.canStart) ?? open.find((t) => t.status !== 'done') ?? open[0];
  const next = open.filter((t) => t.id !== current?.id);
  const place = current ? [current.departmentName, current.stationName ?? current.stationCode].filter(Boolean).join(' · ') : 'کارتابل تعمیرکار';

  return (
    <div className="tc-page">
      <header className="tc-head">
        <div>
          <h1>سلام {me.displayName}</h1>
          <p>{place} · {formatJalali(new Date())}</p>
        </div>
        <Link className="tc-month" href="/workshop/technician/work" aria-label="اجرت این ماه">
          <span>اجرت این ماه</span>
          <strong>{month ? faNum(month.totalRial) : '—'}</strong>
          <small>ریال</small>
        </Link>
      </header>
      <ReminderCards compact />
      {message && <p role="status" className="m-next">{message}</p>}
      {failure && <p role="alert" className="m-error">{failure}</p>}
      {error && <p role="alert" className="m-error">کارها دریافت نشد. <button className="m-btn-s" onClick={() => void mutate()}>تلاش دوباره</button></p>}
      {!data && !error && <p className="m-empty">در حال دریافت کارها…</p>}

      {current && <CurrentJob t={current} busy={busy} onAct={act} onPickup={pickup} onWageSeen={wageSeen} onNoPart={(t) => report(t, 'no_part')} onProblem={setProblemFor} />}
      {data && !open.length && <div className="tc-card tc-empty"><h2>کار بازی ندارید</h2><p>وقتی کاری به شما ارجاع شود، همین‌جا می‌آید.</p></div>}

      {next.length > 0 && (
        <section aria-label="کارهای بعدی">
          <h2 className="tc-sub">بعدی</h2>
          <ul className="tc-next">
            {next.map((t) => (
              <li key={t.id} className="tc-mini">
                <div>
                  <strong>{t.vehicleLabel}</strong>
                  <span><bdi>{toPersianDigits(t.plate ?? '')}</bdi> · {t.title || t.departmentName}{t.status === 'done' ? ' · منتظر تأیید کارشناس' : ''}</span>
                </div>
                {t.wage && <b>{faNum(t.wage.amountRial)}</b>}
              </li>
            ))}
          </ul>
        </section>
      )}
      <nav className="tc-links no-print" aria-label="کارکرد و تذکرها">
        <Link href="/workshop/technician/work">کارکرد ماه</Link>
        <Link href="/reminders">تذکرهای من</Link>
      </nav>

      <Dialog open={!!problemFor} title="مشکل دیگر" onClose={() => !busy && setProblemFor(null)} footer={<button type="button" className="btn" disabled={busy} onClick={() => setProblemFor(null)}>انصراف</button>}>
        <p className="small">پیام برای کارشناس همین خودرو فرستاده می‌شود{problemFor?.plate ? <> (پلاک <bdi>{toPersianDigits(problemFor.plate)}</bdi>)</> : ''}.</p>
        <div className="technician-problems">
          {TECHNICIAN_PROBLEMS.map((p) => <button key={p} type="button" className="btn" disabled={busy} onClick={() => problemFor && void report(problemFor, p)}>{TECHNICIAN_PROBLEM_LABELS[p]}</button>)}
        </div>
      </Dialog>
    </div>
  );
}

function CurrentJob({ t, busy, onAct, onPickup, onWageSeen, onNoPart, onProblem }: {
  t: WorkshopTask; busy: boolean;
  onAct: (t: WorkshopTask) => void; onPickup: (taskId: string, partId: string, v: number) => void; onWageSeen: (t: WorkshopTask) => void;
  onNoPart: (t: WorkshopTask) => void; onProblem: (t: WorkshopTask) => void;
}) {
  const left = t.status === 'done' ? null : timeLeft(t.plannedEndAt);
  const waiting = t.status === 'pending' && !t.canStart;
  const late = left?.tone === 'late';
  return (
    <article className="tc-card" aria-label="کار فعلی">
      <div className="tc-card-top">
        <div className="tc-vehicle">
          <strong>{t.vehicleLabel}</strong>
          {late && <span className="tc-pill tc-pill-late">فوری</span>}
        </div>
        {left && <div className={`tc-left tc-left-${left.tone}`}><small>وقت</small><b>{left.text}</b></div>}
      </div>
      <Plate value={t.plate ?? ''} large />
      <div className="tc-job-line">
        <p>{t.title || t.departmentName}</p>
        {t.wage && (
          <div className="tc-wage">
            <small>اجرت شما</small>
            <b>{faNum(t.wage.amountRial)}</b>
            {t.wage.changed && <><span className="tc-pill tc-pill-soon">تغییر کرد · قبلاً {rial(t.wage.previousRial ?? 0)}</span><button type="button" className="m-btn-s" disabled={busy} onClick={() => onWageSeen(t)}>دیدم</button></>}
          </div>
        )}
      </div>

      {t.status !== 'done' && t.partsReady && t.partsReady.count > 0 && (
        <div className="tc-ready" role="status">
          <b>قطعه آماده است، تحویل بگیرید</b>
          <span>{t.partsReady.names.join('، ')}{t.partsReady.count > t.partsReady.names.length ? ' و …' : ''}</span>
          {t.partsReady.pickup?.map((p) => <button key={p.id} type="button" className="m-btn-s" disabled={busy} onClick={() => onPickup(t.id, p.id, p.version)}>گرفتم · {p.description}</button>)}
        </div>
      )}
      {t.status !== 'done' && !!t.partsWaiting && <p className="tc-note">{faNum(t.partsWaiting)} قطعهٔ دیگر هنوز نرسیده است.</p>}

      {t.status === 'pending' && (
        <button type="button" className="tc-big tc-go" disabled={busy || waiting} onClick={() => onAct(t)}>{busy ? 'در حال ثبت…' : 'شروع کار'}</button>
      )}
      {waiting && <p className="tc-note">منتظر تأیید کار قبلی توسط کارشناس.</p>}
      {t.status === 'in_progress' && (
        <>
          {t.actualStartAt && <p className="tc-note">در حال کار از ساعت {clock(t.actualStartAt)}</p>}
          <button type="button" className="tc-big tc-stop" disabled={busy} onClick={() => onAct(t)}>{busy ? 'در حال ثبت…' : 'پایان کار'}</button>
        </>
      )}
      {t.status === 'done' && <p className="tc-big tc-wait" role="status">تمام شد. منتظر تأیید کارشناس.</p>}
      {t.status === 'blocked' && <p className="tc-note">کار متوقف است؛ با کارشناس هماهنگ کنید.</p>}

      {t.status !== 'done' && (
        <div className="tc-problems">
          <button type="button" className="tc-warn" disabled={busy} onClick={() => onNoPart(t)}>قطعه ندارم</button>
          <button type="button" className="m-btn-s" disabled={busy} onClick={() => onProblem(t)} aria-label={`مشکل دیگر؛ ${t.title || t.departmentName}`}>مشکل دیگر</button>
        </div>
      )}
      <p className="tc-note">پرونده <bdi>{toPersianDigits(t.caseNumber)}</bdi> · موعد {formatJalali(t.plannedEndAt, { time: true })}</p>
    </article>
  );
}
