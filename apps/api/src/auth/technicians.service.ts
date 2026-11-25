import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, like, sql } from 'drizzle-orm';
import type { TechnicianPinInput } from '@manage/shared';
import { randomBytes } from 'node:crypto';
import { normalizeRoles, nextTechnicianUsername, technicianUsernameForStation, staffCodePrefixForRoles, staffUsernameForCode, REPAIR_TRADE_LABELS, type RepairTrade, type TechnicianAccountInput } from '@manage/shared';
import { AuditService } from '../audit/audit.service';
import { badRequest, conflict, notFound } from '../common/errors';
import { newId } from '../common/ids';
import { DATABASE, type DatabaseHandle, type Tx } from '../db/database';
import { departments, sessions, trustedDevices, users, workshopStations } from '../db/schema';
import { isTechnicianOnly } from './auth.service';
import type { Actor } from './auth.types';
import { hashPassword } from './password';
import { requireSupportReason } from './support-reason';

export interface TechnicianAccount {
  id: string;
  username: string;
  displayName: string;
  isActive: boolean;
  roles: string[];
  hasEmail: boolean;
  hasPin: boolean;
  /** PIN sign-in works only once a device password exists (it registers new devices). */
  hasDevicePassword: boolean;
  trustedDevices: number;
  locked: boolean;
  lastLoginAt: string | null;
  /** The bay this technician is responsible for, if any. */
  station: { code: string; name: string; trade: RepairTrade } | null;
}

/**
 * Technician accounts without email: username + 4-digit PIN, technician role
 * only. Created and reset by whoever holds user.manage (owner, and the system
 * administrator while the owner allows it).
 */
@Injectable()
export class TechniciansService {
  constructor(
    @Inject(DATABASE) private readonly handle: DatabaseHandle,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.handle.db;
  }

  async list(actor: Actor): Promise<TechnicianAccount[]> {
    const rows = await this.db
      .select()
      .from(users)
      .where(eq(users.tenantId, actor.user.tenantId))
      .orderBy(asc(users.displayName));
    const now = Date.now();
    const technicians = rows.filter((u) => isTechnicianOnly(u.roles, u.isOwner));
    const bays = technicians.length
      ? await this.db
          .select({ userId: workshopStations.responsibleUserId, code: workshopStations.code, name: workshopStations.name, trade: workshopStations.trade })
          .from(workshopStations)
          .where(and(eq(workshopStations.tenantId, actor.user.tenantId), inArray(workshopStations.responsibleUserId, technicians.map((u) => u.id))))
          .orderBy(asc(workshopStations.code))
      : [];
    const devices = technicians.length
      ? await this.db
          .select({ userId: trustedDevices.userId })
          .from(trustedDevices)
          .where(and(eq(trustedDevices.tenantId, actor.user.tenantId), isNull(trustedDevices.revokedAt), inArray(trustedDevices.userId, technicians.map((u) => u.id))))
      : [];
    return technicians
      .map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        isActive: u.isActive,
        roles: u.roles,
        hasEmail: !!u.email,
        hasPin: !!u.pinHash,
        hasDevicePassword: !!u.devicePasswordHash,
        trustedDevices: devices.filter((d) => d.userId === u.id).length,
        locked: !!u.lockedUntil && u.lockedUntil.getTime() > now,
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
        station: ((bay) => (bay ? { code: bay.code, name: bay.name, trade: bay.trade as RepairTrade } : null))(bays.find((b) => b.userId === u.id)),
      }));
  }

  async create(actor: Actor, input: TechnicianAccountInput): Promise<TechnicianAccount[]> {
    const tenantId = actor.user.tenantId;
    await this.db.transaction(async (tx) => {
      if (input.stationCode && input.trade) {
        const [bay] = await tx.select().from(workshopStations).where(and(eq(workshopStations.tenantId, tenantId), eq(workshopStations.code, input.stationCode))).for('update');
        if (bay && bay.trade !== input.trade) throw badRequest('STATION_TRADE_MISMATCH', 'این جایگاه متعلق به واحد دیگری است');
        if (bay?.responsibleUserId) {
          const [holder] = await tx.select({ isActive: users.isActive }).from(users).where(and(eq(users.id, bay.responsibleUserId), eq(users.tenantId, tenantId)));
          if (holder?.isActive) throw conflict('STATION_TAKEN', 'این جایگاه به همکار دیگری سپرده شده است');
        }
      }
      let derived: string | undefined;
      try {
        derived = input.role === 'technician' && input.stationCode
          ? technicianUsernameForStation(input.stationCode)
          : input.role !== 'technician' && input.personnelCode ? staffUsernameForCode(input.personnelCode, staffCodePrefixForRoles([input.role])) : undefined;
      } catch { throw badRequest('INVALID_STAFF_CODE', 'کد جایگاه یا کد دو رقمی کارشناس معتبر نیست'); }
      if (derived && input.username && input.username.toLowerCase() !== derived) throw badRequest('USERNAME_CODE_MISMATCH', 'نام کاربری باید با کد جایگاه یا کد انتخابی کارشناس یکسان باشد');
      const username = derived ?? input.username ??
        nextTechnicianUsername(
          (await tx.select({ username: users.username }).from(users).where(and(eq(users.tenantId, tenantId), like(users.username, 'tech%')))).map((r) => r.username),
        );
      const [taken] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.tenantId, tenantId), eq(users.username, username)));
      if (taken) throw conflict('USERNAME_TAKEN', 'این نام کاربری قبلاً استفاده شده است');
      const id = newId();
      await tx.insert(users).values({
        id,
        tenantId,
        username,
        displayName: input.displayName,
        // Never used: technicians sign in with their PIN only.
        passwordHash: await hashPassword(randomBytes(24).toString('base64url')),
        pinHash: await hashPassword(input.pin),
        devicePasswordHash: input.devicePassword ? await hashPassword(input.devicePassword) : null,
        roles: [input.role],
        isActive: true,
        activatedAt: new Date(),
        isTest: actor.user.isTestTenant,
      });
      await this.audit.record(tx, actor, {
        entityType: 'user',
        entityId: id,
        action: 'user.technician_created',
        after: { username, displayName: input.displayName, roles: [input.role], ...(input.stationCode ? { stationCode: input.stationCode, trade: input.trade } : {}) },
      });
      if (input.trade && input.stationCode) await this.assignBay(tx, actor, id, input.trade, input.stationCode);
    });
    return this.list(actor);
  }

  /**
   * Makes the technician responsible for bay `code` of `trade`: an existing free
   * bay of the same unit is linked, a new code creates the bay (and the unit if
   * it was never set up). A bay held by another active colleague is refused.
   */
  private async assignBay(tx: Tx, actor: Actor, technicianId: string, trade: RepairTrade, code: string) {
    const tenantId = actor.user.tenantId;
    const [existing] = await tx.select().from(workshopStations).where(and(eq(workshopStations.tenantId, tenantId), eq(workshopStations.code, code))).for('update');
    if (existing) {
      if (existing.trade !== trade)
        throw badRequest('STATION_TRADE_MISMATCH', `جایگاه ${code} برای ${REPAIR_TRADE_LABELS[existing.trade as RepairTrade] ?? existing.trade} تعریف شده است؛ واحد درست را انتخاب کنید یا کد دیگری بدهید`);
      if (existing.responsibleUserId) {
        const [holder] = await tx.select({ displayName: users.displayName, isActive: users.isActive }).from(users).where(eq(users.id, existing.responsibleUserId));
        if (holder?.isActive) throw conflict('STATION_TAKEN', `جایگاه ${code} به ${holder.displayName} سپرده شده است`);
      }
      const [row] = await tx
        .update(workshopStations)
        .set({ responsibleUserId: technicianId, isActive: true, version: existing.version + 1, updatedAt: new Date() })
        .where(eq(workshopStations.id, existing.id))
        .returning();
      await this.audit.record(tx, actor, { entityType: 'workshop_station', entityId: existing.id, action: 'workshop_station.updated', before: existing, after: { responsibleUserId: technicianId, isActive: true }, snapshot: { version: row!.version, row } });
      return;
    }
    let [department] = await tx.select().from(departments).where(and(eq(departments.tenantId, tenantId), eq(departments.code, trade)));
    if (!department) {
      const departmentId = newId();
      [department] = await tx.insert(departments).values({ id: departmentId, tenantId, code: trade, name: REPAIR_TRADE_LABELS[trade] }).returning();
      await this.audit.record(tx, actor, { entityType: 'reference', entityId: departmentId, action: 'department.created', after: { code: trade, name: department!.name }, snapshot: { version: 1, row: department } });
    }
    const stationId = newId();
    const fields = { departmentId: department!.id, code, name: `${REPAIR_TRADE_LABELS[trade]} ${code}`, trade, responsibleUserId: technicianId, isActive: true };
    const [row] = await tx.insert(workshopStations).values({ ...fields, id: stationId, tenantId, isTest: actor.user.isTestTenant }).returning();
    await this.audit.record(tx, actor, { entityType: 'workshop_station', entityId: stationId, action: 'workshop_station.created', after: fields, snapshot: { version: 1, row } });
  }

  /** Sets the PIN and/or the device password; also enables PIN sign-in on an existing eligible account. */
  async resetPin(actor: Actor, id: string, input: Pick<TechnicianPinInput, 'pin' | 'devicePassword'>, reason?: string): Promise<TechnicianAccount[]> {
    await this.db.transaction(async (tx) => {
      const user = await this.loadTechnician(tx, actor.user.tenantId, id);
      requireSupportReason(actor, reason);
      if (!input.pin && !user.pinHash) throw badRequest('PIN_REQUIRED', 'رمز ۴ رقمی را هم وارد کنید');
      await tx
        .update(users)
        .set({
          ...(input.pin ? { pinHash: await hashPassword(input.pin) } : {}),
          ...(input.devicePassword ? { devicePasswordHash: await hashPassword(input.devicePassword) } : {}),
          failedLoginCount: 0, lockedUntil: null, updatedAt: new Date(), version: sql`${users.version} + 1`,
        })
        .where(eq(users.id, user.id));
      // A new PIN ends every open session; a new device password also forgets every registered device.
      await this.endSessions(tx, user.id, !!input.devicePassword);
      await this.audit.record(tx, actor, { entityType: 'user', entityId: user.id, action: 'user.technician_pin_reset', reason: reason?.trim() || null, after: { pin: !!input.pin, devicePassword: !!input.devicePassword } });
    });
    return this.list(actor);
  }

  /**
   * Gives an existing expert, parts clerk, service manager or guest the owner-chosen
   * two-digit username (EXP, MGR for a service manager, GST for a guest). Only the sign-in name changes: ID, PIN, device
   * password, registered devices, open sessions and history stay. The old name
   * is not kept as an alias. Technicians follow their station code instead.
   */
  async setExpertCode(actor: Actor, id: string, code: string, reason?: string): Promise<TechnicianAccount[]> {
    await this.db.transaction(async (tx) => {
      const user = await this.loadTechnician(tx, actor.user.tenantId, id);
      if (normalizeRoles(user.roles).includes('technician')) throw badRequest('TECHNICIAN_USES_STATION', 'نام کاربری تکنسین از کد جایگاه او ساخته می‌شود');
      requireSupportReason(actor, reason);
      let username: string;
      // EXP for operational roles, MGR for a service manager, GST for a guest (scenario 2026-11-25). Existing names stay valid until changed here.
      try { username = staffUsernameForCode(code, staffCodePrefixForRoles(normalizeRoles(user.roles))); } catch { throw badRequest('INVALID_STAFF_CODE', 'کد کارشناس باید دو رقم باشد'); }
      if (username === user.username) return;
      const [taken] = await tx.select({ id: users.id }).from(users).where(and(eq(users.tenantId, actor.user.tenantId), eq(users.username, username)));
      if (taken) throw conflict('USERNAME_TAKEN', `نام کاربری ${username.toUpperCase()} متعلق به همکار دیگری است`);
      await tx.update(users).set({ username, updatedAt: new Date(), version: sql`${users.version} + 1` }).where(eq(users.id, user.id));
      await this.audit.record(tx, actor, { entityType: 'user', entityId: user.id, action: 'user.username_changed', reason: reason?.trim() || null, before: { username: user.username }, after: { username } });
    });
    return this.list(actor);
  }

  /** Forced sign-out: ends all sessions and forgets every registered device of the account. */
  async signOutEverywhere(actor: Actor, id: string, reason?: string): Promise<TechnicianAccount[]> {
    await this.db.transaction(async (tx) => {
      const user = await this.loadTechnician(tx, actor.user.tenantId, id);
      requireSupportReason(actor, reason);
      await this.endSessions(tx, user.id, true);
      await this.audit.record(tx, actor, { entityType: 'user', entityId: user.id, action: 'user.technician_signed_out', reason: reason?.trim() || null });
    });
    return this.list(actor);
  }

  private async endSessions(tx: Tx, userId: string, devices: boolean) {
    await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
    if (devices) await tx.update(trustedDevices).set({ revokedAt: new Date() }).where(and(eq(trustedDevices.userId, userId), isNull(trustedDevices.revokedAt)));
  }

  async setActive(actor: Actor, id: string, active: boolean, reason?: string): Promise<TechnicianAccount[]> {
    await this.db.transaction(async (tx) => {
      const user = await this.loadTechnician(tx, actor.user.tenantId, id);
      requireSupportReason(actor, reason);
      await tx.update(users).set({ isActive: active, updatedAt: new Date(), version: sql`${users.version} + 1` }).where(eq(users.id, user.id));
      if (!active) await this.endSessions(tx, user.id, true);
      await this.audit.record(tx, actor, {
        entityType: 'user',
        entityId: user.id,
        action: active ? 'user.technician_activated' : 'user.technician_deactivated',
        reason: reason?.trim() || null,
      });
    });
    return this.list(actor);
  }

  private async loadTechnician(tx: Tx, tenantId: string, id: string) {
    const [user] = await tx.select().from(users).where(and(eq(users.id, id), eq(users.tenantId, tenantId)));
    if (!user) throw notFound('تعمیرکار');
    if (!isTechnicianOnly(user.roles, user.isOwner)) {
      throw badRequest('NOT_TECHNICIAN_ACCOUNT', 'ورود با رمز ۴ رقمی برای مالک، مدیران و نقش‌های مدیریتی ممکن نیست');
    }
    return user;
  }
}
