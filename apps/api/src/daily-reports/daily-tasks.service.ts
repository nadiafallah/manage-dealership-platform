import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, lt, notInArray } from 'drizzle-orm';
import { alertSettingsOf, DAILY_REPORT_KINDS, DAILY_REPORT_KIND_LABELS, isWorkingDay, normalizeRoles, partFlowState, permissionsFor, type AlertSettings, type DailyReportKind, type DailyTaskState, type Role } from '@manage/shared';
import type { Actor } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../config';
import { newId } from '../common/ids';
import { DATABASE, type DatabaseHandle, type DbOrTx } from '../db/database';
import { cases, dailyReportProfiles, dailyTasks, departments, emdadRequests, notifications, partRequests, tasks, tenants, users, vehicles } from '../db/schema';
import { tehranAt, tehranDate } from './daily-time';
import { calendarAt } from '../workshop/work-calendar';

export const DEFAULT_REMINDER = '11:00';

/**
 * The two daily update tasks and their internal reminders. Runs on the server
 * (not a browser timer or host cron). Tasks and notifications have unique keys
 * (tenant + Tehran day + kind, user + dedupe key), so restarts and several API
 * workers never create duplicates; the notified flag is claimed atomically.
 */
@Injectable()
export class DailyTasksService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('DailyTasks');
  private timer: NodeJS.Timeout | null = null;
  constructor(
    @Inject(DATABASE) private readonly handle: DatabaseHandle,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly audit: AuditService,
  ) {}
  private get db() {
    return this.handle.db;
  }

  onApplicationBootstrap() {
    if (!this.cfg.DAILY_SCHEDULER || this.cfg.APP_ENV === 'test') return;
    const run = () => {
      void this.tick().catch((e: unknown) => this.logger.error(`daily task tick failed: ${e instanceof Error ? e.message : 'unknown'}`));
      void this.sweepAlerts().catch((e: unknown) => this.logger.error(`alert sweep failed: ${e instanceof Error ? e.message : 'unknown'}`));
    };
    this.timer = setInterval(run, 60_000);
    this.timer.unref();
    run();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  private async profiles(tx: DbOrTx, tenantId: string) {
    const rows = await tx.select().from(dailyReportProfiles).where(eq(dailyReportProfiles.tenantId, tenantId));
    return new Map(rows.map((p) => [p.kind as DailyReportKind, p]));
  }

  /** Creates today's tasks (idempotent) and sends due reminders once. */
  async tick(now = new Date()): Promise<{ created: number; notified: number }> {
    const localDate = tehranDate(now);
    let created = 0;
    let notified = 0;
    for (const t of await this.db.select({ id: tenants.id }).from(tenants)) {
      // Friday and recorded holidays have no daily reports: no task, no reminder.
      if (!(await this.isWorkday(t.id, localDate, now))) continue;
      const profiles = await this.profiles(this.db, t.id);
      for (const kind of DAILY_REPORT_KINDS) {
        const p = profiles.get(kind);
        const dueAt = tehranAt(localDate, p?.reminderTime ?? DEFAULT_REMINDER);
        const inserted = await this.db
          .insert(dailyTasks)
          .values({ id: newId(), tenantId: t.id, localDate, kind, dueAt })
          .onConflictDoNothing()
          .returning({ id: dailyTasks.id });
        created += inserted.length;
        if (now < dueAt) continue;
        const open = and(eq(dailyTasks.tenantId, t.id), eq(dailyTasks.localDate, localDate), eq(dailyTasks.kind, kind), eq(dailyTasks.status, 'pending'), isNull(dailyTasks.notifiedAt));
        if (!(await this.db.select({ id: dailyTasks.id }).from(dailyTasks).where(open)).length) continue;
        // Without a recipient the reminder stays due, so it reaches whoever gets the permission later today.
        const recipients = await this.recipients(t.id, p?.reminderUserId ?? null);
        if (!recipients.length) continue;
        // Claim and notifications commit together: a crash between them cannot lose the reminder.
        notified += await this.db.transaction(async (tx) => {
          const [claimed] = await tx.update(dailyTasks).set({ notifiedAt: now }).where(open).returning({ id: dailyTasks.id });
          if (!claimed) return 0;
          const rows = await tx
            .insert(notifications)
            .values(
              recipients.map((userId) => ({
                id: newId(),
                tenantId: t.id,
                userId,
                kind: 'daily_report_due',
                title: `یادآوری: ${DAILY_REPORT_KIND_LABELS[kind]}`,
                body: 'گزارش امروز هنوز ثبت نشده است. فایل را از بخش «به‌روزرسانی گزارش‌های روزانه» بارگذاری و پس از پیش‌نمایش تأیید کنید. این یادآوری کاری را قفل نمی‌کند.',
                link: `/daily-reports?kind=${kind}`,
                dedupeKey: `daily:${kind}:${localDate}`,
              })),
            )
            .onConflictDoNothing()
            .returning({ id: notifications.id });
          return rows.length;
        });
      }
    }
    return { created, notified };
  }

  /**
   * Alerts of spec §9 that come from time, not from a click: «گزارش امداد ویژهٔ امروز
   * بارگذاری نشده» at 12:00 (owner decision 7), «امداد ویژه دیر شده» after N days and
   * «عقب‌تر از برنامه» when a step passes its planned end. Each reaches its people once
   * (unique dedupe key per user); nothing is locked, only made visible.
   */
  async sweepAlerts(now = new Date()): Promise<number> {
    const localDate = tehranDate(now);
    let sent = 0;
    for (const t of await this.db.select({ id: tenants.id, settings: tenants.settings }).from(tenants)) {
      if (!(await this.isWorkday(t.id, localDate, now))) continue;
      const settings: AlertSettings = alertSettingsOf(t.settings as Partial<Record<keyof AlertSettings, unknown>> | null);
      const staff = await this.db.select({ id: users.id, roles: users.roles }).from(users).where(and(eq(users.tenantId, t.id), eq(users.isActive, true)));
      const active = new Set(staff.map((u) => u.id));
      const withRole = (r: Role) => staff.filter((u) => normalizeRoles(u.roles).includes(r)).map((u) => u.id);
      const partsClerks = withRole('parts_clerk');
      const rows: (typeof notifications.$inferInsert)[] = [];
      const to = (userIds: (string | null | undefined)[], n: { kind: string; title: string; body: string; link: string; dedupeKey: string }) => {
        for (const userId of new Set(userIds.filter((u): u is string => !!u && active.has(u)))) rows.push({ id: newId(), tenantId: t.id, userId, ...n });
      };

      const [emdadTask] = await this.db.select().from(dailyTasks).where(and(eq(dailyTasks.tenantId, t.id), eq(dailyTasks.localDate, localDate), eq(dailyTasks.kind, 'emdad')));
      if (now >= tehranAt(localDate, '12:00') && emdadTask && emdadTask.status === 'pending') {
        to([...partsClerks, ...withRole('system_admin')], { kind: 'daily_report_missing', title: 'گزارش امداد ویژهٔ امروز بارگذاری نشده', body: 'ساعت ۱۲ گذشت و گزارش امروز ثبت نشده؛ وضعیت قطعه‌ها با تاریخ آخرین گزارش نمایش داده می‌شود.', link: '/daily-reports?kind=emdad', dedupeKey: `daily-missing:emdad:${localDate}` });
      }

      const parts = await this.db
        .select({ id: partRequests.id, caseId: partRequests.caseId, description: partRequests.description, status: partRequests.status, source: partRequests.source, consumedAt: partRequests.consumedAt, orderedAt: partRequests.orderedAt, createdAt: partRequests.createdAt, emdadCategory: emdadRequests.statusCategory, responsible: cases.responsibleUserId, plate: vehicles.plate })
        .from(partRequests)
        .innerJoin(cases, and(eq(cases.id, partRequests.caseId), eq(cases.status, 'open')))
        .innerJoin(vehicles, eq(vehicles.id, cases.vehicleId))
        .leftJoin(emdadRequests, eq(emdadRequests.partRequestId, partRequests.id))
        .where(and(eq(partRequests.tenantId, t.id), notInArray(partRequests.status, ['cancelled', 'returned', 'handed_over'])));
      for (const p of parts) {
        const state = partFlowState({ status: p.status, source: p.source, consumedAt: p.consumedAt, emdadCategory: p.emdadCategory ?? undefined });
        if (state !== 'emdad' || now.getTime() - (p.orderedAt ?? p.createdAt).getTime() <= settings.emdadLateDays * 86_400_000) continue;
        to([...partsClerks, p.responsible], { kind: 'emdad_late', title: `امداد ویژه دیر شده: ${p.description}`, body: `بیش از ${settings.emdadLateDays} روز از ثبت امداد ویژه گذشته${p.plate ? ` (پلاک ${p.plate})` : ''}؛ پیگیری کنید.`, link: `/cases/${p.caseId}#case-parts`, dedupeKey: `emdad-late:${p.id}` });
      }

      const late = await this.db
        .select({ id: tasks.id, caseId: tasks.caseId, plannedEndAt: tasks.plannedEndAt, assignedUserId: tasks.assignedUserId, department: departments.name, responsible: cases.responsibleUserId, plate: vehicles.plate })
        .from(tasks)
        .innerJoin(cases, and(eq(cases.id, tasks.caseId), eq(cases.status, 'open')))
        .innerJoin(vehicles, eq(vehicles.id, cases.vehicleId))
        .innerJoin(departments, eq(departments.id, tasks.departmentId))
        .where(and(eq(tasks.tenantId, t.id), inArray(tasks.status, ['pending', 'in_progress', 'blocked']), lt(tasks.plannedEndAt, now)));
      for (const k of late) {
        to([k.responsible, k.assignedUserId], { kind: 'behind_schedule', title: `عقب‌تر از برنامه: ${k.department}`, body: `روز مجاز این قدم گذشته${k.plate ? ` (پلاک ${k.plate})` : ''}؛ برنامه را اصلاح یا پیگیری کنید.`, link: `/cases/${k.caseId}#case-tasks`, dedupeKey: `behind:${k.id}:${tehranDate(k.plannedEndAt!)}` });
      }
      if (rows.length) sent += (await this.db.insert(notifications).values(rows).onConflictDoNothing().returning({ id: notifications.id })).length;
    }
    return sent;
  }

  /** The dealership's work calendar decides whether daily files are expected today. */
  async isWorkday(tenantId: string, localDate: string, now = new Date()): Promise<boolean> {
    const revision = await calendarAt(this.db, tenantId, now.toISOString());
    return isWorkingDay(localDate, revision.calendar);
  }

  /** The configured person, or everyone active who may upload the daily files. */
  private async recipients(tenantId: string, configured: string | null): Promise<string[]> {
    const [tenant] = await this.db.select({ templates: tenants.permissionTemplates }).from(tenants).where(eq(tenants.id, tenantId));
    const staff = await this.db.select().from(users).where(and(eq(users.tenantId, tenantId), eq(users.isActive, true)));
    if (configured && staff.some((u) => u.id === configured)) return [configured];
    return staff.filter((u) => permissionsFor(u.roles as Role[], tenant?.templates ?? {}, u.permissionOverrides, u.isOwner).has('daily_reports.upload')).map((u) => u.id);
  }

  /** Today's two tasks; a missing row (scheduler not run yet) is shown as pending. */
  async today(tenantId: string, now = new Date()): Promise<DailyTaskState[]> {
    const localDate = tehranDate(now);
    const rows = await this.db.select().from(dailyTasks).where(and(eq(dailyTasks.tenantId, tenantId), eq(dailyTasks.localDate, localDate)));
    const profiles = await this.profiles(this.db, tenantId);
    const workday = await this.isWorkday(tenantId, localDate, now);
    return DAILY_REPORT_KINDS.map((kind) => {
      const r = rows.find((x) => x.kind === kind);
      // A new reminder time applies to today until the reminder has gone out.
      const dueAt = r && (r.status === 'done' || r.notifiedAt) ? r.dueAt : tehranAt(localDate, profiles.get(kind)?.reminderTime ?? DEFAULT_REMINDER);
      const status = (r?.status ?? 'pending') as DailyTaskState['status'];
      return { kind, localDate, dueAt: dueAt.toISOString(), status, late: workday && status === 'pending' && now >= dueAt, completedAt: r?.completedAt?.toISOString() ?? null, unchangedDeclared: r?.unchangedDeclared ?? false };
    });
  }

  /**
   * Completes today's task with an applied import whose report day is today.
   * Content identical to the previous report reaches this only with the
   * uploader's declaration that it is today's report (recorded in the audit).
   */
  async completeWith(tx: DbOrTx, actor: Actor, kind: DailyReportKind, importId: string, reportAt: Date, identical: boolean, now = new Date()): Promise<'done' | 'not_today' | 'already_done'> {
    const localDate = tehranDate(now);
    if (tehranDate(reportAt) !== localDate) return 'not_today';
    const profiles = await this.profiles(tx, actor.user.tenantId);
    await tx
      .insert(dailyTasks)
      .values({ id: newId(), tenantId: actor.user.tenantId, localDate, kind, dueAt: tehranAt(localDate, profiles.get(kind)?.reminderTime ?? DEFAULT_REMINDER) })
      .onConflictDoNothing();
    const [row] = await tx
      .update(dailyTasks)
      .set({ status: 'done', completedImportId: importId, completedAt: now, completedBy: actor.user.id, unchangedDeclared: identical })
      .where(and(eq(dailyTasks.tenantId, actor.user.tenantId), eq(dailyTasks.localDate, localDate), eq(dailyTasks.kind, kind), eq(dailyTasks.status, 'pending')))
      .returning();
    if (!row) return 'already_done';
    await this.audit.record(tx, actor, {
      entityType: 'daily_report',
      entityId: importId,
      action: identical ? 'daily_task.completed_unchanged_declared' : 'daily_task.completed',
      after: { kind, localDate, importId, unchangedDeclared: identical },
    });
    return 'done';
  }

  async inbox(actor: Actor) {
    const rows = await this.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.tenantId, actor.user.tenantId), eq(notifications.userId, actor.user.id)))
      .orderBy(desc(notifications.createdAt))
      .limit(50);
    return {
      unread: rows.filter((r) => !r.readAt).length,
      items: rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, link: r.link, createdAt: r.createdAt.toISOString(), readAt: r.readAt?.toISOString() ?? null })),
    };
  }

  async markRead(actor: Actor, ids: string[] | 'all') {
    const scope = and(eq(notifications.tenantId, actor.user.tenantId), eq(notifications.userId, actor.user.id), isNull(notifications.readAt));
    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(ids === 'all' ? scope : and(scope, inArray(notifications.id, ids)));
    return this.inbox(actor);
  }
}
