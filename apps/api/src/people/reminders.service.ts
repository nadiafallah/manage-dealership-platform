import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, lte, ne, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  addWorkingMinutes,
  REMINDER_NUDGE_WORKING_MINUTES,
  ROLE_LABELS,
  TECHNICIAN_PROBLEM_LABELS,
  type MyReminders,
  type ReceivedReminder,
  type ReminderPerson,
  type ReminderRespondInput,
  type ReminderSendInput,
  type ReminderSource,
  type ReminderStatus,
  type ReminderUrgency,
  normalizeRoles,
  type Role,
  type SentReminder,
  type TechnicianProblem,
} from '@manage/shared';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../auth/auth.types';
import { APP_CONFIG, type AppConfig } from '../config';
import { badRequest, forbidden, notFound, versionConflict } from '../common/errors';
import { newId } from '../common/ids';
import { DATABASE, type DatabaseHandle } from '../db/database';
import { cases, departments, notifications, reminderRecipients, reminders, tasks, users, vehicles, partRequests, blockers, workshopStations } from '../db/schema';
import { calendarAt } from '../workshop/work-calendar';

/** Roles that receive a technician's "I have a problem" when the case has no responsible. */
const COORDINATOR_ROLES: Role[] = ['accident_expert'];
const sender = alias(users, 'reminder_sender');
const iso = (d: Date | null) => d?.toISOString() ?? null;

interface Draft {
  recipients: string[];
  body: string;
  urgency: ReminderUrgency;
  source: ReminderSource;
  caseId: string | null;
  plate: string | null;
  targetRole: Role | null;
}

/**
 * Reminders between desks: a short message to people or to a role, optionally
 * tied to a case or plate. Not a chat: no threads and no long free text. Every
 * reminder and every status change is audited. An unseen reminder is sent
 * again as an internal notification after two working hours (the dealership
 * calendar), by the same once-a-minute server loop style as the daily tasks.
 */
@Injectable()
export class RemindersService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Reminders');
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
    const run = () => void this.tick().catch((e: unknown) => this.logger.error(`reminder tick failed: ${e instanceof Error ? e.message : 'unknown'}`));
    this.timer = setInterval(run, 60_000);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Active colleagues of the same dealership (no contact details). */
  async people(actor: Actor): Promise<ReminderPerson[]> {
    const rows = await this.db
      .select({ id: users.id, displayName: users.displayName, roles: users.roles })
      .from(users)
      .where(and(eq(users.tenantId, actor.user.tenantId), eq(users.isActive, true), ne(users.id, actor.user.id)))
      .orderBy(asc(users.displayName));
    return rows.map((r) => ({ id: r.id, displayName: r.displayName, roles: r.roles as Role[] }));
  }

  async send(actor: Actor, input: ReminderSendInput): Promise<{ id: string; recipients: number }> {
    const tenantId = actor.user.tenantId;
    let plate = input.plate?.trim() || null;
    if (input.caseId) {
      const [kase] = await this.db
        .select({ id: cases.id, plate: vehicles.plate })
        .from(cases)
        .innerJoin(vehicles, eq(vehicles.id, cases.vehicleId))
        .where(and(eq(cases.id, input.caseId), eq(cases.tenantId, tenantId)));
      if (!kase) throw notFound('پرونده');
      // Without case access (a technician) only a case of one's own job can be attached.
      if (!actor.user.permissions.has('case.read')) {
        const [own] = await this.db
          .select({ id: tasks.id })
          .from(tasks)
          .where(and(eq(tasks.tenantId, tenantId), eq(tasks.caseId, kase.id), eq(tasks.assignedUserId, actor.user.id)))
          .limit(1);
        if (!own) throw forbidden('فقط پروندهٔ کار خودتان را می‌توانید به تذکر وصل کنید');
      }
      plate ??= kase.plate;
    }
    const staff = await this.db
      .select({ id: users.id, roles: users.roles })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.isActive, true)));
    const recipients = new Set<string>();
    for (const id of input.userIds) {
      if (!staff.some((u) => u.id === id)) throw badRequest('INVALID_RECIPIENT', 'گیرنده در این نمایندگی پیدا نشد یا فعال نیست');
      recipients.add(id);
    }
    const roles: string[] = input.role ? [input.role] : [];
    for (const u of staff) if (normalizeRoles(u.roles).some((r) => roles.includes(r))) recipients.add(u.id);
    recipients.delete(actor.user.id);
    return this.create(actor, {
      recipients: [...recipients],
      body: input.body,
      urgency: input.urgency,
      source: input.source,
      caseId: input.caseId ?? null,
      plate,
      targetRole: input.role ?? null,
    });
  }


  /** Explicit call from the parts desk; the recipient must belong to this exact case. */
  async partsReady(actor: Actor, partId: string, taskId: string): Promise<{ id: string; recipients: number }> {
    if (!actor.user.permissions.has('part.manage')) throw forbidden();
    const tenantId = actor.user.tenantId;
    const [part] = await this.db.select({ p: partRequests, c: cases, plate: vehicles.plate })
      .from(partRequests)
      .innerJoin(cases, and(eq(cases.id, partRequests.caseId), eq(cases.tenantId, tenantId)))
      .innerJoin(vehicles, and(eq(vehicles.id, cases.vehicleId), eq(vehicles.tenantId, tenantId)))
      .where(and(eq(partRequests.id, partId), eq(partRequests.tenantId, tenantId)));
    if (!part) throw notFound('قطعه');
    if (!['reserved', 'received'].includes(part.p.status) || part.c.status !== 'open')
      throw badRequest('PART_NOT_READY', 'قطعه هنوز آماده تحویل نیست');
    const [jobs, waiting, staff] = await Promise.all([
      this.db.select().from(tasks).where(and(eq(tasks.tenantId, tenantId), eq(tasks.caseId, part.p.caseId),
        inArray(tasks.status, ['pending', 'in_progress', 'blocked']))).orderBy(asc(tasks.plannedStartAt)),
      this.db.select({ taskId: blockers.taskId }).from(blockers).where(and(
        eq(blockers.tenantId, tenantId), eq(blockers.partRequestId, partId), isNull(blockers.resolvedAt))),
      this.db.select({ id: users.id, roles: users.roles }).from(users).where(and(
        eq(users.tenantId, tenantId), eq(users.isActive, true))),
    ]);
    const matching = jobs.filter(j => waiting.some(b => b.taskId === j.id));
    const available = matching.length ? matching : jobs;
    // Human-selected task must be active, part of the same case and (if blocked) a linked target.
    const selected = available.find(j => j.id === taskId);
    if (!selected) throw badRequest('PART_TARGET_INVALID', 'جایگاه انتخاب‌شده به این قطعه و پرونده تعلق ندارد');
    const [station] = selected.stationId ? await this.db.select({ responsibleUserId: workshopStations.responsibleUserId })
      .from(workshopStations).where(and(eq(workshopStations.id, selected.stationId), eq(workshopStations.tenantId, tenantId))) : [];
    const recipients = new Set([selected.assignedUserId, station?.responsibleUserId, part.c.responsibleUserId]
      .filter((id): id is string => !!id));
    // Spec section 7: the accident expert of the case and the station hear about it; nobody else is broadcast to.
    const allowed = new Set(staff.map(u => u.id));
    recipients.delete(actor.user.id);
    const destination = selected.stationSnapshot?.name || selected.stationSnapshot?.code || selected.title || 'واحد تعمیر';
    return this.create(actor, {
      recipients: [...recipients].filter(id => allowed.has(id)),
      body: `قطعه «${part.p.description}» برای خودرو ${part.c.caseNumber} آماده تحویل است؛ جایگاه ${destination}. لطفاً از انبار دریافت و ثبت کنید.`,
      urgency: 'normal', source: 'manual', caseId: part.c.id, plate: part.plate, targetRole: null,
    });
  }

  /** "I have a problem" on a job card: goes to the accident responsible of that case. */
  async problem(actor: Actor, taskId: string, problem: TechnicianProblem): Promise<{ id: string; recipients: number }> {
    const tenantId = actor.user.tenantId;
    const [row] = await this.db
      .select({ t: tasks, responsible: cases.responsibleUserId, plate: vehicles.plate, department: departments.name })
      .from(tasks)
      .innerJoin(cases, and(eq(cases.id, tasks.caseId), eq(cases.tenantId, tenantId)))
      .innerJoin(vehicles, eq(vehicles.id, cases.vehicleId))
      .innerJoin(departments, eq(departments.id, tasks.departmentId))
      .where(and(eq(tasks.id, taskId), eq(tasks.tenantId, tenantId)));
    if (!row) throw notFound('کار');
    if (row.t.assignedUserId !== actor.user.id) throw forbidden('این کار به شما محول نشده است');
    const staff = await this.db
      .select({ id: users.id, roles: users.roles })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.isActive, true)));
    let recipients = row.responsible && staff.some((u) => u.id === row.responsible) ? [row.responsible] : [];
    // No responsible on the case: every active accident expert of the dealership.
    if (!recipients.length) recipients = staff.filter((u) => normalizeRoles(u.roles).some((r) => COORDINATOR_ROLES.includes(r))).map((u) => u.id);
    // Spec section 9: «قطعه ندارم» (and a late part) also reaches the parts clerks.
    if (problem === 'no_part' || problem === 'part_late') {
      recipients = [...new Set([...recipients, ...staff.filter((u) => normalizeRoles(u.roles).includes('parts_clerk')).map((u) => u.id)])];
    }
    return this.create(actor, {
      recipients: recipients.filter((id) => id !== actor.user.id),
      body: `${TECHNICIAN_PROBLEM_LABELS[problem]} — ${row.t.title || row.department}`,
      urgency: 'urgent',
      source: 'technician_problem',
      caseId: row.t.caseId,
      plate: row.plate,
      targetRole: null,
    });
  }

  private async create(actor: Actor, draft: Draft): Promise<{ id: string; recipients: number }> {
    if (!draft.recipients.length) throw badRequest('NO_RECIPIENTS', 'گیرنده‌ای برای این تذکر پیدا نشد');
    const tenantId = actor.user.tenantId;
    const id = newId();
    const now = new Date();
    await this.db.transaction(async (tx) => {
      const calendar = await calendarAt(tx, tenantId, now.toISOString());
      const remindAt = new Date(addWorkingMinutes(now.toISOString(), REMINDER_NUDGE_WORKING_MINUTES, calendar.calendar));
      await tx.insert(reminders).values({
        id,
        tenantId,
        senderUserId: actor.user.id,
        caseId: draft.caseId,
        plate: draft.plate,
        body: draft.body,
        urgency: draft.urgency,
        source: draft.source,
        targetRole: draft.targetRole,
        isTest: actor.user.isTestTenant,
        createdAt: now,
      });
      await tx.insert(reminderRecipients).values(
        draft.recipients.map((userId) => ({ id: newId(), tenantId, reminderId: id, userId, remindAt, isTest: actor.user.isTestTenant, updatedAt: now })),
      );
      await this.audit.record(tx, actor, {
        entityType: 'reminder',
        entityId: id,
        caseId: draft.caseId,
        action: 'reminder.sent',
        occurredAt: now,
        after: { body: draft.body, urgency: draft.urgency, source: draft.source, targetRole: draft.targetRole, recipients: draft.recipients.length, plate: draft.plate },
      });
    });
    return { id, recipients: draft.recipients.length };
  }

  /** Open reminders of the current user for the cards at the top of the desk (urgent first). */
  async inbox(actor: Actor, now = new Date()): Promise<ReceivedReminder[]> {
    const rows = await this.received(actor, ne(reminderRecipients.status, 'done'), 30, now);
    return rows.sort((a, b) => Number(b.urgency === 'urgent') - Number(a.urgency === 'urgent') || b.createdAt.localeCompare(a.createdAt));
  }

  /** "My reminders": received and sent, newest first. */
  async mine(actor: Actor, now = new Date()): Promise<MyReminders> {
    const received = await this.received(actor, undefined, 100, now);
    const sent = await this.db
      .select({ r: reminders, caseNumber: cases.caseNumber })
      .from(reminders)
      .leftJoin(cases, and(eq(cases.id, reminders.caseId), eq(cases.tenantId, reminders.tenantId)))
      .where(and(eq(reminders.tenantId, actor.user.tenantId), eq(reminders.senderUserId, actor.user.id)))
      .orderBy(desc(reminders.createdAt), desc(reminders.id))
      .limit(100);
    const copies = sent.length
      ? await this.db
          .select({ c: reminderRecipients, name: users.displayName })
          .from(reminderRecipients)
          .innerJoin(users, eq(users.id, reminderRecipients.userId))
          .where(and(eq(reminderRecipients.tenantId, actor.user.tenantId), inArray(reminderRecipients.reminderId, sent.map((s) => s.r.id))))
          .orderBy(asc(users.displayName))
      : [];
    return {
      received,
      sent: sent.map(({ r, caseNumber }): SentReminder => ({
        id: r.id,
        body: r.body,
        urgency: r.urgency as ReminderUrgency,
        source: r.source as ReminderSource,
        case: r.caseId && caseNumber ? { id: r.caseId, caseNumber } : null,
        plate: r.plate,
        targetRole: (r.targetRole as Role | null) ?? null,
        createdAt: r.createdAt.toISOString(),
        recipients: copies
          .filter(({ c }) => c.reminderId === r.id)
          .map(({ c, name }) => ({ id: c.id, userId: c.userId, displayName: name, status: c.status as ReminderStatus, seenAt: iso(c.seenAt), doneAt: iso(c.doneAt), reply: c.reply })),
      })),
    };
  }

  private async received(actor: Actor, condition: SQL | undefined, limit: number, now: Date): Promise<ReceivedReminder[]> {
    const rows = await this.db
      .select({ c: reminderRecipients, r: reminders, senderName: sender.displayName, senderRoles: sender.roles, senderOwner: sender.isOwner, caseNumber: cases.caseNumber })
      .from(reminderRecipients)
      .innerJoin(reminders, and(eq(reminders.id, reminderRecipients.reminderId), eq(reminders.tenantId, reminderRecipients.tenantId)))
      .innerJoin(sender, eq(sender.id, reminders.senderUserId))
      .leftJoin(cases, and(eq(cases.id, reminders.caseId), eq(cases.tenantId, reminders.tenantId)))
      .where(and(eq(reminderRecipients.tenantId, actor.user.tenantId), eq(reminderRecipients.userId, actor.user.id), condition))
      .orderBy(desc(reminders.createdAt), desc(reminderRecipients.id))
      .limit(limit);
    return rows.map(({ c, r, senderName, senderRoles, senderOwner, caseNumber }) => ({
      id: c.id,
      reminderId: r.id,
      sender: { id: r.senderUserId, displayName: senderName, roleLabel: senderOwner ? 'مالک' : (normalizeRoles(senderRoles as string[]).map((role) => ROLE_LABELS[role])[0] ?? '') },
      body: r.body,
      urgency: r.urgency as ReminderUrgency,
      source: r.source as ReminderSource,
      case: r.caseId && caseNumber ? { id: r.caseId, caseNumber } : null,
      plate: r.plate,
      status: c.status as ReminderStatus,
      seenAt: iso(c.seenAt),
      doneAt: iso(c.doneAt),
      reply: c.reply,
      createdAt: r.createdAt.toISOString(),
      overdue: c.status === 'sent' && (!!c.remindedAt || c.remindAt.getTime() <= now.getTime()),
      version: c.version,
    }));
  }

  /** Seen, done (with an optional one-line reply) or a reply; only by the recipient. */
  async respond(actor: Actor, recipientId: string, input: ReminderRespondInput): Promise<ReceivedReminder> {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ c: reminderRecipients, caseId: reminders.caseId })
        .from(reminderRecipients)
        .innerJoin(reminders, eq(reminders.id, reminderRecipients.reminderId))
        .where(and(eq(reminderRecipients.id, recipientId), eq(reminderRecipients.tenantId, actor.user.tenantId), eq(reminderRecipients.userId, actor.user.id)))
        .for('update');
      if (!row) throw notFound('تذکر');
      const c = row.c;
      if (c.version !== input.expectedVersion) throw versionConflict(c.version);
      const status = c.status as ReminderStatus;
      let patch: Partial<typeof reminderRecipients.$inferSelect>;
      if (input.action === 'seen') {
        if (status !== 'sent') return;
        patch = { status: 'seen', seenAt: now };
      } else if (input.action === 'done') {
        if (status === 'done') return;
        patch = { status: 'done', doneAt: now, seenAt: c.seenAt ?? now, ...(input.reply ? { reply: input.reply } : {}) };
      } else {
        patch = { reply: input.reply, ...(status === 'sent' ? { status: 'seen', seenAt: now } : {}) };
      }
      const [updated] = await tx
        .update(reminderRecipients)
        .set({ ...patch, updatedAt: now, version: c.version + 1 })
        .where(and(eq(reminderRecipients.id, c.id), eq(reminderRecipients.version, c.version)))
        .returning();
      if (!updated) throw versionConflict();
      await this.audit.record(tx, actor, {
        entityType: 'reminder',
        entityId: c.reminderId,
        caseId: row.caseId,
        action: input.action === 'reply' ? 'reminder.replied' : `reminder.${input.action}`,
        occurredAt: now,
        before: { recipientId: c.id, status: c.status, reply: c.reply },
        after: { recipientId: c.id, status: updated.status, reply: updated.reply },
        snapshot: { version: updated.version, row: updated },
      });
    });
    const [result] = await this.received(actor, eq(reminderRecipients.id, recipientId), 1, now);
    if (!result) throw notFound('تذکر');
    return result;
  }

  /** Sends a notification once for each reminder still unseen two working hours after it was sent. */
  async tick(now = new Date()): Promise<{ nudged: number }> {
    const due = await this.db
      .select({ c: reminderRecipients, body: reminders.body, plate: reminders.plate })
      .from(reminderRecipients)
      .innerJoin(reminders, eq(reminders.id, reminderRecipients.reminderId))
      .where(and(eq(reminderRecipients.status, 'sent'), isNull(reminderRecipients.remindedAt), lte(reminderRecipients.remindAt, now)))
      .limit(500);
    let nudged = 0;
    for (const { c, body, plate } of due) {
      nudged += await this.db.transaction(async (tx) => {
        const [claimed] = await tx
          .update(reminderRecipients)
          .set({ remindedAt: now })
          .where(and(eq(reminderRecipients.id, c.id), eq(reminderRecipients.status, 'sent'), isNull(reminderRecipients.remindedAt)))
          .returning({ id: reminderRecipients.id });
        if (!claimed) return 0;
        const rows = await tx
          .insert(notifications)
          .values({
            id: newId(),
            tenantId: c.tenantId,
            userId: c.userId,
            kind: 'reminder_unseen',
            title: 'یادآوری: تذکری هنوز دیده نشده است',
            body: plate ? `${plate} — ${body}` : body,
            link: '/reminders',
            dedupeKey: `reminder:${c.id}`,
          })
          .onConflictDoNothing()
          .returning({ id: notifications.id });
        return rows.length;
      });
    }
    return { nudged };
  }
}
