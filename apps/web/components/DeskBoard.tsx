'use client';
import { useMemo, useState, type ReactNode } from 'react';
import useSWR from 'swr';
import { DESK_FILTER_LABELS, deskFilterMatch, greeting, toLatinDigits, type DeskFilter, type DeskFolder, type NextActor } from '@manage/shared';
import { fetcher } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { faNum } from '@/lib/format';
import { AppIcon } from './AppIcon';
import { FolderCard } from './FolderCard';

/** Role desk = folder cards + filter chips (spec §2.1; owner reference «میز کار کارشناس تصادفات»). */
export function DeskBoard({ title, actors, intro, filters = ['all', 'own', 'mine', 'parts', 'repair', 'delivery', 'behind'], initial = 'all', scope, extra }: {
  title: string;
  /** Whose «قدم بعدی» counts as «منتظر اقدام من». */
  actors: readonly NextActor[];
  /** Primary action of the desk (e.g. «پذیرش خودرو»). */
  intro?: ReactNode;
  filters?: readonly DeskFilter[];
  initial?: DeskFilter;
  /** Which cars belong on this desk at all (parts desk: cars with open part lines). */
  scope?: (f: DeskFolder) => boolean;
  /** Role-specific line on each card (parts desk: counts). */
  extra?: (f: DeskFolder) => ReactNode;
}) {
  const { me } = useAuth();
  const { data, error, mutate } = useSWR<DeskFolder[]>('/desk/folders', fetcher, { refreshInterval: 60_000 });
  const [filter, setFilter] = useState<DeskFilter>(initial);
  const [q, setQ] = useState('');
  const own = useMemo(() => (data ?? []).filter((f) => !scope || scope(f)), [data, scope]);
  const term = toLatinDigits(q).trim().toLowerCase();
  const found = own.filter((f) => !term || [f.plate, f.caseNumber, f.admissionNo, f.vehicle, f.customerName].some((v) => v && toLatinDigits(v).toLowerCase().includes(term)));
  const match = (f: DeskFolder, k: DeskFilter) => deskFilterMatch(f, k, actors, me.id);
  const shown = found.filter((f) => match(f, filter));
  const waiting = own.filter((f) => match(f, 'mine')).length;
  const behind = own.filter((f) => f.behind).length;
  const ready = own.reduce((n, f) => n + f.parts.ready, 0);
  const late = own.reduce((n, f) => n + f.parts.emdadLate, 0);
  const followUps = [waiting && `${faNum(waiting)} خودرو منتظر اقدام شماست`, behind && `${faNum(behind)} خودرو عقب‌تر از برنامه است`, late && `${faNum(late)} قطعهٔ امداد ویژه دیر کرده`, ready && `${faNum(ready)} قطعه آمادهٔ تحویل به جایگاه است`].filter(Boolean) as string[];

  return (
    <section className="desk" aria-labelledby="desk-hello">
      <header className="desk-head">
        <div className="desk-hello">
          <h1 id="desk-hello">{greeting(me.displayName)}</h1>
          <p className="desk-sub">{data ? `${faNum(own.length)} خودرو داخل تعمیرگاه` : 'در حال خواندن پوشه‌ها…'}</p>
        </div>
        <p className="desk-kicker">{title}</p>
      </header>
      <div className="desk-tools">
        <div className="chips" role="group" aria-label="صافی پوشه‌ها">
          {filters.map((k) => (
            <button key={k} type="button" className={filter === k ? 'on' : ''} aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {DESK_FILTER_LABELS[k]} <span>{faNum(found.filter((f) => match(f, k)).length)}</span>
            </button>
          ))}
        </div>
        <label className="srch">
          <AppIcon name="search" />
          <span className="sr-only">جست‌وجو در خودروهای این میز</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="جست‌وجو در خودروهای داخل تعمیرگاه…" />
        </label>
        {intro}
      </div>
      {data && (
        <p className="desk-strip" role="status">
          <AppIcon name="calendar" />
          <b>پیگیری‌های امروز:</b> {followUps.length ? followUps.join(' · ') : 'فعلاً چیزی منتظر شما نیست.'}
        </p>
      )}
      {error && <p role="alert" className="m-error">پوشه‌ها خوانده نشد. <button type="button" className="m-btn-s" onClick={() => void mutate()}>تلاش دوباره</button></p>}
      {data && !shown.length && <p className="m-empty">{own.length ? 'در این صافی خودرویی نیست.' : 'هنوز خودرویی در تعمیرگاه ثبت نشده است.'}</p>}
      {!data && !error && <p className="sr-only" role="status">در حال خواندن پوشه‌ها…</p>}
      {!data && !error && <div className="folder-grid" aria-hidden="true">{[0, 1, 2].map((i) => <div key={i} className="folder folder-skeleton" />)}</div>}
      <div className="folder-grid">{shown.map((f) => <FolderCard key={f.caseId} f={f} extra={extra?.(f)} mine={!!me.id && f.responsibleUserId === me.id} />)}</div>
    </section>
  );
}
