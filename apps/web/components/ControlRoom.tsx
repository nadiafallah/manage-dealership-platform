'use client';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import useSWR from 'swr';
import { ALERT_TABLE, CONTROL_RANGES, CONTROL_RANGE_LABELS, toPersianDigits, type ControlRange, type ControlRoomSnapshot, type JourneyStep, type UnansweredAlert } from '@manage/shared';
import { fetcher } from '@/lib/api';
import { faNum, formatJalali } from '@/lib/format';
import { AppIcon, type IconName } from './AppIcon';
import { PlateText } from './Plate';
import { ReminderComposer, type ReminderDefaults } from './ReminderComposer';
import { WorkshopScene } from './WorkshopScene';

// Control room (spec §10, owner reference «اتاق کنترل مدیر خدمات»): dark
// petrol space, display and analysis only. The single action anywhere on this
// page is «تذکر»; the workshop drawing comes from the live bays.
const fa1 = (n: number | null | undefined) => (n == null ? '—' : toPersianDigits(String(Math.round(n * 10) / 10).replace('.', '٫')));
const hours = (h: number) => (h >= 48 ? `${faNum(Math.round(h / 24))} روز` : `${faNum(h)} ساعت`);
const ROLE_TEXT = { accident_expert: 'کارشناس تصادفات', parts_clerk: 'مسئول قطعات', station: 'جایگاه' } as const;
const STAGE_ICON: Record<JourneyStep, IconName> = { reception: 'doc', assessment: 'clipboard', parts: 'box', repair: 'wrench', delivery: 'car' };
const ALERTS_SHOWN = 6;
/** The part or step an alert is about, without repeating the alert type. */
const detailOf = (a: UnansweredAlert) => {
  const i = a.text.indexOf(': ');
  const rest = i >= 0 ? a.text.slice(i + 2) : a.text;
  return rest === ALERT_TABLE[a.kind].label ? '' : rest;
};

export function ControlRoom({ title = 'اتاق کنترل مدیر خدمات', extra }: { title?: string; extra?: ReactNode }) {
  const [range, setRange] = useState<ControlRange>('today');
  const { data, error, mutate, isValidating } = useSWR<ControlRoomSnapshot>(`/control-room?range=${range}`, fetcher, { refreshInterval: 60_000, keepPreviousData: true });
  const [remind, setRemind] = useState<ReminderDefaults | null>(null);
  const [allAlerts, setAllAlerts] = useState(false);
  const alertRemind = (a: UnansweredAlert): ReminderDefaults => ({
    userIds: a.recipientUserIds,
    caseId: a.caseId ?? undefined,
    plate: a.plate,
    body: `${ALERT_TABLE[a.kind].label}: ${a.text} — ${hours(a.waitingHours)} بی‌پاسخ. لطفاً پیگیری کنید.`.slice(0, 300),
    source: 'manager_report',
  });
  const max = data ? Math.max(1, ...data.funnel.map((x) => x.count)) : 1;
  const alerts = data ? (allAlerts ? data.alerts : data.alerts.slice(0, ALERTS_SHOWN)) : [];

  return (
    <div className="cr" data-testid="control-room" aria-busy={!data && !error}>
      <header className="cr-head">
        <div className="cr-head-text">
          <h1>{title}</h1>
          <p className="cr-sub">نمای کلی عملیات تعمیرات، وضعیت جایگاه‌ها و جریان پرونده‌ها</p>
          <p className="cr-when">
            {formatJalali(new Date())}
            {data ? ` · به‌روز ${formatJalali(data.generatedAt, { time: true }).split(' ').at(-1)}` : ''}
            {isValidating && data ? ' · در حال تازه‌سازی…' : ''}
          </p>
        </div>
        <div className="cr-seg" role="group" aria-label="بازهٔ زمانی">
          {CONTROL_RANGES.map((r) => (
            <button key={r} type="button" className={range === r ? 'on' : ''} aria-pressed={range === r} onClick={() => setRange(r)}>{CONTROL_RANGE_LABELS[r]}</button>
          ))}
          <span className="cr-seg-ico" aria-hidden="true"><AppIcon name="calendar" /></span>
        </div>
      </header>
      {extra}
      {error && (
        <p role="alert" className="cr-glass cr-pad cr-state">
          <AppIcon name="alert" />اتاق کنترل خوانده نشد؛ اتصال یا دسترسی را بررسی کنید.
          <button type="button" className="cr-link" onClick={() => void mutate()}>تلاش دوباره</button>
        </p>
      )}
      {!data && !error && (
        <div className="cr-loading" role="status">
          <span className="sr-only">در حال خواندن وضعیت تعمیرگاه…</span>
          <div className="cr-kpis" aria-hidden="true">{[0, 1, 2, 3].map((k) => <div key={k} className="cr-glass cr-skel" />)}</div>
          <div className="cr-glass cr-skel tall" aria-hidden="true" />
        </div>
      )}
      {data && <>
        <section className="cr-kpis" aria-label="چهار عدد اصلی">
          <div className="cr-glass cr-kpi teal">
            <span className="cr-kpi-head"><AppIcon name="car" /><span className="cr-lbl">خودرو در تعمیرگاه</span></span>
            <b>{faNum(data.kpis.inShop)}</b>
            <small>{faNum(data.kpis.admitted)} پذیرش · {faNum(data.kpis.delivered)} تحویل در {CONTROL_RANGE_LABELS[data.range]}</small>
          </div>
          <div className="cr-glass cr-kpi teal">
            <span className="cr-kpi-head"><AppIcon name="calendar" /><span className="cr-lbl">میانگین ماندگاری</span></span>
            <b>{fa1(data.kpis.avgStayDays)}<em>روز</em></b>
            <small>{data.kpis.deliveredAvgStayDays != null ? `تحویل‌شده‌های ${CONTROL_RANGE_LABELS[data.range]}: ${fa1(data.kpis.deliveredAvgStayDays)} روز` : 'در این بازه تحویلی نبوده'}</small>
          </div>
          <div className="cr-glass cr-kpi warm">
            <span className="cr-kpi-head"><AppIcon name="clock" /><span className="cr-lbl">عقب‌تر از برنامه</span></span>
            <b>{faNum(data.kpis.behind)}</b>
            <small>{faNum(data.kpis.behindOver3)} مورد بیش از ۳ روز</small>
          </div>
          <div className="cr-glass cr-kpi hot">
            <span className="cr-kpi-head"><AppIcon name="alert" /><span className="cr-lbl">هشدار بی‌پاسخ</span></span>
            <b>{faNum(data.kpis.unanswered)}</b>
            <small>{data.kpis.oldestUnansweredHours != null ? `قدیمی‌ترین: ${hours(data.kpis.oldestUnansweredHours)} پیش` : 'همه پاسخ گرفته‌اند'}</small>
          </div>
        </section>

        <div className="cr-main">
          <section className="cr-glass cr-flow" aria-label="جریان پرونده‌ها بر اساس مرحله">
            <div className="cr-title"><h2>جریان پرونده‌ها بر اساس مرحله</h2></div>
            <ol className="cr-funnel">
              {data.funnel.map((s) => (
                <li key={s.key} className={s.bottleneck ? 'neck' : ''} style={{ ['--w' as string]: `${76 + 24 * (s.count / max)}%` }}>
                  <span className="cr-fn">
                    <AppIcon name={STAGE_ICON[s.key]} />
                    <span className="cr-fn-text">
                      <span className="cr-stage">{s.label}</span>
                      <small>{s.count ? `میانگین ${fa1(s.avgDays)} روز` : 'خالی'}{s.bottleneck ? ' · گلوگاه' : ''}</small>
                    </span>
                    <b className="cr-fn-count">{faNum(s.count)}</b>
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <section className="cr-glass cr-map" aria-label="نقشهٔ زندهٔ کارگاه">
            <div className="cr-title"><h2>نقشهٔ زندهٔ کارگاه</h2><span className="cr-lbl">برای دیدن خودروهای هر جایگاه، آن را انتخاب کنید</span></div>
            <WorkshopScene bays={data.bays} />
          </section>
        </div>

        <div className="cr-grid">
          <section className="cr-folder" aria-label="تحلیل امروز">
            <div className="cr-folder-tab"><AppIcon name="chart" /><h2>تحلیل امروز</h2></div>
            <div className="cr-folder-sheet">
              <ul className="cr-analysis">{data.analysis.map((s) => <li key={s}>{s}</li>)}</ul>
              <button type="button" className="cr-btn" onClick={() => setRemind({ role: 'parts_clerk', source: 'manager_report' })}><AppIcon name="send" />ارسال تذکر</button>
            </div>
          </section>

          <section className="cr-folder" aria-label="هشدارهای بی‌پاسخ">
            <div className="cr-folder-tab"><AppIcon name="alert" /><h2>هشدارهای بی‌پاسخ</h2>{data.alerts.length > 0 && <span className="cr-count">{faNum(data.alerts.length)}</span>}</div>
            <div className="cr-folder-sheet">
              {data.alerts.length ? (
                <table className="cr-table">
                  <caption className="sr-only">هشدارهای بی‌پاسخ، قدیمی‌ترین بالا</caption>
                  <thead>
                    <tr><th scope="col">پرونده</th><th scope="col">خودرو</th><th scope="col">نوع هشدار</th><th scope="col">مدت انتظار</th><th scope="col"><span className="sr-only">اقدام</span></th></tr>
                  </thead>
                  <tbody>
                    {alerts.map((a, i) => (
                      <tr key={`${a.kind}:${a.caseId}:${i}`} data-testid="unanswered-alert">
                        <td data-label="پرونده">{a.caseId ? <Link href={`/cases/${a.caseId}`}>{a.caseNumber ? <bdi dir="ltr">{toPersianDigits(a.caseNumber)}</bdi> : 'باز کردن'}</Link> : '—'}</td>
                        <td data-label="خودرو">{a.vehicle ?? '—'}{a.plate && <small><PlateText value={a.plate} /></small>}</td>
                        <td data-label="نوع هشدار">{ALERT_TABLE[a.kind].label}{detailOf(a) && <small>{detailOf(a)}</small>}</td>
                        <td data-label="مدت انتظار"><span className={`cr-wait ${a.waitingHours >= 24 ? 'hot' : 'warm'}`}>{hours(a.waitingHours)}</span></td>
                        <td><button type="button" className="cr-remind" title={`گیرنده: ${a.recipient}`} onClick={() => setRemind(alertRemind(a))} aria-label={`تذکر به ${a.recipient} دربارهٔ ${ALERT_TABLE[a.kind].label}${a.vehicle ? ` — ${a.vehicle}` : ''}`}>تذکر</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="cr-muted cr-ok-line"><AppIcon name="check" />هشدار بی‌پاسخی نیست؛ همه پاسخ گرفته‌اند.</p>
              )}
              {data.alerts.length > ALERTS_SHOWN && (
                <button type="button" className="cr-link" aria-expanded={allAlerts} onClick={() => setAllAlerts((v) => !v)}>
                  {allAlerts ? 'نمایش کمتر' : `نمایش همهٔ ${faNum(data.alerts.length)} هشدار`}
                </button>
              )}
            </div>
          </section>
        </div>

        <section className="cr-folder" aria-label="عملکرد افراد">
          <div className="cr-folder-tab"><AppIcon name="team" /><h2>عملکرد افراد</h2><span className="cr-tab-note">بدون رتبه‌بندی؛ فقط وضعیت</span></div>
          <div className="cr-folder-sheet">
            <ul className="cr-rows">
              {data.people.map((p) => (
                <li key={`${p.role}:${p.userId ?? p.name}`} className="cr-row">
                  <div><strong>{p.name}</strong><small>{p.role === 'station' ? `${ROLE_TEXT.station} · ${p.detail} · ${faNum(p.open)} خودرو` : `${ROLE_TEXT[p.role]} · ${faNum(p.open)} ${p.role === 'parts_clerk' ? 'قلم در جریان' : 'پروندهٔ باز'}`}</small></div>
                  <div className="cr-row-end">
                    {p.avgDays != null && <span className="cr-lbl">میانگین {fa1(p.avgDays)} روز</span>}
                    {p.late > 0 ? <span className="cr-chip warm">{faNum(p.late)} تأخیر</span> : <span className="cr-chip ok">طبق برنامه</span>}
                    {p.unanswered > 0 && <span className="cr-chip hot">{faNum(p.unanswered)} هشدار بی‌پاسخ</span>}
                    {p.userId && <button type="button" className="cr-remind" onClick={() => setRemind({ userIds: [p.userId!], source: 'manager_report' })} aria-label={`تذکر به ${p.name}`}>تذکر</button>}
                  </div>
                </li>
              ))}
              {!data.people.length && <li className="cr-row cr-muted">هنوز کسی ثبت نشده است.</li>}
            </ul>
          </div>
        </section>
      </>}
      <ReminderComposer open={!!remind} onClose={() => setRemind(null)} defaults={remind ?? undefined} onSent={() => void mutate()} />
    </div>
  );
}
