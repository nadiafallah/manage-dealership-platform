'use client';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import useSWR from 'swr';
import { ALERT_TABLE, CONTROL_RANGES, CONTROL_RANGE_LABELS, toPersianDigits, type ControlRange, type ControlRoomSnapshot, type UnansweredAlert } from '@manage/shared';
import { fetcher } from '@/lib/api';
import { faNum, formatJalali } from '@/lib/format';
import { ReminderComposer, type ReminderDefaults } from './ReminderComposer';

// Control room (spec §10, mockup ControlRoom.dc.html): dark, cinematic, display
// and analysis only. The single action anywhere on this page is «تذکر».
const fa1 = (n: number | null | undefined) => (n == null ? '—' : toPersianDigits(String(Math.round(n * 10) / 10).replace('.', '٫')));
const hours = (h: number) => (h >= 48 ? `${faNum(Math.round(h / 24))} روز` : `${faNum(h)} ساعت`);
const ROLE_TEXT = { accident_expert: 'کارشناس تصادفات', parts_clerk: 'مسئول قطعات', station: 'جایگاه' } as const;

export function ControlRoom({ title = 'اتاق کنترل مدیر خدمات', extra }: { title?: string; extra?: ReactNode }) {
  const [range, setRange] = useState<ControlRange>('today');
  const { data, error, mutate } = useSWR<ControlRoomSnapshot>(`/control-room?range=${range}`, fetcher, { refreshInterval: 60_000 });
  const [remind, setRemind] = useState<ReminderDefaults | null>(null);
  const alertRemind = (a: UnansweredAlert): ReminderDefaults => ({
    userIds: a.recipientUserIds,
    caseId: a.caseId ?? undefined,
    plate: a.plate,
    body: `${ALERT_TABLE[a.kind].label}: ${a.text} — ${hours(a.waitingHours)} بی‌پاسخ. لطفاً پیگیری کنید.`.slice(0, 300),
    source: 'manager_report',
  });

  return (
    <div className="cr" data-testid="control-room">
      <header className="cr-head">
        <div>
          <h1>{title}</h1>
          <p className="cr-sub">{formatJalali(new Date())}{data ? ` · به‌روز ${formatJalali(data.generatedAt, { time: true }).split(' ').at(-1)}` : ''}</p>
        </div>
        <div className="cr-seg" role="group" aria-label="بازهٔ زمانی">
          {CONTROL_RANGES.map((r) => (
            <button key={r} type="button" className={range === r ? 'on' : ''} aria-pressed={range === r} onClick={() => setRange(r)}>{CONTROL_RANGE_LABELS[r]}</button>
          ))}
        </div>
      </header>
      {extra}
      {error && <p role="alert" className="cr-glass cr-pad">اتاق کنترل خوانده نشد. <button type="button" className="cr-link" onClick={() => void mutate()}>تلاش دوباره</button></p>}
      {!data && !error && <p className="cr-glass cr-pad" role="status">در حال خواندن وضعیت تعمیرگاه…</p>}
      {data && <>
        <section className="cr-kpis" aria-label="چهار عدد اصلی">
          <div className="cr-glass cr-kpi"><span className="cr-lbl">خودرو در تعمیرگاه</span><b>{faNum(data.kpis.inShop)}</b><small>{faNum(data.kpis.admitted)} پذیرش · {faNum(data.kpis.delivered)} تحویل در {CONTROL_RANGE_LABELS[data.range]}</small></div>
          <div className="cr-glass cr-kpi"><span className="cr-lbl">میانگین ماندگاری</span><b>{fa1(data.kpis.avgStayDays)}<em>روز</em></b><small>{data.kpis.deliveredAvgStayDays != null ? `تحویل‌شده‌های ${CONTROL_RANGE_LABELS[data.range]}: ${fa1(data.kpis.deliveredAvgStayDays)} روز` : 'در این بازه تحویلی نبوده'}</small></div>
          <div className="cr-glass cr-kpi warm"><span className="cr-lbl">عقب‌تر از برنامه</span><b>{faNum(data.kpis.behind)}</b><small>{faNum(data.kpis.behindOver3)} مورد بیش از ۳ روز</small></div>
          <div className="cr-glass cr-kpi hot"><span className="cr-lbl">هشدار بی‌پاسخ</span><b>{faNum(data.kpis.unanswered)}</b><small>{data.kpis.oldestUnansweredHours != null ? `قدیمی‌ترین: ${hours(data.kpis.oldestUnansweredHours)} پیش` : 'همه پاسخ گرفته‌اند'}</small></div>
        </section>

        <section className="cr-glass cr-pad" aria-label="مسیر خودروها">
          <div className="cr-title"><h2>مسیر خودروها، از پذیرش تا تحویل</h2><span className="cr-lbl">تعداد خودرو · میانگین روز در هر مرحله</span></div>
          <ol className="cr-funnel">
            {data.funnel.map((s) => {
              const max = Math.max(1, ...data.funnel.map((x) => x.count));
              return (
                <li key={s.key} className={s.bottleneck ? 'neck' : ''}>
                  <span className="cr-stage">{s.label}{s.bottleneck ? ' — گلوگاه' : ''}</span>
                  <span className="cr-bar" aria-hidden="true"><i style={{ inlineSize: `${(s.count / max) * 100}%` }} /></span>
                  <span className="cr-num"><b>{faNum(s.count)}</b> · {fa1(s.avgDays)} روز</span>
                </li>
              );
            })}
          </ol>
        </section>

        <div className="cr-grid">
          <section className="cr-glass cr-pad" aria-label="نقشهٔ زندهٔ کارگاه">
            <div className="cr-title"><h2>نقشهٔ زندهٔ کارگاه</h2>
              <span className="cr-legend"><i className="dot ok" />طبق برنامه<i className="dot late" />عقب‌تر<i className="dot stop" />متوقف</span>
            </div>
            <div className="iso-wrap">
              <div className="iso" style={{ gridTemplateColumns: `repeat(${Math.min(4, Math.max(2, Math.ceil(Math.sqrt(data.bays.length))))}, minmax(0, 1fr))` }}>
                {data.bays.map((b) => (
                  <div key={b.key} className={`bay ${b.tone}`}>
                    <b>{b.label}</b>
                    {b.cars.map((c) => (
                      <Link key={c.caseId} href={`/cases/${c.caseId}`} className={`car ${c.state}`} aria-label={`${c.vehicle}${c.plate ? ` ${toPersianDigits(c.plate)}` : ''} · ${b.label} · ${c.state === 'ok' ? 'طبق برنامه' : c.state === 'late' ? 'عقب‌تر' : 'متوقف'}`} title={`${c.vehicle} · ${c.step}`} />
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <ul className="cr-baylist">
              {data.bays.filter((b) => b.cars.length).map((b) => (
                <li key={b.key}><span>{b.label}</span>{b.cars.map((c) => <Link key={c.caseId} href={`/cases/${c.caseId}`} className={`cr-car-chip ${c.state}`}>{c.vehicle}</Link>)}</li>
              ))}
            </ul>
          </section>

          <section className="cr-glass cr-pad" aria-label="تحلیل امروز">
            <div className="cr-title"><h2>تحلیل امروز</h2></div>
            <ul className="cr-analysis">{data.analysis.map((s) => <li key={s}>{s}</li>)}</ul>
            <button type="button" className="cr-link" onClick={() => setRemind({ role: 'parts_clerk', source: 'manager_report' })}>ارسال تذکر ←</button>
          </section>
        </div>

        <div className="cr-grid">
          <section className="cr-glass cr-pad" aria-label="عملکرد افراد">
            <div className="cr-title"><h2>عملکرد افراد</h2><span className="cr-lbl">بدون رتبه‌بندی؛ فقط وضعیت</span></div>
            <ul className="cr-rows">
              {data.people.map((p) => (
                <li key={`${p.role}:${p.userId ?? p.name}`} className="cr-row">
                  <div><strong>{p.name}</strong><small>{p.role === 'station' ? `${ROLE_TEXT.station} · ${p.detail} · ${faNum(p.open)} خودرو` : `${ROLE_TEXT[p.role]} · ${faNum(p.open)} ${p.role === 'parts_clerk' ? 'قلم در جریان' : 'پروندهٔ باز'}`}</small></div>
                  <div className="cr-row-end">
                    {p.avgDays != null && <span className="cr-lbl">میانگین {fa1(p.avgDays)} روز</span>}
                    {p.late > 0 ? <span className="cr-chip warm">{faNum(p.late)} تأخیر</span> : <span className="cr-chip ok">طبق برنامه</span>}
                    {p.unanswered > 0 && <span className="cr-chip hot">{faNum(p.unanswered)} هشدار بی‌پاسخ</span>}
                    {p.userId && <button type="button" className="cr-link" onClick={() => setRemind({ userIds: [p.userId!], source: 'manager_report' })} aria-label={`تذکر به ${p.name}`}>تذکر</button>}
                  </div>
                </li>
              ))}
              {!data.people.length && <li className="cr-row">هنوز کسی ثبت نشده است.</li>}
            </ul>
          </section>

          <section className="cr-glass cr-pad" aria-label="هشدارهای بی‌پاسخ">
            <div className="cr-title"><h2>هشدارهای بی‌پاسخ</h2><span className="cr-lbl">قدیمی‌ترین بالا</span></div>
            <ul className="cr-rows">
              {data.alerts.map((a, i) => (
                <li key={`${a.kind}:${a.caseId}:${i}`} className="cr-row" data-testid="unanswered-alert">
                  <div>
                    <strong>{a.vehicle ? `${a.vehicle} — ` : ''}{a.text}</strong>
                    <small>{ALERT_TABLE[a.kind].label} · گیرنده: {a.recipient} · پاسخ: {ALERT_TABLE[a.kind].answer}</small>
                  </div>
                  <div className="cr-row-end">
                    <span className={`cr-chip ${a.waitingHours >= 24 ? 'hot' : 'warm'}`}>{hours(a.waitingHours)}</span>
                    {a.caseId && <Link className="cr-link" href={`/cases/${a.caseId}`}>پرونده</Link>}
                    <button type="button" className="cr-link" onClick={() => setRemind(alertRemind(a))}>تذکر</button>
                  </div>
                </li>
              ))}
              {!data.alerts.length && <li className="cr-row">هشدار بی‌پاسخی نیست.</li>}
            </ul>
          </section>
        </div>
      </>}
      <ReminderComposer open={!!remind} onClose={() => setRemind(null)} defaults={remind ?? undefined} onSent={() => void mutate()} />
    </div>
  );
}
