'use client';
import Link from 'next/link';
import {usePathname,useRouter} from 'next/navigation';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {MODULE_LABELS,ROLE_LABELS,type ModuleKey,type ReceivedReminder} from '@manage/shared';
import useSWR from 'swr';
import {fetcher} from '@/lib/api';
import {api} from '@/lib/api';
import {useAuth} from '@/lib/auth';
import {visibleWorkspaces,workspaceHome} from '@/lib/workspaces';
import {BackLink} from './BackLink';
import {AppIcon,type IconName} from './AppIcon';
import {NotificationBar} from './NotificationBar';
import {PageActions} from './PageActions';
import {InstallButton} from './InstallApp';
export function Shell({children}:{children:ReactNode}){
 const {me,can}=useAuth(),pathname=usePathname(),router=useRouter();const [open,setOpen]=useState(false),[mobile,setMobile]=useState(false);const menu=useRef<HTMLButtonElement>(null);
 useEffect(()=>{const media=window.matchMedia('(max-width: 860px)');const sync=()=>setMobile(media.matches);sync();media.addEventListener('change',sync);return ()=>media.removeEventListener('change',sync);},[]);
 useEffect(()=>{if(!open||!mobile)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);menu.current?.focus();}};document.addEventListener('keydown',key);return ()=>document.removeEventListener('keydown',key);},[open,mobile]);
 useEffect(()=>{document.title=`${pageTitle(pathname)} | Manage by HEDAX`;},[pathname]);
 const technicianOnly=me.roles.length===1&&me.roles[0]==='technician';
 const {data:inbox}=useSWR<ReceivedReminder[]>('/reminders/inbox',fetcher,{refreshInterval:60_000});
 const unseen=inbox?.filter(r=>r.status==='sent').length??0;
 const accident=pathname.startsWith('/workshop')||pathname.startsWith('/cases')||pathname.startsWith('/reports')||pathname.startsWith('/accidents')||['/daily-reports','/stock','/emdad'].includes(pathname);
 function nav(href:string,label:string,icon:IconName,show=true){if(!show)return null;const active=href==='/'?pathname==='/':href.includes('#')?false:pathname===href||(href==='/cases'&&/^\/cases\/(?!new|import)/.test(pathname));return href.includes('#')&&href.split('#')[0]===pathname?<a key={href} href={'#'+href.split('#')[1]}><AppIcon name={icon}/><span>{label}</span></a>:<Link key={href} href={href} aria-current={active?'page':undefined}><AppIcon name={icon}/><span>{label}</span></Link>;}
 async function logout(){await api('/auth/logout',{method:'POST'}).catch(()=>{});router.replace('/login');}
 return <div className="shell"><a className="skip-link" href="#page-content">رفتن به محتوای صفحه</a>{open&&mobile&&<button type="button" className="nav-scrim" aria-label="بستن منو" onClick={()=>{setOpen(false);menu.current?.focus();}}/>}
 <aside className={`sidebar${open?' open':''}`} aria-label="منوی اصلی" inert={mobile&&!open}>
 <div className="brand"><Link href="/launch" className="brand-lockup" aria-label="Manage by HEDAX، انتخاب میز کار"><img src="/brand/manage-wordmark-light.svg" alt="" width={124} height={31}/><span className="brand-by" aria-hidden="true">by HEDAX</span></Link><div className="tenant">{me.tenant.name}</div></div>{!technicianOnly&&can('case.read')&&<GlobalSearch onDone={()=>setOpen(false)}/>}
 <nav className="nav" id="main-navigation" aria-label="واحدها و میزهای کار" onClick={e=>{if((e.target as HTMLElement).closest('a'))setOpen(false);}}>
 {nav('/launch','انتخاب میز کار','grid')}{technicianOnly?nav('/workshop/technician','کارهای من','wrench'):null}
 <Link href="/reminders" className="nav-reminders" aria-current={pathname==='/reminders'?'page':undefined}><AppIcon name="bell"/><span>تذکرها</span>{unseen>0&&<span className="nav-badge" aria-label={`${unseen} تذکر دیده‌نشده`}>{unseen.toLocaleString('fa-IR')}</span>}</Link>
 {!technicianOnly&&<>{nav('/','داشبورد','gauge',can('dashboard.read'))}
 <details className="nav-unit" key={`accident-${accident}`} open={accident||pathname==='/'}><summary><AppIcon name="car"/><span>واحد تصادفات</span></summary><div className="nav-sub">
 <p className="nav-caption">میزهای کار و پرونده‌ها</p>
 {nav(visibleWorkspaces(me).length===1?`/accidents/${visibleWorkspaces(me)[0].key}`:'/accidents',visibleWorkspaces(me).length===1?'میز کار من':'میزهای کار تصادفات','desk')}
 {nav('/cases','پرونده‌های تصادفی','file',can('case.read'))}{nav('/cases/new','ثبت پرونده','add',can('case.create'))}
 <p className="nav-caption">کارگاه و قطعات</p>
 {nav('/workshop','برنامه و گزارش تعمیر','wrench',can('workshop.read'))}
 {nav('/stock','موجودی و رزرو قطعات','box',can('stock.read'))}{nav('/emdad','پیگیری امداد ویژه','truck',can('emdad.read'))}
 <p className="nav-caption">گزارش‌ها و تنظیمات کارگاه</p>
 {nav('/reports','گزارش‌های مدیریتی','chart',can('report.manager')||can('part.manage')||can('case.update')||can('task.manage')||can('qc.inspect'))}
 {nav('/daily-reports','ورود گزارش‌های روزانه','upload',can('daily_reports.upload')||can('daily_reports.apply')||can('daily_reports.settings'))}
 {nav('/workshop/settings','تقویم و جایگاه‌ها','calendar',can('calendar.manage')||can('workshop.manage'))}

 </div></details>
 {(can('user.manage')||can('reference.parts.read')||can('reference.customers.read')||me.isOwner)&&<details className="nav-unit" open={pathname==='/users'||pathname==='/reference-data'}><summary><AppIcon name="settings"/><span>مدیریت و اطلاعات پایه</span></summary><div className="nav-sub">{nav('/users','کارکنان','team',can('user.manage'))}{nav('/users#access-control','مدیریت دسترسی‌ها','shield',!!me.isOwner)}{nav('/reference-data','اطلاعات پایه','database',can('reference.parts.read')||can('reference.customers.read'))}</div></details>}
 {me.modules.some(m=>m.status==='planned')&&<details className="nav-unit planned-units"><summary><AppIcon name="box"/><span>سایر واحدها</span></summary><p className="nav-caption">واحدهای زیر هنوز در دست توسعه‌اند</p><div className="nav-sub">{me.modules.filter(m=>m.status==='planned').map(m=><Link key={m.key} href={`/modules/${m.key}`} className="planned" aria-current={pathname===`/modules/${m.key}`?'page':undefined}><span>{MODULE_LABELS[m.key]}</span><span className="tag-dev">در دست توسعه</span></Link>)}</div></details>}
 </>}
 </nav><div className="account"><div className="account-head"><span className="avatar" aria-hidden="true">{initials(me.displayName)}</span><div><div className="name">{me.displayName}</div><div className="xs">{me.isOwner?'مالک سامانه':me.roles.map(r=>ROLE_LABELS[r]).join('، ')}</div></div></div><InstallButton/><button type="button" className="btn btn-sm" onClick={logout}>خروج</button></div></aside>
 <div className="main"><div className="topbar"><span className="brand-lockup brand-lockup-sm" role="img" aria-label="Manage by HEDAX"><img src="/brand/manage-wordmark-light.svg" alt="" width={96} height={24}/><span className="brand-by" aria-hidden="true">by HEDAX</span></span><button ref={menu} type="button" className="btn btn-sm" aria-controls="main-navigation" aria-expanded={open} onClick={()=>setOpen(!open)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d={open?'M6 6l12 12M18 6 6 18':'M4 7h16M4 12h16M4 17h16'}/></svg><span>منو</span></button></div>{me.environment!=='production'&&<div className="env-banner" role="note">نسخه آزمایشی — داده‌های این محیط ساختگی‌اند و جای سامانه‌های رسمی را نمی‌گیرند.</div>}
 <main className="page" id="page-content" tabIndex={-1}><NotificationBar/>{(()=>{const b=backTarget(pathname,workspaceHome(me));return b?<BackLink href={b.href} label={b.label}/>:null;})()}<PageActions/>{children}</main></div></div>;
}

/** Every page has a way back (spec §12): to the case for its edit page, otherwise to the own desk. Pages with their own back link and the desks themselves get none. */
export function backTarget(pathname:string,home:string):{href:string;label:string}|null{
 if(pathname===home||pathname==='/launch')return null;
 if(['/reminders','/reports/people','/workshop/technician/work'].includes(pathname))return null;
 if(/^\/cases\/(?!new$|import$)[^/]+$/.test(pathname))return null;
 const edit=/^\/cases\/([^/]+)\/edit$/.exec(pathname);
 if(edit)return {href:`/cases/${edit[1]}`,label:'بازگشت به پرونده'};
 return {href:home,label:'بازگشت به میز کار'};
}

const PAGE_TITLES:[RegExp,string][]=[[/^\/launch$/,'انتخاب میز کار'],[/^\/$/,'داشبورد'],[/^\/workshop\/settings/,'تقویم و جایگاه‌ها'],[/^\/workshop\/technician/,'کارهای من'],[/^\/workshop/,'برنامه و گزارش تعمیر'],[/^\/accidents/,'میز کار تصادفات'],[/^\/cases\/new/,'ثبت پرونده'],[/^\/cases\/import/,'ورود خودروها از اکسل'],[/^\/cases\/[^/]+/,'پرونده'],[/^\/cases/,'پرونده‌های تصادفی'],[/^\/reports/,'گزارش‌ها'],[/^\/daily-reports/,'گزارش‌های روزانه'],[/^\/stock/,'موجودی روزانه و رزرو'],[/^\/emdad/,'پیگیری امداد ویژه'],[/^\/users/,'کارکنان'],[/^\/reference-data/,'اطلاعات پایه'],[/^\/reminders/,'تذکرها']];
/** Browser tab title for each area, so several open tabs can be told apart. */
export function pageTitle(pathname:string):string{
 const module=/^\/modules\/([^/]+)/.exec(pathname)?.[1];
 if(module)return MODULE_LABELS[module as ModuleKey]??'واحدها';
 return PAGE_TITLES.find(([re])=>re.test(pathname))?.[1]??'Manage';
}

/** First letters of the first two words of a display name, for the avatar. */
export function initials(name:string):string{
 return name.trim().split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('\u200c')||'؟';
}

/** Search from any page: plate, chassis, admission or case number, owner. Opens the filtered case list. Ctrl+K (or "/") focuses it. */
function GlobalSearch({onDone}:{onDone:()=>void}){
 const router=useRouter();const [q,setQ]=useState('');const input=useRef<HTMLInputElement>(null);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{const t=e.target as HTMLElement;if(((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k')||(e.key==='/'&&!e.ctrlKey&&!e.metaKey&&!(t.closest('input,textarea,select,[contenteditable="true"]')))){e.preventDefault();input.current?.focus();}};document.addEventListener('keydown',key);return ()=>document.removeEventListener('keydown',key);},[]);
 return <form role="search" className="global-search" onSubmit={e=>{e.preventDefault();const v=q.trim();if(!v)return;router.push(`/cases?q=${encodeURIComponent(v)}`);setQ('');onDone();}}><label className="sr-only" htmlFor="global-search">جست‌وجوی سریع از هر صفحه</label><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input ref={input} id="global-search" type="search" value={q} maxLength={100} onChange={e=>setQ(e.target.value)} placeholder="پلاک، نام، شمارهٔ پرونده یا پذیرش" autoComplete="off"/><kbd aria-hidden="true">Ctrl K</kbd></form>;
}
