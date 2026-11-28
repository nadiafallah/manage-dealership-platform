'use client';
import { useState } from 'react';
import useSWR from 'swr';
import {
  APPOINTMENT_STATE_LABELS, CARD_MAX_BYTES, CARD_MIME_TYPES, FEEDBACK_KIND_LABELS, NON_CONSUMPTION_LABELS, NON_CONSUMPTION_REASONS, toPersianDigits,
  type AppointmentState, type FeedbackKind, type NonConsumptionReason, type SpecialAidCard, type SpecialAidDossier, type SpecialAidFeedback,
} from '@manage/shared';
import { api, errorMessage, fetcher } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { faNum, formatJalali } from '@/lib/format';
import { useToast } from '@/lib/toast';

const STATE_TONE: Record<AppointmentState, string> = { confirmed: 'ok', attended: 'ok', ambiguous: 'wait', passed_unverified: 'stop', stale: 'wait', none_recent: 'mute', no_report: 'mute' };
export const AppointmentStateTag = ({ state }: { state: AppointmentState }) => <span className={`m-tag ${STATE_TONE[state]}`}>{APPOINTMENT_STATE_LABELS[state]}</span>;

/**
 * Appointments of this VIN from the imported ISACO list; Manage never schedules. Spec 29.3: the
 * appointment of the vehicle after a part arrived is linked automatically; the operator can correct it.
 */
export function AppointmentsPanel({ d, busy, onRelation }: { d: SpecialAidDossier; busy: boolean; onRelation: (entryId: string, relation: 'related' | 'unrelated' | null) => void }) {
  const { can } = useAuth();
  const operate = can('special_aid.operate');
  return (
    <section className="panel" aria-labelledby="aid-appointments"><div className="panel-head"><div><h2 id="aid-appointments">نوبت‌های ایساکو</h2><p className="muted small">از «لیست نوبت پذیرش»؛ نوبت در سامانهٔ نوبت‌دهی کسب‌وکار داده و جابه‌جا می‌شود، نه در منیج. نوبت همین خودرو پس از رسیدن قطعه خودکار وصل می‌شود؛ اگر اشتباه است «نامرتبط» بزنید.</p></div><AppointmentStateTag state={d.appointmentState} /></div>
      <div className="panel-body">
        {d.appointments.length ? <div className="table-scroll"><table className="table static"><thead><tr><th>روز و ساعت</th><th>وضعیت در ایساکو</th><th>شماره نوبت / پذیرش</th><th>مرتبط با امداد ویژه؟</th></tr></thead><tbody>
          {d.appointments.map((a) => <tr key={a.id}>
            <td>{a.at ? formatJalali(a.at, { time: !!a.timeText }) : toPersianDigits(a.dateText ?? '—')}</td>
            <td>{a.status ?? '—'}{a.serviceType && <div className="xs muted">{a.serviceType}</div>}</td>
            <td><bdi>{toPersianDigits(a.appointmentNo ?? '—')}</bdi>{a.admissionNo && <div className="xs muted">پذیرش <bdi>{toPersianDigits(a.admissionNo)}</bdi></div>}</td>
            <td>{operate ? <div className="segmented" role="group" aria-label="ارتباط نوبت">
              <button type="button" aria-pressed={a.relation === 'related'} disabled={busy} onClick={() => onRelation(a.id, a.relation === 'related' ? null : 'related')}>مرتبط</button>
              <button type="button" aria-pressed={a.relation === 'unrelated'} disabled={busy} onClick={() => onRelation(a.id, a.relation === 'unrelated' ? null : 'unrelated')}>نامرتبط</button>
            </div> : a.relation === 'related' ? 'مرتبط' : a.relation === 'unrelated' ? 'نامرتبط' : 'تأیید نشده'}{a.auto ? <div className="xs muted">خودکار از گزارش نوبت</div> : a.relationByName && <div className="xs muted">{a.relationByName}</div>}</td>
          </tr>)}
        </tbody></table></div> : <p className="muted small">{APPOINTMENT_STATE_LABELS[d.appointmentState]}.</p>}
      </div>
    </section>
  );
}

async function fileB64(f: File) {
  const bytes = new Uint8Array(await f.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
type UploadResult = { fileName: string; outcome: 'matched' | 'unmatched' | 'duplicate' | 'rejected'; message: string | null };
const OUTCOME: Record<UploadResult['outcome'], string> = { matched: 'به پرونده وصل شد', unmatched: 'بایگانی شد؛ هنوز وصل نیست', duplicate: 'تکراری؛ قبلاً بایگانی شده', rejected: 'پذیرفته نشد' };

/** Single or bulk upload of admission cards; each file is sent on its own (original kept). */
export function CardUpload({ admissionNo, vin, onDone }: { admissionNo?: string; vin?: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false), [results, setResults] = useState<UploadResult[]>([]);
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true); const out: UploadResult[] = [];
    for (const f of Array.from(files).slice(0, 50)) {
      if (!(CARD_MIME_TYPES as readonly string[]).includes(f.type) || f.size > CARD_MAX_BYTES) { out.push({ fileName: f.name, outcome: 'rejected', message: 'فقط تصویر JPEG/PNG/WEBP یا PDF کمتر از چهار مگابایت' }); continue; }
      try {
        const r = await api<{ results: UploadResult[] }>('/special-aid/cards', { body: { files: [{ fileName: f.name, mime: f.type, dataBase64: await fileB64(f), admissionNo, vin }] } });
        out.push(...r.results);
      } catch (e) { out.push({ fileName: f.name, outcome: 'rejected', message: errorMessage(e) }); }
      setResults([...out]);
    }
    setBusy(false); onDone();
  }
  return (
    <div className="stack">
      <label className="field"><span>تصویر کارت پذیرش (یک یا چند فایل)</span><input className="input" type="file" multiple accept={CARD_MIME_TYPES.join(',')} disabled={busy} onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} /></label>
      {busy && <p className="muted small" role="status">در حال بارگذاری…</p>}
      {results.length > 0 && <ul className="small stack" aria-live="polite">{results.map((r, i) => <li key={i}><bdi>{r.fileName}</bdi>: <b>{OUTCOME[r.outcome]}</b>{r.message && ` — ${r.message}`}</li>)}</ul>}
    </div>
  );
}

export function CardList({ cards, onChanged }: { cards: SpecialAidCard[]; onChanged: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const [edit, setEdit] = useState<string | null>(null), [adm, setAdm] = useState(''), [vin, setVin] = useState(''), [busy, setBusy] = useState(false);
  async function match(c: SpecialAidCard) {
    setBusy(true);
    try { const r = await api<{ matched: boolean }>(`/special-aid/cards/${c.id}/match`, { body: { admissionNo: adm.trim() || undefined, vin: vin.trim() || undefined, expectedVersion: c.version } }); toast(r.matched ? 'کارت به پرونده وصل شد' : 'شماره‌ها ثبت شد؛ پس از گزارش بعدی دوباره بررسی می‌شود'); setEdit(null); onChanged(); }
    catch (e) { toast(errorMessage(e), 'error'); } finally { setBusy(false); }
  }
  if (!cards.length) return <p className="muted small">کارتی بایگانی نشده است.</p>;
  return (
    <div className="table-scroll"><table className="table static"><thead><tr><th>فایل</th><th>بارگذاری</th><th>شماره‌ها</th><th>وضعیت</th><th /></tr></thead><tbody>
      {cards.map((c) => <tr key={c.id}>
        <td><a href={`/api/v1/special-aid/cards/${c.id}/file`} download><bdi>{c.fileName}</bdi></a><div className="xs muted">{faNum(Math.ceil(c.size / 1024))} کیلوبایت · <bdi dir="ltr">{c.sha256.slice(0, 12)}</bdi></div></td>
        <td>{c.uploadedByName}<div className="xs muted">{formatJalali(c.uploadedAt, { time: true })}</div></td>
        <td>{c.admissionNo && <div>پذیرش <bdi>{toPersianDigits(c.admissionNo)}</bdi></div>}{c.vin && <div><bdi dir="ltr">{c.vin}</bdi></div>}{!c.admissionNo && !c.vin && '—'}</td>
        <td><span className={`m-tag ${c.state === 'matched' ? 'ok' : 'wait'}`}>{c.state === 'matched' ? 'وصل به پرونده' : 'در انتظار تطبیق'}</span></td>
        <td>{can('special_aid.operate') && (edit === c.id ? <div className="row">
          <input className="input" aria-label="شمارهٔ پذیرش" placeholder="شمارهٔ پذیرش" maxLength={40} value={adm} onChange={(e) => setAdm(e.target.value)} />
          <input className="input" aria-label="VIN" placeholder="VIN یا شاسی" dir="ltr" maxLength={17} value={vin} onChange={(e) => setVin(e.target.value.toUpperCase())} />
          <button type="button" className="btn btn-sm btn-primary" disabled={busy || (!adm.trim() && !vin.trim())} onClick={() => void match(c)}>تطبیق</button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEdit(null)}>انصراف</button>
        </div> : <button type="button" className="btn btn-sm" onClick={() => { setEdit(c.id); setAdm(c.admissionNo ?? ''); setVin(c.vin ?? ''); }}>ثبت شماره</button>)}</td>
      </tr>)}
    </tbody></table></div>
  );
}

export function FeedbackList({ items, onChanged }: { items: SpecialAidFeedback[]; onChanged: () => void }) {
  const { me } = useAuth();
  const toast = useToast();
  const [reply, setReply] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false);
  async function ack(f: SpecialAidFeedback) {
    setBusy(true);
    try { await api(`/special-aid/feedback/${f.id}/acknowledge`, { body: { reply: reply[f.id]?.trim() || undefined, expectedVersion: f.version } }); toast('دریافت تأیید شد'); onChanged(); }
    catch (e) { toast(errorMessage(e), 'error'); } finally { setBusy(false); }
  }
  if (!items.length) return <p className="muted small">موردی ثبت نشده است.</p>;
  return (
    <ul className="stack">{items.map((f) => <li key={f.id} className="stack small">
      <div className="row"><span className={`m-tag ${f.kind === 'warning' ? 'stop' : 'em'}`}>{FEEDBACK_KIND_LABELS[f.kind]}</span>{f.reason && <span className="m-tag mute">{NON_CONSUMPTION_LABELS[f.reason]}</span>}<span>به {f.recipientName} · از {f.issuedByName} · {formatJalali(f.issuedAt, { time: true })}</span>{f.vin && <bdi dir="ltr" className="xs">{f.vin}</bdi>}</div>
      <p>{f.message}</p>
      {f.acknowledgedAt ? <p className="xs muted">دریافت در {formatJalali(f.acknowledgedAt, { time: true })} تأیید شد{f.reply && ` — پاسخ: ${f.reply}`}</p>
        : f.recipientId === me.id ? <div className="row"><input className="input" aria-label="پاسخ (اختیاری)" placeholder="پاسخ (اختیاری)" maxLength={1000} value={reply[f.id] ?? ''} onChange={(e) => setReply({ ...reply, [f.id]: e.target.value })} /><button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void ack(f)}>دریافت شد</button></div>
          : <p className="xs muted">در انتظار تأیید دریافت</p>}
    </li>)}<li className="xs muted">تأیید دریافت به معنای پذیرش تقصیر نیست.</li></ul>
  );
}

/** Service manager: technical feedback or a formal warning about this vehicle or one of its parts. */
export function FeedbackForm({ d, onSaved }: { d: SpecialAidDossier; onSaved: () => void }) {
  const toast = useToast();
  const { me } = useAuth();
  const { data: staff } = useSWR<{ id: string; displayName: string }[]>('/users/assignable', fetcher);
  const [recipientId, setRecipient] = useState(''), [kind, setKind] = useState<FeedbackKind>('feedback'), [reason, setReason] = useState<NonConsumptionReason | ''>(''), [itemId, setItem] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { await api('/special-aid/feedback', { body: { recipientId, kind, reason: reason || undefined, dossierId: d.id, itemId: itemId || undefined, message: message.trim() } }); toast('ثبت و برای گیرنده ارسال شد'); setMessage(''); onSaved(); }
    catch (e) { toast(errorMessage(e), 'error'); } finally { setBusy(false); }
  }
  return (
    <details className="small"><summary>ثبت بازخورد فنی یا تذکر رسمی</summary>
      <div className="stack">
        <div className="grid-2">
          <label className="field"><span>گیرنده</span><select className="input" value={recipientId} onChange={(e) => setRecipient(e.target.value)}><option value="">انتخاب کنید</option>{staff?.filter((s) => s.id !== me.id).map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}</select></label>
          <label className="field"><span>نوع</span><select className="input" value={kind} onChange={(e) => setKind(e.target.value as FeedbackKind)}><option value="feedback">{FEEDBACK_KIND_LABELS.feedback}</option><option value="warning">{FEEDBACK_KIND_LABELS.warning}</option></select></label>
          <label className="field"><span>موضوع</span><select className="input" value={reason} onChange={(e) => setReason(e.target.value as NonConsumptionReason | '')}><option value="">بدون موضوع</option>{NON_CONSUMPTION_REASONS.map((r) => <option key={r} value={r}>{NON_CONSUMPTION_LABELS[r]}</option>)}</select></label>
          <label className="field"><span>قطعه (اختیاری)</span><select className="input" value={itemId} onChange={(e) => setItem(e.target.value)}><option value="">کل خودرو</option>{d.items.map((i) => <option key={i.id} value={i.id}>{i.description ?? 'قطعه'} · {toPersianDigits(i.emdadNo ?? '')}</option>)}</select></label>
        </div>
        <label className="field"><span>متن</span><textarea className="input" rows={3} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} /></label>
        <div><button type="button" className="btn btn-primary" disabled={busy || !recipientId || message.trim().length < 3} onClick={() => void save()}>ثبت</button></div>
      </div>
    </details>
  );
}
