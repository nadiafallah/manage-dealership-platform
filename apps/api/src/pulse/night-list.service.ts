import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, lt } from 'drizzle-orm';
import {
  compareNightRows, daysInShop, isWorkingDay, NIGHT_LIST_DEADLINE, NIGHT_LIST_GENERATE_AT, nightListLate, nightListMissing, nightListSheet, normalizeRoles, shortVehicleName, toPersianDigits,
  type NightListItemInput, type NightListPending, type NightListReason, type NightListRow, type NightListStatus, type NightListView,
} from '@manage/shared';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../auth/auth.types';
import { badRequest, conflict, notFound, versionConflict } from '../common/errors';
import { newId } from '../common/ids';
import { APP_CONFIG, type AppConfig } from '../config';
import { tehranAt, tehranDate } from '../daily-reports/daily-time';
import { safeCell } from '../daily-reports/safe-cell';
import { DATABASE, type DatabaseHandle } from '../db/database';
import { nightListItems, nightLists, notifications, receptionRepairs, receptions, tenants, users } from '../db/schema';
import { writeWorkbook } from '../parts/xlsx';
import { calendarAt } from '../workshop/work-calendar';

/**
 * «لیست شب» (reconstruction scenario, owner 2026-11-25). At 18:00 Tehran on a working day the open
 * receptions become a draft list; the receptionist picks one stay reason per vehicle (the reason of
 * the previous list is copied in), and the reception supervisor sends it. Still a draft at 18:45:
 * the service manager is told once. Nothing here writes to کسب‌وکار; receptions stay read only.
 */
@Injectable()
export class NightListService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(NightListService.name);
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
    if (!this.cfg.PULSE_ENABLED || !this.cfg.DAILY_SCHEDULER || this.cfg.APP_ENV === 'test') return;
    const run = () => void this.tick().catch((e: unknown) => this.logger.error(`night list tick failed: ${e instanceof Error ? e.message : 'unknown'}`));
    this.timer = setInterval(run, 60_000);
    this.timer.unref();
    run();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  private ensureActive() {
    if (!this.cfg.PULSE_ENABLED) throw badRequest('RECEPTION_DISABLED', 'بخش پذیرش و ترخیص هنوز روی این سرور فعال نشده است.');
  }

  private async workingDay(tenantId: string, day: string) {
    const revision = await calendarAt(this.db, tenantId, tehranAt(day, '12:00').toISOString());
    return isWorkingDay(day, revision.calendar);
  }

  /** Every minute: today's draft after 18:00 on a working day, and the 18:45 alert once. Idempotent. */
  async tick(now = new Date()): Promise<{ generated: number; alerted: number }> {
    const day = tehranDate(now);
    let generated = 0;
    let alerted = 0;
    if (now < tehranAt(day, NIGHT_LIST_GENERATE_AT)) return { generated, alerted };
    for (const t of await this.db.select({ id: tenants.id, isTest: tenants.isTest }).from(tenants)) {
      if (!(await this.workingDay(t.id, day))) continue;
      if (await this.generate(t.id, day, null, t.isTest, now)) generated += 1;
      alerted += await this.alertLate(t.id, day, now);
    }
    return { generated, alerted };
  }

  /**
   * Creates the day's list (once) and adds every open reception not on it yet. Returns true when the
   * list was created now. A reason given on the previous list for the same reception is copied in.
   */
  async generate(tenantId: string, day: string, actor: Actor | null, isTest: boolean, now = new Date()): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const listId = newId();
      const created = await tx.insert(nightLists).values({ id: listId, tenantId, day, generatedAt: now, isTest }).onConflictDoNothing().returning({ id: nightLists.id });
      const [list] = await tx.select().from(nightLists).where(and(eq(nightLists.tenantId, tenantId), eq(nightLists.day, day))).for('update');
      if (!list) return false;
      if (list.status !== 'draft') return created.length > 0;
      const open = await tx.select({ id: receptions.id }).from(receptions)
        .where(and(eq(receptions.tenantId, tenantId), eq(receptions.isOpen, true), lt(receptions.admittedAt, now)));
      const present = new Set((await tx.select({ receptionId: nightListItems.receptionId }).from(nightListItems).where(eq(nightListItems.listId, list.id))).map((r) => r.receptionId));
      const missing = open.map((r) => r.id).filter((id) => !present.has(id));
      if (missing.length) {
        // The latest earlier list item of each reception, for the reason and stations to copy.
        const earlier = await tx.select({ receptionId: nightListItems.receptionId, reason: nightListItems.reason, reasonNote: nightListItems.reasonNote, currentStation: nightListItems.currentStation, nextStations: nightListItems.nextStations, day: nightLists.day })
          .from(nightListItems).innerJoin(nightLists, eq(nightLists.id, nightListItems.listId))
          .where(and(eq(nightListItems.tenantId, tenantId), inArray(nightListItems.receptionId, missing), lt(nightLists.day, day)))
          .orderBy(desc(nightLists.day));
        const previous = new Map<string, (typeof earlier)[number]>();
        for (const e of earlier) if (!previous.has(e.receptionId)) previous.set(e.receptionId, e);
        await tx.insert(nightListItems).values(missing.map((receptionId) => {
          const p = previous.get(receptionId);
          return { id: newId(), tenantId, listId: list.id, receptionId, reason: p?.reason ?? null, reasonNote: p?.reasonNote ?? null, currentStation: p?.currentStation ?? null, nextStations: p?.nextStations ?? null, carried: !!p?.reason, isTest };
        })).onConflictDoNothing();
      }
      if (created.length || missing.length) {
        if (actor) await this.audit.record(tx, actor, { entityType: 'night_list', entityId: list.id, action: 'reception.night_list_generated', after: { day, added: missing.length } });
      }
      return created.length > 0;
    });
  }

  /** Still a draft at 18:45: one notification to each active service manager (the owner when there is none). */
  private async alertLate(tenantId: string, day: string, now: Date): Promise<number> {
    const deadline = tehranAt(day, NIGHT_LIST_DEADLINE);
    if (now < deadline) return 0;
    const staff = await this.db.select({ id: users.id, roles: users.roles, isOwner: users.isOwner }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.isActive, true)));
    const managers = staff.filter((u) => normalizeRoles(u.roles).includes('service_manager')).map((u) => u.id);
    const recipients = managers.length ? managers : staff.filter((u) => u.isOwner).map((u) => u.id);
    if (!recipients.length) return 0;
    return this.db.transaction(async (tx) => {
      const [claimed] = await tx.update(nightLists).set({ lateNotifiedAt: now })
        .where(and(eq(nightLists.tenantId, tenantId), eq(nightLists.day, day), eq(nightLists.status, 'draft'), isNull(nightLists.lateNotifiedAt)))
        .returning({ id: nightLists.id });
      if (!claimed) return 0;
      const rows = await tx.insert(notifications).values(recipients.map((userId) => ({
        id: newId(), tenantId, userId, kind: 'night_list_late', title: 'لیست شب هنوز ارسال نشده است',
        body: `مهلت ارسال لیست شب (ساعت ${toPersianDigits(NIGHT_LIST_DEADLINE)}) گذشت.`, link: '/reception/night', dedupeKey: `night_list_late:${day}`, urgent: true,
      }))).onConflictDoNothing().returning({ id: notifications.id });
      return rows.length;
    });
  }

  /** The list of a day, or when it is not built yet, the time it will be. */
  async view(actor: Actor, day?: string, now = new Date()): Promise<NightListView | NightListPending> {
    this.ensureActive();
    const tenantId = actor.user.tenantId;
    const d = day ?? tehranDate(now);
    const [list] = await this.db.select({ l: nightLists, sentByName: users.displayName }).from(nightLists).leftJoin(users, eq(users.id, nightLists.sentBy))
      .where(and(eq(nightLists.tenantId, tenantId), eq(nightLists.day, d)));
    if (!list) return { day: d, status: 'not_generated', generatesAt: tehranAt(d, NIGHT_LIST_GENERATE_AT).toISOString(), workingDay: await this.workingDay(tenantId, d) };
    return this.render(tenantId, list.l, list.sentByName ?? null, now);
  }

  private async render(tenantId: string, l: typeof nightLists.$inferSelect, sentByName: string | null, now: Date): Promise<NightListView> {
    const items = await this.db.select({ i: nightListItems, r: receptions, setByName: users.displayName }).from(nightListItems)
      .innerJoin(receptions, eq(receptions.id, nightListItems.receptionId))
      .leftJoin(users, eq(users.id, nightListItems.setBy))
      .where(and(eq(nightListItems.tenantId, tenantId), eq(nightListItems.listId, l.id)));
    const ids = items.map((x) => x.r.id);
    const labour = ids.length
      ? await this.db.select({ receptionId: receptionRepairs.receptionId, description: receptionRepairs.description, code: receptionRepairs.code, state: receptionRepairs.state }).from(receptionRepairs)
        .where(and(eq(receptionRepairs.tenantId, tenantId), inArray(receptionRepairs.receptionId, ids), isNull(receptionRepairs.removedAt)))
      : [];
    const labourOf = new Map<string, string[]>();
    for (const x of labour) {
      const text = [x.description || x.code || 'اجرت', x.state && `(${x.state})`].filter(Boolean).join(' ');
      labourOf.set(x.receptionId, [...(labourOf.get(x.receptionId) ?? []), text]);
    }
    const at = tehranAt(l.day, NIGHT_LIST_GENERATE_AT);
    const rows: NightListRow[] = items.map(({ i, r, setByName }) => ({
      id: i.id,
      version: i.version,
      receptionId: r.id,
      admissionNo: r.admissionNo,
      plate: r.plate,
      vehicleName: r.productName || r.modelName ? shortVehicleName(r.productName, r.productName ?? r.modelName) : null,
      ownerName: r.customerName,
      daysIn: r.admittedAt ? daysInShop(r.admittedAt.toISOString(), at.getTime()) : null,
      isOpen: r.isOpen,
      accident: !!r.caseId,
      labour: labourOf.get(r.id) ?? [],
      currentStation: i.currentStation,
      nextStations: i.nextStations,
      reason: (i.reason as NightListReason | null) ?? null,
      reasonNote: i.reasonNote,
      carried: i.carried,
      setByName: setByName ?? null,
      setAt: i.setAt?.toISOString() ?? null,
    })).sort(compareNightRows);
    const deadline = tehranAt(l.day, NIGHT_LIST_DEADLINE);
    const status = l.status as NightListStatus;
    return {
      id: l.id, day: l.day, status, version: l.version, generatedAt: l.generatedAt.toISOString(), sentAt: l.sentAt?.toISOString() ?? null, sentByName,
      deadline: deadline.toISOString(), late: nightListLate(status, deadline, now), missingReasons: nightListMissing(rows), rows,
    };
  }

  /** Draft now (before 18:00 or after a missed minute) by the person who sends the list. */
  async generateNow(actor: Actor, day?: string): Promise<NightListView | NightListPending> {
    this.ensureActive();
    const d = day ?? tehranDate(new Date());
    if (d > tehranDate(new Date())) throw badRequest('NIGHT_LIST_FUTURE', 'لیست شب روزهای آینده ساخته نمی‌شود.');
    await this.generate(actor.user.tenantId, d, actor, actor.user.isTestTenant);
    return this.view(actor, d);
  }

  async setItem(actor: Actor, itemId: string, input: NightListItemInput): Promise<NightListView> {
    this.ensureActive();
    const tenantId = actor.user.tenantId;
    const listId = await this.db.transaction(async (tx) => {
      const [item] = await tx.select().from(nightListItems).where(and(eq(nightListItems.tenantId, tenantId), eq(nightListItems.id, itemId))).for('update');
      if (!item) throw notFound('ردیف لیست شب');
      if (item.version !== input.expectedVersion) throw versionConflict(item.version);
      const next = {
        reason: input.reason,
        reasonNote: input.reasonNote?.trim() || null,
        currentStation: input.currentStation?.trim() || null,
        nextStations: input.nextStations?.trim() || null,
      };
      await tx.update(nightListItems).set({ ...next, carried: false, setBy: actor.user.id, setAt: new Date(), version: item.version + 1 }).where(eq(nightListItems.id, item.id));
      await this.audit.record(tx, actor, {
        entityType: 'night_list', entityId: item.listId, action: 'reception.night_list_item_set',
        before: { receptionId: item.receptionId, reason: item.reason, reasonNote: item.reasonNote, currentStation: item.currentStation, nextStations: item.nextStations, carried: item.carried },
        after: { receptionId: item.receptionId, ...next },
      });
      return item.listId;
    });
    return this.byId(actor, listId);
  }

  /** The reception supervisor sends the list; missing reasons are a warning, not a lock (spec section 2). */
  async send(actor: Actor, listId: string, expectedVersion: number): Promise<NightListView> {
    this.ensureActive();
    const tenantId = actor.user.tenantId;
    await this.db.transaction(async (tx) => {
      const [list] = await tx.select().from(nightLists).where(and(eq(nightLists.tenantId, tenantId), eq(nightLists.id, listId))).for('update');
      if (!list) throw notFound('لیست شب');
      if (list.version !== expectedVersion) throw versionConflict(list.version);
      if (list.status === 'sent') throw conflict('NIGHT_LIST_SENT', 'این لیست قبلاً ارسال شده است.');
      const now = new Date();
      await tx.update(nightLists).set({ status: 'sent', sentAt: now, sentBy: actor.user.id, version: list.version + 1 }).where(eq(nightLists.id, list.id));
      const missing = (await tx.select({ id: nightListItems.id }).from(nightListItems).where(and(eq(nightListItems.listId, list.id), isNull(nightListItems.reason)))).length;
      await this.audit.record(tx, actor, { entityType: 'night_list', entityId: list.id, action: 'reception.night_list_sent', before: { status: list.status }, after: { status: 'sent', day: list.day, missingReasons: missing } });
      const staff = await tx.select({ id: users.id, roles: users.roles, isOwner: users.isOwner }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.isActive, true)));
      const recipients = staff.filter((u) => u.id !== actor.user.id && (u.isOwner || normalizeRoles(u.roles).includes('service_manager'))).map((u) => u.id);
      if (recipients.length) {
        await tx.insert(notifications).values(recipients.map((userId) => ({
          id: newId(), tenantId, userId, kind: 'night_list_sent', title: 'لیست شب ارسال شد', body: missing ? `${missing} خودرو بدون علت ماندن است.` : null,
          link: `/reception/night?day=${list.day}`, dedupeKey: `night_list_sent:${list.day}`,
        }))).onConflictDoNothing();
      }
    });
    return this.byId(actor, listId);
  }

  private async byId(actor: Actor, listId: string): Promise<NightListView> {
    const [list] = await this.db.select({ l: nightLists, sentByName: users.displayName }).from(nightLists).leftJoin(users, eq(users.id, nightLists.sentBy))
      .where(and(eq(nightLists.tenantId, actor.user.tenantId), eq(nightLists.id, listId)));
    if (!list) throw notFound('لیست شب');
    return this.render(actor.user.tenantId, list.l, list.sentByName ?? null, new Date());
  }

  async excel(actor: Actor, listId: string): Promise<{ day: string; bytes: Uint8Array }> {
    this.ensureActive();
    const view = await this.byId(actor, listId);
    // Texts come from کسب‌وکار and people: neutralise spreadsheet formulas.
    const rows = nightListSheet(view.rows).map((r) => r.map((c) => (typeof c === 'string' ? safeCell(c) : c)));
    return { day: view.day, bytes: writeWorkbook([{ name: 'لیست شب', rows }]) };
  }
}
