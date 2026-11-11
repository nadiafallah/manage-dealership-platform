'use client';
import useSWR from 'swr';
import { AUDIT_ACTION_LABELS, workingMinutesBetween, type CaseDetail, type Task, type TaskStatus, type TimelineEvent } from '@manage/shared';
import { fetcher } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { faNum, formatJalali } from '@/lib/format';
import { AppIcon, type IconName } from './AppIcon';

// «کار امروز» of the case folder (owner reference): the repair plan as a readable table and
// a short case history beside it. Full editing stays in the «برنامهٔ تعمیر» section below.
const DEPT_ICON: Record<string, IconName> = { body: 'hammer', paint: 'paint', mechanical: 'settings', electrical: 'battery', suspension: 'suspension', engine_tuning: 'gauge', assembly: 'wrench', qc: 'check' };
const STATUS: Record<TaskStatus, { label: string; tone: string; icon: IconName }> = {
  pending: { label: 'در انتظار شروع', tone: 'mute', icon: 'clock' },
  in_progress: { label: 'در حال انجام', tone: 'em', icon: 'spinner' },
  blocked: { label: 'متوقف', tone: 'stop', icon: 'alert' },
  done: { label: 'منتظر تأیید کارشناس', tone: 'wait', icon: 'flag' },
  approved: { label: 'تکمیل‌شده', tone: 'ok', icon: 'check' },
};

function duration(kase: CaseDetail, t: Task): string {
  if (!t.plannedStartAt || !t.plannedEndAt) return '—';
  if (kase.repairPlan) {
    const days = workingMinutesBetween(t.plannedStartAt, t.plannedEndAt, kase.repairPlan.calendar.calendar) / kase.repairPlan.dayMinutes;
    if (Number.isFinite(days) && days > 0) return `${faNum(Math.round(days * 4) / 4)} روز کاری`;
  }
  return `تا ${formatJalali(t.plannedEndAt)}`;
}

export function RepairPlanTable({ kase }: { kase: CaseDetail }) {
  if (!kase.tasks.length) return null;
  return (
    <section className="cf-plan" aria-labelledby="cf-plan-title">
      <h2 id="cf-plan-title"><AppIcon name="list" />برنامهٔ تعمیرات</h2>
      <div className="table-scroll">
        <table className="cf-table">
          <thead><tr><th scope="col">عملیات</th><th scope="col">تکنسین مسئول</th><th scope="col">مدت کار</th><th scope="col">وضعیت</th></tr></thead>
          <tbody>
            {kase.tasks.map((t) => {
              const st = STATUS[t.status];
              return (
                <tr key={t.id}>
                  <th scope="row"><span className="op"><AppIcon name={DEPT_ICON[t.department.code] ?? 'wrench'} />{t.title || t.department.name}{t.stationCode ? <small> · جایگاه {t.stationCode}</small> : null}</span></th>
                  <td>{t.technicianName ?? '—'}</td>
                  <td>{duration(kase, t)}</td>
                  <td><span className={`m-tag ${st.tone}`}><AppIcon name={st.icon} />{st.label}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** The latest events of the case in plain words (needs audit.read; otherwise nothing is shown). */
export function CaseHistoryCard({ kase, onAll }: { kase: CaseDetail; onAll: () => void }) {
  const { can } = useAuth();
  const version = kase.version + kase.tasks.reduce((s, t) => s + t.version, 0) + kase.blockers.length;
  const { data } = useSWR<TimelineEvent[]>(can('audit.read') ? `/cases/${kase.id}/timeline?v=${version}` : null, fetcher);
  if (!can('audit.read')) return null;
  const items = (data ?? []).slice(0, 6);
  return (
    <aside className="cf-history" aria-labelledby="cf-history-title">
      <h2 id="cf-history-title"><AppIcon name="history" />تاریخچهٔ پرونده</h2>
      {!data && <p className="muted small" role="status">در حال خواندن…</p>}
      <ol>
        {items.map((e) => (
          <li key={e.id}>
            <b>{formatJalali(e.occurredAt, { time: true })}</b>
            <span>{AUDIT_ACTION_LABELS[e.action] ?? e.action}{e.actor ? ` · ${e.actor.displayName}` : ''}</span>
          </li>
        ))}
      </ol>
      {(data?.length ?? 0) > items.length && <button type="button" className="cr-link light" onClick={onAll}>همهٔ تاریخچه</button>}
    </aside>
  );
}
