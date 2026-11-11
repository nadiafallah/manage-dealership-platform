'use client';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import { REMINDER_MAX_LENGTH, type ReceivedReminder } from '@manage/shared';
import { api, errorMessage, fetcher } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatJalali, toPersianDigits } from '@/lib/format';
import { useToast } from '@/lib/toast';

export const REMINDER_INBOX = '/reminders/inbox';

function MessageIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5h16v11H9l-5 4z" />
    </svg>
  );
}

/** Open reminders as cards at the top of the recipient's desk: "دیدم", then "انجام شد" with a one-line reply. */
export function ReminderCards({ compact = false }: { compact?: boolean }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, mutate } = useSWR<ReceivedReminder[]>(REMINDER_INBOX, fetcher, { refreshInterval: 60_000 });
  const [busy, setBusy] = useState('');
  const [replies, setReplies] = useState<Record<string, string>>({});
  if (!data?.length) return null;

  async function respond(r: ReceivedReminder, action: 'seen' | 'done' | 'reply') {
    if (busy) return;
    const reply = (replies[r.id] ?? '').trim();
    if (action === 'reply' && !reply) return;
    setBusy(r.id);
    try {
      await api(`/reminders/${r.id}/respond`, { body: { action, expectedVersion: r.version, ...(reply && action !== 'seen' ? { reply } : {}) } });
      if (action !== 'seen') setReplies((x) => ({ ...x, [r.id]: '' }));
      toast(action === 'seen' ? 'دیدن تذکر ثبت شد' : action === 'done' ? 'انجام تذکر ثبت شد' : 'جواب فرستاده شد');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy('');
      void mutate();
    }
  }

  return (
    <section className={`reminder-cards no-print${compact ? ' compact' : ''}`} aria-label="تذکرهای رسیده" data-testid="reminder-cards">
      {data.map((r) => (
        <article key={r.id} className={`reminder-card${r.urgency === 'urgent' ? ' urgent' : ''}${r.status === 'seen' ? ' seen' : ''}`} data-testid="reminder-card">
          <span className="reminder-icon"><MessageIcon /></span>
          <div className="reminder-text">
            <p className="reminder-from">
              تذکر از {r.sender.displayName}{r.sender.roleLabel ? ` · ${r.sender.roleLabel}` : ''}
              {r.urgency === 'urgent' && <span className="chip chip-red">فوری</span>}
              {r.overdue && <span className="chip chip-amber">دو ساعت کاری دیده نشده</span>}
            </p>
            <p className="reminder-body">{toPersianDigits(r.body)}</p>
            <p className="xs muted">
              {r.case && can('case.read') ? <Link href={`/cases/${r.case.id}`}>پرونده <bdi>{toPersianDigits(r.case.caseNumber)}</bdi></Link> : r.case ? <>پرونده <bdi>{toPersianDigits(r.case.caseNumber)}</bdi></> : null}
              {r.part ? <> · قطعهٔ «{r.part.description}»</> : null}
              {r.plate ? <> · پلاک <bdi>{toPersianDigits(r.plate)}</bdi></> : null} · {formatJalali(r.createdAt, { time: true })}
            </p>
            {r.status === 'seen' && (
              <form className="reminder-reply" onSubmit={(e) => { e.preventDefault(); void respond(r, 'reply'); }}>
                <label className="sr-only" htmlFor={`reply-${r.id}`}>جواب کوتاه</label>
                <input id={`reply-${r.id}`} className="input" maxLength={REMINDER_MAX_LENGTH} placeholder={r.reply ? `جواب شما: ${r.reply}` : 'یک خط جواب (اختیاری)'} value={replies[r.id] ?? ''} onChange={(e) => setReplies((x) => ({ ...x, [r.id]: e.target.value }))} />
                <button type="submit" className="btn btn-sm" disabled={busy === r.id || !(replies[r.id] ?? '').trim()}>فرستادن جواب</button>
              </form>
            )}
          </div>
          <div className="reminder-actions">
            {r.status === 'sent' ? (
              <button type="button" className="btn" disabled={busy === r.id} onClick={() => void respond(r, 'seen')}>دیدم</button>
            ) : (
              <button type="button" className="btn btn-primary" disabled={busy === r.id} onClick={() => void respond(r, 'done')}>انجام شد</button>
            )}
          </div>
        </article>
      ))}
    </section>
  );
}
