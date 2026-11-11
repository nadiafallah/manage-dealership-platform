'use client';
import Link from 'next/link';
import { useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { REMINDER_STATUS_LABELS, ROLE_LABELS, type MyReminders } from '@manage/shared';
import { fetcher } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { workspaceHome } from '@/lib/workspaces';
import { formatJalali, toPersianDigits } from '@/lib/format';
import { BackLink } from '@/components/BackLink';
import { ReminderCards, REMINDER_INBOX } from '@/components/ReminderCards';
import { ReminderComposer } from '@/components/ReminderComposer';
import { PlateText } from '@/components/Plate';

const STATUS_TONE = { sent: 'chip-amber', seen: 'chip-blue', done: 'chip-green' } as const;

/** "My reminders": what I received and what I sent, with seen / done and the reply of each recipient. */
export default function RemindersPage() {
  const { me, can } = useAuth();
  const { data, error, mutate } = useSWR<MyReminders>('/reminders', fetcher, { refreshInterval: 60_000 });
  const { mutate: refreshKey } = useSWRConfig();
  const [tab, setTab] = useState<'received' | 'sent'>('received');
  const [composing, setComposing] = useState(false);
  const refresh = () => {
    void mutate();
    void refreshKey(REMINDER_INBOX);
  };
  const caseLink = (c: { id: string; caseNumber: string } | null) =>
    c ? (can('case.read') ? <Link href={`/cases/${c.id}`}>پرونده <bdi>{toPersianDigits(c.caseNumber)}</bdi></Link> : <span>پرونده <bdi>{toPersianDigits(c.caseNumber)}</bdi></span>) : null;

  return (
    <div className="stack reminders-page">
      <BackLink href={workspaceHome(me)} />
      <header className="page-head">
        <div>
          <h1>تذکرهای من</h1>
          <p className="muted">تذکر کوتاه برای یک نفر، چند نفر یا یک نقش؛ گفت‌وگو نیست و هر تغییر وضعیت در تاریخچه می‌ماند.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setComposing(true)}>تذکر تازه</button>
      </header>
      <ReminderCards />
      <nav className="segmented" aria-label="نوع تذکرها">
        <button type="button" aria-pressed={tab === 'received'} onClick={() => setTab('received')}>دریافتی ({toPersianDigits(data?.received.length ?? 0)})</button>
        <button type="button" aria-pressed={tab === 'sent'} onClick={() => setTab('sent')}>فرستاده ({toPersianDigits(data?.sent.length ?? 0)})</button>
      </nav>
      {error && <p role="alert" className="callout callout-red">تذکرها دریافت نشد. <button type="button" className="btn btn-sm" onClick={refresh}>تلاش دوباره</button></p>}
      {!data && !error && <p role="status" className="muted">در حال دریافت تذکرها…</p>}
      {data && tab === 'received' && (
        <section className="panel" aria-label="تذکرهای دریافتی">
          {data.received.length === 0 && <p className="panel-body muted">تذکری نرسیده است.</p>}
          <ul className="reminder-list">
            {data.received.map((r) => (
              <li key={r.id}>
                <div className="row">
                  <strong>{r.sender.displayName}</strong>
                  <span className="xs muted">{r.sender.roleLabel}</span>
                  <span className={`chip ${STATUS_TONE[r.status]}`}>{REMINDER_STATUS_LABELS[r.status]}</span>
                  {r.urgency === 'urgent' && <span className="chip chip-red">فوری</span>}
                </div>
                <p>{toPersianDigits(r.body)}</p>
                <p className="xs muted">{caseLink(r.case)}{r.plate ? <> · پلاک <PlateText value={r.plate} /></> : null} · {formatJalali(r.createdAt, { time: true })}{r.reply ? <> · جواب شما: {r.reply}</> : null}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {data && tab === 'sent' && (
        <section className="panel" aria-label="تذکرهای فرستاده">
          {data.sent.length === 0 && <p className="panel-body muted">هنوز تذکری نفرستاده‌اید.</p>}
          <ul className="reminder-list">
            {data.sent.map((s) => (
              <li key={s.id}>
                <div className="row">
                  <strong>{s.targetRole ? `به نقش ${ROLE_LABELS[s.targetRole]}` : `به ${toPersianDigits(s.recipients.length)} نفر`}</strong>
                  {s.urgency === 'urgent' && <span className="chip chip-red">فوری</span>}
                  <span className="xs muted">{formatJalali(s.createdAt, { time: true })}</span>
                </div>
                <p>{toPersianDigits(s.body)}</p>
                <p className="xs muted">{caseLink(s.case)}{s.plate ? <> · پلاک <PlateText value={s.plate} /></> : null}</p>
                <ul className="reminder-recipients">
                  {s.recipients.map((r) => (
                    <li key={r.id}>
                      <span>{r.displayName}</span>
                      <span className={`chip ${STATUS_TONE[r.status]}`}>{REMINDER_STATUS_LABELS[r.status]}</span>
                      {r.status !== 'sent' && <span className="xs muted">{formatJalali(r.doneAt ?? r.seenAt, { time: true })}</span>}
                      {r.reply && <span className="small">«{r.reply}»</span>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}
      <ReminderComposer open={composing} onClose={() => setComposing(false)} onSent={refresh} />
    </div>
  );
}
