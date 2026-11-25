'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import useSWR from 'swr';
import {
  NIGHT_LIST_DEADLINE, NIGHT_LIST_GENERATE_AT, NIGHT_LIST_REASONS, NIGHT_LIST_REASON_LABELS, NIGHT_LIST_STATUS_LABELS, formatJalali, toPersianDigits,
  type NightListPending, type NightListReason, type NightListRow, type NightListView,
} from '@manage/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { faNum } from '@/lib/format';
import { AppIcon } from './AppIcon';
import { EmptyState } from './EmptyState';
import { Plate } from './Plate';

// «لیست شب» (reconstruction scenario, owner 2026-11-25): Manage builds it at 18:00 from the open
// receptions; the receptionist only picks the stay reason (and stations while کسب‌وکار has no
// technician data); the supervisor sends it by 18:45. Print gives the PDF; Excel comes from the API.

type Data = NightListView | NightListPending;
const isList = (d: Data | undefined): d is NightListView => !!d && d.status !== 'not_generated';

export function NightList() {
  const { can, me } = useAuth();
  const day = useSearchParams().get('day') ?? undefined;
  const active = me.modules.some((m) => m.key === 'reception' && m.status === 'active');
  const key = ['/reception/night-list', day ?? ''] as const;
  const { data, error, mutate } = useSWR<Data>(can('reception.read') && active ? key : null, () => api<Data>('/reception/night-list', { body: day ? { day } : {} }), { refreshInterval: 60_000 });
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  if (!can('reception.read')) return <EmptyState icon="lock" title="لیست شب" heading="h1">برای این بخش مجوز ندارید.</EmptyState>;
  if (!active) return <EmptyState icon="file" title="لیست شب" heading="h1" action={{ href: '/modules/reception', label: 'نقشهٔ راه' }}>این بخش هنوز روی این سرور فعال نشده است.</EmptyState>;
  const run = async (fn: () => Promise<Data>, done: string) => {
    setBusy(true);
    setMessage('');
    try {
      await mutate(await fn(), { revalidate: false });
      setMessage(done);
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const editable = isList(data) && can('reception.night_list');
  return (
    <section className="desk rcp-desk night-desk" aria-labelledby="night-title">
      <header className="desk-head">
        <div className="desk-hello">
          <h1 id="night-title">لیست شب</h1>
          <p className="desk-sub">{data ? `${formatJalali(data.day + 'T12:00:00Z')}${isList(data) ? ` · ${NIGHT_LIST_STATUS_LABELS[data.status]} · ${faNum(data.rows.length)} خودرو` : ''}` : 'در حال خواندن…'}</p>
        </div>
        {isList(data) && (
          <div className="row no-print">
            <button type="button" className="btn btn-sm" onClick={() => window.print()}><AppIcon name="file" /> چاپ / PDF</button>
            <a className="btn btn-sm" href={`/api/v1/reception/night-list/${data.id}/excel`}>Excel</a>
          </div>
        )}
      </header>
      {error && <p role="alert" className="m-error">{errorMessage(error)}</p>}
      {data && !isList(data) && (
        <div className="callout">
          <p>{data.workingDay ? `لیست امروز ساعت ${toPersianDigits(NIGHT_LIST_GENERATE_AT)} از پذیرش‌های باز ساخته می‌شود.` : 'امروز روز کاری نیست و لیست شب ساخته نمی‌شود.'}</p>
          {can('reception.night_list_send') && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => run(() => api<Data>('/reception/night-list/generate', { body: day ? { day } : {} }), 'پیش‌نویس ساخته شد.')}>ساخت پیش‌نویس همین حالا</button>}
        </div>
      )}
      {isList(data) && (
        <>
          <div className={`callout${data.late ? ' warn' : ''}`} role="status">
            {data.status === 'sent'
              ? <span>ارسال‌شده {data.sentAt ? formatJalali(data.sentAt, { time: true }) : ''}{data.sentByName ? ` توسط ${data.sentByName}` : ''}</span>
              : <span>{data.late ? `مهلت ارسال (ساعت ${toPersianDigits(NIGHT_LIST_DEADLINE)}) گذشته است.` : `مهلت ارسال: ساعت ${toPersianDigits(NIGHT_LIST_DEADLINE)}.`}</span>}
            {data.missingReasons > 0 && <span> {faNum(data.missingReasons)} خودرو هنوز علت ماندن ندارد.</span>}
            {data.status === 'draft' && can('reception.night_list_send') && (
              <button type="button" className="btn btn-sm btn-primary no-print" disabled={busy} onClick={() => run(() => api<Data>(`/reception/night-list/${data.id}/send`, { body: { expectedVersion: data.version } }), 'لیست شب ارسال شد.')}>تأیید و ارسال لیست</button>
            )}
          </div>
          {!data.rows.length && <p className="m-empty">امشب خودرویی در نمایندگی نمانده است.</p>}
          {!!data.rows.length && (
            <div className="table-scroll">
              <table className="table static night-table" data-testid="night-list">
                <thead><tr><th scope="col">خودرو</th><th scope="col">مالک</th><th scope="col">پذیرش</th><th scope="col">روز</th><th scope="col">اجرت‌های کارت</th><th scope="col">جایگاه فعلی</th><th scope="col">جایگاه‌های بعدی</th><th scope="col">علت ماندن</th></tr></thead>
                <tbody>{data.rows.map((r) => <NightRow key={`${r.id}:${r.version}`} row={r} editable={editable} busy={busy} onSave={(body) => run(() => api<Data>(`/reception/night-list/items/${r.id}`, { body }), 'ذخیره شد.')} />)}</tbody>
              </table>
            </div>
          )}
        </>
      )}
      {message && <p className="small" role="status">{message}</p>}
    </section>
  );
}

function NightRow({ row: r, editable, busy, onSave }: { row: NightListRow; editable: boolean; busy: boolean; onSave: (body: object) => void }) {
  const [reason, setReason] = useState<NightListReason | ''>(r.reason ?? ''), [note, setNote] = useState(r.reasonNote ?? '');
  const [current, setCurrent] = useState(r.currentStation ?? ''), [next, setNext] = useState(r.nextStations ?? '');
  const changed = reason !== (r.reason ?? '') || note !== (r.reasonNote ?? '') || current !== (r.currentStation ?? '') || next !== (r.nextStations ?? '');
  const save = () => onSave({ expectedVersion: r.version, reason: reason || null, ...(note.trim() ? { reasonNote: note.trim() } : {}), ...(current.trim() ? { currentStation: current.trim() } : {}), ...(next.trim() ? { nextStations: next.trim() } : {}) });
  return (
    <tr className={r.isOpen ? '' : 'is-closed'}>
      <td><Link href={`/reception/${r.receptionId}`} className="night-car"><Plate value={r.plate} size="row" /><span>{r.vehicleName ?? 'خودرو'}</span></Link>{r.accident && <span className="m-tag wait">تصادفی</span>}{!r.isOpen && <span className="m-tag ok">ترخیص شد</span>}</td>
      <td>{r.ownerName ?? '—'}</td>
      <td><bdi>{r.admissionNo ? toPersianDigits(r.admissionNo) : '—'}</bdi></td>
      <td>{r.daysIn == null ? '—' : faNum(r.daysIn)}</td>
      <td className="small">{r.labour.length ? r.labour.join(' · ') : '—'}</td>
      <td>{editable ? <input className="input" aria-label="جایگاه فعلی" maxLength={60} value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="مثلاً باتری‌سازی ۳۶" /> : r.currentStation ?? '—'}</td>
      <td>{editable ? <input className="input" aria-label="جایگاه‌های بعدی" maxLength={120} value={next} onChange={(e) => setNext(e.target.value)} placeholder="مثلاً مکانیکی ۹۹" /> : r.nextStations ?? '—'}</td>
      <td>
        {editable ? (
          <div className="stack night-reason">
            <select className="input" aria-label="علت ماندن" value={reason} onChange={(e) => setReason(e.target.value as NightListReason | '')}>
              <option value="">— انتخاب علت —</option>
              {NIGHT_LIST_REASONS.map((k) => <option key={k} value={k}>{NIGHT_LIST_REASON_LABELS[k]}</option>)}
            </select>
            {reason === 'other' && <input className="input" aria-label="توضیح علت" maxLength={300} required value={note} onChange={(e) => setNote(e.target.value)} placeholder="توضیح کوتاه" />}
            {r.carried && !changed && <span className="muted small">از لیست دیروز</span>}
            {(changed || r.carried) && <button type="button" className="btn btn-sm no-print" disabled={busy || (reason === 'other' && !note.trim())} onClick={save}>{changed ? 'ذخیره' : 'تأیید'}</button>}
          </div>
        ) : (
          <span>{r.reason ? NIGHT_LIST_REASON_LABELS[r.reason] : 'ثبت نشده'}{r.reasonNote ? ` — ${r.reasonNote}` : ''}{r.carried ? ' (از دیروز)' : ''}</span>
        )}
      </td>
    </tr>
  );
}
