'use client';
import { useMemo, useState, type ReactNode } from 'react';
import useSWR from 'swr';
import { DESK_FILTERS, DESK_FILTER_LABELS, deskFilterMatch, greeting, toLatinDigits, type DeskFilter, type DeskFolder, type NextActor } from '@manage/shared';
import { fetcher } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { faNum } from '@/lib/format';
import { FolderCard } from './FolderCard';

/** Role desk = folder cards + filter chips (spec §2.1, mockup ExpertDesk.dc.html). */
export function DeskBoard({ title, actors, intro, filters = DESK_FILTERS.filter((k) => k !== 'stuck'), initial = 'all', mineOnly, scope, extra }: {
  title: string;
  /** Whose «قدم بعدی» counts as «منتظر اقدام من». */
  actors: readonly NextActor[];
  intro?: ReactNode;
  filters?: readonly DeskFilter[];
  initial?: DeskFilter;
  /** Only cars the viewer is responsible for (accident expert). */
  mineOnly?: boolean;
  /** Which cars belong on this desk at all (parts desk: cars with open part lines). */
  scope?: (f: DeskFolder) => boolean;
  /** Role-specific line on each card (parts desk: counts). */
  extra?: (f: DeskFolder) => ReactNode;
}) {
  const { me } = useAuth();
  const { data, error, mutate } = useSWR<DeskFolder[]>('/desk/folders', fetcher, { refreshInterval: 60_000 });
  const [filter, setFilter] = useState<DeskFilter>(initial);
  const [q, setQ] = useState('');
  const own = useMemo(() => (data ?? []).filter((f) => (!mineOnly || !f.responsibleUserId || f.responsibleUserId === me.id) && (!scope || scope(f))), [data, mineOnly, me.id, scope]);
  const term = toLatinDigits(q).trim().toLowerCase();
  const found = own.filter((f) => !term || [f.plate, f.caseNumber, f.admissionNo, f.vehicle, f.customerName].some((v) => v && toLatinDigits(v).toLowerCase().includes(term)));
  const shown = found.filter((f) => deskFilterMatch(f, filter, actors));
  const waiting = own.filter((f) => deskFilterMatch(f, 'mine', actors)).length;

  return (
    <section className="desk" aria-label={title}>
      <header className="desk-head">
        <div>
          <p className="desk-kicker">{title}</p>
          <h1>{greeting(me.displayName)}</h1>
          <p className="desk-sub">
            {data ? <>{faNum(own.length)} خودرو در تعمیرگاه است. {waiting ? <b>{faNum(waiting)} خودرو منتظر اقدام شماست.</b> : 'فعلاً چیزی منتظر شما نیست.'}</> : 'در حال خواندن پوشه‌ها…'}
          </p>
        </div>
        {intro}
      </header>
      <div className="desk-tools">
        <label className="srch">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <span className="sr-only">جست‌وجو در پوشه‌های این میز</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="پلاک، نام، شمارهٔ پرونده یا پذیرش" />
        </label>
        <div className="chips" role="group" aria-label="صافی پوشه‌ها">
          {filters.map((k) => {
            const n = found.filter((f) => deskFilterMatch(f, k, actors)).length;
            return (
              <button key={k} type="button" className={filter === k ? 'on' : ''} aria-pressed={filter === k} onClick={() => setFilter(k)}>
                {DESK_FILTER_LABELS[k]} <span>{faNum(n)}</span>
              </button>
            );
          })}
        </div>
      </div>
      {error && <p role="alert" className="m-error">پوشه‌ها خوانده نشد. <button type="button" className="m-btn-s" onClick={() => void mutate()}>تلاش دوباره</button></p>}
      {data && !shown.length && <p className="m-empty">{own.length ? 'در این صافی خودرویی نیست.' : 'هنوز خودرویی در تعمیرگاه ثبت نشده است.'}</p>}
      <div className="folder-grid">{shown.map((f) => <FolderCard key={f.caseId} f={f} extra={extra?.(f)} />)}</div>
    </section>
  );
}
