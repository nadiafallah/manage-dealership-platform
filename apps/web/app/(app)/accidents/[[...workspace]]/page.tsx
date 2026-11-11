'use client';
import Link from 'next/link';
import {useParams} from 'next/navigation';
import {useState,type FormEvent} from 'react';
import useSWR from 'swr';
import type {CaseListItem,Paged} from '@manage/shared';
import {STAGE_LABELS} from '@manage/shared';
import {WORKSPACES,workspaceVisible} from '@/lib/workspaces';
import {useAuth} from '@/lib/auth';
import {fetcher} from '@/lib/api';
import {faNum,toPersianDigits} from '@/lib/format';
import {AppIcon} from '@/components/AppIcon';
import {WorkspaceLauncher} from '@/components/WorkspaceLauncher';
import {DailyStatusPanel} from '@/components/DailyStatusPanel';
import {WorkspaceActions} from '@/components/WorkspaceActions';
import {PartsWorkbench} from '@/components/PartsWorkbench';
import {PartsOperationNotices} from '@/components/PartsOperations';
import {AlertsPanel} from '@/components/AlertsPanel';
import {ReminderCards} from '@/components/ReminderCards';
import {DeskBoard} from '@/components/DeskBoard';
import {ControlRoom} from '@/components/ControlRoom';
import type {DeskFolder} from '@manage/shared';

const hasParts=(f:DeskFolder)=>f.parts.undecided+f.parts.inProgress+f.parts.ready>0;
const partCounts=(f:DeskFolder)=><span className="folder-counts">{f.parts.undecided>0&&<span className="cnt cnt-warn">{faNum(f.parts.undecided)} تعیین تکلیف نشده</span>}{f.parts.inProgress>0&&<span className="cnt">{faNum(f.parts.inProgress)} در جریان</span>}{f.parts.ready>0&&<span className="cnt cnt-ok">{faNum(f.parts.ready)} آمادهٔ تحویل</span>}{f.parts.emdadLate>0&&<span className="cnt cnt-stop">{faNum(f.parts.emdadLate)} امداد دیرشده</span>}</span>;
export default function AccidentWorkspace(){
 const {workspace}=useParams<{workspace?:string[]}>(),key=workspace?.[0]==='supervisor'?'expert':workspace?.[0];const {me,can}=useAuth();const w=WORKSPACES.find(x=>x.key===key),allowed=!!w&&workspaceVisible(w,me);
 const [term,setTerm]=useState(''),[query,setQuery]=useState(''),[page,setPage]=useState(1);
 const params=new URLSearchParams(w?.queue.replace('responsibleUserId=me',`responsibleUserId=${me.id}`)||'');if(query)params.set('q',query);params.set('page',String(page));params.set('pageSize','25');
 const {data,error,isLoading}=useSWR<Paged<CaseListItem>>(allowed&&can('case.read')?`/cases?${params}`:null,fetcher);
 function search(e:FormEvent){e.preventDefault();setQuery(term.trim());setPage(1);}
 if(!key)return <div className="stack"><header className="unit-header"><span className="workspace-symbol"><AppIcon name="car"/></span><div><h1>واحد تصادفات</h1><p>میز کار خود را انتخاب کنید؛ هر میز، کارها و میان‌برهای مرتبط را یک‌جا نشان می‌دهد.</p></div></header><WorkspaceLauncher/></div>;
 if(!w||!allowed||workspace!.length!==1)return <div className="callout"><h1>این میز کار برای شما فعال نیست</h1><p>مالک می‌تواند دسترسی‌های شما را از بخش کارکنان تنظیم کند.</p><Link href="/accidents">بازگشت به واحد تصادفات</Link></div>;
 const legacy = <div className="stack">
 {['manager','owner'].includes(w.key)&&<ReminderCards/>}
 {['parts','manager','owner'].includes(w.key)&&<DailyStatusPanel/>}
 {w.key==='expert'&&<>{data && <details className="panel compact-disclosure"><summary><AppIcon name="sparkles" /> دستیار منیج · اولویت پرونده‌های فعلی</summary><div className="panel-body stack">
 <p className="small muted">بررسی صف همین صفحه؛ پیشنهادها بدون تغییر خودکار پرونده و بر اساس اطلاعات ثبت‌شده‌اند.</p>
 {data.items.filter(c => c.openBlockers > 0 || c.missingFields.length > 0 || (c.officialDeadlineAt && Date.parse(c.officialDeadlineAt) < Date.now()) || !c.responsible).slice(0,7).map(c => <div className="row" key={c.id} style={{justifyContent:'space-between',flexWrap:'wrap'}}>
 <div className="small"><strong>{c.vehicleSummary || c.vehicleLabel} · {toPersianDigits(c.caseNumber)}</strong><div className="muted">{c.openBlockers > 0 ? `${faNum(c.openBlockers)} مانع باز · ` : ''}{!c.responsible ? 'مسئول پرونده تعیین نشده · ' : ''}{c.missingFields.length ? 'اطلاعات پذیرش ناقص · ' : ''}{c.officialDeadlineAt && Date.parse(c.officialDeadlineAt) < Date.now() ? 'مهلت رسمی گذشته' : ''}</div></div>
 <Link className="btn btn-sm" href={`/cases/${c.id}`}>بررسی و اقدام</Link></div>)}
 {!data.items.some(c => c.openBlockers > 0 || c.missingFields.length > 0 || (c.officialDeadlineAt && Date.parse(c.officialDeadlineAt) < Date.now()) || !c.responsible) && <p className="small muted">در پرونده‌های این صفحه هشدار اولویت‌دار مشخصی ثبت نشده است.</p>}
 </div></details>}</>}
 <WorkspaceActions workspace={w}/>
 {w.key==='owner'&&<details className="compact-disclosure panel"><summary>ورود به میزهای کار واحد</summary><div className="panel-body"><WorkspaceLauncher compact/></div></details>}
 {can('case.read')&&<section className="panel"><div className="panel-head"><div><h2>{w.queueLabel}</h2><p className="muted small">{data?`${faNum(data.total)} پرونده منطبق با این صف`:' '}؛ برای اقدام، پرونده را باز کنید.</p></div></div><div className="panel-body"><form onSubmit={search} className="workspace-search"><label className="field">جست‌وجو در همین صف<input className="input" value={term} maxLength={100} onChange={e=>setTerm(e.target.value)} placeholder="شماره منیج، پذیرش، پلاک یا شاسی"/></label><button type="submit" className="btn">جست‌وجو</button></form>{error&&<p role="alert">دریافت صف ناموفق بود؛ صفحه را تازه کنید.</p>}{isLoading&&<p role="status">در حال دریافت پرونده‌ها…</p>}{data&&<><div className="table-scroll"><table className="table"><thead><tr><th>پرونده و پذیرش</th><th>خودرو و مالک</th><th>مرحله</th></tr></thead><tbody>{data.items.map(c=><tr key={c.id}><td><Link href={`/cases/${c.id}${w.key==='finance'?'#case-finance':w.key==='parts'?'#case-parts':w.key==='quality'?'#case-quality':''}`}>{toPersianDigits(c.caseNumber)}</Link>{c.admissionNo?<div className="small">پذیرش: {toPersianDigits(c.admissionNo)}</div>:<div className="small muted">بدون شماره پذیرش</div>}</td><td>{c.vehicleSummary ?? c.vehicleLabel}<div className="small muted">{c.customerName||'نام ثبت نشده'}</div></td><td>{STAGE_LABELS[c.stage]}</td></tr>)}</tbody></table></div>{!data.total&&<p className="callout">در این صف پرونده‌ای وجود ندارد. این نتیجه فقط مربوط به فیلتر همین میز است؛ <Link href="/cases">همه پرونده‌ها</Link> را هم می‌توانید بررسی کنید.</p>}<div className="row"><button className="btn" disabled={page===1} onClick={()=>setPage(p=>p-1)}>صفحه قبل</button><span>صفحه {faNum(page)} از {faNum(Math.max(1,Math.ceil(data.total/25)))}</span><button className="btn" disabled={page*25>=data.total} onClick={()=>setPage(p=>p+1)}>صفحه بعد</button></div></>}</div></section>}
 </div>;
 const tools=(label='ابزارها و صف‌های دیگر')=><details className="panel compact-disclosure desk-more"><summary>{label}</summary><div className="panel-body">{legacy}</div></details>;
 if (w.key === 'expert') return <div className="stack"><ReminderCards/><DeskBoard title="میز کار کارشناس تصادفات" actors={['accident_expert']} mineOnly intro={can('case.create')?<Link className="m-btn" href="/cases/new">پذیرش جدید</Link>:undefined}/><AlertsPanel/><PartsOperationNotices/>{tools()}</div>;
 if (w.key === 'parts') return <div className="stack"><ReminderCards/><DeskBoard title="میز کار مسئول قطعات" actors={['parts_clerk']} initial="mine" filters={['mine','parts','all']} scope={hasParts} extra={partCounts}/><PartsWorkbench/>{tools('همهٔ صف‌ها')}</div>;
 if (w.key === 'admin') return <div className="stack"><ReminderCards/><DailyStatusPanel/><DeskBoard title="میز کار مدیر سیستم" actors={['accident_expert','parts_clerk']} initial="stuck" filters={['stuck','all','mine','behind','parts','delivery']}/>{tools('همهٔ ابزارهای پشتیبانی')}</div>;
 if (w.key === 'manager') return <div className="stack"><ControlRoom/>{tools('گزارش‌ها و ابزارهای دیگر')}</div>;
 if (w.key === 'owner') return <div className="stack"><ControlRoom title="اتاق کنترل" extra={<nav className="cr-glass cr-pad owner-tools" aria-label="تنظیمات و کارکنان"><strong>تنظیمات و کارکنان</strong><div className="row"><Link className="cr-link" href="/users">کارکنان و دعوت</Link><Link className="cr-link" href="/users#access-control">دسترسی‌ها</Link><Link className="cr-link" href="/users#owner-admin">اجازه‌های مدیر سیستم</Link><Link className="cr-link" href="/workshop/settings">سقف هشدارها، تقویم و جایگاه‌ها</Link><Link className="cr-link" href="/accidents">میزهای کار</Link></div></nav>}/>{tools('همهٔ ابزارها')}</div>;
 return <div className="stack"><div className="unit-breadcrumb"><Link href="/accidents">واحد تصادفات</Link><span aria-hidden="true"> / </span><span>{w.label}</span></div><header className="unit-header"><span className="workspace-symbol"><AppIcon name={w.icon}/></span><div><h1>میز کار {w.label}</h1><p className="muted">{w.description}</p></div></header>{legacy}</div>;
}
