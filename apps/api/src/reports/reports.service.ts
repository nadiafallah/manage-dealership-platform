import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, isNull, like, lt, sql, type SQL } from 'drizzle-orm';
import {
  BLOCKER_REASON_LABELS,
  CASE_STAGES,
  DISCREPANCY_KIND_LABELS,
  DISCREPANCY_STATUS_LABELS,
  COVERAGE_LABELS,
  PART_STATUS_LABELS,
  REPORT_VIEW_LABELS,
  STAGE_LABELS,
  TASK_STATUS_LABELS,
  WORK_PRIORITIES,
  formatJalali,
  parseJalali,
  searchKey,
  toJalaliParts,
  toLatinDigits,
  type BlockerReason,
  type CaseStage,
  type PartStatus,
  type ReportKpi,
  type ReportQuery,
  type ReportResult,
  type ReportView,
  type TaskStatus,
  type WorkItem,
  type WorkPriority,
} from '@manage/shared';
import type { Actor } from '../auth/auth.types';
import { caseSql } from '../cases/cases.service';
import { badRequest, forbidden } from '../common/errors';
import { DATABASE, type DatabaseHandle } from '../db/database';
import { DiscrepanciesService } from '../discrepancies/discrepancies.service';
import { cases, departments, partRequests, tasks, tenants, users, vehicles } from '../db/schema';

// Definitions: docs/REPORTS_FA.md. Every figure is computed here from the
// operational tables, scoped to the actor's dealership; the web app only
// renders. Current-state figures use active cases (open, not delivered).

const DAY = 86_400_000;
const SOON_MS = 48 * 3_600_000;
const STALE_FOLLOW_UP_MS = 24 * 3_600_000;
export const MAX_EXPORT_ROWS = 5000;
const PART_STOP_REASONS: BlockerReason[] = ['part_not_arrived', 'part_wrong_or_defective'];
const AGE_BUCKETS: [number, number, string][] = [
  [0, 3, '۰ تا ۳ روز'],
  [4, 7, '۴ تا ۷ روز'],
  [8, 14, '۸ تا ۱۴ روز'],
  [15, 30, '۱۵ تا ۳۰ روز'],
  [31, Infinity, 'بیش از ۳۰ روز'],
];

/** Who may open which view (the API decides; the web app only hides tabs). */
export function allowedViews(permissions: Set<string>): ReportView[] {
  const views: ReportView[] = [];
  if (permissions.has('report.manager')) return ['manager','parts','accident','workshop'];
  if (permissions.has('part.manage')) views.push('parts');
  if (permissions.has('case.update')) views.push('accident');
  if (permissions.has('task.manage') || permissions.has('qc.inspect')) views.push('workshop');
  return views;
}

/** Tehran midnight of the day containing `d`. */
export function tehranDayStart(d: Date): Date {
  const p = toJalaliParts(d);
  return parseJalali(`${p.jy}/${p.jm}/${p.jd}`)!;
}

/**
 * Period bounds [from, to) in UTC. Current periods end now; the previous
 * period has the same length directly before (never a full period compared
 * with an incomplete one).
 */
export function periodRange(q: Pick<ReportQuery, 'period' | 'from' | 'to'>, now = new Date()) {
  let from: Date;
  let to = now;
  let label: string;
  const today = tehranDayStart(now);
  switch (q.period) {
    case 'today':
      from = today;
      label = 'امروز';
      break;
    case 'week': {
      // Iranian week starts on Saturday.
      const dow = new Date(today.getTime() + 210 * 60_000).getUTCDay();
      from = new Date(today.getTime() - ((dow + 1) % 7) * DAY);
      label = 'این هفته (از شنبه)';
      break;
    }
    case 'month': {
      const p = toJalaliParts(now);
      from = parseJalali(`${p.jy}/${p.jm}/1`)!;
      label = 'این ماه';
      break;
    }
    case 'custom': {
      const a = q.from && parseJalali(toLatinDigits(q.from).replace(/-/g, '/'));
      const b = q.to && parseJalali(toLatinDigits(q.to).replace(/-/g, '/'));
      if (!a || !b) throw badRequest('INVALID_PERIOD', 'برای بازه دلخواه، تاریخ شروع و پایان معتبر وارد کنید');
      if (b < a) throw badRequest('INVALID_PERIOD', 'تاریخ پایان باید بعد از تاریخ شروع باشد');
      if (b.getTime() - a.getTime() > 366 * DAY) throw badRequest('INVALID_PERIOD', 'بازه حداکثر یک سال است');
      from = a;
      to = new Date(b.getTime() + DAY);
      label = `${formatJalali(a.toISOString())} تا ${formatJalali(b.toISOString())}`;
      break;
    }
  }
  const length = to.getTime() - from.getTime();
  return { from, to, label, previousFrom: new Date(from.getTime() - length), previousTo: from };
}

/** Priority of a due time in Tehran days, with the reason shown on the row. */
export function priorityOf(due: Date | null, now = new Date()): { priority: WorkPriority; reason: string } {
  if (!due) return { priority: 'none', reason: 'بدون موعد' };
  const diff = due.getTime() - now.getTime();
  if (diff < 0) {
    const days = Math.floor(-diff / DAY);
    return { priority: 'overdue', reason: days ? `موعد ${days} روز گذشته` : 'موعد امروز گذشته' };
  }
  const tomorrow = new Date(tehranDayStart(now).getTime() + DAY);
  if (due < tomorrow) return { priority: 'today', reason: 'موعد امروز' };
  if (diff <= SOON_MS) return { priority: 'soon', reason: 'موعد تا ۴۸ ساعت آینده' };
  return { priority: 'later', reason: `موعد ${Math.ceil(diff / DAY)} روز دیگر` };
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
};

type BaseCase = Awaited<ReturnType<ReportsService['baseCases']>>[number];

@Injectable()
export class ReportsService {
  constructor(
    @Inject(DATABASE) private readonly handle: DatabaseHandle,
    private readonly discrepancies: DiscrepanciesService,
  ) {}

  private get db() {
    return this.handle.db;
  }

  async report(actor: Actor, q: ReportQuery, opts: { allItems?: boolean } = {}): Promise<ReportResult> {
    if (!allowedViews(actor.user.permissions).includes(q.view)) {
      throw forbidden('این گزارش برای نقش شما فعال نیست');
    }
    const now = new Date();
    const period = periodRange(q, now);
    const tenantId = actor.user.tenantId;
    const [tenant] = await this.db.select({ isTest: tenants.isTest }).from(tenants).where(eq(tenants.id, tenantId));
    const base = await this.baseCases(actor, q);

    let built: { kpis: ReportKpi[]; charts: ReportResult['charts']; items: WorkItem[] };
    switch (q.view) {
      case 'manager':
        built = await this.managerView(base, now, period, tenantId, q);
        break;
      case 'parts':
        built = await this.partsView(base, q, now);
        break;
      case 'accident':
        built = this.accidentView(base, now);
        break;
      case 'workshop':
        built = await this.workshopView(base, q, now);
        break;
    }

    if (q.view === 'manager' || q.view === 'parts') built.items.push(...(await this.discrepancyItems(actor, base, now)));
    if(q.stationCode) {
      const scoped=(query:string)=>{const params=new URLSearchParams(query);params.set('stationCode',q.stationCode!);return params.toString();};
      built.kpis=built.kpis.map(k=>k.listQuery===undefined?k:{...k,listQuery:scoped(k.listQuery)});
      built.charts=built.charts.map(chart=>({...chart,bars:chart.bars.map(b=>b.listQuery===undefined?b:{...b,listQuery:scoped(b.listQuery)})}));
    }
    const events = q.view === 'manager' || q.view === 'accident' ? await this.events(tenantId, q, period) : [];
    const kinds = new Map<string, { label: string; count: number }>();
    for (const i of built.items) kinds.set(i.kind, { label: i.kindLabel, count: (kinds.get(i.kind)?.count ?? 0) + 1 });
    const filtered = built.items
      .filter((i) => !q.kind || i.kind === q.kind)
      .sort(
        (a, b) =>
          WORK_PRIORITIES.indexOf(a.priority) - WORK_PRIORITIES.indexOf(b.priority) ||
          (a.dueAt ?? '9').localeCompare(b.dueAt ?? '9') ||
          a.caseNumber.localeCompare(b.caseNumber),
      );
    const pageSize = opts.allItems ? MAX_EXPORT_ROWS : q.pageSize;
    const page = opts.allItems ? 1 : q.page;

    return {
      view: q.view,
      generatedAt: now.toISOString(),
      isTestData: !!tenant?.isTest,
      period: {
        key: q.period,
        from: period.from.toISOString(),
        to: period.to.toISOString(),
        label: period.label,
        previousFrom: period.previousFrom.toISOString(),
        previousTo: period.previousTo.toISOString(),
      },
      filters: await this.filterLabels(actor, q),
      kpis: built.kpis,
      charts: built.charts,
      events,
      items: {
        rows: filtered.slice((page - 1) * pageSize, page * pageSize),
        total: filtered.length,
        page,
        pageSize,
        kinds: [...kinds].map(([kind, v]) => ({ kind, ...v })),
      },
    };
  }

  // ------------------------------------------------------------- base data

  /** Active cases of the dealership matching the case-level filters. */
  private async baseCases(actor: Actor, q: ReportQuery) {
    const conditions: SQL[] = [eq(cases.tenantId, actor.user.tenantId), caseSql.active];
    if (q.responsibleUserId === 'me') conditions.push(eq(cases.responsibleUserId, actor.user.id));
    else if (q.responsibleUserId === 'none') conditions.push(isNull(cases.responsibleUserId));
    else if (q.responsibleUserId) conditions.push(eq(cases.responsibleUserId, q.responsibleUserId));
    if(q.stationCode)conditions.push(sql`exists (select 1 from tasks t where t.case_id = ${cases.id} and t.tenant_id = ${cases.tenantId} and t.station_snapshot->>'code' = ${q.stationCode})`);
    if (q.stage) conditions.push(eq(cases.stage, q.stage));
    if (q.coverage) conditions.push(eq(cases.coverageType, q.coverage));
    if (q.blockerReason) {
      conditions.push(sql`exists (select 1 from blockers b where b.case_id = ${cases.id} and b.resolved_at is null and b.reason = ${q.blockerReason})`);
    }
    if (q.q) {
      const key = searchKey(q.q).replace(/[%_\\]/g, '\\$&');
      if (key) conditions.push(like(cases.searchText, `%${key}%`));
    }
    return this.db
      .select({
        id: cases.id,
        caseNumber: cases.caseNumber,
        admissionNo: cases.admissionNo,
        stage: cases.stage,
        coverageType: cases.coverageType,
        vehicleId: cases.vehicleId,
        plate: vehicles.plate,
        model: vehicles.model,
        brand: vehicles.brand,
        responsibleUserId: cases.responsibleUserId,
        responsibleName: users.displayName,
        admittedAt: cases.admittedAt,
        officialDeadlineAt: cases.officialDeadlineAt,
        forecastDeliveryAt: cases.forecastDeliveryAt,
        missingFields: cases.missingFields,
        isLegacyEntry: cases.isLegacyEntry,
        origin: cases.origin,
        createdAt: cases.createdAt,
        openReasons: sql<string[]>`coalesce((select array_agg(distinct b.reason) from blockers b where b.case_id = ${cases.id} and b.resolved_at is null), '{}')`,
        firstOpenBlockerAt: sql<Date | null>`(select min(b.occurred_at) from blockers b where b.case_id = ${cases.id} and b.resolved_at is null)`,
        staleBlockers: sql<number>`(select count(*)::int from blockers b where b.case_id = ${cases.id} and b.resolved_at is null and coalesce(b.last_follow_up_at, b.recorded_at) < now() - interval '24 hours')`,
        lastStageChangeAt: sql<Date | null>`(select max(a.occurred_at) from audit_events a where a.case_id = ${cases.id} and a.action = 'case.stage_changed')`,
        hasFinalAssessment: sql<boolean>`exists (select 1 from assessments a where a.case_id = ${cases.id} and a.status = 'final')`,
        authorizationPending: sql<boolean>`exists (select 1 from part_quotes q where q.case_id = ${cases.id} and q.tenant_id = ${cases.tenantId} and q.status = 'pending')`,
        activeStationCodes:sql<string[]>`coalesce((select array_agg(distinct t.station_snapshot->>'code') from tasks t where t.case_id = ${cases.id} and t.tenant_id = ${cases.tenantId} and t.status in ('in_progress','blocked','done') and t.station_snapshot->>'code' is not null),'{}')`,
        financeProposals: sql<number>`(select count(*)::int from financial_approvals f where f.case_id = ${cases.id} and f.status = 'proposed')`,
      })
      .from(cases)
      .innerJoin(vehicles, eq(vehicles.id, cases.vehicleId))
      .leftJoin(users, eq(users.id, cases.responsibleUserId))
      .where(and(...conditions));
  }

  /** A work-list row; the due time is the row's own (part ETA, planned end, follow-up) or else the case commitment. */
  private item(
    c: BaseCase,
    fields: Omit<WorkItem, 'caseId' | 'caseNumber' | 'plate' | 'vehicleLabel' | 'priority' | 'priorityReason' | 'dueAt' | 'dueLabel' | 'responsible'>,
    now: Date,
    own?: { at: Date | null; label: string },
  ): WorkItem {
    const due = own ? own.at : commitmentOf(c);
    const p = priorityOf(due, now);
    return {
      caseId: c.id,
      caseNumber: c.caseNumber,
      admissionNo: c.admissionNo,
      plate: c.plate,
      vehicleLabel: [c.brand, c.model].filter(Boolean).join(' ') || 'خودرو',
      responsible: c.responsibleUserId ? { id: c.responsibleUserId, displayName: c.responsibleName ?? '' } : null,
      priority: p.priority,
      priorityReason: p.reason,
      dueLabel: due ? (own ? own.label : c.officialDeadlineAt ? 'مهلت رسمی' : 'پیش‌بینی تحویل') : null,
      stationCodes:c.activeStationCodes,
      ...fields,
      dueAt: due ? due.toISOString() : null,
    };
  }

  // ----------------------------------------------------------- manager view

  private async managerView(base: BaseCase[], now: Date, period: ReturnType<typeof periodRange>, tenantId: string, q: ReportQuery) {
    const blocked = base.filter((c) => c.openReasons.length);
    const kpis: ReportKpi[] = [
      kpi('active', 'پرونده‌های فعال', 'پرونده', base.length, 'پرونده باز که تحویل نشده است', ''),
      kpi('vehicles', 'خودروهای موجود', 'خودرو', new Set(base.map((c) => c.vehicleId)).size, 'خودروهای متمایز پرونده‌های فعال', ''),
      kpi('overdue_official', 'عبور از مهلت رسمی', 'پرونده', base.filter((c) => c.officialDeadlineAt && c.officialDeadlineAt < now).length, 'مهلت رسمی ثبت‌شده گذشته است', 'flag=overdue_official'),
      kpi('overdue_forecast', 'عبور از پیش‌بینی', 'پرونده', base.filter((c) => c.forecastDeliveryAt && c.forecastDeliveryAt < now).length, 'پیش‌بینی داخلی ثبت‌شده گذشته است (جدا از مهلت رسمی)', 'flag=overdue_forecast'),
      kpi('blocked', 'دارای مانع', 'پرونده', blocked.length, 'حداقل یک مانع باز', 'flag=blocked'),
      kpi('ready', 'آماده تحویل', 'پرونده', base.filter((c) => c.stage === 'ready_for_delivery').length, 'مرحله «آماده تحویل»', 'flag=ready'),
    ];

    const stageBars = CASE_STAGES.filter((s) => s !== 'delivered').map((s) => ({
      key: s,
      label: STAGE_LABELS[s],
      value: base.filter((c) => c.stage === s).length,
      listQuery: `stage=${s}`,
    }));
    const reasonCounts = new Map<string, number>();
    for (const c of blocked) for (const r of c.openReasons) reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1);
    const reasonBars = [...reasonCounts]
      .sort((a, b) => b[1] - a[1])
      .map(([r, v]) => ({ key: r, label: BLOCKER_REASON_LABELS[r as BlockerReason], value: v, listQuery: `blockerReason=${r}` }));

    const ages = base.map((c) => Math.floor((now.getTime() - c.admittedAt.getTime()) / DAY));
    const ageBars = AGE_BUCKETS.map(([lo, hi, label]) => ({ key: `${lo}`, label, value: ages.filter((a) => a >= lo && a <= hi).length }));

    // Time in the current stage needs a recorded entry into it.
    const known = base.filter((c) => c.lastStageChangeAt || (!c.isLegacyEntry && c.origin === 'manual'));
    const inStageBars = CASE_STAGES.filter((s) => s !== 'delivered')
      .map((s) => {
        const days = known
          .filter((c) => c.stage === s)
          .map((c) => Math.floor((now.getTime() - new Date(c.lastStageChangeAt ?? c.createdAt).getTime()) / DAY));
        return { key: s, label: `${STAGE_LABELS[s]} (${days.length} نمونه)`, value: median(days), listQuery: `stage=${s}` };
      })
      .filter((b) => !b.label.includes('(0 نمونه)'));

    const trend = await this.trend(tenantId, q, period);

    const items: WorkItem[] = [];
    for (const c of base) {
      if (c.financeProposals) {
        items.push(this.item(c, { kind: 'finance', kindLabel: 'تصمیم مالی', description: `${c.financeProposals} پیشنهاد مالی منتظر تصمیم`, status: 'منتظر تصمیم مدیر', stoppedBy: null, nextAction: 'بررسی و تأیید یا رد پیشنهاد مالی' }, now, { at: null, label: '' }));
      }
      if (c.staleBlockers) {
        items.push(this.item(c, { kind: 'stale_blocker', kindLabel: 'مانع بدون پیگیری', description: `${c.staleBlockers} مانع بیش از ۲۴ ساعت بدون پیگیری`, status: 'بدون پیگیری', stoppedBy: c.openReasons.map((r) => BLOCKER_REASON_LABELS[r as BlockerReason]).join('، '), nextAction: 'پیگیری یا تعیین مسئول رفع مانع' }, now, { at: c.firstOpenBlockerAt ? new Date(new Date(c.firstOpenBlockerAt).getTime() + STALE_FOLLOW_UP_MS) : null, label: 'مهلت پیگیری (۲۴ ساعت)' }));
      }
      if (!c.responsibleUserId) {
        items.push(this.item(c, { kind: 'unassigned', kindLabel: 'بدون مسئول', description: 'مسئول پرونده تعیین نشده', status: STAGE_LABELS[c.stage as CaseStage], stoppedBy: null, nextAction: 'تعیین مسئول پرونده' }, now));
      }
      if (c.officialDeadlineAt && c.officialDeadlineAt < now) {
        items.push(this.item(c, { kind: 'overdue_official', kindLabel: 'عبور از مهلت رسمی', description: 'مهلت رسمی گذشته است', status: STAGE_LABELS[c.stage as CaseStage], stoppedBy: reasonsText(c), nextAction: c.openReasons.length ? 'تصمیم برای رفع مانع' : 'بررسی برنامه و اطلاع به مشتری' }, now));
      }
    }

    const charts: ReportResult['charts'] = [
      { key: 'stages', title: 'توزیع پرونده‌های فعال در مراحل', unit: 'پرونده', kind: 'bar', bars: stageBars },
      { key: 'blockers', title: 'علت توقف', unit: 'پرونده (هر علت جدا)', kind: 'bar', bars: reasonBars, note: 'پرونده با چند علت در هر علت یک بار شمرده می‌شود؛ جمع ستون‌ها می‌تواند از تعداد پرونده‌های دارای مانع بیشتر باشد.' },
      {
        key: 'completeness',
        title: 'کامل‌بودن داده',
        unit: 'پرونده',
        kind: 'bar',
        bars: [
          { key: 'unassigned', label: 'بدون مسئول', value: base.filter((c) => !c.responsibleUserId).length, listQuery: 'flag=unassigned' },
          { key: 'no_deadline', label: 'بدون موعد', value: base.filter((c) => !c.officialDeadlineAt && !c.forecastDeliveryAt).length, listQuery: 'flag=no_deadline' },
          { key: 'needs_completion', label: 'نیازمند تکمیل اطلاعات', value: base.filter((c) => c.missingFields.length).length, listQuery: 'flag=needs_completion' },
        ],
      },
      { key: 'age', title: 'سن پرونده‌های باز (از پذیرش واقعی)', unit: 'پرونده', kind: 'bar', bars: ageBars },
      {
        key: 'in_stage',
        title: 'ماندن در مرحله فعلی (میانه روز)',
        unit: 'روز',
        kind: 'bar',
        bars: inStageBars,
        excluded: { count: base.length - known.length, reason: 'زمان ورود به مرحله فعلی ثبت نشده (واردشده از اکسل یا ثبت سوابق موجود)' },
      },
      trend,
    ];
    return { kpis, charts, items };
  }

  /** Admissions and deliveries per Tehran day (≤31 days) or per week, from real event times only. */
  private async trend(tenantId: string, q: ReportQuery, period: ReturnType<typeof periodRange>): Promise<ReportResult['charts'][number]> {
    const start = tehranDayStart(period.from);
    const step = period.to.getTime() - start.getTime() > 31 * DAY ? 7 * DAY : DAY;
    const buckets: Date[] = [];
    for (let t = start.getTime(); t < period.to.getTime(); t += step) buckets.push(new Date(t));
    const scope = and(
      eq(cases.tenantId, tenantId),
      ...(q.stationCode?[sql`exists (select 1 from tasks t where t.case_id = ${cases.id} and t.tenant_id = ${cases.tenantId} and t.station_snapshot->>'code' = ${q.stationCode})`]:[]),
      ...(q.responsibleUserId && !['me', 'none'].includes(q.responsibleUserId) ? [eq(cases.responsibleUserId, q.responsibleUserId)] : []),
    );
    const times = async (col: typeof cases.admittedAt | typeof cases.actualDeliveryAt) =>
      (await this.db.select({ t: col }).from(cases).where(and(scope, gte(col, period.from), lt(col, period.to)))).map((r) => r.t!.getTime());
    const [admitted, delivered] = [await times(cases.admittedAt), await times(cases.actualDeliveryAt)];
    const per = (xs: number[]) => buckets.map((b) => xs.filter((x) => x >= b.getTime() && x < b.getTime() + step).length);
    const a = per(admitted);
    return {
      key: 'trend',
      title: step === DAY ? 'روند پذیرش و تحویل (روزانه)' : 'روند پذیرش و تحویل (هفتگی)',
      unit: 'پرونده',
      kind: 'trend',
      bars: buckets.map((b, i) => ({ key: b.toISOString(), label: formatJalali(b.toISOString()), value: a[i]! })),
      series: [
        { label: 'پذیرش', values: a },
        { label: 'تحویل', values: per(delivered) },
      ],
      note: 'پذیرش بر مبنای «پذیرش واقعی» و تحویل بر مبنای «تحویل واقعی»؛ پرونده با تاریخ بدون ساعت در همان روز شمرده می‌شود.',
    };
  }

  // -------------------------------------------------------------- parts view

  private async partsView(base: BaseCase[], q: ReportQuery, now: Date) {
    const byId = new Map(base.map((c) => [c.id, c]));
    const rows = base.length
      ? await this.db
          .select({
            p: partRequests,
            authorized: sql<boolean | null>`(select i.approval_status = 'approved' from assessment_items i where i.id = ${partRequests.assessmentItemId})`,
            financeGateOpen: sql<boolean>`not exists (select 1 from blockers b where b.case_id = ${partRequests.caseId} and b.resolved_at is null and b.reason = 'financial')`,
          })
          .from(partRequests)
          .where(
            and(
              inArray(partRequests.caseId, [...byId.keys()]),
              inArray(partRequests.status, ['needed', 'reserved', 'ordered', 'received', 'rejected']),
              ...(q.partStatus ? [eq(partRequests.status, q.partStatus)] : []),
            ),
          )
      : [];

    const groups: Record<string, { label: string; rows: typeof rows }> = {
      unchecked: { label: 'بدون تعیین تکلیف', rows: [] },
      to_order: { label: 'نیازمند سفارش', rows: [] },
      overdue: { label: 'سفارش دیرکرد', rows: [] },
      awaiting_supply: { label: 'منتظر تأمین', rows: [] },
      to_hand_over: { label: 'رسیده، منتظر تحویل به واحد', rows: [] },
    };
    for (const r of rows) {
      const s = r.p.status as PartStatus;
      if (s === 'needed' && r.p.inStock === null) groups.unchecked!.rows.push(r);
      else if (s === 'needed' || s === 'rejected') groups.to_order!.rows.push(r);
      else if (s === 'ordered' && r.p.etaAt && r.p.etaAt < now) groups.overdue!.rows.push(r);
      else if (s === 'ordered') groups.awaiting_supply!.rows.push(r);
      else groups.to_hand_over!.rows.push(r);
    }
    const qty = (rs: typeof rows) => rs.reduce((n, r) => n + r.p.quantity, 0);
    const stopped = base.filter((c) => c.openReasons.some((r) => PART_STOP_REASONS.includes(r as BlockerReason)));
    const kpis: ReportKpi[] = [
      ...Object.entries(groups).map(([k, g]) => ({ ...kpi(k, g.label, 'درخواست قطعه', g.rows.length, PART_DEFINITIONS[k]!, undefined, k), quantity: qty(g.rows) })),
      kpi('stopped_by_parts', 'خودروهای متوقف به علت قطعه', 'پرونده', stopped.length, 'مانع باز «قطعه نرسیده» یا «قطعه اشتباه/معیوب»', 'blockerReason=part_not_arrived'),
    ];

    const items: WorkItem[] = [];
    for (const [kind, g] of Object.entries(groups)) {
      for (const r of g.rows) {
        const c = byId.get(r.p.caseId)!;
        const s = r.p.status as PartStatus;
        let status: string = PART_STATUS_LABELS[s];
        let next = 'بررسی موجودی';
        if (kind === 'to_order') {
          if (r.authorized === false) {
            status = 'نیازمند بررسی کارشناسی';
            next = 'بررسی نیاز فعلی قطعه';
          } else if (!r.financeGateOpen) {
            status = 'مانع مالی';
            next = 'پیگیری تأیید یا دریافت مالی';
          } else {
            status = s === 'rejected' ? 'اشتباه/معیوب — سفارش دوباره' : 'نیاز تأییدشده خرید';
            next = 'ثبت سفارش';
          }
        } else if (kind === 'overdue' || kind === 'awaiting_supply') next = 'پیگیری تأمین‌کننده';
        else if (kind === 'to_hand_over') next = 'تحویل به واحد تعمیر';
        items.push(
          this.item(
            c,
            {
              kind,
              kindLabel: g.label,
              partId: r.p.id,
              description: r.p.description,
              partNumber: r.p.partNumber,
              quantity: r.p.quantity,
              status,
              stoppedBy: reasonsText(c),
              nextAction: next,
            },
            now,
            s === 'ordered' ? { at: r.p.etaAt ?? null, label: 'زمان رسیدن قطعه' } : undefined,
          ),
        );
      }
    }
    for (const c of stopped) {
      items.push(this.item(c, { kind: 'stopped_by_parts', kindLabel: 'خودروی متوقف به علت قطعه', description: 'تعمیر به علت قطعه متوقف است', status: STAGE_LABELS[c.stage as CaseStage], stoppedBy: reasonsText(c), nextAction: 'پیگیری قطعه و رفع مانع' }, now));
    }
    const charts: ReportResult['charts'] = [
      { key: 'parts', title: 'درخواست‌های قطعه بر اساس وضعیت کار', unit: 'درخواست قطعه', kind: 'bar', bars: Object.entries(groups).map(([k, g]) => ({ key: k, label: g.label, value: g.rows.length, itemKind: k })) },
    ];
    return { kpis, charts, items };
  }

  // ----------------------------------------------------------- accident view

  private accidentView(base: BaseCase[], now: Date) {
    const commitment = (c: BaseCase) => commitmentOf(c);
    const waitingAssessment = base.filter((c) => c.authorizationPending || (['reception', 'assessment'].includes(c.stage) && !c.hasFinalAssessment));
    const incomplete = base.filter((c) => !c.responsibleUserId || c.missingFields.length);
    const overdue = base.filter((c) => commitment(c) && commitment(c)! < now);
    const soon = base.filter((c) => commitment(c) && commitment(c)! >= now && commitment(c)!.getTime() - now.getTime() <= SOON_MS);
    const stopped = base.filter((c) => c.openReasons.length);
    const kpis: ReportKpi[] = [
      kpi('active', 'پرونده‌های فعال (در فیلتر)', 'پرونده', base.length, 'پرونده‌های فعال با فیلتر مسئول', ''),
      kpi('assessment', 'کارشناسی یا تأیید قیمت بازار', 'پرونده', waitingAssessment.length, 'بدون کارشناسی نهایی یا تأیید قیمت بازار منتظر', undefined, 'assessment'),
      kpi('incomplete', 'بدون مسئول یا نیازمند تکمیل', 'پرونده', incomplete.length, 'بدون مسئول یا دارای فیلد ناقص', undefined, 'incomplete'),
      kpi('overdue', 'موعد گذشته', 'پرونده', overdue.length, 'مهلت رسمی، یا در نبود آن پیش‌بینی، گذشته', 'flag=overdue'),
      kpi('due_soon', 'موعد ۴۸ ساعت آینده', 'پرونده', soon.length, 'همان موعد در ۴۸ ساعت آینده', 'flag=due_soon'),
      kpi('stopped', 'متوقف', 'پرونده', stopped.length, 'حداقل یک مانع باز', 'flag=blocked'),
    ];
    const items = base.map((c) => {
      const kind = c.openReasons.length ? 'stopped' : waitingAssessment.includes(c) ? 'assessment' : incomplete.includes(c) ? 'incomplete' : c.stage === 'ready_for_delivery' ? 'ready' : 'follow_up';
      return this.item(c, {
        kind,
        kindLabel: ACCIDENT_KIND_LABELS[kind]!,
        description: `${STAGE_LABELS[c.stage as CaseStage]} — ${COVERAGE_LABELS[c.coverageType as keyof typeof COVERAGE_LABELS]}`,
        status: STAGE_LABELS[c.stage as CaseStage],
        stoppedBy: reasonsText(c),
        nextAction: c.openReasons.length ? `رفع مانع: ${reasonsText(c)}` : c.authorizationPending ? 'پیگیری تأیید قیمت خرید بیرون' : !c.responsibleUserId ? 'تعیین مسئول' : c.missingFields.length ? 'تکمیل اطلاعات پرونده' : NEXT_BY_STAGE[c.stage as CaseStage],
      }, now);
    });
    const charts: ReportResult['charts'] = [
      { key: 'stages', title: 'پرونده‌ها در مراحل', unit: 'پرونده', kind: 'bar', bars: CASE_STAGES.filter((s) => s !== 'delivered').map((s) => ({ key: s, label: STAGE_LABELS[s], value: base.filter((c) => c.stage === s).length, listQuery: `stage=${s}` })) },
    ];
    return { kpis, charts, items };
  }

  // ----------------------------------------------------------- workshop view

  private async workshopView(base: BaseCase[], q: ReportQuery, now: Date) {
    const byId = new Map(base.map((c) => [c.id, c]));
    const rows = base.length
      ? await this.db
          .select({
            t: tasks,
            dept: departments.name,
            blockedSince: sql<Date | null>`(select min(b.occurred_at) from blockers b where b.task_id = ${tasks.id} and b.resolved_at is null)`,
            blockReason: sql<string | null>`(select b.reason from blockers b where b.task_id = ${tasks.id} and b.resolved_at is null order by b.occurred_at limit 1)`,
          })
          .from(tasks)
          .innerJoin(departments, eq(departments.id, tasks.departmentId))
          .where(and(inArray(tasks.caseId, [...byId.keys()]),...(q.stationCode?[sql`${tasks.stationSnapshot}->>'code' = ${q.stationCode}`]:[]), ...(q.departmentId ? [eq(tasks.departmentId, q.departmentId)] : [])))
      : [];
    const open = rows.filter((r) => r.t.status !== 'approved');
    const by = (s: TaskStatus) => open.filter((r) => r.t.status === s);
    const corrective = open.filter((r) => r.t.qcInspectionId);
    // Ready for QC: every activity approved and no QC round after the last change.
    const qcCandidates = base.filter((c) => {
      const ts = rows.filter((r) => r.t.caseId === c.id);
      return ts.length > 0 && ts.every((r) => r.t.status === 'approved') && ['in_repair', 'quality_control'].includes(c.stage);
    });
    const qcIds = qcCandidates.map((c) => c.id);
    const passed = qcIds.length
      ? await this.db.execute<{ case_id: string }>(
          sql`select q.case_id from qc_inspections q where q.case_id in (${sql.join(qcIds.map((id) => sql`${id}`), sql`, `)}) and q.outcome = 'passed' and q.created_at >= (select max(t.updated_at) from tasks t where t.case_id = q.case_id)`,
        )
      : { rows: [] };
    const passedIds = new Set(((passed as { rows?: { case_id: string }[] }).rows ?? (passed as unknown as { case_id: string }[])).map((r) => r.case_id));
    const readyForQc = qcCandidates.filter((c) => !passedIds.has(c.id));

    const kpis: ReportKpi[] = [
      kpi('pending', 'محول‌شده (شروع‌نشده)', 'فعالیت', by('pending').length, 'فعالیت در انتظار', undefined, 'pending'),
      kpi('in_progress', 'در حال انجام', 'فعالیت', by('in_progress').length, 'شروع‌شده', undefined, 'in_progress'),
      kpi('blocked', 'متوقف', 'فعالیت', by('blocked').length, 'دارای مانع باز؛ مدت از زمان بروز مانع', undefined, 'blocked'),
      kpi('done', 'منتظر تأیید تحویل', 'فعالیت', by('done').length, 'اتمام ثبت‌شده، تأییدنشده', undefined, 'done'),
      kpi('ready_for_qc', 'آماده کنترل کیفیت', 'خودرو', readyForQc.length, 'همه فعالیت‌ها تأیید شده و کنترل کیفیت معتبر ندارد', undefined, 'ready_for_qc'),
      kpi('corrective', 'کار اصلاحی کنترل کیفیت', 'فعالیت', corrective.length, 'فعالیت ساخته‌شده از ردشدن کنترل کیفیت، تأییدنشده', undefined, 'corrective'),
    ];
    const items: WorkItem[] = open.map((r) => {
      const c = byId.get(r.t.caseId)!;
      const s = r.t.status as TaskStatus;
      const kind = r.t.qcInspectionId ? 'corrective' : s;
      const blockedDays = r.blockedSince ? Math.floor((now.getTime() - new Date(r.blockedSince).getTime()) / DAY) : null;
      return this.item(
        c,
        {
          kind,
          kindLabel: kind === 'corrective' ? 'کار اصلاحی کنترل کیفیت' : TASK_STATUS_LABELS[s],
          taskId: r.t.id,
          stationCodes:r.t.stationSnapshot?.code?[r.t.stationSnapshot.code]:[],
          description: `${r.dept}${r.t.title ? ` — ${r.t.title}` : ''}${r.t.technicianName ? ` (${r.t.technicianName})` : ''}`,
          status: TASK_STATUS_LABELS[s],
          stoppedBy: r.blockReason ? `${BLOCKER_REASON_LABELS[r.blockReason as BlockerReason]}${blockedDays !== null ? ` — ${blockedDays} روز` : ''}` : null,
          nextAction: s === 'pending' ? 'شروع کار' : s === 'in_progress' ? 'ثبت اتمام' : s === 'blocked' ? 'پیگیری رفع مانع' : 'تأیید تحویل کارشناس تصادفات',
        },
        now,
        r.t.plannedEndAt ? { at: r.t.plannedEndAt, label: 'پایان برنامه‌ای' } : undefined,
      );
    });
    for (const c of readyForQc) {
      items.push(this.item(c, { kind: 'ready_for_qc', kindLabel: 'آماده کنترل کیفیت', description: 'همه فعالیت‌ها تأیید شده‌اند', status: STAGE_LABELS[c.stage as CaseStage], stoppedBy: null, nextAction: 'ثبت کنترل کیفیت' }, now));
    }
    const deptBars = new Map<string, { label: string; value: number; id: string }>();
    for (const r of open) {
      const d = deptBars.get(r.t.departmentId) ?? { label: r.dept, value: 0, id: r.t.departmentId };
      d.value += 1;
      deptBars.set(r.t.departmentId, d);
    }
    const charts: ReportResult['charts'] = [
      { key: 'departments', title: 'فعالیت‌های باز به تفکیک واحد', unit: 'فعالیت', kind: 'bar', bars: [...deptBars.values()].map((d) => ({ key: d.id, label: d.label, value: d.value, reportQuery: `departmentId=${d.id}` })), note: 'تعداد کار بالا به‌تنهایی نشانه عملکرد ضعیف نیست؛ ظرفیت و نفرساعت ثبت نمی‌شود.' },
    ];
    return { kpis, charts, items };
  }

  /** Open and in-review parts discrepancies of the filtered cases (the queue itself is GET /part-discrepancies). */
  private async discrepancyItems(actor: Actor, base: BaseCase[], now: Date): Promise<WorkItem[]> {
    const byId = new Map(base.map((c) => [c.id, c]));
    const open = (await this.discrepancies.list(actor, { status: 'active' })).filter((d) => byId.has(d.caseId));
    return open.map((d) =>
      this.item(
        byId.get(d.caseId)!,
        {
          kind: 'discrepancy',
          kindLabel: 'مغایرت قطعه',
          partId: d.part?.id,
          description: `${DISCREPANCY_KIND_LABELS[d.kind]}${d.part ? `: ${d.part.description}` : ''}`,
          partNumber: d.part?.partNumber ?? null,
          quantity: d.part?.quantity,
          status: DISCREPANCY_STATUS_LABELS[d.status],
          stoppedBy: d.detail,
          nextAction: d.assignee ? `بررسی و ثبت نتیجه (${d.assignee.displayName})` : 'تعیین مسئول بررسی',
        },
        now,
        { at: null, label: '' },
      ),
    );
  }

  // ----------------------------------------------------------------- events

  private async events(tenantId: string, q: ReportQuery, period: ReturnType<typeof periodRange>) {
    const filterUser = q.responsibleUserId && q.responsibleUserId !== 'me' && q.responsibleUserId !== 'none' ? q.responsibleUserId : null;
    // Phase 3: an event belongs to whoever was responsible when it happened (case_responsibility_periods);
    // a case without recorded periods keeps its current responsible from admission onwards.
    const responsible = (column: 'admitted_at' | 'actual_delivery_at') =>
      filterUser
        ? sql`and coalesce((select p.user_id from case_responsibility_periods p where p.case_id = c.id and p.tenant_id = c.tenant_id and p.started_at <= c.${sql.raw(column)} and (p.ended_at is null or p.ended_at > c.${sql.raw(column)}) order by p.started_at desc limit 1), case when not exists (select 1 from case_responsibility_periods p2 where p2.case_id = c.id and p2.tenant_id = c.tenant_id) then c.responsible_user_id end) = ${filterUser}`
        : sql``;
    const stationScope=q.stationCode?sql`and exists (select 1 from tasks t where t.case_id = c.id and t.tenant_id = c.tenant_id and t.station_snapshot->>'code' = ${q.stationCode})`:sql``;
    const count = async (column: 'admitted_at' | 'actual_delivery_at', from: Date, to: Date) => {
      const res = await this.db.execute<{ n: number }>(
        sql`select count(*)::int as n from cases c where c.tenant_id = ${tenantId} and c.${sql.raw(column)} >= ${from.toISOString()} and c.${sql.raw(column)} < ${to.toISOString()} ${responsible(column)} ${stationScope}`,
      );
      return Number(((res as { rows?: { n: number }[] }).rows ?? (res as unknown as { n: number }[]))[0]?.n ?? 0);
    };
    return [
      { key: 'admitted', label: 'پذیرش در بازه', unit: 'پرونده', current: await count('admitted_at', period.from, period.to), previous: await count('admitted_at', period.previousFrom, period.previousTo) },
      { key: 'delivered', label: 'تحویل در بازه', unit: 'پرونده', current: await count('actual_delivery_at', period.from, period.to), previous: await count('actual_delivery_at', period.previousFrom, period.previousTo) },
    ];
  }

  private async filterLabels(actor: Actor, q: ReportQuery) {
    const out: { key: string; label: string; value: string }[] = [{ key: 'view', label: 'گزارش', value: REPORT_VIEW_LABELS[q.view] }];
    if (q.responsibleUserId) {
      let name = q.responsibleUserId === 'me' ? actor.user.displayName : q.responsibleUserId === 'none' ? 'بدون مسئول' : q.responsibleUserId;
      if (!['me', 'none'].includes(q.responsibleUserId)) {
        const [u] = await this.db.select({ n: users.displayName }).from(users).where(and(eq(users.id, q.responsibleUserId), eq(users.tenantId, actor.user.tenantId)));
        name = u?.n ?? 'نامعلوم';
      }
      out.push({ key: 'responsible', label: 'مسئول', value: name });
    }
    if (q.departmentId) {
      const [d] = await this.db.select({ n: departments.name }).from(departments).where(and(eq(departments.id, q.departmentId), eq(departments.tenantId, actor.user.tenantId)));
      out.push({ key: 'department', label: 'واحد', value: d?.n ?? 'نامعلوم' });
    }
    if (q.stage) out.push({ key: 'stage', label: 'مرحله', value: STAGE_LABELS[q.stage] });
    if (q.coverage) out.push({ key: 'coverage', label: 'پوشش', value: COVERAGE_LABELS[q.coverage] });
    if (q.blockerReason) out.push({ key: 'blocker', label: 'مانع', value: BLOCKER_REASON_LABELS[q.blockerReason] });
    if (q.partStatus) out.push({ key: 'part', label: 'وضعیت قطعه', value: PART_STATUS_LABELS[q.partStatus] });
    if(q.stationCode)out.push({key:'station',label:'کد جایگاه ارجاع',value:q.stationCode});
    if (q.q) out.push({ key: 'q', label: 'جست‌وجو', value: q.q });
    if (q.kind) out.push({ key: 'kind', label: 'نوع ردیف', value: q.kind });
    return out;
  }
}

const commitmentOf = (c: { officialDeadlineAt: Date | null; forecastDeliveryAt: Date | null }) => c.officialDeadlineAt ?? c.forecastDeliveryAt ?? null;
const reasonsText = (c: { openReasons: string[] }) => (c.openReasons.length ? c.openReasons.map((r) => BLOCKER_REASON_LABELS[r as BlockerReason]).join('، ') : null);

function kpi(key: string, label: string, unit: string, value: number, definition: string, listQuery?: string, itemKind?: string): ReportKpi {
  return { key, label, unit, value, definition, ...(listQuery !== undefined ? { listQuery } : {}), ...(itemKind ? { itemKind } : {}) };
}

const PART_DEFINITIONS: Record<string, string> = {
  unchecked: '«نیاز ثبت شد» و موجودی هنوز بررسی نشده',
  to_order: 'نیاز بدون موجودی، یا ردشده در رسید (اشتباه/معیوب)',
  overdue: 'سفارش داده شده و زمان رسیدن گذشته',
  awaiting_supply: 'سفارش داده شده، زمان رسیدن نرسیده یا ثبت نشده',
  to_hand_over: 'رسیده و کنترل‌شده یا رزرو از انبار',
};

const ACCIDENT_KIND_LABELS: Record<string, string> = {
  stopped: 'متوقف',
  assessment: 'کارشناسی یا مجوز',
  incomplete: 'مسئول یا اطلاعات ناقص',
  ready: 'آماده تحویل',
  follow_up: 'پیگیری روزانه',
};

const NEXT_BY_STAGE: Record<CaseStage, string> = {
  reception: 'شروع کارشناسی',
  assessment: 'نهایی‌کردن کارشناسی',
  awaiting_approval: 'پیگیری مجوز',
  awaiting_parts: 'پیگیری قطعه',
  in_repair: 'پیگیری تعمیر',
  quality_control: 'کنترل کیفیت و بستن فنی',
  ready_for_delivery: 'هماهنگی تحویل با مشتری',
  delivered: '—',
};

