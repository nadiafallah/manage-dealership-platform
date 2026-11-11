'use client';
import { useState, type ReactNode } from 'react';
import useSWR from 'swr';
import { COVERAGE_LABELS, JOURNEY_LABELS, JOURNEY_STEPS, coverageTab, type CaseDetail, type DeskFolder, type NextActor, type Task } from '@manage/shared';
import { api, errorMessage, fetcher } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { faNum, formatJalali, toPersianDigits } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { AppIcon, type IconName } from './AppIcon';
import { ReminderComposer, type ReminderDefaults } from './ReminderComposer';
import { Dialog } from './Dialog';
import { Plate } from './Plate';

// Case folder (spec §12; owner reference «پوشهٔ پرونده خودرو»): a physical folder with
// the coverage tab and a binder clip; the car, customer, plate, identifiers and days in
// the shop; the five-step journey as chevrons; folder tabs; and the role's «قدم بعدی شما».

export const CASE_TABS = ['today', 'assessment', 'parts', 'docs', 'history'] as const;
export type CaseTab = (typeof CASE_TABS)[number];
export const CASE_TAB_LABELS: Record<CaseTab, string> = { today: 'کار امروز', assessment: 'کارشناسی', parts: 'قطعات', docs: 'مدارک', history: 'تاریخچه' };
const TAB_ICON: Record<CaseTab, IconName> = { today: 'calendar', assessment: 'clipboard', parts: 'box', docs: 'doc', history: 'history' };
/** The tab that holds each section, so «#case-…» links keep working. */
export const SECTION_TAB: Record<string, CaseTab> = {
  'case-tasks': 'today', 'case-blockers': 'today', 'case-quality': 'today', 'case-responsibility': 'today',
  'case-assessment': 'assessment',
  'case-parts': 'parts',
  'case-info': 'docs', 'case-finance': 'docs', 'case-provenance': 'docs',
  'case-history': 'history',
};

export function myActors(roles: readonly string[]): NextActor[] {
  const out: NextActor[] = [];
  if (roles.includes('accident_expert') || roles.includes('system_admin')) out.push('accident_expert');
  if (roles.includes('parts_clerk') || roles.includes('system_admin')) out.push('parts_clerk');
  if (roles.includes('technician')) out.push('technician');
  return out;
}

/** The desk facts of one case (place, days, journey, «قدم بعدی»), shared by header and cards. */
export function useFolder(caseId: string) {
  return useSWR<DeskFolder>(`/desk/folders/${caseId}`, fetcher, { refreshInterval: 60_000 });
}

export function CaseFolderHeader({ kase, tab, onTab, actions, chips, children }: { kase: CaseDetail; tab: CaseTab; onTab: (t: CaseTab, anchor?: string) => void; actions?: ReactNode; chips?: ReactNode; children: ReactNode }) {
  const { data: f } = useFolder(kase.id);
  const cov = coverageTab(kase.coverageType);
  const doneIdx = f ? JOURNEY_STEPS.indexOf(f.journey) : -1;
  return (
    <div className={`cf cov-${cov.key}`}>
      <span className="cf-cover-tab" title={COVERAGE_LABELS[kase.coverageType]}>{cov.label}</span>
      <svg className="cf-clip" width="84" height="74" viewBox="0 0 84 74" aria-hidden="true" focusable="false">
        <path d="M24 40 30 8a4 4 0 0 1 4-3h16a4 4 0 0 1 4 3l6 32" fill="none" stroke="#9AA1A8" strokeWidth="3.2" strokeLinejoin="round" />
        <path d="M24 40 30 8a4 4 0 0 1 4-3h16a4 4 0 0 1 4 3l6 32" fill="none" stroke="#E6E9EC" strokeWidth="1.2" strokeLinejoin="round" opacity=".7" />
        <path d="M10 40h64l-6 24a6 6 0 0 1-6 5H22a6 6 0 0 1-6-5Z" fill="#7C6A3E" />
        <path d="M10 40h64l-1.6 6.4H11.6Z" fill="#B49A5C" />
        <path d="M18 62h48" stroke="#5A4C2B" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <div className="cf-paper">
        <header className="case-hero cf-head" aria-label="سربرگ پرونده">
          <div className="cf-id-row">
            <h1 className="cf-car"><AppIcon name="car" />{(kase.vehicle.model || kase.vehicle.brand || kase.vehicleLabel).trim()}</h1>
            <span className="cf-cust"><AppIcon name="user" />{kase.customer?.fullName ?? 'مشتری ثبت نشده'}</span>
            <Plate value={kase.vehicle.plate} size="xl" />
            <span className="cf-ids">پرونده <bdi>{toPersianDigits(kase.caseNumber)}</bdi> · پذیرش <bdi>{kase.admissionNo ? toPersianDigits(kase.admissionNo) : 'ندارد'}</bdi></span>
            {f && <span className="cf-days"><b>{faNum(f.daysInShop)}</b> روز در تعمیرگاه</span>}
            {kase.isTest && <span className="m-tag">آزمایشی</span>}
          </div>
          <ol className="journey" aria-label="مسیر خودرو">
            {JOURNEY_STEPS.map((s, i) => {
              const state = kase.stage === 'delivered' || i < doneIdx ? 'done' : i === doneIdx ? 'now' : 'next';
              return (
                <li key={s} className={`jstep ${state}`} aria-current={state === 'now' ? 'step' : undefined}>
                  {state === 'done' && <AppIcon name="check" />}
                  <span>{JOURNEY_LABELS[s]}{s === 'repair' && f?.place && state === 'now' && f.place !== JOURNEY_LABELS[s] && <small>{f.place}</small>}</span>
                </li>
              );
            })}
          </ol>
          {(chips || actions) && <div className="cf-status">{chips}{actions && <div className="cf-actions no-print">{actions}</div>}</div>}
        </header>
        <nav className="cf-tabs" role="tablist" aria-label="بخش‌های پرونده">
          {CASE_TABS.map((t) => (
            <button key={t} type="button" role="tab" id={`tab-${t}`} aria-controls="case-tabpanel" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => onTab(t)}>
              <AppIcon name={TAB_ICON[t]} />{CASE_TAB_LABELS[t]}
            </button>
          ))}
        </nav>
        {children}
      </div>
    </div>
  );
}

const ACTOR_LABEL: Record<NextActor, string> = { accident_expert: 'کارشناس تصادفات', parts_clerk: 'مسئول قطعات', technician: 'تکنسین جایگاه', none: '' };

/** What happens after the step, and where it is done. */
function help(text: string, actor: NextActor): { why: string; tab: CaseTab; anchor: string; cta: string } {
  if (text.includes('تمام شد —')) return { why: 'با تأیید شما، کار روی گوشی تکنسین بعدی ظاهر می‌شود و اجرت این قدم قطعی می‌شود.', tab: 'today', anchor: 'case-tasks', cta: 'بررسی و تأیید' };
  if (text.startsWith('برآورد')) return { why: 'با ورود برآورد (تکی یا اکسل)، فهرست قطعات ساخته می‌شود و مسئول قطعات تعیین تکلیف می‌کند.', tab: 'assessment', anchor: 'case-assessment', cta: 'ورود برآورد کارشناسی' };
  if (text.startsWith('مسیر تعمیر')) return { why: 'قدم‌ها را به ترتیب بنویسید؛ کار هر قدم روی گوشی تکنسین همان جایگاه می‌آید.', tab: 'today', anchor: 'case-tasks', cta: 'ساخت مسیر تعمیر' };
  if (text.includes('آمادهٔ تحویل —') || text.includes('کنترل نهایی')) return { why: 'پس از کنترل نهایی و «پایان کار»، پرونده بسته می‌شود و قطعاتش دیگر از موجودی کم نمی‌شوند.', tab: 'today', anchor: 'case-quality', cta: 'کنترل نهایی و پایان کار' };
  if (text.startsWith('تکنسین:') || text.includes('متوقف')) return { why: 'پاسخ بدهید یا علت توقف را ثبت کنید؛ مدت انتظار در اتاق کنترل دیده می‌شود.', tab: 'today', anchor: 'case-blockers', cta: 'موانع و پیگیری' };
  if (actor === 'parts_clerk') return { why: 'هر قلم را در فهرست قطعات تعیین تکلیف کنید؛ آمادهٔ تحویل که شد، کارشناس و جایگاه خبر می‌گیرند.', tab: 'parts', anchor: 'case-parts', cta: 'فهرست قطعات' };
  if (actor === 'technician') return { why: 'این قدم را تکنسین جایگاه روی گوشی خود پیش می‌برد؛ شروع، پایان و تأخیر هر قدم در جدول «برنامهٔ تعمیرات» دیده می‌شود.', tab: 'today', anchor: 'case-tasks', cta: 'برنامهٔ تعمیر' };
  return { why: 'برنامه و وضعیت هر قدم در جدول «برنامهٔ تعمیرات» است.', tab: 'today', anchor: 'case-tasks', cta: 'برنامهٔ تعمیر' };
}

/** A reminder about someone else's step: the technician of the running step, the parts clerk or the case's expert. */
function nudge(kase: CaseDetail, actor: NextActor, text: string): ReminderDefaults {
  const base = { caseId: kase.id, caseLabel: kase.caseNumber, plate: kase.plate, body: `${(kase.vehicle.model || kase.vehicleLabel).trim()}: ${text}`.slice(0, 300), source: 'manual' as const };
  if (actor === 'technician') {
    const t = kase.tasks.find((x) => x.status === 'in_progress') ?? kase.tasks.find((x) => x.status === 'blocked') ?? kase.tasks.find((x) => x.status === 'pending');
    if (t?.assignedUserId) return { ...base, userIds: [t.assignedUserId] };
    return { ...base, role: 'technician' };
  }
  if (actor === 'parts_clerk') return { ...base, role: 'parts_clerk' };
  return kase.responsible ? { ...base, userIds: [kase.responsible.id] } : { ...base, role: 'accident_expert' };
}

/** «قدم بعدی شما»: one sentence, why, and the button that does it (approval opens a review dialog). */
export function NextStepCard({ kase, onTab, onChange }: { kase: CaseDetail; onTab: (t: CaseTab, anchor?: string) => void; onChange: () => void }) {
  const { me, can } = useAuth();
  const { data: f, mutate } = useFolder(kase.id);
  const [reviewing, setReviewing] = useState<Task | null>(null);
  const [remind, setRemind] = useState<ReminderDefaults | null>(null);
  if (!f || f.next.actor === 'none') return null;
  const mine = myActors(me.roles).includes(f.next.actor);
  const h = help(f.next.text, f.next.actor);
  const done = kase.tasks.find((t) => t.status === 'done');
  const approve = mine && !!done && h.cta === 'بررسی و تأیید' && can('task.approve');
  return (
    <section className={`cf-next tone-${f.next.tone}${mine ? ' mine' : ''}`} aria-label={mine ? 'قدم بعدی شما' : 'قدم بعدی'}>
      <span className="cf-next-k"><AppIcon name="flag" />{mine ? 'قدم بعدی شما' : `قدم بعدی · با ${ACTOR_LABEL[f.next.actor]}`}</span>
      <strong>{f.next.text}</strong>
      <p>{h.why}</p>
      {mine ? (
        <div className="cf-next-actions">
          <button type="button" className="m-btn" onClick={() => (approve ? setReviewing(done!) : onTab(h.tab, h.anchor))}>{h.cta}<AppIcon name="arrow-left" /></button>
        </div>
      ) : (
        <div className="cf-next-actions">
          <button type="button" className="m-btn2" onClick={() => setRemind(nudge(kase, f.next.actor, f.next.text))}><AppIcon name="bell" />تذکر به {ACTOR_LABEL[f.next.actor]}</button>
        </div>
      )}
      <ReminderComposer open={!!remind} onClose={() => setRemind(null)} defaults={remind ?? undefined} />
      {reviewing && <ApproveDialog kase={kase} task={reviewing} onClose={() => setReviewing(null)} onDone={() => { setReviewing(null); void mutate(); onChange(); }} />}
    </section>
  );
}

/** Spec §6: the expert approves a finished step (next step appears on the technician's phone and the wage is final) or sends it back. */
function ApproveDialog({ kase, task, onClose, onDone }: { kase: CaseDetail; task: Task; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const next = kase.tasks.find((t) => t.status === 'pending' && t.dependsOn.includes(task.id)) ?? kase.tasks.find((t) => t.status === 'pending');
  const label = task.title || task.department.name;
  async function act(action: 'approve' | 'reopen') {
    setBusy(true);
    try {
      await api(`/tasks/${task.id}/actions`, { body: { action, expectedVersion: task.version, note: note.trim() || null } });
      toast(action === 'approve' ? `«${label}» تأیید شد` : `«${label}» برای اصلاح برگشت`);
      onDone();
    } catch (e) {
      toast(errorMessage(e), 'error');
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      title={`بررسی پایان «${label}»`}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="btn" disabled={busy} onClick={onClose}>انصراف</button>
          <button type="button" className="btn" disabled={busy || note.trim().length < 3} onClick={() => void act('reopen')} title={note.trim().length < 3 ? 'برای برگرداندن، علت را بنویسید' : undefined}>نیاز به اصلاح دارد</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void act('approve')}>{next ? `تأیید و ارجاع به ${next.title || next.department.name}` : 'تأیید پایان کار'}</button>
        </>
      }
    >
      <dl className="m-dl">
        <dt>جایگاه</dt><dd>{task.stationName || task.stationCode || task.department.name}</dd>
        <dt>تکنسین</dt><dd>{task.technicianName ?? '—'}</dd>
        <dt>پایان زده</dt><dd>{formatJalali(task.actualEndAt, { time: true })}</dd>
      </dl>
      <label className="field">
        <span>یادداشت (برای «نیاز به اصلاح» الزامی است)</span>
        <textarea className="input" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
    </Dialog>
  );
}
