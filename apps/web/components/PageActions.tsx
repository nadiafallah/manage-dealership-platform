'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {useAuth} from '@/lib/auth';
import type {Action} from '@/lib/workspaces';
import {AppIcon} from './AppIcon';
export function PageActions(){
 const path=usePathname(),{can,me}=useAuth();if(path==='/launch'||path.startsWith('/accidents'))return null;
 if(path.startsWith('/workshop'))return null;
 let label='واحد تصادفات';let actions:Action[]=[];
 const match=path.match(/^\/cases\/([^/]+)$/);
 // The case folder has its own tabs (کار امروز · کارشناسی · قطعات · مدارک · تاریخچه).
 if(match&&!['new','import'].includes(match[1]))return null;
 else if(path==='/users'){label='مدیریت کارکنان';actions=[{label:'افزودن کارمند',detail:'',href:'#invite-staff',icon:'add',permission:'user.manage'},{label:'افزودن تعمیرکار',detail:'',href:'#technicians',icon:'add',permission:'user.manage'}];}
 else if(path==='/reference-data'){label='اطلاعات پایه';}
 else if(path.startsWith('/modules'))return null;
 else actions=[{label:'ورود به میز کار',detail:'',href:'/accidents',icon:'desk'},...(!path.startsWith('/cases/new')?[{label:'پذیرش جدید',detail:'',href:'/cases/new',icon:'add',permission:'case.create'} as Action]:[])];
 return <div className="page-context no-print"><Link className="context-unit" href={path==='/users'?'/users':path==='/reference-data'?'/reference-data':'/accidents'}><AppIcon name={path==='/users'?'team':path==='/reference-data'?'database':'car'}/>{label}</Link><nav aria-label="دسترسی سریع صفحه" className="page-actions">{actions.filter(a=>!a.permission||can(a.permission)).map(a=>a.href.startsWith('#')?<a key={a.href} href={a.href}><AppIcon name={a.icon}/>{a.label}</a>:<Link key={a.href} href={a.href}><AppIcon name={a.icon}/>{a.label}</Link>)}</nav></div>;
}
