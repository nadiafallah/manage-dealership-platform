'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  AID_DEADLINE_LABELS, CONTACT_OUTCOMES, CONTACT_OUTCOME_LABELS, DEADLINE_RELEASE_REASON, SPECIAL_AID_ITEM_STATE_LABELS, SPECIAL_AID_RULES, toPersianDigits,
  type AidDeadline, type ContactOutcome, type SpecialAidDossier, type SpecialAidDossierRow, type SpecialAidItem, type SpecialAidItemState, type SpecialAidReleasable, type SpecialAidTask,
} from '@manage/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { faNum, formatJalali } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { AppIcon } from './AppIcon';
import { Dialog } from './Dialog';
import { JalaliInput } from './JalaliInput';
import { Plate } from './Plate';

// «پیگیری امداد ویژه» (spec section 25): the same folder card, tabs, chips, tables and dialogs as the
// rest of Manage; nothing here has its own palette or card style.

const TABS = [
  { href: '/special-aid', label: 'کارهای امروز', icon: 'calendar' as const, perm: 'special_aid.read' as const },
  { href: '/special-aid/vehicles', label: 'پرونده خودروها', icon: 'folder' as const, perm: 'special_aid.read' as const },
  { href: '/special-aid/supply', label: 'پیگیری تأمین قطعات', icon: 'truck' as const, perm: 'special_aid.supply' as const },
  { href: '/special-aid/reports', label: 'گزارش‌ها', icon: 'chart' as const, perm: 'special_aid.report' as const },
];

/** The module's four workspaces; each tab is shown only with its own permission. */
export function SpecialAidTabs() {
  const { can } = useAuth();
  const path = usePathname();
  const active = (href: string) => (href === '/special-aid' ? path === href : path.startsWith(href));
  return (
    <nav className="staff-tabs no-print" aria-label="بخش‌های پیگیری امداد ویژه">
      {TABS.filter((t) => can(t.perm)).map((t) => (
        <Link key={t.href} href={t.href} aria-current={active(t.href) ? 'page' : undefined}><AppIcon name={t.icon} />{t.label}</Link>
      ))}
    </nav>
  );
}

const STATE_TONE: Record<SpecialAidItemState, string> = { pending: 'mute', arrived: 'wait', reserved: 'wait', delivered: 'em', installation_pending: 'em', installed: 'ok', not_installed: 'stop', released: 'mute' };
export function ItemStateTag({ item }: { item: Pick<SpecialAidItem, 'state' | 'officialCategory'> }) {
  if (item.officialCategory === 'cancelled') return <span className="m-tag mute">ابطال‌شده طبق گزارش</span>;
  return <span className={`m-tag ${STATE_TONE[item.state]}`}>{SPECIAL_AID_ITEM_STATE_LABELS[item.state]}</span>;
}

/** Full VIN, selectable and copyable (no masking: the VIN is the dossier's identity). */
export function VinText({ vin }: { vin: string }) {
  const toast = useToast();
  return (
    <span className="folder-id">
      شاسی: <bdi dir="ltr" className="vin-text">{vin}</bdi>
      <button type="button" className="btn btn-sm btn-ghost no-print" aria-label={`کپی شاسی ${vin}`} onClick={() => { void navigator.clipboard?.writeText(vin).then(() => toast('شاسی کپی شد', 'ok'), () => toast('کپی انجام نشد', 'error')); }}>کپی</button>
    </span>
  );
}

const taskTone = (t: SpecialAidTask | null) => (!t ? 'ok' : t.urgent || t.overdue ? 'stop' : 'warn');

/**
 * The 20-working-day deadline of a part or a dossier (spec 29.4): yellow from working day 11, red from
 * day 18, expired after day 20. The existing tag colours (amber, red); no new palette.
 */
export function DeadlineTag({ deadline, compact }: { deadline: AidDeadline | null | undefined; compact?: boolean }) {
  if (!deadline) return null;
  const R = SPECIAL_AID_RULES;
  const tone = deadline.level === 'expired' || deadline.level === 'red' ? 'stop' : deadline.level === 'yellow' ? 'wait' : 'mute';
  const text = deadline.level === 'expired' ? AID_DEADLINE_LABELS.expired
    : `${deadline.level === 'red' ? 'قرمز · ' : deadline.level === 'yellow' ? 'زرد · ' : ''}روز کاری ${faNum(deadline.day)} از ${faNum(R.deadlineWorkingDays)}${compact ? '' : deadline.remaining ? ` · ${faNum(deadline.remaining)} روز کاری مانده` : ' · امروز آخرین روز مهلت'}`;
  return <span className={`m-tag ${tone}`} data-deadline={deadline.level} title={`پایان مهلت: ${formatJalali(deadline.endsAt)}${deadline.official ? '' : ' (از نخستین مشاهدهٔ رسید در منیج)'}`}>{text}</span>;
}

/** Short vehicle name; the full ISACO model opens with one click (lists show only the short name). */
export function VehicleName({ model, fullModel, as: Tag = 'strong' }: { model: string | null; fullModel?: string | null; as?: 'strong' | 'h1' }) {
  const short = model ?? 'خودرو';
  return (
    <>
      <Tag className="folder-car">{short}</Tag>
      {fullModel && fullModel !== model && <details className="vehicle-spec no-print"><summary>مدل کامل</summary><p>{toPersianDigits(fullModel)}</p></details>}
    </>
  );
}

/**
 * One click at the end of the deadline (spec 29.2): the part is released for another customer by a
 * person with the release permission; the reason, name and time are recorded. Never automatic.
 */
export function ReleaseNowButton({ part, onDone }: { part: Pick<SpecialAidReleasable, 'id' | 'version' | 'description' | 'code'>; onDone: (d: SpecialAidDossier | null) => void }) {
  const toast = useToast();
  const { can } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!can('special_aid.release')) return null;
  async function release() {
    setBusy(true);
    try {
      const d = await api<SpecialAidDossier>(`/special-aid/items/${part.id}/action`, { body: { action: 'release', reason: DEADLINE_RELEASE_REASON, expectedVersion: part.version } });
      toast('قطعه برای مشتری دیگر آزاد شد؛ با نام شما در سابقه ثبت شد', 'ok'); onDone(d);
    } catch (e) { toast(errorMessage(e), 'error'); onDone(null); } finally { setBusy(false); }
  }
  return <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void release()} aria-label={`آزاد کردن ${part.description ?? 'قطعه'} برای مشتری دیگر`}>آزاد کردن برای مشتری دیگر</button>;
}

/** A vehicle of the module as the familiar case folder: plate, customer, counts and one next step. */
export function DossierFolder({ d }: { d: SpecialAidDossierRow }) {
  const car = d.vehicle.model ?? 'خودرو';
  return (
    <article className={`folder aid-folder cov-own${d.urgent ? ' folder-behind' : ''}`} aria-label={`پروندهٔ امداد ویژهٔ ${car}${d.vehicle.plate ? `، پلاک ${toPersianDigits(d.vehicle.plate)}` : ''}`}>
      <span className="folder-tab" aria-hidden="true" />
      <div className="folder-top">
        <div className="folder-who">
          <VehicleName model={d.vehicle.model} fullModel={d.vehicle.fullModel} />
          <span className="folder-cust">{d.vehicle.customerName ?? 'مشتری در سوابق پذیرش نیست'}</span>
        </div>
        <Plate value={d.vehicle.plate} size="xl" />
      </div>
      <div className="folder-row"><VinText vin={d.vin} /><span className="folder-id">پذیرش: {faNum(d.admissionCount)}</span></div>
      <div className="folder-counts">
        <span className="cnt cnt-ok">رسیده {faNum(d.arrived)}</span>
        <span className="cnt">در حال تأمین {faNum(d.pending)}</span>
        {d.actionCount > 0 && <span className={`cnt ${d.urgent ? 'cnt-stop' : 'cnt-warn'}`}>نیازمند اقدام {faNum(d.actionCount)}</span>}
        <DeadlineTag deadline={d.deadline} compact />
        {d.contactFailed && <span className="m-tag stop">تماس ناموفق</span>}
      </div>
      <p className={`folder-next tone-${taskTone(d.nextTask)}`}><span>قدم بعدی:</span> {d.nextTask ? d.nextTask.label : 'فعلاً کاری منتظر نیست.'}</p>
      <Link href={`/special-aid/vehicles/${d.id}`} className="folder-open"><AppIcon name="login" />باز کردن پرونده</Link>
    </article>
  );
}

const openItem = (i: SpecialAidItem) => i.state !== 'pending' && !['installed', 'released'].includes(i.state) && i.officialCategory !== 'cancelled';

/** One call for the vehicle; the parts it covers are chosen (default: every open arrived part). */
export function ContactDialog({ dossier, open, onClose, onSaved, preselect }: { dossier: SpecialAidDossier; open: boolean; onClose: () => void; onSaved: (d: SpecialAidDossier) => void; preselect?: string[] }) {
  const toast = useToast();
  const candidates = dossier.items.filter(openItem);
  const [outcome, setOutcome] = useState<ContactOutcome>('answered');
  const [items, setItems] = useState<string[]>(preselect?.length ? preselect : candidates.map((i) => i.id));
  const [note, setNote] = useState('');
  const [promisedAt, setPromisedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const needsDate = outcome === 'promised_visit' || outcome === 'appointment_coordinated';
  async function save() {
    if (!items.length) { toast('دست‌کم یک قطعه را انتخاب کنید', 'error'); return; }
    if (outcome === 'promised_visit' && !promisedAt) { toast('روز قول مراجعه را وارد کنید', 'error'); return; }
    setBusy(true);
    try {
      const d = await api<SpecialAidDossier>(`/special-aid/dossiers/${dossier.id}/contacts`, { body: { outcome, itemIds: items, note: note.trim() || undefined, promisedAt: needsDate && promisedAt ? promisedAt : undefined, expectedVersion: dossier.version } });
      toast('تماس ثبت شد', 'ok'); onSaved(d); onClose();
    } catch (e) { toast(errorMessage(e), 'error'); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} title="ثبت نتیجهٔ تماس با مشتری" onClose={onClose} footer={<><button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>ثبت تماس</button><button type="button" className="btn btn-ghost" onClick={onClose}>انصراف</button></>}>
      <div className="stack">
        {dossier.vehicle.phone && <p className="small">تلفن: <bdi dir="ltr">{toPersianDigits(dossier.vehicle.phone)}</bdi></p>}
        <fieldset className="stack"><legend>نتیجه</legend>
          <div className="segmented" role="group" aria-label="نتیجهٔ تماس">{CONTACT_OUTCOMES.map((o) => <button key={o} type="button" aria-pressed={outcome === o} onClick={() => setOutcome(o)}>{CONTACT_OUTCOME_LABELS[o]}</button>)}</div>
        </fieldset>
        {candidates.length > 0 && <fieldset className="stack"><legend>قطعه‌های این تماس</legend>
          {candidates.map((i) => <label key={i.id} className="check"><input type="checkbox" checked={items.includes(i.id)} onChange={(e) => setItems(e.target.checked ? [...items, i.id] : items.filter((x) => x !== i.id))} /> {i.description ?? 'قطعه'} · <bdi>{toPersianDigits(i.procurementCode ?? i.assessmentCode ?? '')}</bdi></label>)}
        </fieldset>}
        {needsDate && <JalaliInput label={outcome === 'promised_visit' ? 'روز قول مراجعه' : 'روز نوبت هماهنگ‌شده (اختیاری)'} value={promisedAt} onChange={setPromisedAt} />}
        <label className="field"><span>یادداشت (اختیاری)</span><textarea className="input" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <p className="xs muted">زمان، نام شما و نتیجه خودکار ثبت می‌شود. «پاسخ نداد» در همین روز تکرار نمی‌خواهد؛ دو تماس بی‌پاسخ پشت سر هم «تماس ناموفق» است و به مدیریت اعلام می‌شود. تماس بعدی ده روز بعد یادآوری می‌شود.</p>
      </div>
    </Dialog>
  );
}

/** Moves the next call only; the original deadline and the 20-working-day deadline stay as they are. */
export function PostponeDialog({ dossier, open, onClose, onSaved }: { dossier: SpecialAidDossier; open: boolean; onClose: () => void; onSaved: (d: SpecialAidDossier) => void }) {
  const toast = useToast();
  const [until, setUntil] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!until || reason.trim().length < 3) { toast('تاریخ و علت تعویق را وارد کنید', 'error'); return; }
    setBusy(true);
    try { onSaved(await api<SpecialAidDossier>(`/special-aid/dossiers/${dossier.id}/postpone`, { body: { until, reason: reason.trim(), expectedVersion: dossier.version } })); toast('پیگیری به تعویق افتاد', 'ok'); onClose(); }
    catch (e) { toast(errorMessage(e), 'error'); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} title="تعویق پیگیری" onClose={onClose} footer={<><button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>ثبت تعویق</button><button type="button" className="btn btn-ghost" onClick={onClose}>انصراف</button></>}>
      <div className="stack">
        <JalaliInput label="پیگیری بعدی از" value={until} onChange={setUntil} required />
        <label className="field"><span>علت</span><input className="input" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <p className="xs muted">مهلت اصلی اطلاع‌رسانی و مهلت ۲۰ روز کاری از رسیدن قطعه با تعویق جابه‌جا نمی‌شوند.</p>
      </div>
    </Dialog>
  );
}

export const dayText = (iso: string | null) => (iso ? formatJalali(iso) : '—');

/**
 * One-click call log from «کارهای امروز» (scenario S26): «پاسخ داد» or «پاسخ نداد» for the parts of the
 * task; time and name are recorded by the server. Other outcomes are recorded in the dossier.
 */
export function QuickCall({ dossier, itemIds, onSaved }: { dossier: Pick<SpecialAidDossierRow, 'id' | 'version'>; itemIds: string[]; onSaved: () => void }) {
  const toast = useToast();
  const { can } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!can('special_aid.operate') || !itemIds.length) return null;
  async function save(outcome: ContactOutcome) {
    setBusy(true);
    try {
      const d = await api<SpecialAidDossier>(`/special-aid/dossiers/${dossier.id}/contacts`, { body: { outcome, itemIds, expectedVersion: dossier.version } });
      toast(d.contactFailed ? 'دو تماس بی‌پاسخ: تماس ناموفق ثبت و به مدیریت اعلام شد' : `ثبت شد: ${CONTACT_OUTCOME_LABELS[outcome]}`, d.contactFailed ? 'error' : 'ok');
    } catch (e) { toast(errorMessage(e), 'error'); } finally { setBusy(false); onSaved(); }
  }
  return (
    <span className="row no-print" role="group" aria-label="ثبت سریع تماس">
      <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void save('answered')}>پاسخ داد</button>
      <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void save('no_answer')}>پاسخ نداد</button>
    </span>
  );
}
