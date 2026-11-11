import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  coverageTab,
  daysInShop,
  folderBehind,
  folderNextStep,
  folderPlace,
  journeyStep,
  partFlowFilter,
  partFlowState,
  STAGE_LABELS,
  type CaseStage,
  type CoverageType,
  type DeskFolder,
  type FolderFacts,
  type TaskStatus,
} from '@manage/shared';
import { AlertsService } from '../alerts/alerts.service';
import type { Actor } from '../auth/auth.types';
import { notFound } from '../common/errors';
import { DATABASE, type DatabaseHandle } from '../db/database';
import { blockers, cases, customers, departments, emdadRequests, partRequests, reminderRecipients, reminders, tasks, users, vehicles, workshopStations } from '../db/schema';

const responsible = alias(users, 'desk_responsible');

/**
 * Folder cards for every desk (spec §2): one query per kind of fact for all open
 * cases of the dealership, then the shared rules decide place, «قدم بعدی» and
 * «عقب‌تر از برنامه». Read-only; nothing here changes data.
 */
@Injectable()
export class DeskService {
  constructor(
    @Inject(DATABASE) private readonly handle: DatabaseHandle,
    private readonly alerts: AlertsService,
  ) {}

  async folders(actor: Actor, now = Date.now(), caseId?: string): Promise<DeskFolder[]> {
    const db = this.handle.db;
    const tenantId = actor.user.tenantId;
    const rows = await db
      .select({
        id: cases.id,
        caseNumber: cases.caseNumber,
        admissionNo: cases.admissionNo,
        stage: cases.stage,
        coverageType: cases.coverageType,
        admittedAt: cases.admittedAt,
        officialDeadlineAt: cases.officialDeadlineAt,
        responsibleUserId: cases.responsibleUserId,
        responsibleName: responsible.displayName,
        plate: vehicles.plate,
        brand: vehicles.brand,
        model: vehicles.model,
        customerName: customers.fullName,
      })
      .from(cases)
      .innerJoin(vehicles, eq(vehicles.id, cases.vehicleId))
      .leftJoin(customers, eq(customers.id, cases.customerId))
      .leftJoin(responsible, eq(responsible.id, cases.responsibleUserId))
      // One case (its folder header) may be closed; the desks list open cases only.
      .where(and(eq(cases.tenantId, tenantId), caseId ? eq(cases.id, caseId) : eq(cases.status, 'open')))
      .orderBy(asc(cases.admittedAt));
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);

    const [taskRows, partRows, blockerRows, problemRows, settings] = await Promise.all([
      db
        .select({ caseId: tasks.caseId, status: tasks.status, plannedEndAt: tasks.plannedEndAt, department: departments.name, station: workshopStations.code, stationId: tasks.stationId, assignedUserId: tasks.assignedUserId })
        .from(tasks)
        .innerJoin(departments, eq(departments.id, tasks.departmentId))
        .leftJoin(workshopStations, eq(workshopStations.id, tasks.stationId))
        .where(and(eq(tasks.tenantId, tenantId), inArray(tasks.caseId, ids)))
        .orderBy(asc(tasks.sortOrder)),
      db
        .select({ id: partRequests.id, caseId: partRequests.caseId, status: partRequests.status, source: partRequests.source, consumedAt: partRequests.consumedAt, orderedAt: partRequests.orderedAt, createdAt: partRequests.createdAt, emdadCategory: emdadRequests.statusCategory })
        .from(partRequests)
        .leftJoin(emdadRequests, and(eq(emdadRequests.partRequestId, partRequests.id), eq(emdadRequests.tenantId, tenantId)))
        .where(and(eq(partRequests.tenantId, tenantId), inArray(partRequests.caseId, ids), notInArray(partRequests.status, ['cancelled', 'returned']))),
      db.select({ caseId: blockers.caseId }).from(blockers).where(and(inArray(blockers.caseId, ids), isNull(blockers.resolvedAt))),
      db
        .select({ caseId: reminders.caseId, body: reminders.body, createdAt: reminders.createdAt, status: reminderRecipients.status, reply: reminderRecipients.reply, reminderId: reminders.id })
        .from(reminders)
        .innerJoin(reminderRecipients, eq(reminderRecipients.reminderId, reminders.id))
        .where(and(eq(reminders.tenantId, tenantId), eq(reminders.source, 'technician_problem'), inArray(reminders.caseId, ids))),
      this.alerts.alertSettings(tenantId),
    ]);

    const lateMs = settings.emdadLateDays * 86_400_000;
    const facts = new Map<string, FolderFacts & { taskRows: DeskFolder['tasks'] }>();
    for (const r of rows) {
      facts.set(r.id, { stage: r.stage as CaseStage, tasks: [], taskRows: [], parts: { total: 0, undecided: 0, inProgress: 0, ready: 0, emdadLate: 0 }, openBlockers: 0, problems: [], officialDeadlineAt: r.officialDeadlineAt?.toISOString() ?? null });
    }
    for (const t of taskRows) {
      const f = facts.get(t.caseId)!;
      const row = { department: t.department, station: t.station ?? null, status: t.status as TaskStatus, plannedEndAt: t.plannedEndAt?.toISOString() ?? null, stationId: t.stationId ?? null, assignedUserId: t.assignedUserId ?? null };
      f.taskRows.push(row);
    }
    // Each part once, even if more than one Emdad request points to it.
    const seen = new Set<string>();
    for (const p of partRows) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      const f = facts.get(p.caseId)!;
      const state = partFlowState({ status: p.status, source: p.source, consumedAt: p.consumedAt, emdadCategory: p.emdadCategory ?? undefined });
      const filter = partFlowFilter(state);
      f.parts.total += 1;
      if (filter === 'undecided') f.parts.undecided += 1;
      else if (filter === 'in_progress') f.parts.inProgress += 1;
      else if (filter === 'ready') f.parts.ready += 1;
      if (state === 'emdad' && now - (p.orderedAt ?? p.createdAt).getTime() > lateMs) f.parts.emdadLate += 1;
    }
    for (const b of blockerRows) facts.get(b.caseId)!.openBlockers += 1;
    const answered = new Set(problemRows.filter((p) => p.status === 'done' || !!p.reply).map((p) => p.reminderId));
    const problemSeen = new Set<string>();
    for (const p of problemRows) {
      if (!p.caseId || answered.has(p.reminderId) || problemSeen.has(p.reminderId)) continue;
      problemSeen.add(p.reminderId);
      facts.get(p.caseId)!.problems!.push({ label: p.body.split(' — ')[0] ?? p.body, hours: (now - p.createdAt.getTime()) / 3_600_000 });
    }

    return rows.map((r) => {
      const f = facts.get(r.id)!;
      const fx: FolderFacts = { ...f, tasks: f.taskRows };
      const stage = r.stage as CaseStage;
      return {
        caseId: r.id,
        caseNumber: r.caseNumber,
        admissionNo: r.admissionNo,
        plate: r.plate,
        vehicle: (r.model || r.brand || 'خودرو').trim(),
        customerName: r.customerName,
        coverageType: r.coverageType as CoverageType,
        stage,
        journey: journeyStep(stage),
        place: folderPlace(fx, STAGE_LABELS[stage]),
        admittedAt: r.admittedAt.toISOString(),
        daysInShop: daysInShop(r.admittedAt.toISOString(), now),
        next: folderNextStep(fx, now),
        behind: folderBehind(fx, now),
        responsibleUserId: r.responsibleUserId,
        responsibleName: r.responsibleName ?? null,
        parts: f.parts,
        openBlockers: f.openBlockers,
        tasks: f.taskRows,
      } satisfies DeskFolder;
    });
  }

  /** The folder of one case: header, journey bar and «قدم بعدی». */
  async folder(actor: Actor, caseId: string): Promise<DeskFolder> {
    const [f] = await this.folders(actor, Date.now(), caseId);
    if (!f) throw notFound('پرونده');
    return f;
  }

  /** Coverage tab label for exports and messages. */
  static tab(c: CoverageType) {
    return coverageTab(c).label;
  }
}
