'use client';
import {useState} from 'react';
import {useSWRConfig} from 'swr';
import {RESERVATION_ACTION_LABELS,RESERVATION_STATUS_LABELS,toPersianDigits,type ReservationAction,type StockReservation} from '@manage/shared';
import {api,errorMessage,newKey} from '@/lib/api';
import {useAuth} from '@/lib/auth';
import {formatJalali} from '@/lib/format';
import {useToast} from '@/lib/toast';
import {isStockCacheKey} from '@/lib/stock-cache';
import {Dialog} from './Dialog';

const TONE={reserved:'chip-blue',issued:'chip-amber',released:'',cancelled:'',returned:''} as const;
const STEPS:Record<ReservationAction,(r:StockReservation)=>boolean>={issue:r=>r.status==='reserved',release:r=>r.status==='reserved',cancel:r=>r.status==='issued'&&!r.reflectedAt,reflect:()=>false};
const HELP:Record<ReservationAction,string>={issue:'تحویل به جایگاه ثبت می‌شود و تا «پایان کار» پرونده از موجودی قابل‌استفاده کم می‌ماند.',release:'رزرو آزاد می‌شود و مقدار به موجودی قابل تخصیص برمی‌گردد.',cancel:'فقط برای خروجی که اشتباه ثبت شده و هنوز در گزارش انبار منعکس نشده است.',reflect:'تأیید می‌کنید گزارش فعال انبار این خروج را نشان می‌دهد؛ از این پس دوباره از موجودی کم نمی‌شود.'};

/** Manage's internal reservations; separate steps with a reason where needed, every step audited on the server. */
export function ReservationsTable({items,caseColumn=true,onChange}:{items:StockReservation[];caseColumn?:boolean;onChange:()=>void}){
 const {can}=useAuth();const toast=useToast();const {mutate:refresh}=useSWRConfig();
 const [dialog,setDialog]=useState<{r:StockReservation;action:ReservationAction;key:string}|null>(null),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const allowed=(a:ReservationAction)=>a==='release'||a==='cancel'?can('stock.release'):can('stock.issue');
 async function run(){if(!dialog)return;setBusy(true);setError('');try{await api(`/stock/reservations/${dialog.r.id}/actions`,{body:{action:dialog.action,expectedVersion:dialog.r.version,...(reason.trim()?{reason:reason.trim()}:{})},idempotencyKey:dialog.key});toast(`${RESERVATION_ACTION_LABELS[dialog.action]} ثبت شد`);setDialog(null);onChange();await refresh(isStockCacheKey);}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
 const needsReason=dialog?.action==='release'||dialog?.action==='cancel';
 return <><div className="table-scroll"><table className="table static" data-testid="reservations"><thead><tr>{caseColumn&&<th>پرونده / پذیرش</th>}<th>نیاز قطعه</th><th>کد کامل انتخابی</th><th>محل</th><th>مقدار</th><th>قیمت زمان انتخاب</th><th>وضعیت</th><th>مسئول و زمان</th><th>اقدام</th></tr></thead>
 <tbody>{items.map(r=><tr key={r.id} data-testid="reservation">{caseColumn&&<td><a href={`/cases/${r.caseId}#case-parts`}><bdi>{toPersianDigits(r.caseNumber)}</bdi></a><div className="xs">پذیرش: <bdi>{r.admissionNo?toPersianDigits(r.admissionNo):'ندارد'}</bdi></div></td>}
  <td className="small">{r.partDescription}{r.partNumber&&<div className="xs muted"><bdi>{toPersianDigits(r.partNumber)}</bdi></div>}</td><td><bdi>{toPersianDigits(r.fullStockCode)}</bdi></td><td className="small"><bdi>{r.locationAddress||'—'}</bdi></td><td>{toPersianDigits(r.quantity)}</td>
  <td className="small">فروش: {r.unitSalePrice?toPersianDigits(r.unitSalePrice):'—'}<br/>میانگین: {r.unitAvgPrice?toPersianDigits(r.unitAvgPrice):'—'}{!r.currency&&<div className="xs muted">واحد پول تأییدنشده</div>}</td>
  <td><span className={`chip ${TONE[r.status]}`}>{RESERVATION_STATUS_LABELS[r.status]}</span>{r.status==='issued'&&<div className="xs muted">{r.reflectedAt?`پایان کار پرونده ${formatJalali(r.reflectedAt)}؛ دیگر کم نمی‌شود`:'تا پایان کار پرونده از موجودی کم می‌شود'}</div>}{r.shortfall&&<div><span className="chip chip-red">کسری نسبت به گزارش</span></div>}{r.reason&&<div className="xs muted">{r.reason}</div>}</td>
  <td className="small">{r.reservedByName??'—'}<div className="xs muted">{formatJalali(r.reservedAt,{time:true})}</div></td>
  <td><div className="row">{(Object.keys(STEPS) as ReservationAction[]).filter(a=>STEPS[a](r)&&allowed(a)).map(a=><button type="button" key={a} className="btn btn-sm" onClick={()=>{setReason('');setError('');setDialog({r,action:a,key:newKey()});}}>{RESERVATION_ACTION_LABELS[a]}</button>)}</div></td></tr>)}</tbody></table></div>
 <Dialog open={!!dialog} title={dialog?RESERVATION_ACTION_LABELS[dialog.action]:''} onClose={()=>setDialog(null)} footer={<><button type="button" className="btn" onClick={()=>setDialog(null)}>انصراف</button><button type="button" className="btn btn-primary" disabled={busy||(needsReason&&!reason.trim())} onClick={()=>void run()}>{busy?'در حال ثبت…':'تأیید'}</button></>}>{dialog&&<div className="stack"><p className="small"><bdi>{toPersianDigits(dialog.r.fullStockCode)}</bdi> — مقدار {toPersianDigits(dialog.r.quantity)}</p><p className="small muted">{HELP[dialog.action]}</p><label className="field"><span>دلیل{needsReason?' *':' (اختیاری)'}</span><textarea className="input" rows={2} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label>{error&&<p className="callout callout-red small" role="alert">{error}</p>}</div>}</Dialog></>;
}
