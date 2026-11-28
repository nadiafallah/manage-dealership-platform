'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import useSWR from 'swr';
import {
  CONTACT_OUTCOME_LABELS, NON_CONSUMPTION_LABELS, NON_CONSUMPTION_REASONS, SPECIAL_AID_ACTION_LABELS, SPECIAL_AID_ITEM_STATES, SPECIAL_AID_ITEM_STATE_LABELS,
  toPersianDigits, type NonConsumptionReason, type SpecialAidAction, type SpecialAidDossier, type SpecialAidItem, type SpecialAidItemState,
} from '@manage/shared';
import { api, errorMessage, fetcher } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { faNum, formatJalali } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { AppIcon } from '@/components/AppIcon';
import { Dialog } from '@/components/Dialog';
import { Plate } from '@/components/Plate';
import { ContactDialog, DeadlineTag, ItemStateTag, PostponeDialog, ReleaseNowButton, SpecialAidTabs, VinText, dayText } from '@/components/SpecialAid';
import { AppointmentStateTag, AppointmentsPanel, CardList, CardUpload, FeedbackForm, FeedbackList } from '@/components/SpecialAidRecords';

/**
 * One vehicle: every admission and special-aid part together, filterable; one call covers several parts.
 * The dossier of «منتظر دعوت» (owner, 2026-11-28): short name with the full model one click away, the
 * customer, each part with its state, request and arrival dates and its 20-working-day deadline, and the
 * history of calls — for every vehicle of the dealership, accident or general repair.
 */
export default function SpecialAidDossierPage() {
  const { id } = useParams<{ id: string }>();
  const { can, me } = useAuth();
  const toast = useToast();
  const { data: d, error, mutate } = useSWR<SpecialAidDossier>(can('special_aid.read') ? `/special-aid/dossiers/${id}` : null, fetcher);
  const [admission, setAdmission] = useState(''), [state, setState] = useState<SpecialAidItemState | ''>('');
  const [contact, setContact] = useState<string[] | null>(null), [postpone, setPostpone] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [release, setRelease] = useState<SpecialAidItem | null>(null), [releaseReason, setReleaseReason] = useState('');
  const [busy, setBusy] = useState(false);
  const operate = can('special_aid.operate');
  if (!can('special_aid.read')) return <div className="callout"><h1>پروندهٔ امداد ویژه</h1><p>برای این بخش مجوز ندارید.</p></div>;
  if (error) return <p role="alert" className="m-error">{errorMessage(error)}</p>;
  if (!d) return <p className="muted small" role="status">در حال خواندن پرونده…</p>;
  const saved = (next: SpecialAidDossier) => void mutate(next, { revalidate: false });
  async function run(path: string, body: Record<string, unknown>, ok: string) {
    setBusy(true);
    try { saved(await api<SpecialAidDossier>(path, { body })); toast(ok); return true; }
    catch (e) { toast(errorMessage(e), 'error'); await mutate(); return false; } finally { setBusy(false); }
  }
  const act = (i: SpecialAidItem, action: SpecialAidAction, extra: Record<string, unknown> = {}) => run(`/special-aid/items/${i.id}/action`, { action, expectedVersion: i.version, ...extra }, SPECIAL_AID_ACTION_LABELS[action]);
  const items = d.items.filter((i) => (!admission || i.admissionId === admission) && (!state || i.state === state));
  return (
    <div className="stack">
      <SpecialAidTabs />
      <article className={`folder aid-folder cov-own${d.urgent ? ' folder-behind' : ''}`} aria-label="مشخصات خودرو">
        <span className="folder-tab" aria-hidden="true" />
        <div className="folder-top">
          <div className="folder-who"><h1 className="folder-car">{d.vehicle.model ?? 'خودرو'}</h1><span className="folder-cust">{d.vehicle.customerName ?? 'مشتری در سوابق پذیرش نیست'}{d.vehicle.phone && <> · <bdi dir="ltr">{toPersianDigits(d.vehicle.phone)}</bdi></>}</span></div>
          <Plate value={d.vehicle.plate} size="xl" />
        </div>
        <div className="folder-row"><VinText vin={d.vin} /><span className="folder-id">پذیرش: {faNum(d.admissionCount)}</span></div>
        {d.vehicle.fullModel && d.vehicle.fullModel !== d.vehicle.model && <details className="vehicle-spec"><summary>مشخصات کامل خودرو</summary><p>{toPersianDigits(d.vehicle.fullModel)}</p></details>}
        <div className="folder-counts"><AppointmentStateTag state={d.appointmentState} /><span className="cnt cnt-ok">رسیده {faNum(d.arrived)}</span><span className="cnt">در حال تأمین {faNum(d.pending)}</span><DeadlineTag deadline={d.deadline} />{d.contactFailed ? <span className="m-tag stop">تماس ناموفق: دو تماس بی‌پاسخ</span> : d.unansweredStreak > 0 && <span className="cnt cnt-warn">{faNum(d.unansweredStreak)} تماس بی‌پاسخ</span>}{d.postponedUntil && <span className="cnt">پیگیری از {formatJalali(d.postponedUntil)} · {d.postponeReason}</span>}</div>
        {operate && <div className="row no-print">
          <button type="button" className="btn btn-primary" onClick={() => setContact([])}><AppIcon name="send" />ثبت تماس</button>
          <button type="button" className="btn" onClick={() => setPostpone(true)}>تعویق پیگیری</button>
          <button type="button" className="btn" disabled={busy} onClick={() => void run(`/special-aid/dossiers/${d.id}/attended`, { expectedVersion: d.version }, 'مراجعهٔ مشتری ثبت شد')}>مشتری مراجعه کرد</button>
          {selected.length >= 2 && <button type="button" className="btn" disabled={busy} onClick={() => void run(`/special-aid/dossiers/${d.id}/groups`, { itemIds: selected }, 'قطعه‌ها گروه شدند').then((ok) => ok && setSelected([]))}>گروه کردن {faNum(selected.length)} قطعهٔ مرتبط</button>}
        </div>}
      </article>

      {d.tasks.length > 0 && <p className="desk-strip" role="status"><AppIcon name="calendar" /><b>کار امروز:</b> {d.tasks.map((t) => `${t.label}${t.postponed ? ' (به تعویق افتاده)' : ''}`).join(' · ')}</p>}

      <section className="panel" aria-labelledby="aid-parts"><div className="panel-head"><div><h2 id="aid-parts">قطعه‌های امداد ویژه</h2><p className="muted small">{faNum(items.length)} از {faNum(d.items.length)} قطعه</p></div>
        <div className="row no-print">
          {!me.roles.every((r) => r === 'guest') && <a className="btn btn-sm" href={`/api/v1/special-aid/dossiers/${d.id}/inspection`} title="قطعه‌ها، تماس‌ها و سابقه برای بازرس">Excel بازرسی</a>}
          <label className="field">پذیرش<select className="input" value={admission} onChange={(e) => setAdmission(e.target.value)}><option value="">همهٔ پذیرش‌ها</option>{d.admissions.map((a) => <option key={a.id} value={a.id}>{toPersianDigits(a.admissionNo)} ({faNum(a.itemCount)})</option>)}</select></label>
          <label className="field">وضعیت<select className="input" value={state} onChange={(e) => setState(e.target.value as SpecialAidItemState | '')}><option value="">همه</option>{SPECIAL_AID_ITEM_STATES.map((s) => <option key={s} value={s}>{SPECIAL_AID_ITEM_STATE_LABELS[s]}</option>)}</select></label>
        </div></div>
        <div className="panel-body aid-items" data-testid="aid-items">{items.map((i) => {
          const group = d.groups.find((g) => g.id === i.groupId);
          return <div key={i.id} className="aid-item" data-testid="aid-item">
            <div className="stack">
              <div className="row">{operate && !i.accidentCaseId && !i.groupId && <input type="checkbox" aria-label="انتخاب برای گروه" checked={selected.includes(i.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, i.id] : selected.filter((x) => x !== i.id))} />}<strong>{i.description ?? 'قطعه'}</strong><ItemStateTag item={i} />{group && <span className="m-tag em">گروه {group.label ?? ''}</span>}<DeadlineTag deadline={i.deadline} /></div>
              <div className="aid-item-meta">
                <span>کد تدارکاتی: <bdi>{toPersianDigits(i.procurementCode ?? '—')}</bdi></span><span>کد اختصاصی: <bdi>{toPersianDigits(i.assessmentCode ?? '—')}</bdi></span>
                <span>امداد ویژه: <bdi>{toPersianDigits(i.emdadNo ?? '—')}</bdi></span><span>پذیرش: <bdi>{toPersianDigits(i.admissionNo ?? '—')}</bdi></span><span>تعداد: {toPersianDigits(i.quantity ?? '—')}</span>
              </div>
              <div className="aid-item-meta"><span>وضعیت رسمی: {i.officialStatus || '—'}</span>
                <span>درخواست (ثبت رسمی امداد): {dayText(i.officialRegisteredAt)}</span>
                {i.receivedAt ? <span>رسید انبار (رسمی): {dayText(i.receivedAt)}</span> : i.arrivalObservedAt ? <span>نخستین مشاهدهٔ رسید در منیج: {dayText(i.arrivalObservedAt)}</span> : null}
                {i.informedAt ? <span>اطلاع به مشتری: {dayText(i.informedAt)}</span> : i.state !== 'pending' && <span className="m-tag wait">مشتری خبر ندارد</span>}
              </div>
              {i.holdNote && <p className="callout callout-amber small">{i.holdNote}</p>}
              {i.accidentCaseId && <p className="small">این قطعه به <Link href={`/cases/${i.accidentCaseId}#case-parts`}>پروندهٔ تصادفی <bdi>{toPersianDigits(i.accidentCaseNumber ?? '')}</bdi></Link> وصل است؛ رزرو و تحویل در میز قطعات انجام می‌شود.</p>}
              {i.replacesItemId && <p className="small">جایگزین درخواست قبلی: <bdi>{toPersianDigits(d.items.find((x) => x.id === i.replacesItemId)?.emdadNo ?? '')}</bdi> (درخواست قبلی در تاریخچه می‌ماند)</p>}
              {i.replacedByItemId && <p className="small">درخواست تازه با شمارهٔ درست: <bdi>{toPersianDigits(d.items.find((x) => x.id === i.replacedByItemId)?.emdadNo ?? '')}</bdi></p>}
              {i.nonConsumptionReason && <p className="small">علت مصرف‌نشدن: <b>{NON_CONSUMPTION_LABELS[i.nonConsumptionReason]}</b>{i.requestingStation ? ` · جایگاه درخواست‌دهنده: ${i.requestingStation}` : ''}{i.nonConsumptionNote && ` — ${i.nonConsumptionNote}`}</p>}
              {operate && d.items.length > 1 && <Replacement item={i} items={d.items} busy={busy} onSave={(replacesItemId) => run(`/special-aid/items/${i.id}/replacement`, { replacesItemId, expectedVersion: i.version }, 'پیوند درخواست ثبت شد')} />}
              {operate && !i.accidentCaseId && i.state !== 'installed' && <NonConsumption item={i} busy={busy} onSave={(reason, note, station) => run(`/special-aid/items/${i.id}/non-consumption`, { reason, note, ...(station ? { requestingStation: station } : {}), expectedVersion: i.version }, 'علت ثبت شد؛ رزرو تغییری نکرد')} />}
            </div>
            <div className="aid-item-actions no-print">{i.allowedActions.filter((a) => a !== 'release' ? operate : can('special_aid.release')).map((a) => (
              // At the end of the 20-working-day deadline the release is one click (spec 29.2); before it, a reason is asked for.
              a === 'release' && i.deadline?.level === 'expired'
                ? <ReleaseNowButton key={a} part={{ id: i.id, version: i.version, description: i.description, code: i.procurementCode }} onDone={(next) => { if (next) saved(next); else void mutate(); }} />
                : <button key={a} type="button" className={`btn btn-sm${a === 'release' ? ' btn-ghost' : ''}`} disabled={busy} onClick={() => { if (a === 'release') { setRelease(i); setReleaseReason(''); } else void act(i, a); }}>{SPECIAL_AID_ACTION_LABELS[a]}</button>
            ))}{operate && i.state !== 'pending' && !['installed', 'released'].includes(i.state) && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setContact([i.id])}>تماس برای همین قطعه</button>}</div>
          </div>;
        })}{!items.length && <p className="m-empty">قطعه‌ای با این صافی نیست.</p>}</div>
      </section>

      {d.groups.length > 0 && <section className="panel" aria-labelledby="aid-groups"><div className="panel-head"><h2 id="aid-groups">قطعه‌های مرتبط</h2></div><div className="panel-body stack">{d.groups.map((g) => {
        const members = d.items.filter((i) => g.itemIds.includes(i.id));
        const waiting = members.filter((i) => i.state === 'pending').length;
        return <div key={g.id} className="stack"><p className="small"><b>{g.label ?? 'گروه'}</b> · {faNum(members.length)} قطعه · {waiting ? `${faNum(waiting)} قطعه هنوز نرسیده` : 'همه رسیده‌اند'} · تصمیم: {g.decision === 'wait' ? 'انتظار برای همه' : g.decision === 'partial' ? 'تعمیر بخشی' : 'تصمیم گرفته نشده'}</p>
          {operate && <div className="segmented" role="group" aria-label="تصمیم گروه"><button type="button" aria-pressed={g.decision === 'wait'} disabled={busy} onClick={() => void run(`/special-aid/groups/${g.id}/decision`, { decision: 'wait', expectedVersion: g.version }, 'ثبت شد')}>انتظار برای همه</button><button type="button" aria-pressed={g.decision === 'partial'} disabled={busy} onClick={() => void run(`/special-aid/groups/${g.id}/decision`, { decision: 'partial', expectedVersion: g.version }, 'ثبت شد')}>تعمیر بخشی</button><button type="button" disabled={busy} onClick={() => void run(`/special-aid/groups/${g.id}/decision`, { decision: null, dissolve: true, expectedVersion: g.version }, 'گروه باز شد')}>باز کردن گروه</button></div>}
        </div>;
      })}</div></section>}

      <section className="panel" aria-labelledby="aid-contacts"><div className="panel-head"><h2 id="aid-contacts">تماس‌ها</h2></div><div className="panel-body">
        {d.contacts.length ? <ul className="stack">{d.contacts.map((c) => <li key={c.id} className="small"><b>{CONTACT_OUTCOME_LABELS[c.outcome]}</b> · {formatJalali(c.at, { time: true })} · {c.byName}{c.promisedAt && ` · روز: ${dayText(c.promisedAt)}`} · {faNum(c.itemIds.length)} قطعه{c.note && <div className="xs muted">{c.note}</div>}</li>)}</ul> : <p className="muted small">هنوز تماسی ثبت نشده است.</p>}
      </div></section>

      {can('reference.appointments.read') && <AppointmentsPanel d={d} busy={busy} onRelation={(entryId, relation) => void run(`/special-aid/dossiers/${d.id}/appointments/${entryId}`, { relation }, relation ? 'ثبت شد' : 'تصمیم برداشته شد')} />}

      <section className="panel" aria-labelledby="aid-cards"><div className="panel-head"><div><h2 id="aid-cards">کارت پذیرش</h2><p className="muted small">اصل فایل با نام بارگذاری‌کننده و زمان نگه داشته می‌شود.</p></div></div><div className="panel-body stack">
        <CardList cards={d.cards} onChanged={() => void mutate()} />
        {operate && <CardUpload vin={d.vin} admissionNo={d.admissions.length === 1 ? d.admissions[0]!.admissionNo : undefined} onDone={() => void mutate()} />}
      </div></section>

      {(can('special_aid.warn') || can('special_aid.report')) && <section className="panel" aria-labelledby="aid-feedback"><div className="panel-head"><h2 id="aid-feedback">بازخورد فنی و تذکر</h2></div><div className="panel-body stack">
        <FeedbackList items={d.feedback} onChanged={() => void mutate()} />
        {can('special_aid.warn') && <FeedbackForm d={d} onSaved={() => void mutate()} />}
      </div></section>}

      {contact && <ContactDialog dossier={d} open onClose={() => setContact(null)} onSaved={saved} preselect={contact} />}
      {postpone && <PostponeDialog dossier={d} open onClose={() => setPostpone(false)} onSaved={saved} />}
      <Dialog open={!!release} title="آزاد کردن رزرو" onClose={() => setRelease(null)} footer={<><button type="button" className="btn btn-primary" disabled={busy || releaseReason.trim().length < 3} onClick={() => { if (release) void act(release, 'release', { reason: releaseReason.trim() }).then((ok) => ok && setRelease(null)); }}>آزاد کردن</button><button type="button" className="btn btn-ghost" onClick={() => setRelease(null)}>انصراف</button></>}>
        <p className="small">قطعه دوباره در موجودی قابل‌استفاده دیده می‌شود. این کار با نام شما و علت در تاریخچه می‌ماند.</p>
        <label className="field"><span>علت</span><input className="input" maxLength={300} value={releaseReason} onChange={(e) => setReleaseReason(e.target.value)} /></label>
      </Dialog>
    </div>
  );
}

function NonConsumption({ item, busy, onSave }: { item: SpecialAidItem; busy: boolean; onSave: (reason: NonConsumptionReason | null, note?: string, station?: string) => Promise<boolean> }) {
  const [reason, setReason] = useState<NonConsumptionReason | ''>(item.nonConsumptionReason ?? '');
  const [note, setNote] = useState(item.nonConsumptionNote ?? '');
  const [station, setStation] = useState(item.requestingStation ?? '');
  return (
    <details className="small no-print"><summary>علت مصرف‌نشدن</summary>
      <div className="row">
        <select className="input" aria-label="علت مصرف‌نشدن" value={reason} onChange={(e) => setReason(e.target.value as NonConsumptionReason | '')}><option value="">ثبت نشده</option>{NON_CONSUMPTION_REASONS.map((r) => <option key={r} value={r}>{NON_CONSUMPTION_LABELS[r]}</option>)}</select>
        <input className="input" aria-label="توضیح" placeholder="توضیح (برای «سایر» الزامی)" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        <input className="input" aria-label="جایگاه درخواست‌دهنده" placeholder="جایگاه درخواست‌دهنده (مثلاً مکانیکی ۹۹)" maxLength={60} value={station} onChange={(e) => setStation(e.target.value)} />
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void onSave(reason || null, note.trim() || undefined, station.trim() || undefined)}>ثبت</button>
      </div>
      {reason === 'wrong_part_number' && <p className="xs muted">درخواست قبلی در ایساکو ویرایش نمی‌شود؛ کارشناس فنی درخواست تازه ثبت می‌کند و هر دو در تاریخچه می‌مانند.</p>}
    </details>
  );
}

/** Links a new request with the correct part number to the earlier one; neither is overwritten. */
function Replacement({ item, items, busy, onSave }: { item: SpecialAidItem; items: SpecialAidItem[]; busy: boolean; onSave: (replacesItemId: string | null) => Promise<boolean> }) {
  const [value, setValue] = useState(item.replacesItemId ?? '');
  const others = items.filter((x) => x.id !== item.id && x.replacesItemId !== item.id);
  return (
    <details className="small no-print"><summary>جایگزین درخواست قبلی است؟</summary>
      <div className="row">
        <select className="input" aria-label="درخواست قبلی" value={value} onChange={(e) => setValue(e.target.value)}><option value="">جایگزین نیست</option>{others.map((x) => <option key={x.id} value={x.id}>{x.description ?? 'قطعه'} · {toPersianDigits(x.emdadNo ?? '')}{x.nonConsumptionReason ? ` · ${NON_CONSUMPTION_LABELS[x.nonConsumptionReason]}` : ''}</option>)}</select>
        <button type="button" className="btn btn-sm" disabled={busy || value === (item.replacesItemId ?? '')} onClick={() => void onSave(value || null)}>ثبت</button>
      </div>
    </details>
  );
}
