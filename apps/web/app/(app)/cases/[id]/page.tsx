'use client';

import Link from 'next/link';
import { ExternalWorkPanel, PartsStatementPanel } from '@/components/PartsOperations';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import useSWR, { useSWRConfig } from 'swr';
import {
  CASE_STAGES,
  MISSING_FIELD_LABELS,
  STAGE_LABELS,
  type CaseDetail,
  type CaseStage,
} from '@manage/shared';
import { AssessmentPanel } from '@/components/AssessmentPanel';
import { BlockersPanel } from '@/components/BlockersPanel';
import { CompletionPanel } from '@/components/CompletionPanel';
import { FinancePanel } from '@/components/FinancePanel';
import { AlertsPanel } from '@/components/AlertsPanel';
import { CaseSection } from '@/components/CaseSection';
import { PartsLedger } from '@/components/PartsLedger';
import { ProvenancePanel } from '@/components/ProvenancePanel';
import { CoverageChip, StageChip } from '@/components/Chips';
import { Plate } from '@/components/Plate';
import { TasksPanel } from '@/components/TasksPanel';
import { ResponsibilityBar } from '@/components/ResponsibilityBar';
import { CaseWagesPanel } from '@/components/CaseWagesPanel';
import { BackLink } from '@/components/BackLink';
import { CaseFolderHeader, SECTION_TAB, type CaseTab } from '@/components/CaseFolderHeader';
import { ReminderComposer } from '@/components/ReminderComposer';
import { Dialog } from '@/components/Dialog';
import { Timeline } from '@/components/Timeline';
import { api, ApiError, errorMessage, fetcher } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { workspaceHome } from '@/lib/workspaces';
import { deadlineTone, faNum, formatJalali, relativeDays, toPersianDigits } from '@/lib/format';
import { useToast } from '@/lib/toast';

function Missing() {
  return <span className="missing">نیازمند تکمیل</span>;
}

export default function CaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can, me } = useAuth();
  const supportAccount = !me.isOwner && me.roles.includes('system_admin');
  const toast = useToast();
  const { data: kase, error, mutate } = useSWR<CaseDetail>(`/cases/${id}`, fetcher);
  const { mutate: mutateKey } = useSWRConfig();
  const [stageBusy, setStageBusy] = useState(false);
  const [reminding, setReminding] = useState(false);
  const [stageBack, setStageBack] = useState<{ stage: CaseStage; note: string } | null>(null);
  const [tab, setTab] = useState<CaseTab | null>(null);
  const [printing, setPrinting] = useState(false);
  // «#case-…» links (cards, desks, alerts, tests) open the tab that holds the section.
  useEffect(() => {
    const sync = () => { const t = SECTION_TAB[window.location.hash.slice(1)]; if (t) setTab(t); };
    sync();
    window.addEventListener('hashchange', sync);
    // Printing the folder prints every tab, rendered synchronously before the dialog opens.
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => { window.removeEventListener('hashchange', sync); window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', after); };
  }, []);

  if (error) {
    return (
      <div className="callout callout-red">
        {error instanceof ApiError && error.status === 404 ? 'این پرونده پیدا نشد.' : 'پرونده بارگذاری نشد.'}{' '}
        <Link href="/cases">بازگشت به فهرست</Link>
      </div>
    );
  }
  if (!kase) return <p className="muted">در حال بارگذاری…</p>;

  const active = kase.status === 'open' && kase.stage !== 'delivered';
  const commitment = kase.officialDeadlineAt ?? kase.forecastDeliveryAt;
  const tone = deadlineTone(commitment, active);
  const refresh = () => {
    void mutate();
    // Assessment, parts and finance depend on each other and do not touch the
    // case version: refresh every view of this case (timeline included).
    void mutateKey((key) => (typeof key === 'string' && key.startsWith(`/cases/${id}/`)) ||
      (Array.isArray(key) && key[0] === '/emdad/requests/search' && key[1] === id));
  };

  async function changeStage(stage: CaseStage, note?: string) {
    if (!kase || stage === kase.stage) return;
    // A system administrator moving a case back writes a reason first (owner report).
    if (note === undefined && supportAccount && CASE_STAGES.indexOf(stage) < CASE_STAGES.indexOf(kase.stage)) {
      setStageBack({ stage, note: '' });
      return;
    }
    setStageBusy(true);
    try {
      await api(`/cases/${kase.id}/stage`, { body: { stage, expectedVersion: kase.version, ...(note ? { note } : {}) } });
      toast(`مرحله به «${STAGE_LABELS[stage]}» تغییر کرد`);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
    setStageBusy(false);
    refresh();
  }

  const v = kase.vehicle;
  const currentTasks = kase.tasks.filter(t => ['in_progress','blocked','done'].includes(t.status));
  // Default tab by role and stage: the parts clerk opens the parts list; the expert opens
  // the assessment while there is no repair plan yet; everyone else opens «کار امروز».
  const partsOnly = can('part.manage') && !can('assessment.manage');
  const defaultTab: CaseTab = partsOnly ? 'parts' : can('assessment.manage') && kase.tasks.length === 0 && ['reception', 'assessment', 'awaiting_approval'].includes(kase.stage) ? 'assessment' : 'today';
  const activeTab = tab ?? defaultTab;
  function goTab(t: CaseTab, anchor?: string) {
    setTab(t);
    if (anchor) {
      window.history.replaceState(null, '', `#${anchor}`);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const el = document.getElementById(anchor);
        if (el instanceof HTMLDetailsElement) el.open = true;
        el?.scrollIntoView({ block: 'start' });
      }));
    }
  }
  const actions = (
    <>
      {can('case.update') && active && (
        <select
          className="input"
          style={{ width: 'auto' }}
          aria-label="تغییر مرحله"
          value={kase.stage}
          disabled={stageBusy}
          onChange={(e) => changeStage(e.target.value as CaseStage)}
        >
          {CASE_STAGES.map((s) => (
            // Ready for delivery and delivered come from the technical close and the handover.
            <option key={s} value={s} disabled={s !== kase.stage && (s === 'ready_for_delivery' || s === 'delivered')}>
              مرحله: {STAGE_LABELS[s]}
            </option>
          ))}
        </select>
      )}
      {can('case.update') && kase.status === 'open' && <Link className="m-btn2-s" href={`/cases/${kase.id}/edit`}>ویرایش پرونده</Link>}
      <button className="m-btn2-s" type="button" onClick={() => setReminding(true)}>تذکر</button>
      <button className="m-btn2-s" type="button" onClick={() => window.print()}>چاپ</button>
      {can('case.create') && <Link className="m-btn2-s" href="/cases/new">پذیرش بعدی</Link>}
    </>
  );
  return (
    <div className="stack case-folder">
      <BackLink href={workspaceHome(me)} label="میز کار" />
      <CaseFolderHeader kase={kase} tab={activeTab} onTab={goTab} actions={actions} />
      <div className="row cf-chips">
        <StageChip stage={kase.stage} />
        <CoverageChip coverage={kase.coverageType} />
        {kase.openBlockers > 0 && <span className="chip chip-red">{faNum(kase.openBlockers)} مانع باز</span>}
        {kase.isLegacyEntry && <span className="chip">ثبت‌شده از قبل از Manage</span>}
        {kase.isTest && <span className="chip chip-amber">داده آزمایشی</span>}
      </div>

      <div id="case-tabpanel" role="tabpanel" aria-labelledby={`tab-${activeTab}`} className="stack cf-panel">
      {(printing || activeTab === 'today') && <>
      {kase.missingFields.length > 0 && (
        <div className="callout callout-amber row" style={{ justifyContent: 'space-between' }}>
          <span>
            نیازمند تکمیل: {kase.missingFields.map((m) => MISSING_FIELD_LABELS[m] ?? m).join('، ')}
          </span>
          {can('case.update') && kase.status === 'open' && (
            <Link className="btn btn-sm" href={`/cases/${kase.id}/edit`}>
              تکمیل اطلاعات
            </Link>
          )}
        </div>
      )}
      {currentTasks.length > 0 && <div className="case-current-route"><strong>فعالیت‌های جاری خودرو</strong><div className="row">
        {currentTasks.map(t => <a className="chip" key={t.id} href="#case-tasks">{t.stationCode || t.department.name} · {t.status === 'done' ? 'منتظر تأیید تحویل' : t.status === 'blocked' ? 'دارای مانع' : 'در حال انجام'}</a>)}
      </div></div>}
      {active && <AlertsPanel caseId={kase.id} />}
      <CaseSection id="case-tasks" title="برنامهٔ تعمیر" note="قدم‌ها، جایگاه، نفر، روز و اجرت؛ شروع، پایان و تأیید" initialOpen><TasksPanel kase={kase} onChange={refresh} /><ExternalWorkPanel kase={kase} onChange={refresh} /><CaseWagesPanel kase={kase} /></CaseSection>
      <CaseSection id="case-blockers" title="موانع و پیگیری" note={`${faNum(kase.openBlockers)} مانع باز`} initialOpen={kase.openBlockers > 0}><BlockersPanel kase={kase} onChange={refresh} /></CaseSection>
      <CaseSection id="case-quality" title="کنترل نهایی و پایان کار" initialOpen={['quality_control', 'ready_for_delivery', 'delivered'].includes(kase.stage)}><CompletionPanel kase={kase} onChange={refresh} /></CaseSection>
      <ResponsibilityBar kase={kase} onChange={refresh} />
      </>}

      {(printing || activeTab === 'assessment') && <CaseSection id="case-assessment" title="کارشناسی و الحاقیه" note="اقلام، فایل اکسل و ارسال به قطعات" initialOpen><AssessmentPanel kase={kase} onChange={refresh} /></CaseSection>}

      {(printing || activeTab === 'parts') && <CaseSection id="case-parts" title="قطعات" note="یک فهرست: تعیین تکلیف، تأمین، قیمت و تحویل" initialOpen><PartsLedger kase={kase} onChange={refresh} /><PartsStatementPanel kase={kase} /></CaseSection>}

      {(printing || activeTab === 'docs') && <>
      <section className="panel times" aria-label="زمان‌ها">
        <div>
          <div className="k">پذیرش واقعی</div>
          <div className="v">
            {kase.admittedAtPrecision === 'date' ? (
              <>
                {formatJalali(kase.admittedAt)} <span className="xs muted">(ساعت نامعلوم)</span>
              </>
            ) : (
              formatJalali(kase.admittedAt, { time: true })
            )}
          </div>
          <div className="rel muted">ثبت در Manage: {formatJalali(kase.createdAt)}</div>
        </div>
        <div>
          <div className="k">مهلت رسمی / تعهد</div>
          <div className="v">{kase.officialDeadlineAt ? formatJalali(kase.officialDeadlineAt, { time: true }) : <Missing />}</div>
          {kase.officialDeadlineAt && active && (
            <div className="rel" style={{ color: tone === 'red' ? 'var(--red)' : tone === 'amber' ? 'var(--amber)' : 'var(--steel)' }}>
              {relativeDays(kase.officialDeadlineAt)}
            </div>
          )}
        </div>
        <div>
          <div className="k">پیش‌بینی تحویل</div>
          <div className="v">{formatJalali(kase.forecastDeliveryAt, { time: true })}</div>
          {kase.forecastDeliveryAt && active && <div className="rel muted">{relativeDays(kase.forecastDeliveryAt)}</div>}
        </div>
        <div>
          <div className="k">تحویل واقعی</div>
          <div className="v">{formatJalali(kase.actualDeliveryAt, { time: true })}</div>
          <div className="rel muted">پیشرفت فعالیت‌ها: {faNum(kase.progressPercent)}٪</div>
        </div>
      </section>
          <CaseSection id="case-info" title="مشخصات و شرح خسارت">
          <section className="panel">
            <div className="panel-head">
              <h2>مشخصات</h2>
            </div>
            <div className="panel-body">
              <dl className="dl">
                <dt>مالک</dt>
                <dd>{kase.customer?.fullName ?? <Missing />}</dd>
                <dt>تلفن</dt>
                <dd className="num">
                  {kase.customer?.phone ? <span className="ltr">{toPersianDigits(kase.customer.phone)}</span> : <Missing />}
                </dd>
                <dt>VIN</dt>
                <dd>{v.vin ? <span className="ltr">{v.vin}</span> : '—'}</dd>
                {v.chassisRef && (
                  <>
                    <dt>شاسی ثبت‌شده</dt>
                    <dd>
                      <bdi>{v.chassisRef}</bdi>
                    </dd>
                  </>
                )}
                {kase.admissionNo && (
                  <>
                    <dt>شماره کارت پذیرش</dt>
                    <dd>{kase.admissionNo}</dd>
                  </>
                )}
                <dt>کیلومتر</dt>
                <dd className="num">{kase.odometerKm != null ? faNum(kase.odometerKm) : <Missing />}</dd>
                <dt>محل خودرو</dt>
                <dd>{kase.vehicleLocation ?? '—'}</dd>
                <dt>مسئول پرونده</dt>
                <dd>{kase.responsible?.displayName ?? <Missing />}</dd>
                <dt>ثبت‌کننده</dt>
                <dd>{kase.createdBy.displayName}</dd>
                {(kase.coverageType === 'golden_card' || kase.coverageType === 'mixed') && (
                  <>
                    <dt>پرونده کارت طلایی</dt>
                    <dd>{kase.goldenCardFileNo ?? <Missing />}</dd>
                  </>
                )}
                {(kase.coverageType === 'insurance' || kase.coverageType === 'mixed') && (
                  <>
                    <dt>بیمه</dt>
                    <dd>{kase.insurerName ?? <Missing />}</dd>
                    <dt>شماره خسارت</dt>
                    <dd>{kase.insuranceClaimNo ?? <Missing />}</dd>
                  </>
                )}
                {kase.coverageNotes && (
                  <>
                    <dt>توضیح پوشش</dt>
                    <dd>{kase.coverageNotes}</dd>
                  </>
                )}
              </dl>
              <h3 style={{ marginTop: 14 }}>شرح خسارت</h3>
              <p className="small" style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>
                {kase.damageDescription ?? <Missing />}
              </p>
            </div>
          </section>
          </CaseSection>

          <CaseSection id="case-finance" title="مالی و تسویه" initialOpen={!can('assessment.manage') && !can('part.manage') && can('finance.payment')}><FinancePanel kase={kase} onChange={refresh} /></CaseSection>

          <CaseSection id="case-provenance" title="منبع و سابقه ورود اطلاعات"><ProvenancePanel kase={kase} /></CaseSection>

      </>}

      {(printing || activeTab === 'history') && <>
          {can('audit.read') && (
            <CaseSection id="case-history" title="تاریخچه تغییرات" initialOpen><section className="panel">
              <div className="panel-head">
                <h2>تاریخچه</h2>
              </div>
              <div className="panel-body">
                <Timeline caseId={kase.id} version={kase.version + kase.tasks.reduce((s, t) => s + t.version, 0) + kase.blockers.length} />
              </div>
            </section>
            </CaseSection>
          )}
          {!can('audit.read') && <p className="m-empty">تاریخچهٔ تغییرات برای نقش شما باز نیست.</p>}
      </>}
      </div>
      <Dialog
        open={!!stageBack}
        title="برگرداندن پرونده به مرحلهٔ قبل"
        onClose={() => setStageBack(null)}
        footer={<><button type="button" className="btn" onClick={() => setStageBack(null)}>انصراف</button><button type="button" className="btn btn-primary" disabled={!stageBack?.note.trim()} onClick={() => { const next = stageBack; setStageBack(null); if (next) void changeStage(next.stage, next.note.trim()); }}>ثبت</button></>}
      >
        <label className="field">
          <span>دلیل (برای مدیر سیستم الزامی)</span>
          <input className="input" maxLength={500} value={stageBack?.note ?? ''} onChange={(e) => setStageBack((x) => (x ? { ...x, note: e.target.value } : x))} />
        </label>
      </Dialog>
      <ReminderComposer
        open={reminding}
        onClose={() => setReminding(false)}
        defaults={{ caseId: kase.id, caseLabel: kase.caseNumber, plate: v.plate, userIds: kase.responsible ? [kase.responsible.id] : [], role: kase.responsible ? undefined : 'accident_expert' }}
      />
    </div>
  );
}
