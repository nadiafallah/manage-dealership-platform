'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { TASK_STATUS_LABELS, TECHNICIAN_PROBLEMS, TECHNICIAN_PROBLEM_LABELS, type MyWorkMonth, type TechnicianProblem, type WorkshopTask } from '@manage/shared';
import { useAuth } from '@/lib/auth';
import { api, errorMessage, fetcher } from '@/lib/api';
import { formatJalali, rial, toPersianDigits } from '@/lib/format';
import { Plate } from '@/components/Plate';
import { Dialog } from '@/components/Dialog';
import { ReminderCards } from '@/components/ReminderCards';

const DAY = 86_400_000;
const tehranDay = (ms: number) => Math.floor((ms + 210 * 60_000) / DAY);

/** "۲ روز وقت دارید" / "امروز آخرین روز" / "موعد گذشته" from the planned end of the job. */
function timeLeft(end: string | null | undefined): { text: string; tone: string } | null {
  if (!end) return null;
  const days = tehranDay(Date.parse(end)) - tehranDay(Date.now());
  if (Date.parse(end) < Date.now()) return { text: 'موعد گذشته', tone: 'chip-red' };
  if (days <= 0) return { text: 'امروز آخرین روز', tone: 'chip-amber' };
  return { text: `${toPersianDigits(days)} روز وقت دارید`, tone: 'chip-green' };
}

export default function TechnicianPage(){
  const {me,can}=useAuth();
  const {data,error,mutate}=useSWR<WorkshopTask[]>(can('task.execute')?'/workshop/my-tasks':null,fetcher,{refreshInterval:30000});
  const {data:month}=useSWR<MyWorkMonth>(can('task.execute')?'/workshop/my-work':null,fetcher,{refreshInterval:120000});
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[failure,setFailure]=useState('');
  const [problemFor,setProblemFor]=useState<WorkshopTask|null>(null);
  const confirmed=useRef(new Set<string>());
  // The first time an amount is shown it counts as seen; a later change shows "تغییر کرد" until confirmed.
  useEffect(()=>{for(const t of data??[]){const w=t.wage;if(w&&!w.seen&&!confirmed.current.has(`${t.id}:${w.version}`)){confirmed.current.add(`${t.id}:${w.version}`);void api(`/workshop/my-tasks/${t.id}/wage-seen`,{body:{expectedVersion:w.version}}).catch(()=>{});}}},[data]);
  async function act(t:WorkshopTask){if(busy)return;setBusy(true);setFailure('');setMessage('');try{await api(`/workshop/my-tasks/${t.id}/actions`,{body:{action:t.status==='pending'?'start':'complete',expectedVersion:t.version}});setMessage(t.status==='pending'?'شروع کار ثبت شد.':'پایان کار ثبت شد؛ منتظر تأیید کارشناس تصادفات.');}catch(e){setFailure(errorMessage(e));}finally{await mutate();setBusy(false);}}
  async function pickup(taskId: string, partId: string, expectedVersion: number) {
    if (busy) return;
    setBusy(true);setFailure('');setMessage('');
    try {
      await api(`/tasks/${taskId}/part-pickup`, { body: { partId, expectedVersion } });
      setMessage('دریافت قطعه ثبت شد.');
    } catch (e) { setFailure(errorMessage(e)); }
    finally { await mutate(); setBusy(false); }
  }
  async function wageSeen(t:WorkshopTask){if(!t.wage||busy)return;setBusy(true);setFailure('');try{await api(`/workshop/my-tasks/${t.id}/wage-seen`,{body:{expectedVersion:t.wage.version}});}catch(e){setFailure(errorMessage(e));}finally{await mutate();setBusy(false);}}
  async function report(problem:TechnicianProblem){if(!problemFor||busy)return;setBusy(true);setFailure('');setMessage('');try{await api(`/workshop/my-tasks/${problemFor.id}/problem`,{body:{problem}});setMessage(`«${TECHNICIAN_PROBLEM_LABELS[problem]}» برای کارشناس تصادفات این خودرو فرستاده شد.`);setProblemFor(null);}catch(e){setFailure(errorMessage(e));}finally{setBusy(false);}}
  if(!can('task.execute'))return <p className="callout">کارتابل تعمیرکار برای شما فعال نیست.</p>;
  const open=(data??[]).filter(t=>t.status!=='approved');
  const first=open.find(t=>t.status!=='done');
  return <div className="technician-page">
    <header className="technician-head">
      <p className="technician-kicker"><span>{first?.stationCode||first?.departmentName||'کارتابل تعمیرکار'}</span><span>{formatJalali(new Date())}</span></p>
      <h1>کارهای من</h1>
      <p>سلام {me.displayName}{data?(open.length?` · ${toPersianDigits(open.length)} خودرو برای شما · اول این یکی`:' · کار بازی ندارید'):''}</p>
    </header>
    <ReminderCards compact/>
    {message&&<p role="status" className="callout">{message}</p>}{failure&&<p role="alert" className="callout callout-red">{failure}</p>}
    {error&&<p role="alert">کارها دریافت نشد. <button className="btn" onClick={()=>void mutate()}>تلاش دوباره</button></p>}
    {!data&&!error&&<p>در حال دریافت کارها…</p>}
    {open.map(t=>{const left=t.status==='done'?null:timeLeft(t.plannedEndAt);const waiting=t.status==='pending'&&!t.canStart;return <article key={t.id} className={`technician-job${t.id===first?.id?' current':''}${waiting?' waiting':''}`}>
      <div className="row technician-job-top"><Plate value={t.plate??''} large/>{left&&<span className={`chip ${left.tone}`}>{left.text}</span>}</div>
      <div className="row"><span className="chip">{t.stationCode||t.departmentName}</span><span>{TASK_STATUS_LABELS[t.status as keyof typeof TASK_STATUS_LABELS]}</span></div>
      <h2>{t.vehicleLabel}</h2>
      <p>{t.title||t.departmentName}</p>
      <p className="muted small">پرونده <bdi>{toPersianDigits(t.caseNumber)}</bdi> · موعد: {formatJalali(t.plannedEndAt,{time:true})}</p>
      {t.status!=='done'&&t.partsReady&&t.partsReady.count>0&&<p role="status" className="technician-parts"><span>قطعه آماده است؛ از انبار بگیرید.</span><span className="small">{t.partsReady.names.join('، ')}{t.partsReady.count>t.partsReady.names.length?' و …':''}</span></p>}
      {t.status!=='done'&&t.partsReady?.pickup?.map(p=><button key={p.id} className="btn" disabled={busy} onClick={()=>void pickup(t.id,p.id,p.version)}>گرفتم · {p.description}</button>)}
      {t.status!=='done'&&!!t.partsWaiting&&<p className="muted small" style={{margin:0}}>{toPersianDigits(String(t.partsWaiting))} قطعهٔ دیگر هنوز نرسیده است.</p>}
      {t.wage&&<div className="technician-wage"><span className="muted">اجرت شما</span><strong>{rial(t.wage.amountRial)}</strong>{t.wage.changed&&<><span className="chip chip-amber">تغییر کرد</span><span className="xs muted">قبلاً {rial(t.wage.previousRial??0)}</span><button type="button" className="btn btn-sm" disabled={busy} onClick={()=>void wageSeen(t)}>دیدم</button></>}</div>}
      {['pending','in_progress'].includes(t.status)?<button className={`btn technician-action ${t.status==='pending'?'btn-primary':'technician-finish'}`} disabled={busy||(t.status==='pending'&&!t.canStart)} onClick={()=>void act(t)}>{busy?'در حال ثبت…':t.status==='pending'?'شروع کار':'پایان کار'}</button>:<p className="callout">{t.status==='done'?'پایان ثبت شده؛ منتظر تأیید کارشناس تصادفات.':'کار متوقف است؛ با کارشناس تصادفات هماهنگ کنید.'}</p>}
      {waiting&&<p>منتظر تأیید تحویل کار قبلی توسط کارشناس تصادفات.</p>}
      {t.status!=='done'&&<button type="button" className="btn technician-problem" disabled={busy} onClick={()=>setProblemFor(t)} aria-label={`مشکل دارم؛ ${t.title||t.departmentName}`}>مشکل دارم</button>}
    </article>;})}
    {data&&!open.length&&<div className="technician-job"><h2>کار بازی ندارید</h2><p>وقتی کاری به شما ارجاع شود، همین‌جا نمایش داده می‌شود.</p></div>}
    <nav className="technician-bar no-print" aria-label="کارکرد و تذکرها">
      <Link className="technician-bar-month" href="/workshop/technician/work"><span className="xs">کارکرد این ماه</span><strong>{month?rial(month.totalRial):'—'}</strong></Link>
      <Link className="technician-bar-link" href="/reminders">تذکرهای من</Link>
    </nav>
    <Dialog open={!!problemFor} title="مشکل دارم" onClose={()=>!busy&&setProblemFor(null)} footer={<button type="button" className="btn" disabled={busy} onClick={()=>setProblemFor(null)}>انصراف</button>}>
      <p className="small">پیام برای کارشناس تصادفات همین خودرو فرستاده می‌شود{problemFor?.plate?<> (پلاک <bdi>{toPersianDigits(problemFor.plate)}</bdi>)</>:''}.</p>
      <div className="technician-problems">{TECHNICIAN_PROBLEMS.map(p=><button key={p} type="button" className="btn" disabled={busy} onClick={()=>void report(p)}>{TECHNICIAN_PROBLEM_LABELS[p]}</button>)}</div>
    </Dialog>
  </div>;
}
