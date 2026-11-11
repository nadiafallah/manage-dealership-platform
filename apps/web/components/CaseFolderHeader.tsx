'use client';
import type { ReactNode } from 'react';
import useSWR from 'swr';
import { COVERAGE_LABELS, JOURNEY_LABELS, JOURNEY_STEPS, coverageTab, type CaseDetail, type DeskFolder, type NextActor } from '@manage/shared';
import { fetcher } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { faNum, toPersianDigits } from '@/lib/format';
import { Plate } from './Plate';

// Case folder (spec §12, mockup CaseFolder.dc.html): header with car, coverage,
// customer and days in the shop, plate, «پرونده … · پذیرش …», the five-step
// journey bar, tabs, and a role-specific «قدم بعدی شما» card.

export const CASE_TABS = ['today', 'assessment', 'parts', 'docs', 'history'] as const;
export type CaseTab = (typeof CASE_TABS)[number];
export const CASE_TAB_LABELS: Record<CaseTab, string> = { today: 'کار امروز', assessment: 'کارشناسی', parts: 'قطعات', docs: 'مدارک', history: 'تاریخچه' };
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

const ACTOR_LABEL: Record<NextActor, string> = { accident_expert: 'کارشناس تصادفات', parts_clerk: 'مسئول قطعات', technician: 'تکنسین جایگاه', none: '' };

/** What happens after the step, and where it is done. */
function help(text: string, actor: NextActor): { why: string; tab: CaseTab; anchor: string; cta: string } {
  if (text.includes('تمام شد —')) return { why: 'با تأیید شما، کار روی گوشی تکنسین بعدی ظاهر می‌شود و اجرت این قدم قطعی می‌شود.', tab: 'today', anchor: 'case-tasks', cta: 'رفتن به برنامهٔ تعمیر' };
  if (text.startsWith('برآورد')) return { why: 'با ورود برآورد (تکی یا اکسل)، فهرست قطعات ساخته می‌شود و مسئول قطعات تعیین تکلیف می‌کند.', tab: 'assessment', anchor: 'case-assessment', cta: 'ورود برآورد کارشناسی' };
  if (text.startsWith('مسیر تعمیر')) return { why: 'قدم‌ها را به ترتیب بنویسید؛ کار هر قدم روی گوشی تکنسین همان جایگاه می‌آید.', tab: 'today', anchor: 'case-tasks', cta: 'ساخت مسیر تعمیر' };
  if (text.includes('آمادهٔ تحویل —') || text.includes('کنترل نهایی')) return { why: 'پس از کنترل نهایی و «پایان کار»، پرونده بسته می‌شود و قطعاتش دیگر از موجودی کم نمی‌شوند.', tab: 'today', anchor: 'case-quality', cta: 'کنترل نهایی و تحویل' };
  if (text.startsWith('تکنسین:') || text.includes('متوقف')) return { why: 'پاسخ بدهید یا علت توقف را ثبت کنید؛ مدت انتظار در اتاق کنترل دیده می‌شود.', tab: 'today', anchor: 'case-blockers', cta: 'دیدن موانع و پیگیری' };
  if (actor === 'parts_clerk') return { why: 'هر قلم را در فهرست قطعات تعیین تکلیف کنید؛ آمادهٔ تحویل که شد، کارشناس و جایگاه خبر می‌گیرند.', tab: 'parts', anchor: 'case-parts', cta: 'فهرست قطعات' };
  return { why: 'برنامه و وضعیت هر قدم را در «کار امروز» ببینید.', tab: 'today', anchor: 'case-tasks', cta: 'برنامهٔ تعمیر' };
}

export function CaseFolderHeader({ kase, tab, onTab, actions }: { kase: CaseDetail; tab: CaseTab; onTab: (t: CaseTab, anchor?: string) => void; actions?: ReactNode }) {
  const { me } = useAuth();
  const { data: f } = useSWR<DeskFolder>(`/desk/folders/${kase.id}`, fetcher, { refreshInterval: 60_000 });
  const cov = coverageTab(kase.coverageType);
  const step = f?.journey;
  const doneIdx = step ? JOURNEY_STEPS.indexOf(step) : -1;
  const mine = !!f && myActors(me.roles).includes(f.next.actor);
  const h = f ? help(f.next.text, f.next.actor) : null;
  return (
    <>
      <header className="case-hero cf-sheet" aria-label="سربرگ پرونده">
        <div className="cf-top">
          <div className="cf-title">
            <div className="cf-name">
              <h1>{(kase.vehicle.model || kase.vehicle.brand || kase.vehicleLabel).trim()}</h1>
              <span className={`m-tag cov-${cov.key}`} title={COVERAGE_LABELS[kase.coverageType]}>{cov.label}</span>
              {kase.isTest && <span className="m-tag">آزمایشی</span>}
            </div>
            <p className="cf-sub">{kase.customer?.fullName ?? 'مشتری ثبت نشده'}{f ? <> · {faNum(f.daysInShop)} روز در تعمیرگاه</> : null}</p>
          </div>
          <div className="cf-plate">
            <Plate value={kase.vehicle.plate} size="xl" />
            <span className="cf-ids">پرونده <bdi>{toPersianDigits(kase.caseNumber)}</bdi> · پذیرش <bdi>{kase.admissionNo ? toPersianDigits(kase.admissionNo) : 'ندارد'}</bdi></span>
          </div>
        </div>
        <ol className="journey" aria-label="مسیر خودرو">
          {JOURNEY_STEPS.map((s, i) => {
            const state = kase.stage === 'delivered' || i < doneIdx ? 'done' : i === doneIdx ? 'now' : 'next';
            return (
              <li key={s} className={`jstep ${state}`} aria-current={state === 'now' ? 'step' : undefined}>
                <i aria-hidden="true" />
                <span>{JOURNEY_LABELS[s]}{s === 'repair' && f?.place && state === 'now' ? ` · ${f.place}` : ''}</span>
              </li>
            );
          })}
        </ol>
        {actions && <div className="cf-actions no-print">{actions}</div>}
      </header>
      <nav className="cf-tabs" role="tablist" aria-label="بخش‌های پرونده">
        {(Object.keys(CASE_TAB_LABELS) as CaseTab[]).map((t) => (
          <button key={t} type="button" role="tab" id={`tab-${t}`} aria-controls="case-tabpanel" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => onTab(t)}>
            {CASE_TAB_LABELS[t]}
          </button>
        ))}
      </nav>
      {f && h && f.next.actor !== 'none' && (
        <section className={`cf-next tone-${f.next.tone}${mine ? ' mine' : ''}`} aria-label={mine ? 'قدم بعدی شما' : 'قدم بعدی'}>
          <span className="cf-next-k">{mine ? 'قدم بعدی شما' : `قدم بعدی · با ${ACTOR_LABEL[f.next.actor]}`}</span>
          <strong>{f.next.text}</strong>
          <p>{h.why}</p>
          {mine && <div className="cf-next-actions"><button type="button" className="m-btn" onClick={() => onTab(h.tab, h.anchor)}>{h.cta}</button></div>}
        </section>
      )}
    </>
  );
}
