'use client';

import Link from 'next/link';
import { ExternalWorkPanel, PartsStatementPanel } from '@/components/PartsOperations';
import { useParams } from 'next/navigation';
import { useState } from 'react';
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
import { CaseStockPanel } from '@/components/CaseStockPanel';
import { CaseSection } from '@/components/CaseSection';
import { PartsPanel } from '@/components/PartsPanel';
import { ProvenancePanel } from '@/components/ProvenancePanel';
import { CoverageChip, StageChip } from '@/components/Chips';
import { Plate } from '@/components/Plate';
import { TasksPanel } from '@/components/TasksPanel';
import { ResponsibilityBar } from '@/components/ResponsibilityBar';
import { CaseWagesPanel } from '@/components/CaseWagesPanel';
import { BackLink } from '@/components/BackLink';
import { ReminderComposer } from '@/components/ReminderComposer';
import { Dialog } from '@/components/Dialog';
import { Timeline } from '@/components/Timeline';
import { api, ApiError, errorMessage, fetcher } from '@/lib/api';
import { useAuth } from '@/lib/auth';
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
  return (
    <div className="stack">
      <BackLink href="/cases" label="بازگشت به پرونده‌ها" />
      <div className="case-hero">
        <div className="stack" style={{ gap: 8 }}>
          <div className="ident">
            <span className="case-number">{toPersianDigits(kase.caseNumber)}</span>
            <Plate value={v.plate} large />
          </div>
          <div className="small">شماره پذیرش ایران‌خودرو: <strong><bdi>{kase.admissionNo?toPersianDigits(kase.admissionNo):'ندارد'}</bdi></strong> · شماره منیج: <bdi>{toPersianDigits(kase.caseNumber)}</bdi></div>
          <div className="row" style={{ gap: 6 }}>
            <StageChip stage={kase.stage} />
            <CoverageChip coverage={kase.coverageType} />
            {kase.openBlockers > 0 && <span className="chip chip-red">{faNum(kase.openBlockers)} مانع باز</span>}
            {kase.isLegacyEntry && <span className="chip">ثبت‌شده از قبل از Manage</span>}
            {kase.isTest && <span className="chip chip-amber">داده آزمایشی</span>}
          </div>
          <div className="muted small">
            {toPersianDigits(kase.vehicleLabel)}
            {v.modelYear ? `، مدل ${toPersianDigits(v.modelYear)}` : ''}
            {v.color ? `، ${v.color}` : ''}
          </div>
        </div>
        <div className="row no-print">
          {can('case.create') && <Link className="btn btn-primary" href="/cases/new">ثبت پرونده بعدی</Link>}
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
          {can('case.update') && kase.status === 'open' && (
            <Link className="btn" href={`/cases/${kase.id}/edit`}>
              ویرایش پرونده
            </Link>
          )}
          <button className="btn" type="button" onClick={() => setReminding(true)}>
            تذکر
          </button>
          <button className="btn" type="button" onClick={() => window.print()}>
            چاپ
          </button>
        </div>
      </div>

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

      <ResponsibilityBar kase={kase} onChange={refresh} />

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
      <div className="grid-3 case-work-area" style={{ alignItems: 'start' }}>
        <div className="stack span-2">
          <CaseSection id="case-assessment" title="کارشناسی و الحاقیه" note="اقلام، فایل اکسل و ارسال به قطعات" initialOpen={can('assessment.manage')||(!(can('assessment.manage')||can('part.manage')||can('task.manage')||can('finance.payment')||can('qc.inspect'))&&({assessment:'case-assessment',awaiting_approval:'case-assessment',awaiting_parts:'case-parts',in_repair:'case-tasks',quality_control:'case-quality',ready_for_delivery:'case-quality'} as Record<string,string>)[kase.stage]==='case-assessment')}><AssessmentPanel kase={kase} onChange={refresh} /></CaseSection>
          <CaseSection id="case-parts" title="قطعات و تأمین" note="نیازها، خرید و تحویل قطعه" initialOpen={(!can('assessment.manage') && can('part.manage'))||(!(can('assessment.manage')||can('part.manage')||can('task.manage')||can('finance.payment')||can('qc.inspect'))&&({assessment:'case-assessment',awaiting_approval:'case-assessment',awaiting_parts:'case-parts',in_repair:'case-tasks',quality_control:'case-quality',ready_for_delivery:'case-quality'} as Record<string,string>)[kase.stage]==='case-parts')}><PartsPanel kase={kase} onChange={refresh} /><PartsStatementPanel kase={kase} />{(can('stock.read') || can('emdad.read')) && <CaseStockPanel kase={kase} />}</CaseSection>
          <CaseSection id="case-tasks" title="مسیر تعمیرات" note="ارجاع، شروع، پایان و تحویل جایگاه" initialOpen={(!can('assessment.manage') && !can('part.manage') && can('task.manage'))||(!(can('assessment.manage')||can('part.manage')||can('task.manage')||can('finance.payment')||can('qc.inspect'))&&({assessment:'case-assessment',awaiting_approval:'case-assessment',awaiting_parts:'case-parts',in_repair:'case-tasks',quality_control:'case-quality',ready_for_delivery:'case-quality'} as Record<string,string>)[kase.stage]==='case-tasks')}><TasksPanel kase={kase} onChange={refresh} /><ExternalWorkPanel kase={kase} onChange={refresh} /><CaseWagesPanel kase={kase} /></CaseSection>
          <CaseSection id="case-blockers" title="موانع و پیگیری" note={`${faNum(kase.openBlockers)} مانع باز`} initialOpen={!(can('assessment.manage')||can('part.manage')||can('task.manage')||can('finance.payment')||can('qc.inspect'))&&kase.openBlockers>0}><BlockersPanel kase={kase} onChange={refresh} /></CaseSection>
          <CaseSection id="case-quality" title="کنترل کیفیت و تحویل" initialOpen={(!can('assessment.manage') && !can('part.manage') && !can('finance.payment') && can('qc.inspect'))||(!(can('assessment.manage')||can('part.manage')||can('task.manage')||can('finance.payment')||can('qc.inspect'))&&({assessment:'case-assessment',awaiting_approval:'case-assessment',awaiting_parts:'case-parts',in_repair:'case-tasks',quality_control:'case-quality',ready_for_delivery:'case-quality'} as Record<string,string>)[kase.stage]==='case-quality')}><CompletionPanel kase={kase} onChange={refresh} /></CaseSection>
        </div>

        <div className="stack">
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

          {active && <AlertsPanel caseId={kase.id} />}
          <CaseSection id="case-finance" title="مالی و تسویه" initialOpen={!can('assessment.manage') && !can('part.manage') && can('finance.payment')}><FinancePanel kase={kase} onChange={refresh} /></CaseSection>

          <CaseSection id="case-provenance" title="منبع و سابقه ورود اطلاعات"><ProvenancePanel kase={kase} /></CaseSection>

          {can('audit.read') && (
            <CaseSection id="case-history" title="تاریخچه تغییرات"><section className="panel">
              <div className="panel-head">
                <h2>تاریخچه</h2>
              </div>
              <div className="panel-body">
                <Timeline caseId={kase.id} version={kase.version + kase.tasks.reduce((s, t) => s + t.version, 0) + kase.blockers.length} />
              </div>
            </section>
            </CaseSection>
          )}
        </div>
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
