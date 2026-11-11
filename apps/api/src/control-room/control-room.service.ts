import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNull, notInArray } from 'drizzle-orm';
import {
  ALERT_TABLE,
  analysisSentences,
  buildBays,
  buildFunnel,
  normalizeRoles,
  partFlowState,
  type ControlRange,
  type ControlRoomSnapshot,
  type DeskFolder,
  type PersonLine,
  type UnansweredAlert,
} from '@manage/shared';
import { AlertsService } from '../alerts/alerts.service';
import type { Actor } from '../auth/auth.types';
import { DATABASE, type DatabaseHandle } from '../db/database';
import { tehranAt, tehranDate } from '../daily-reports/daily-time';
import { auditEvents, cases, dailyReportImports, departments, emdadRequests, partPriceNotices, partRequests, reminderRecipients, reminders, users, workshopStations } from '../db/schema';
import { DeskService } from '../desk/desk.service';

const HOUR = 3_600_000;
const DAY = 86_400_000;

/**
 * Control room (spec §10): one read-only snapshot built from the same folder
 * facts as the desks, so a number here always matches the cards there.
 */
@Injectable()
export class ControlRoomService {
  constructor(
    @Inject(DATABASE) private readonly handle: DatabaseHandle,
    private readonly desk: DeskService,
    private readonly alerts: AlertsService,
  ) {}

  /** Start of the range in Tehran days: today, the last 7 days or the last 30 days (rolling). */
  static rangeStart(range: ControlRange, now: Date): Date {
    const today = tehranAt(tehranDate(now), '00:00');
    const back = range === 'today' ? 0 : range === 'week' ? 6 : 29;
    return new Date(today.getTime() - back * DAY);
  }

  async snapshot(actor: Actor, range: ControlRange, nowDate = new Date()): Promise<ControlRoomSnapshot> {
    const db = this.handle.db;
    const tenantId = actor.user.tenantId;
    const now = nowDate.getTime();
    const from = ControlRoomService.rangeStart(range, nowDate);
    const [folders, settings, staff, stations] = await Promise.all([
      this.desk.folders(actor, now),
      this.alerts.alertSettings(tenantId),
      db.select({ id: users.id, name: users.displayName, roles: users.roles, isOwner: users.isOwner }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.isActive, true))),
      db
        .select({ id: workshopStations.id, code: workshopStations.code, name: workshopStations.name, department: departments.name })
        .from(workshopStations)
        .innerJoin(departments, eq(departments.id, workshopStations.departmentId))
        .where(and(eq(workshopStations.tenantId, tenantId), eq(workshopStations.isActive, true)))
        .orderBy(workshopStations.code),
    ]);
    const ids = folders.map((f) => f.caseId);
    const byCase = new Map<string, DeskFolder>(folders.map((f: DeskFolder) => [f.caseId, f]));
    const partsClerks = staff.filter((u) => normalizeRoles(u.roles).includes('parts_clerk')).map((u) => u.id);
    const caseRecipients = (f: DeskFolder | undefined, extra: string[] = []) => [...new Set([...(f?.responsibleUserId ? [f.responsibleUserId] : []), ...extra])];

    // Facts for the alert table that the folders do not carry (times and texts).
    const [stageRows, costAlerts, notices, problems, partRows, reportRows, admittedRows, deliveredRows] = await Promise.all([
      ids.length
        ? db.select({ caseId: auditEvents.caseId, at: auditEvents.occurredAt }).from(auditEvents).where(and(eq(auditEvents.tenantId, tenantId), eq(auditEvents.action, 'case.stage_changed'), inArray(auditEvents.caseId, ids))).orderBy(desc(auditEvents.occurredAt))
        : Promise.resolve([] as { caseId: string | null; at: Date }[]),
      this.alerts.list(actor),
      db
        .select({ caseId: partRequests.caseId, description: partRequests.description, at: partPriceNotices.announcedAt })
        .from(partPriceNotices)
        .innerJoin(partRequests, eq(partRequests.id, partPriceNotices.partRequestId))
        .innerJoin(cases, eq(cases.id, partRequests.caseId))
        .where(and(eq(partPriceNotices.tenantId, tenantId), isNull(partPriceNotices.response), eq(cases.status, 'open'))),
      ids.length
        ? db
            .select({ id: reminders.id, caseId: reminders.caseId, body: reminders.body, at: reminders.createdAt, status: reminderRecipients.status, reply: reminderRecipients.reply })
            .from(reminders)
            .innerJoin(reminderRecipients, eq(reminderRecipients.reminderId, reminders.id))
            .where(and(eq(reminders.tenantId, tenantId), eq(reminders.source, 'technician_problem'), inArray(reminders.caseId, ids)))
        : Promise.resolve([] as { id: string; caseId: string | null; body: string; at: Date; status: string; reply: string | null }[]),
      ids.length
        ? db
            .select({ id: partRequests.id, caseId: partRequests.caseId, description: partRequests.description, status: partRequests.status, source: partRequests.source, consumedAt: partRequests.consumedAt, orderedAt: partRequests.orderedAt, receivedAt: partRequests.receivedAt, reservedAt: partRequests.reservedAt, createdAt: partRequests.createdAt, updatedAt: partRequests.updatedAt, emdadCategory: emdadRequests.statusCategory, emdadAt: emdadRequests.lastReportAt })
            .from(partRequests)
            .leftJoin(emdadRequests, and(eq(emdadRequests.partRequestId, partRequests.id), eq(emdadRequests.tenantId, tenantId)))
            .where(and(eq(partRequests.tenantId, tenantId), inArray(partRequests.caseId, ids), notInArray(partRequests.status, ['cancelled', 'returned'])))
        : Promise.resolve([]),
      db.select({ kind: dailyReportImports.kind, at: dailyReportImports.reportAt }).from(dailyReportImports).where(and(eq(dailyReportImports.tenantId, tenantId), eq(dailyReportImports.status, 'applied'))).orderBy(desc(dailyReportImports.reportAt)),
      db.select({ id: cases.id }).from(cases).where(and(eq(cases.tenantId, tenantId), gte(cases.admittedAt, from))),
      db.select({ admittedAt: cases.admittedAt, deliveredAt: cases.actualDeliveryAt }).from(cases).where(and(eq(cases.tenantId, tenantId), gte(cases.actualDeliveryAt, from))),
    ]);

    // Days in the current stage: since the last recorded stage change, else since admission.
    const stageDays: Record<string, number> = {};
    for (const r of stageRows) if (r.caseId && !(r.caseId in stageDays)) stageDays[r.caseId] = Math.max(0, (now - r.at.getTime()) / DAY);

    const alerts: UnansweredAlert[] = [];
    const push = (a: Omit<UnansweredAlert, 'waitingHours' | 'plate' | 'vehicle'> & { caseId: string | null }) => {
      const f = a.caseId ? byCase.get(a.caseId) : undefined;
      alerts.push({ ...a, plate: f?.plate ?? null, vehicle: f?.vehicle ?? null, waitingHours: Math.max(0, Math.round((now - Date.parse(a.since)) / HOUR)) });
    };
    const answered = new Set(problems.filter((p) => p.status === 'done' || !!p.reply).map((p) => p.id));
    const seenProblem = new Set<string>();
    for (const p of problems) {
      if (answered.has(p.id) || seenProblem.has(p.id)) continue;
      seenProblem.add(p.id);
      const f = p.caseId ? byCase.get(p.caseId) : undefined;
      push({ kind: 'technician_problem', text: p.body, caseId: p.caseId, since: p.at.toISOString(), recipient: ALERT_TABLE.technician_problem.recipient, recipientUserIds: caseRecipients(f, partsClerks) });
    }
    const lastPartAt = new Map<string, number>();
    for (const p of partRows) lastPartAt.set(p.caseId, Math.max(lastPartAt.get(p.caseId) ?? 0, p.createdAt.getTime()));
    for (const a of costAlerts) {
      const f = byCase.get(a.caseId);
      const since = new Date(lastPartAt.get(a.caseId) ?? now).toISOString();
      push({ kind: a.kind, text: a.kind === 'expensive_part' ? `قطعهٔ گران: ${a.partDescription ?? ''}` : 'هزینهٔ قطعات از سقف هشدار گذشت', caseId: a.caseId, since, recipient: a.responsible?.displayName ?? ALERT_TABLE[a.kind].recipient, recipientUserIds: caseRecipients(f) });
    }
    for (const n of notices) {
      const f = byCase.get(n.caseId);
      push({ kind: 'price_notice', text: `اعلام قیمت: ${n.description}`, caseId: n.caseId, since: n.at.toISOString(), recipient: f?.responsibleName ?? ALERT_TABLE.price_notice.recipient, recipientUserIds: caseRecipients(f) });
    }
    const lateMs = settings.emdadLateDays * DAY;
    const seenPart = new Set<string>();
    for (const p of partRows) {
      if (seenPart.has(p.id)) continue;
      seenPart.add(p.id);
      const f = byCase.get(p.caseId);
      const state = partFlowState({ status: p.status, source: p.source, consumedAt: p.consumedAt, emdadCategory: p.emdadCategory ?? undefined });
      const ordered = (p.orderedAt ?? p.createdAt).getTime();
      if (state === 'emdad' && now - ordered > lateMs) push({ kind: 'emdad_late', text: `امداد ویژه دیر شده: ${p.description}`, caseId: p.caseId, since: new Date(ordered + lateMs).toISOString(), recipient: ALERT_TABLE.emdad_late.recipient, recipientUserIds: caseRecipients(f, partsClerks) });
      if (state === 'dealer_supply') push({ kind: 'dealer_supply', text: `تأمین توسط نمایندگی: ${p.description}`, caseId: p.caseId, since: (p.emdadAt ?? p.updatedAt).toISOString(), recipient: ALERT_TABLE.dealer_supply.recipient, recipientUserIds: partsClerks });
      if (state === 'ready') push({ kind: 'part_ready', text: `قطعه آماده است: ${p.description}`, caseId: p.caseId, since: (p.receivedAt ?? p.reservedAt ?? p.updatedAt).toISOString(), recipient: ALERT_TABLE.part_ready.recipient, recipientUserIds: caseRecipients(f, f?.tasks.map((t) => t.assignedUserId).filter((x): x is string => !!x) ?? []) });
    }
    for (const f of folders) {
      for (const t of f.tasks) {
        if (t.status === 'done' || t.status === 'approved' || !t.plannedEndAt || Date.parse(t.plannedEndAt) >= now) continue;
        push({ kind: 'behind', text: `عقب‌تر از برنامه: ${t.department}`, caseId: f.caseId, since: t.plannedEndAt, recipient: ALERT_TABLE.behind.recipient, recipientUserIds: caseRecipients(f, t.assignedUserId ? [t.assignedUserId] : []) });
      }
    }
    const today = tehranDate(nowDate);
    const lastEmdad = reportRows.find((r) => r.kind === 'emdad')?.at ?? null;
    const lastStock = reportRows.find((r) => r.kind === 'stock')?.at ?? null;
    const emdadFresh = !!lastEmdad && tehranDate(lastEmdad) === today;
    const noon = tehranAt(today, '12:00');
    const afterNoon = nowDate >= noon;
    if (afterNoon && !emdadFresh) {
      const uploaders = staff.filter((u) => normalizeRoles(u.roles).some((r) => r === 'parts_clerk' || r === 'system_admin')).map((u) => u.id);
      push({ kind: 'report_missing', text: 'گزارش امداد ویژهٔ امروز بارگذاری نشده', caseId: null, since: noon.toISOString(), recipient: ALERT_TABLE.report_missing.recipient, recipientUserIds: uploaders });
    }
    alerts.sort((a, b) => b.waitingHours - a.waitingHours);

    const funnel = buildFunnel(folders, stageDays);
    const bays = buildBays(folders, stations, now);
    const behind = folders.filter((f) => f.behind);
    const behindOver3 = folders.filter((f) => f.tasks.some((t) => t.status !== 'done' && t.status !== 'approved' && t.plannedEndAt && now - Date.parse(t.plannedEndAt) > 3 * DAY)).length;
    const deliveredStays = deliveredRows.filter((r) => r.deliveredAt).map((r) => (r.deliveredAt!.getTime() - r.admittedAt.getTime()) / DAY);
    const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

    // People: each accident expert, the parts desk and each bay (spec §10.5). Numbers only, no ranking.
    const unansweredFor = (userId: string) => alerts.filter((a) => a.recipientUserIds.includes(userId)).length;
    const people: PersonLine[] = [];
    for (const u of staff.filter((x) => normalizeRoles(x.roles).includes('accident_expert'))) {
      const mine = folders.filter((f) => f.responsibleUserId === u.id);
      people.push({ userId: u.id, name: u.name, role: 'accident_expert', detail: 'کارشناس تصادفات', open: mine.length, avgDays: mean(mine.map((f) => f.daysInShop)), late: mine.filter((f) => f.behind).length, unanswered: unansweredFor(u.id) });
    }
    for (const u of staff.filter((x) => normalizeRoles(x.roles).includes('parts_clerk'))) {
      const flowing = folders.reduce((n, f) => n + f.parts.inProgress + f.parts.undecided, 0);
      const arrivals = partRows.filter((p) => p.receivedAt && p.orderedAt && p.receivedAt >= from).map((p) => (p.receivedAt!.getTime() - p.orderedAt!.getTime()) / DAY);
      people.push({ userId: u.id, name: u.name, role: 'parts_clerk', detail: 'تأمین قطعه', open: flowing, avgDays: mean(arrivals), late: folders.reduce((n, f) => n + f.parts.emdadLate, 0), unanswered: unansweredFor(u.id) });
    }
    for (const b of bays.filter((x) => x.key !== 'parts')) {
      people.push({ userId: null, name: b.label, role: 'station', detail: b.department ?? 'جایگاه', open: b.cars.length, avgDays: null, late: b.cars.filter((c) => c.state !== 'ok').length, unanswered: alerts.filter((a) => a.kind === 'behind' && b.cars.some((c) => c.caseId === a.caseId)).length });
    }

    return {
      generatedAt: nowDate.toISOString(),
      range,
      kpis: {
        inShop: folders.length,
        admitted: admittedRows.length,
        delivered: deliveredRows.length,
        avgStayDays: mean(folders.map((f) => f.daysInShop)) ?? 0,
        deliveredAvgStayDays: mean(deliveredStays),
        behind: behind.length,
        behindOver3,
        unanswered: alerts.length,
        oldestUnansweredHours: alerts[0]?.waitingHours ?? null,
      },
      funnel,
      bays,
      analysis: analysisSentences({ funnel, bays, folders, alerts, emdadLateDays: settings.emdadLateDays, emdadFresh, afterNoon }),
      people,
      alerts,
      reports: { emdadFresh, stockFresh: !!lastStock && tehranDate(lastStock) === today, emdadLastAt: lastEmdad?.toISOString() ?? null },
    };
  }
}
