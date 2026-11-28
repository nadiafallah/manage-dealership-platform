'use client';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import {
  SPECIAL_AID_RULES, SPECIAL_AID_TASK_SECTIONS, SPECIAL_AID_TASK_SECTION_LABELS,
  type SpecialAidTask, type SpecialAidTaskSection, type SpecialAidTodayEntry,
} from '@manage/shared';
import { api, errorMessage, fetcher } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { faNum, formatJalali } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { AppIcon } from '@/components/AppIcon';
import { Plate } from '@/components/Plate';
import { DeadlineTag, QuickCall, ReleaseNowButton, SpecialAidTabs, VehicleName } from '@/components/SpecialAid';

const SECTION_HINT: Record<SpecialAidTaskSection, string> = {
  calls: `تماس ده‌روزه از ثبت درخواست، تماس دوباره پس از «پاسخ نداد» و روز قول مراجعه. دو تماس بی‌پاسخ پشت سر هم «تماس ناموفق» است.`,
  invite: 'قطعه رسیده و مشتری هنوز خبر ندارد: تا پایان روز کاری بعد خبر و دعوت کنید. نوبت در سامانهٔ نوبت‌دهی کسب‌وکار ثبت می‌شود.',
  deadline: `مهلت هر قطعه ${faNum(SPECIAL_AID_RULES.deadlineWorkingDays)} روز کاری از رسیدن است: از روز ${faNum(SPECIAL_AID_RULES.yellowFromDay)} زرد و از روز ${faNum(SPECIAL_AID_RULES.redFromDay)} قرمز. پایان مهلت: آزادسازی با یک کلیک.`,
};
const EMPTY: Record<SpecialAidTaskSection, string> = { calls: 'تماس سررسیده‌ای نیست.', invite: 'قطعهٔ تازه‌رسیده‌ای منتظر دعوت نیست.', deadline: 'پروندهٔ زرد یا قرمزی نیست.' };
const RANK: Record<string, number> = { expired: 0, red: 1, yellow: 2, ok: 3 };

/** «کارهای امروز» (owner, 2026-11-28): due calls, newly arrived parts to invite and yellow/red dossiers. */
export default function SpecialAidToday() {
  const { me, can } = useAuth();
  const toast = useToast();
  const { data, error, mutate, isLoading } = useSWR<SpecialAidTodayEntry[]>(can('special_aid.read') ? '/special-aid/today' : null, fetcher, { refreshInterval: 120_000 });
  const [busy, setBusy] = useState(false);
  if (!can('special_aid.read')) return <div className="callout"><h1>پیگیری امداد ویژه</h1><p>برای این بخش مجوز ندارید.</p></div>;
  const parts = SPECIAL_AID_TASK_SECTIONS.map((key) => {
    const rows = (data ?? []).map((e) => ({ e, tasks: e.tasks.filter((t) => t.section === key) })).filter((x) => x.tasks.length);
    // Deadline: expired first, then red, then yellow; the others by due time (oldest first).
    rows.sort((a, b) => (key === 'deadline' ? (RANK[a.e.dossier.deadline?.level ?? 'ok'] ?? 3) - (RANK[b.e.dossier.deadline?.level ?? 'ok'] ?? 3) : 0) || a.tasks[0]!.dueAt.localeCompare(b.tasks[0]!.dueAt));
    return { key, rows };
  });
  async function refresh() {
    setBusy(true);
    try { const r = await api<Record<string, number>>('/special-aid/sync', { method: 'POST' }); toast(`${faNum(r.items ?? 0)} قطعهٔ تازه و ${faNum(r.statusChanges ?? 0)} تغییر وضعیت از گزارش‌های ثبت‌شده خوانده شد`); await mutate(); }
    catch (e) { toast(errorMessage(e), 'error'); } finally { setBusy(false); }
  }
  return (
    <section className="desk" aria-labelledby="aid-today">
      <header className="desk-head">
        <div className="desk-hello">
          <h1 id="aid-today">کارهای امروز امداد ویژه</h1>
          <p className="desk-sub">{data ? parts.map((p) => `${faNum(p.rows.length)} ${SPECIAL_AID_TASK_SECTION_LABELS[p.key]}`).join(' · ') : 'در حال خواندن…'}</p>
        </div>
        <p className="desk-kicker">{me.displayName}</p>
      </header>
      <SpecialAidTabs />
      <div className="desk-tools">
        <nav className="chips" aria-label="بخش‌های کارهای امروز">{parts.map((p) => <a key={p.key} href={`#aid-${p.key}`}>{SPECIAL_AID_TASK_SECTION_LABELS[p.key]} <b>{faNum(p.rows.length)}</b></a>)}</nav>
        {can('special_aid.operate') && <button type="button" className="btn btn-sm no-print" disabled={busy} onClick={() => void refresh()}>خواندن دوباره از گزارش‌های ثبت‌شده</button>}
      </div>
      {error && <p role="alert" className="m-error">فهرست خوانده نشد: {errorMessage(error)} <button type="button" className="m-btn-s" onClick={() => void mutate()}>تلاش دوباره</button></p>}
      {isLoading && !data && <p className="muted small" role="status">در حال خواندن…</p>}
      {data && parts.map((p) => (
        <section key={p.key} className="panel" id={`aid-${p.key}`} aria-labelledby={`aid-${p.key}-title`}>
          <div className="panel-head"><div><h2 id={`aid-${p.key}-title`}>{SPECIAL_AID_TASK_SECTION_LABELS[p.key]} <span className="cnt">{faNum(p.rows.length)}</span></h2><p className="muted small">{SECTION_HINT[p.key]}</p></div></div>
          <div className="panel-body">
            {p.rows.length ? <ul className="rcp-list" data-testid={`aid-today-${p.key}`}>{p.rows.map(({ e, tasks }) => <TodayRow key={e.dossier.id} entry={e} tasks={tasks} section={p.key} onChanged={() => void mutate()} />)}</ul>
              : <p className="m-empty">{EMPTY[p.key]}</p>}
          </div>
        </section>
      ))}
    </section>
  );
}

/** One vehicle in one part of the desk: plate, short name, customer, the task and its one-click actions. */
function TodayRow({ entry, tasks, section, onChanged }: { entry: SpecialAidTodayEntry; tasks: SpecialAidTask[]; section: SpecialAidTaskSection; onChanged: () => void }) {
  const d = entry.dossier;
  const first = tasks[0]!;
  const itemIds = [...new Set(tasks.flatMap((t) => t.itemIds))];
  return (
    <li className="rcp-row aid-row" data-testid="aid-today-row" data-section={section}>
      <div className="rcp-plate"><Plate value={d.vehicle.plate} size="row" /><small><bdi dir="ltr" className="vin-text">{d.vin}</bdi></small></div>
      <div className="rcp-who">
        <VehicleName model={d.vehicle.model} fullModel={d.vehicle.fullModel} />
        <span>{d.vehicle.customerName ?? 'مشتری در سوابق پذیرش نیست'}</span>
      </div>
      <div className="rcp-status">
        {section === 'deadline' ? <>
          <DeadlineTag deadline={d.deadline} />
          {d.deadline?.level === 'expired' && <div className="xs muted">با یک کلیک برای مشتری دیگر آزاد کنید یا در پرونده تعیین تکلیف کنید.</div>}
        </> : <>
          {tasks.map((t) => <div key={t.kind} className="small">{t.urgent ? <span className="m-tag stop">فوری</span> : t.overdue ? <span className="m-tag wait">گذشته</span> : null} {t.label}</div>)}
          {d.contactFailed && <span className="m-tag stop">تماس ناموفق</span>}
        </>}
      </div>
      <div className="rcp-meta">
        <span><AppIcon name="calendar" />{section === 'deadline' && d.deadline ? `پایان مهلت ${formatJalali(d.deadline.endsAt)}` : `سررسید ${formatJalali(first.dueAt)}`}</span>
        <span>{faNum(itemIds.length)} قطعه</span>
        {section !== 'deadline' && <QuickCall dossier={d} itemIds={itemIds} onSaved={onChanged} />}
        {section === 'deadline' && entry.releasable.map((r) => <ReleaseNowButton key={r.id} part={r} onDone={() => onChanged()} />)}
        <Link className="btn btn-sm btn-ghost" href={`/special-aid/vehicles/${d.id}`}>باز کردن پرونده</Link>
      </div>
    </li>
  );
}
