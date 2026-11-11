'use client';

import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import {
  BLOCKER_REASONS,
  unionWorkingMinutes,
  BLOCKER_REASON_LABELS,
  type BlockerReason,
  type CaseDetail,
  PART_STATUS_LABELS,
  type Department,
  type WorkshopStation,
  type PlanSuggestion,
  type Part,
  type Task,
  type TaskAction,
} from '@manage/shared';
import { api, errorMessage, fetcher } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { duration, formatJalali,faNum } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { TaskStatusChip } from './Chips';
import { Dialog } from './Dialog';
import { JalaliInput } from './JalaliInput';
import { AppIcon } from './AppIcon';
import { RepairPlanEditor } from './RepairPlanEditor';

const ACTION_LABELS: Record<TaskAction, string> = {
  start: 'شروع',
  complete: 'اتمام',
  approve: 'تأیید تحویل',
  reopen: 'بازگشایی',
};

type Pending =
  | { kind: 'action'; task: Task; action: TaskAction }
  | { kind: 'block'; task: Task }
  | null;

export function TasksPanel({ kase, onChange }: { kase: CaseDetail; onChange: () => void }) {
  const plannedMinutes=kase.repairPlan?unionWorkingMinutes(kase.tasks.filter(t=>t.plannedStartAt&&t.plannedEndAt).map(t=>({start:t.plannedStartAt!,end:t.plannedEndAt!})),kase.repairPlan.calendar.calendar):null;
  const { can } = useAuth();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [advisorOpen, setAdvisorOpen] = useState(false);
  const [advisorPicked, setAdvisorPicked] = useState<PlanSuggestion | null>(null);
  const { data: managePlans, error: managePlanError } = useSWR<PlanSuggestion[]>(advisorOpen && can('task.manage') ? `/workshop/plan-suggestion?caseId=${kase.id}` : null, fetcher);
  const [editing, setEditing] = useState<Task | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [at, setAt] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState<BlockerReason>('part_not_arrived');
  const [partId, setPartId] = useState('');
  const { data: parts } = useSWR<Part[]>(`/cases/${kase.id}/parts`, fetcher);
  // Parts a "not arrived" blocker can wait for; handing one over resolves the blocker.
  const waitingParts = (parts ?? []).filter((p) => p.status !== 'handed_over' && p.status !== 'cancelled');
  const [busy, setBusy] = useState(false);
  const manage = can('task.manage');
  const editable = kase.status === 'open' && kase.stage !== 'delivered';
  const byId = new Map(kase.tasks.map((t) => [t.id, t]));

  function open(p: NonNullable<Pending>) {
    setPending(p);
    setAt(new Date().toISOString());
    setNote('');
    setReason('part_not_arrived');
    setPartId('');
  }

  /** One click for routine actions; the dialog only when a time or reason is needed. */
  async function quick(task: Task, action: TaskAction) {
    await run(() =>
      api(`/tasks/${task.id}/actions`, { body: { action, expectedVersion: task.version } }),
      `${ACTION_LABELS[action]} ثبت شد`,
    );
  }

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await fn();
      toast(done);
      setPending(null);
      onChange();
    } catch (err) {
      toast(errorMessage(err), 'error');
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!pending) return;
    if (pending.kind === 'action') {
      const { task, action } = pending;
      await run(
        () =>
          api(`/tasks/${task.id}/actions`, {
            body: { action, expectedVersion: task.version, at, note: note || null },
          }),
        `${ACTION_LABELS[action]} ثبت شد`,
      );
    } else {
      const { task } = pending;
      await run(
        () =>
          api(`/cases/${kase.id}/blockers`, {
            body: {
              reason,
              description: note || null,
              taskId: task.id,
              occurredAt: at,
              expectedTaskVersion: task.version,
              partRequestId: partId && reason.startsWith('part_') ? partId : null,
            },
          }),
        'مانع ثبت شد',
      );
    }
  }

  const dialogTitle =
    pending?.kind === 'block'
      ? `ثبت مانع برای ${pending.task.department.name}`
      : pending
        ? `${ACTION_LABELS[pending.action]}: ${pending.task.department.name}`
        : '';

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>
          مسیر و فعالیت‌های تعمیر{' '}
          {(can('task.manage') || can('qc.inspect')) && (
            <Link className="xs no-print" href="/reports?view=workshop">
              گزارش واحدها
            </Link>
          )}
        </h2>
        {manage && editable && <div className="row">
          <button className="btn btn-sm" type="button" aria-expanded={advisorOpen} onClick={() => setAdvisorOpen(v => !v)}><AppIcon name="sparkles" /> دستیار منیج</button>
          <button className="btn btn-sm btn-primary" type="button" aria-expanded={planning} onClick={() => setPlanning(v => !v)}>{planning ? 'بستن مسیر' : 'ساخت مسیر تعمیر'}</button>
          <button className="btn btn-sm" type="button" onClick={() => { setAdvisorPicked(null); setAdding(!adding); }}>
            {adding ? 'بستن فرم' : 'افزودن فعالیت'}
          </button>
        </div>}
      </div>

      {kase.repairPlan&&plannedMinutes!==null&&<p className="panel-body callout callout-blue">برنامه کل: {faNum(kase.repairPlan.days)} روز کاری · زمان تخصیص‌یافته بدون دوباره‌شمردن هم‌پوشانی: {faNum(plannedMinutes/kase.repairPlan.dayMinutes)} روز · {plannedMinutes>kase.repairPlan.durationMinutes?'عبور از بودجه زمانی: '+faNum((plannedMinutes-kase.repairPlan.durationMinutes)/kase.repairPlan.dayMinutes)+' روز':'زمان باقی‌مانده برای برنامه‌ریزی: '+faNum((kase.repairPlan.durationMinutes-plannedMinutes)/kase.repairPlan.dayMinutes)+' روز'}</p>}
      {advisorOpen && manage && editable && <div className="panel-body stack" role="region" aria-label="راهنمای برنامه‌ریزی منیج">
        <strong><AppIcon name="sparkles" /> پیشنهادهای دستیار منیج برای برنامهٔ تعمیر</strong>
        <p className="small muted">بر اساس سوابق تعمیر، صف جایگاه‌ها و وضعیت فعلی پرونده؛ این نسخه از قواعد داخلی استفاده می‌کند، نه اتصال به AI.</p>
        {kase.blockers.some(b => !b.resolvedAt) && <p className="callout small">مانع باز وجود دارد؛ ابتدا علت توقف و قطعات وابسته را بررسی کنید.</p>}
        {kase.tasks.some(t => ['pending','in_progress'].includes(t.status) && !t.assignedUserId) && <p className="callout small">یک یا چند فعالیت هنوز تعمیرکار مشخص ندارند؛ پیش از شروع به تخصیص توجه کنید.</p>}
        {kase.officialDeadlineAt && Date.parse(kase.officialDeadlineAt) < Date.now() && <p className="callout small">مهلت رسمی پرونده گذشته است؛ اولویت‌بندی و هماهنگی با مشتری را بررسی کنید.</p>}
        {managePlanError && <p role="alert">دریافت پیشنهاد جایگاه ناموفق بود.</p>}
        {!managePlans && !managePlanError && <p className="small muted">در حال بررسی ظرفیت و سوابق…</p>}
        {managePlans?.map(p => { const st = p.stations.find(s => s.id === p.recommendedStationId); const already = kase.tasks.some(t => t.department.id === p.departmentId && t.status !== 'approved'); return <div key={p.departmentId} className="row" style={{ justifyContent:'space-between', flexWrap:'wrap' }}>
          <div className="small"><strong>{p.departmentName} · {faNum(p.suggestedDays)} روز کاری</strong><div className="muted">{st ? `جایگاه ${st.code} · ${st.name} · ${faNum(st.queuedCars)} خودرو در صف` : 'جایگاه آزادِ تأییدشده در پیشنهاد موجود نیست'} · {p.basis === 'default' ? 'برآورد پایه' : `سابقه ${faNum(p.samples)} کار`}{already ? ' · این واحد از قبل در برنامه وجود دارد' : ''}</div></div>
          <button type="button" className="btn btn-sm" disabled={already || !st} onClick={() => { setAdvisorPicked(p); setAdding(true); setEditing(null); }}>آماده‌کردن برنامه</button>
        </div>; })}
        <p className="small muted">استفاده از پیشنهاد فقط فرم فعالیت را تکمیل می‌کند؛ ثبت، بررسی پیش‌نیازها و تعیین مسئول با تأیید کارشناس است.</p>
      </div>}
      {planning && manage && editable && <RepairPlanEditor kase={kase} onDone={() => { setPlanning(false); onChange(); }} />}
      {adding && <AddTask key={advisorPicked?.departmentId ?? 'manual'} kase={kase} suggested={advisorPicked ?? undefined} onDone={() => { setAdding(false); setAdvisorPicked(null); onChange(); }} />}
      {editing && <AddTask key={editing.id} kase={kase} initial={editing} onDone={() => {setEditing(null);onChange();}} />}
      <ol className="repair-route" aria-label="مسیر برنامه‌ریزی‌شده تعمیر">
        {kase.tasks.map(t=><li key={t.id} data-status={t.status}><strong>{t.stationCode || t.department.name}</strong><span>{t.dependsOn.length ? `پس از تأیید ${t.dependsOn.map(id=>byId.get(id)?.stationCode||byId.get(id)?.department.name).join('، ')}` : 'مستقل / قابل اجرای هم‌زمان'}</span></li>)}
      </ol>

      {kase.tasks.length === 0 && !adding && !planning && (
        <div className="panel-body muted small">
          هنوز فعالیتی تعریف نشده است.
          {manage && editable ? ' مسیر را با «ساخت مسیر تعمیر» قدم‌به‌قدم بنویسید.' : ''}
        </div>
      )}

      {kase.tasks.map((t) => {
        const deps = t.dependsOn.map((id) => byId.get(id)).filter(Boolean) as Task[];
        const waiting = deps.filter((d) => d.status !== 'approved');
        const openBlocker = kase.blockers.find((b) => b.taskId === t.id && !b.resolvedAt);
        return (
          <div key={t.id} className={`task${t.status === 'blocked' ? ' is-blocked' : ''}`} data-testid="task">
            <div>
              <div className="row" style={{ gap: 8 }}>
                <span className="dept">{t.stationCode?`${t.stationCode} · ${t.stationName}`:t.department.name}</span>
                <TaskStatusChip status={t.status} />
                {t.qcInspectionId && <span className="chip chip-amber">کار اصلاحی کنترل کیفیت</span>}
                {t.title && <span className="small">{t.title}</span>}
              </div>
              <div className="meta">
                <span>
                  تکنسین: {t.technicianName ?? 'تعیین نشده'}
                  {t.technicianCode ? ` (${t.technicianCode})` : ''}
                </span>
                {(t.plannedStartAt || t.plannedEndAt) && (
                  <span>
                    برنامه: {formatJalali(t.plannedStartAt)} تا {formatJalali(t.plannedEndAt)}
                  </span>
                )}
                {t.actualStartAt && <span>شروع واقعی: {formatJalali(t.actualStartAt, { time: true })}</span>}
                {t.actualEndAt && (
                  <span>
                    اتمام: {formatJalali(t.actualEndAt, { time: true })} ({duration(t.actualStartAt ?? t.actualEndAt, t.actualEndAt)})
                  </span>
                )}
                {t.approvedBy && <span>تأیید: {t.approvedBy.displayName}</span>}
                {deps.length > 0 && <span>بعد از: {deps.map((d) => d.department.name).join('، ')}</span>}
                {t.weight > 1 && <span>وزن: {t.weight}</span>}
              </div>
              {openBlocker && (
                <div className="small" style={{ color: 'var(--red)', marginTop: 4 }}>
                  مانع: {BLOCKER_REASON_LABELS[openBlocker.reason]}
                  {openBlocker.description ? `، ${openBlocker.description}` : ''}
                </div>
              )}
            </div>
            {manage && editable && (
              <div className="actions">
                <button className="btn btn-sm" disabled={busy} onClick={()=>{setAdding(false);setEditing(t);}}>ویرایش برنامه و ارجاع</button>
                {t.status === 'pending' && (
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={busy || waiting.length > 0}
                    title={waiting.length ? `منتظر: ${waiting.map((d) => d.department.name).join('، ')}` : undefined}
                    onClick={() => quick(t, 'start')}
                  >
                    شروع
                  </button>
                )}
                {t.status === 'in_progress' && (
                  <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => quick(t, 'complete')}>
                    اتمام
                  </button>
                )}
                {t.status === 'done' && can('task.approve') && (
                  <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => quick(t, 'approve')}>
                    تأیید تحویل
                  </button>
                )}
                {(t.status === 'pending' || t.status === 'in_progress' || t.status === 'blocked') && (
                  <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => open({ kind: 'block', task: t })}>
                    ثبت مانع
                  </button>
                )}
                {(t.status === 'done' || t.status === 'approved') && (
                  <button className="btn btn-sm" disabled={busy} onClick={() => open({ kind: 'action', task: t, action: 'reopen' })}>
                    بازگشایی
                  </button>
                )}
                {(t.status === 'pending' || t.status === 'in_progress') && (
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={busy || (t.status === 'pending' && waiting.length > 0)}
                    onClick={() => open({ kind: 'action', task: t, action: t.status === 'pending' ? 'start' : 'complete' })}
                  >
                    ثبت با زمان دیگر
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      <Dialog
        open={!!pending}
        title={dialogTitle}
        onClose={() => setPending(null)}
        footer={
          <>
            <button
              className="btn btn-primary"
              disabled={busy || (pending?.kind === 'action' && pending.action === 'reopen' && !note.trim())}
              onClick={confirm}
            >
              {pending?.kind === 'block' ? 'ثبت مانع' : pending ? `ثبت ${ACTION_LABELS[pending.action]}` : ''}
            </button>
            <button className="btn" onClick={() => setPending(null)}>
              انصراف
            </button>
          </>
        }
      >
        {pending?.kind === 'block' && (
          <label className="field">
            <span>علت مانع</span>
            <select className="input" value={reason} onChange={(e) => setReason(e.target.value as BlockerReason)}>
              {BLOCKER_REASONS.map((r) => (
                <option key={r} value={r}>
                  {BLOCKER_REASON_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
        )}
        {pending?.kind === 'block' && reason.startsWith('part_') && waitingParts.length > 0 && (
          <label className="field">
            <span>قطعه</span>
            <select className="input" value={partId} onChange={(e) => setPartId(e.target.value)}>
              <option value="">—</option>
              {waitingParts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.description} ({PART_STATUS_LABELS[p.status]})
                </option>
              ))}
            </select>
            <span className="hint">با ثبت تحویل این قطعه به واحد، مانع خودکار رفع می‌شود.</span>
          </label>
        )}
        {!(pending?.kind === 'action' && pending.action === 'reopen') && (
          <JalaliInput
            label={pending?.kind === 'block' ? 'زمان بروز مانع' : 'زمان واقعی'}
            value={at}
            onChange={setAt}
            withTime
            nowButton
            hint="اگر با تأخیر ثبت می‌کنید، زمان واقعی رخداد را وارد کنید"
          />
        )}
        <label className="field">
          <span>
            {pending?.kind === 'action' && pending.action === 'reopen' ? 'دلیل بازگشایی (کار اصلاحی) *' : 'توضیح'}
          </span>
          <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </Dialog>
    </section>
  );
}

function AddTask({ kase, onDone, initial, suggested }: { kase: CaseDetail; onDone: () => void; initial?: Task; suggested?: PlanSuggestion }) {
  const toast = useToast();
  const { data: departments } = useSWR<Department[]>('/departments', fetcher);
  const [departmentId, setDepartmentId] = useState(initial?.department.id ?? suggested?.departmentId ?? '');
  const {data:stations}=useSWR<WorkshopStation[]>('/workshop/stations',fetcher);
  const {data:staff}=useSWR<{id:string;displayName:string}[]>('/workshop/staff',fetcher);
  const {data:plan}=useSWR<PlanSuggestion[]>(initial?null:`/workshop/plan-suggestion?caseId=${kase.id}`,fetcher);
  const [stationId,setStationId]=useState(initial?.stationId??suggested?.recommendedStationId??''),[assignedUserId,setAssignedUserId]=useState(initial?.assignedUserId??''),[durationMinutes,setDurationMinutes]=useState(''),[durationDays,setDurationDays]=useState(suggested ? String(suggested.suggestedDays) : ''),[scheduleReason,setScheduleReason]=useState('');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [technicianName, setTechnicianName] = useState(initial?.technicianName ?? '');
  const [technicianCode, setTechnicianCode] = useState(initial?.technicianCode ?? '');
  const [plannedStartAt, setPlannedStartAt] = useState<string | null>(initial?.plannedStartAt ?? null);
  const [plannedEndAt, setPlannedEndAt] = useState<string | null>(initial?.plannedEndAt ?? null);
  const [dependsOn, setDependsOn] = useState<string[]>(initial?.dependsOn ?? []);
  const [weight, setWeight] = useState(1);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api(initial ? `/tasks/${initial.id}` : `/cases/${kase.id}/tasks`, {
        method: initial ? 'PATCH' : 'POST',
        body: {
          expectedVersion: initial?.version,
          scheduleReason: initial ? scheduleReason : undefined,
          departmentId, stationId:stationId||null, assignedUserId:assignedUserId||null, durationMinutes:durationMinutes?Number(durationMinutes):undefined,
          durationDays:durationDays?Number(durationDays):undefined,
          title: title || null,
          technicianName: technicianName || null,
          technicianCode: technicianCode || null,
          plannedStartAt,
          plannedEndAt,
          dependsOn,
          weight,
        },
      });
      toast('فعالیت اضافه شد');
      onDone();
    } catch (err) {
      toast(errorMessage(err), 'error');
      setBusy(false);
    }
  }

  return (
    <div className="panel-body grid-3" style={{ borderBlockEnd: '1px solid var(--silver)', background: '#fafbfc' }}>
      <label className="field">
        <span>واحد *</span>
        <select className="input" name="departmentId" value={departmentId} onChange={(e) => {setDepartmentId(e.target.value);setStationId('');}}>
          <option value="">انتخاب واحد</option>
          {departments?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>شرح کار</span>
        <input className="input" name="title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'nowrap' }}>
        <label className="field" style={{ flex: 2 }}>
          <span>نام تکنسین</span>
          <input className="input" name="technicianName" value={technicianName} onChange={(e) => setTechnicianName(e.target.value)} />
        </label>
        <label className="field" style={{ flex: 1 }}>
          <span>کد</span>
          <input className="input ltr-input" name="technicianCode" value={technicianCode} onChange={(e) => setTechnicianCode(e.target.value)} />
        </label>
      </div>
      <label className="field"><span>جایگاه دارای کد</span><select className="input" name="stationId" value={stationId} onChange={e=>{setStationId(e.target.value);const s=stations?.find(s=>s.id===e.target.value);if(s){setAssignedUserId(s.responsibleUserId??'');setDepartmentId(s.departmentId);}}}><option value="">انتخاب جایگاه</option>{stations?.filter(s=>s.isActive&&(!departmentId||s.departmentId===departmentId)).map(s=><option value={s.id} key={s.id}>{s.code} · {s.name}</option>)}</select></label>
      <label className="field"><span>حساب تعمیرکار</span><select className="input" name="assignedUserId" value={assignedUserId} onChange={e=>{setAssignedUserId(e.target.value);setTechnicianName(staff?.find(u=>u.id===e.target.value)?.displayName??'');}}><option value="">ثبت توسط مسئول / بدون حساب تعمیرکار</option>{staff?.map(u=><option value={u.id} key={u.id}>{u.displayName}</option>)}</select></label>
      {kase.repairPlan&&<p className="callout callout-blue">برنامه کل پرونده: {faNum(kase.repairPlan.days)} روز کاری؛ پایان {formatJalali(kase.forecastDeliveryAt,{time:true})}</p>}
      {(()=>{const p=plan?.find(x=>x.departmentId===departmentId);if(!p)return null;const st=p.stations.find(x=>x.id===p.recommendedStationId);
        const why=p.basis==='same_model'?`میانگین ${faNum(p.samples)} کار قبلی همین مدل`:p.basis==='history'?`میانگین ${faNum(p.samples)} کار قبلی این واحد`:'مقدار پایه؛ با ثبت کارهای واقعی دقیق‌تر می‌شود';
        return <div className="callout callout-blue" role="note"><strong>پیشنهاد منیج: {faNum(p.suggestedDays)} روز کاری</strong> <span className="small">({why})</span>
          {st&&<div className="small">جایگاه {st.code} · {st.name} — {st.freeFrom?`آزاد از ${formatJalali(st.freeFrom,{time:true})}`:'همین حالا آزاد'}{st.queuedCars?` · ${faNum(st.queuedCars)} خودرو در صف`:''}</div>}
          {p.stations.filter(x=>x.id!==st?.id&&x.freeFrom).map(x=><div className="small muted" key={x.id}>جایگاه {x.code}: مشغول تا {formatJalali(x.freeFrom!,{time:true})}</div>)}
          <button type="button" className="btn btn-sm" onClick={()=>{setDurationDays(String(p.suggestedDays));setDurationMinutes('');setPlannedStartAt(null);setPlannedEndAt(null);if(st){setStationId(st.id);const s=stations?.find(x=>x.id===st.id);if(s)setAssignedUserId(s.responsibleUserId??'');}}}>استفاده از پیشنهاد</button></div>;})()}
      {!departmentId&&plan&&plan.length>0&&<p className="small muted">ترتیب معمول واحدها: {plan.map(p=>p.departmentName).join(' ← ')}</p>}
      <label className="field"><span>سهم این جایگاه (روز کاری)</span><input aria-label="سهم این جایگاه (روز کاری)" name="durationDays" className="input" type="number" min={0.25} max={180} step={0.25} value={durationDays} onChange={e=>{setDurationDays(e.target.value);setDurationMinutes('');setPlannedStartAt(null);setPlannedEndAt(null);}}/><span className="small muted">پایان خودکار محاسبه می‌شود. شروع خالی: پس از پیش‌نیازها یا از زمان پذیرش؛ برای کار هم‌زمان، پیش‌نیاز تعیین نکنید.</span></label>
      <details className="compact-disclosure"><summary>تنظیم زمان دقیق یا سابقه قبلی</summary><div className="stack"><label className="field"><span>مدت کار به دقیقه کاری</span><input name="durationMinutes" className="input" type="number" min={1} max={100000} value={durationMinutes} onChange={e=>{setDurationMinutes(e.target.value);setDurationDays('');}}/></label>
      <JalaliInput label="شروع برنامه‌ای" value={plannedStartAt} onChange={setPlannedStartAt} withTime />
      <JalaliInput label="پایان برنامه‌ای" value={plannedEndAt} onChange={setPlannedEndAt} withTime />
      </div></details>
      <label className="field">
        <span>وزن در پیشرفت (۱ تا ۱۰)</span>
        <input
          className="input ltr-input num"
          type="number"
          min={1}
          max={10}
          value={weight}
          onChange={(e) => setWeight(Math.min(10, Math.max(1, Number(e.target.value) || 1)))}
        />
        <span className="hint">کار سنگین‌تر سهم بیشتری در درصد پیشرفت دارد</span>
      </label>
      {kase.tasks.length > 0 && (
        <div className="field span-all">
          <span>پس از تأیید تحویل این فعالیت‌ها شروع شود</span>
          <div className="row">
            {kase.tasks.filter(t=>t.id!==initial?.id).map((t) => (
              <label key={t.id} className="check">
                <input
                  type="checkbox"
                  checked={dependsOn.includes(t.id)}
                  onChange={(e) =>
                    setDependsOn(e.target.checked ? [...dependsOn, t.id] : dependsOn.filter((x) => x !== t.id))
                  }
                />
                {t.department.name}
                {t.title ? ` (${t.title})` : ''}
              </label>
            ))}
          </div>
        </div>
      )}
      {initial&&<label className="field span-all">دلیل تغییر برنامه<textarea className="input" value={scheduleReason} onChange={e=>setScheduleReason(e.target.value)} maxLength={1000}/></label>}
      <div className="row span-all">
        <button className="btn btn-primary" disabled={busy || !departmentId || (!!initial&&!scheduleReason.trim())} onClick={save} type="button">
          {initial ? 'ذخیره تغییر برنامه' : 'ذخیره فعالیت'}
        </button>
      </div>
    </div>
  );
}
