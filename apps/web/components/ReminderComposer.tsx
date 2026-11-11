'use client';
import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  REMINDER_MAX_LENGTH,
  REMINDER_PRESETS,
  ROLE_LABELS,
  ROLES,
  type ReminderPerson,
  type Role,
} from '@manage/shared';
import { api, errorMessage, fetcher } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { toPersianDigits } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Dialog } from './Dialog';

export interface ReminderDefaults {
  userIds?: string[];
  role?: Role;
  caseId?: string;
  caseLabel?: string;
  plate?: string | null;
  body?: string;
  source?: 'manual' | 'manager_report';
}

/** Short reminder to people or a role; not a chat (one text of at most 300 characters). */
export function ReminderComposer({ open, onClose, defaults, onSent }: { open: boolean; onClose: () => void; defaults?: ReminderDefaults; onSent?: () => void }) {
  const toast = useToast();
  const { me } = useAuth();
  const { data: people } = useSWR<ReminderPerson[]>(open ? '/reminders/people' : null, fetcher);
  const [mode, setMode] = useState<'people' | 'role'>('people');
  const [userIds, setUserIds] = useState<string[]>([]);
  const [role, setRole] = useState<Role>('accident_expert');
  const [body, setBody] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [withCase, setWithCase] = useState(true);
  const [plate, setPlate] = useState('');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Reset only when the dialog opens; defaults are read at that moment (callers may rebuild them each render).
  useEffect(() => {
    if (!open) return;
    // Never preselect the sender (e.g. the responsible reminding about their own case).
    const preset = (defaults?.userIds ?? []).filter((id) => id !== me.id);
    setMode(defaults?.role && !preset.length ? 'role' : 'people');
    setUserIds(preset);
    setRole(defaults?.role ?? 'accident_expert');
    setBody(defaults?.body ?? '');
    setUrgent(false);
    setWithCase(true);
    setPlate(defaults?.plate ?? '');
    setFilter('');
    setError('');
  }, [open]);

  const shown = useMemo(() => (people ?? []).filter((p) => !filter.trim() || p.displayName.includes(filter.trim())), [people, filter]);
  const remaining = REMINDER_MAX_LENGTH - body.length;

  async function send() {
    if (busy) return;
    setError('');
    if (mode === 'people' && !userIds.length) return setError('حداقل یک گیرنده انتخاب کنید.');
    if (!body.trim()) return setError('متن تذکر را بنویسید یا یکی از متن‌های آماده را انتخاب کنید.');
    setBusy(true);
    try {
      const res = await api<{ recipients: number }>('/reminders', {
        body: {
          ...(mode === 'people' ? { userIds } : { role }),
          ...(defaults?.caseId && withCase ? { caseId: defaults.caseId } : {}),
          ...(plate.trim() ? { plate: plate.trim() } : {}),
          body: body.trim(),
          urgency: urgent ? 'urgent' : 'normal',
          source: defaults?.source ?? 'manual',
        },
      });
      toast(`تذکر برای ${toPersianDigits(res.recipients)} نفر فرستاده شد`);
      onSent?.();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      title="فرستادن تذکر"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="btn" disabled={busy} onClick={onClose}>انصراف</button>
          <button type="button" className="btn btn-primary" disabled={busy || remaining < 0} onClick={() => void send()}>{busy ? 'در حال فرستادن…' : 'فرستادن تذکر'}</button>
        </>
      }
    >
      <div className="stack reminder-compose">
        <div className="segmented" role="group" aria-label="گیرنده">
          <button type="button" aria-pressed={mode === 'people'} onClick={() => setMode('people')}>یک یا چند نفر</button>
          <button type="button" aria-pressed={mode === 'role'} onClick={() => setMode('role')}>یک نقش</button>
        </div>
        {mode === 'people' ? (
          <fieldset className="reminder-people">
            <legend className="sr-only">گیرندگان</legend>
            <input className="input" type="search" aria-label="جست‌وجوی همکار" placeholder="نام همکار" value={filter} onChange={(e) => setFilter(e.target.value)} />
            {!people && <p className="muted small" role="status">در حال دریافت همکاران…</p>}
            <div className="reminder-people-list">
              {shown.map((p) => (
                <label key={p.id} className="check">
                  <input type="checkbox" checked={userIds.includes(p.id)} onChange={(e) => setUserIds(e.target.checked ? [...userIds, p.id] : userIds.filter((id) => id !== p.id))} />
                  <span>{p.displayName}</span>
                  <span className="xs muted">{p.roles.map((r) => ROLE_LABELS[r]).join('، ')}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : (
          <label className="field">
            <span>نقش گیرنده</span>
            <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
            <span className="hint">همهٔ همکاران فعال این نقش در همین نمایندگی تذکر را می‌گیرند.</span>
          </label>
        )}
        {defaults?.caseId && (
          <label className="check">
            <input type="checkbox" checked={withCase} onChange={(e) => setWithCase(e.target.checked)} />
            <span>وصل به پرونده {defaults.caseLabel ? <bdi>{toPersianDigits(defaults.caseLabel)}</bdi> : ''}</span>
          </label>
        )}
        <label className="field">
          <span>پلاک (اختیاری)</span>
          <input className="input" value={plate} maxLength={32} onChange={(e) => setPlate(e.target.value)} />
        </label>
        <div className="reminder-presets" role="group" aria-label="متن‌های آماده">
          {REMINDER_PRESETS.map((p) => <button key={p} type="button" className="btn btn-sm" aria-pressed={body === p} onClick={() => setBody(p)}>{p}</button>)}
        </div>
        <label className="field">
          <span>متن تذکر</span>
          <textarea className="input" rows={3} value={body} onChange={(e) => setBody(e.target.value)} aria-describedby="reminder-count" />
          <span id="reminder-count" className={`hint${remaining < 0 ? ' tone-red' : ''}`}>{remaining >= 0 ? `${toPersianDigits(remaining)} حرف باقی مانده` : `${toPersianDigits(-remaining)} حرف بیشتر از حد مجاز`}</span>
        </label>
        <div className="segmented" role="group" aria-label="فوریت">
          <button type="button" aria-pressed={!urgent} onClick={() => setUrgent(false)}>عادی</button>
          <button type="button" aria-pressed={urgent} onClick={() => setUrgent(true)}>فوری</button>
        </div>
        {error && <p role="alert" className="callout callout-red">{error}</p>}
      </div>
    </Dialog>
  );
}
