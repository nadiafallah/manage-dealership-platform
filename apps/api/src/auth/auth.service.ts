import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { isPinEligible, MODULES, normalizeRoles, permissionsFor, PIN_DENIED_PERMISSIONS, type LoginInput, type Me, type TechnicianLoginInput } from '@manage/shared';
import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../config';
import { AppError } from '../common/errors';
import { newId } from '../common/ids';
import { DATABASE, type DatabaseHandle, type Tx } from '../db/database';
import { sessions, tenants, trustedDevices, users } from '../db/schema';
import type { AuthUser } from './auth.types';
import { hashPassword, verifyPassword } from './password';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const TOUCH_INTERVAL_MS = 5 * 60_000;

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

const invalidCredentials = () =>
  new AppError(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'نام کاربری یا رمز عبور نادرست است');

/** A PIN account may hold only ordinary staff roles (PIN_LOGIN_ROLES): never the owner or an administrator. */
export const isTechnicianOnly = isPinEligible;

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');
  // Verified against when the user does not exist, so response time does not
  // reveal which usernames are valid.
  private dummyHash = hashPassword(randomBytes(16).toString('hex'));

  constructor(
    @Inject(DATABASE) private readonly handle: DatabaseHandle,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.handle.db;
  }

  async login(
    input: LoginInput,
    meta: { ip?: string; userAgent?: string; requestId?: string },
  ): Promise<{ token: string; expiresAt: Date }> {
    if (this.cfg.TOTP_AUTH_ENABLED) {
      throw new AppError(403, 'EMAIL_LOGIN_REQUIRED', 'با ایمیل و کد تأیید وارد شوید');
    }
    const conditions = [eq(users.username, input.username.toLowerCase())];
    if (input.tenantCode) conditions.push(eq(tenants.code, input.tenantCode.toLowerCase()));
    const candidates = await this.db
      .select({ user: users, tenant: tenants })
      .from(users)
      .innerJoin(tenants, eq(tenants.id, users.tenantId))
      .where(and(...conditions))
      .limit(2);

    if (candidates.length > 1) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'TENANT_REQUIRED', 'کد نمایندگی را وارد کنید');
    }
    const found = candidates[0];
    if (!found) {
      await verifyPassword(input.password, await this.dummyHash);
      this.logger.warn({ username: input.username, ip: meta.ip }, 'login failed: unknown user');
      throw invalidCredentials();
    }
    const { user, tenant } = found;
    if (user.email) throw new AppError(403, 'EMAIL_LOGIN_REQUIRED', 'با ایمیل و کد تأیید وارد شوید');
    const now = new Date();

    if (user.lockedUntil && user.lockedUntil > now) {
      throw new AppError(
        HttpStatus.TOO_MANY_REQUESTS,
        'ACCOUNT_LOCKED',
        'به دلیل تلاش‌های ناموفق، حساب موقتاً قفل شده است. چند دقیقه بعد دوباره تلاش کنید.',
      );
    }

    const ok = await verifyPassword(input.password, user.passwordHash);
    if (!ok || !user.isActive) {
      const failed = user.failedLoginCount + 1;
      await this.db
        .update(users)
        .set({
          failedLoginCount: failed >= MAX_FAILED_LOGINS ? 0 : failed,
          lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : null,
        })
        .where(eq(users.id, user.id));
      this.logger.warn({ userId: user.id, ip: meta.ip, failed }, 'login failed');
      throw invalidCredentials();
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + this.cfg.SESSION_TTL_HOURS * 3_600_000);
    const sessionId = newId();
    await this.db.transaction(async (tx) => {
      await tx.insert(sessions).values({
        id: sessionId,
        userId: user.id,
        tenantId: tenant.id,
        tokenHash: sha256(token),
        expiresAt,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent?.slice(0, 300) ?? null,
      });
      await tx
        .update(users)
        .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: now })
        .where(eq(users.id, user.id));
      await this.audit.record(
        tx,
        {
          user: this.toAuthUser(user, tenant, sessionId),
          requestId: meta.requestId,
          ip: meta.ip,
        },
        { entityType: 'user', entityId: user.id, action: 'auth.login' },
      );
    });
    return { token, expiresAt };
  }

  /**
   * Technician sign-in with username + 4-digit PIN. Works in both sign-in modes
   * because the session is limited to technician-only accounts (task.execute).
   * Five wrong PINs lock the account for 15 minutes (HTTP 423).
   */
  async technicianLogin(
    input: TechnicianLoginInput,
    meta: { ip?: string; userAgent?: string; requestId?: string },
    deviceToken?: string,
  ): Promise<{ token: string; expiresAt: Date; deviceToken?: string }> {
    const wrong = () => new AppError(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'نام کاربری یا رمز اشتباه است.');
    const conditions = [eq(users.username, input.username.toLowerCase())];
    if (input.tenantCode) conditions.push(eq(tenants.code, input.tenantCode.toLowerCase()));
    const candidates = await this.db
      .select({ user: users, tenant: tenants })
      .from(users)
      .innerJoin(tenants, eq(tenants.id, users.tenantId))
      .where(and(...conditions))
      .limit(2);
    if (candidates.length > 1) throw new AppError(HttpStatus.BAD_REQUEST, 'TENANT_REQUIRED', 'کد نمایندگی را وارد کنید');
    const found = candidates[0];
    const eligible = !!found && !!found.user.pinHash && !!found.user.devicePasswordHash && isTechnicianOnly(found.user.roles, found.user.isOwner);
    // A device registered for this account lets the PIN alone sign in; any other device also needs the device password.
    const [device] = eligible && deviceToken
      ? await this.db.select({ id: trustedDevices.id }).from(trustedDevices)
          .where(and(eq(trustedDevices.userId, found!.user.id), eq(trustedDevices.tenantId, found!.tenant.id), eq(trustedDevices.tokenHash, sha256(deviceToken)), isNull(trustedDevices.revokedAt)))
          .limit(1)
      : [];
    if (!device && !input.devicePassword) {
      throw new AppError(HttpStatus.UNAUTHORIZED, 'DEVICE_NOT_REGISTERED', 'این دستگاه هنوز ثبت نشده است؛ رمز ثبت دستگاه را هم وارد کنید.');
    }
    if (!found || !eligible) {
      await verifyPassword(input.pin, await this.dummyHash);
      this.logger.warn({ username: input.username, ip: meta.ip }, 'technician login failed: no PIN account');
      throw wrong();
    }
    const { user, tenant } = found;
    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      throw new AppError(HttpStatus.LOCKED, 'ACCOUNT_LOCKED', 'چند بار اشتباه وارد شد؛ ۱۵ دقیقه دیگر دوباره امتحان کنید.');
    }
    const ok = (await verifyPassword(input.pin, user.pinHash!)) && (!!device || (await verifyPassword(input.devicePassword!, user.devicePasswordHash!)));
    if (!ok || !user.isActive) {
      const failed = user.failedLoginCount + 1;
      const lock = failed >= MAX_FAILED_LOGINS;
      await this.db
        .update(users)
        .set({ failedLoginCount: lock ? 0 : failed, lockedUntil: lock ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : null })
        .where(eq(users.id, user.id));
      this.logger.warn({ userId: user.id, ip: meta.ip, failed }, 'technician login failed');
      if (lock) throw new AppError(HttpStatus.LOCKED, 'ACCOUNT_LOCKED', 'چند بار اشتباه وارد شد؛ ۱۵ دقیقه دیگر دوباره امتحان کنید.');
      throw wrong();
    }
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + this.cfg.SESSION_TTL_HOURS * 3_600_000);
    const sessionId = newId();
    const newDeviceToken = device ? undefined : (deviceToken ?? randomBytes(32).toString('base64url'));
    await this.db.transaction(async (tx) => {
      const actor = { user: this.toAuthUser(user, tenant, sessionId), requestId: meta.requestId, ip: meta.ip };
      if (device) {
        await tx.update(trustedDevices).set({ lastUsedAt: now }).where(eq(trustedDevices.id, device.id));
      } else {
        const deviceId = newId();
        await tx.insert(trustedDevices).values({ id: deviceId, tenantId: tenant.id, userId: user.id, tokenHash: sha256(newDeviceToken!), userAgent: meta.userAgent?.slice(0, 300) ?? null });
        await this.audit.record(tx, actor, { entityType: 'user', entityId: user.id, action: 'auth.device_registered', after: { deviceId } });
      }
      await tx.insert(sessions).values({
        id: sessionId,
        userId: user.id,
        tenantId: tenant.id,
        tokenHash: sha256(token),
        authMethod: 'pin',
        expiresAt,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent?.slice(0, 300) ?? null,
      });
      await tx.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: now }).where(eq(users.id, user.id));
      await this.audit.record(tx, actor, { entityType: 'user', entityId: user.id, action: 'auth.pin_login' });
    });
    return { token, expiresAt, deviceToken: newDeviceToken };
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.tokenHash, sha256(token)), isNull(sessions.revokedAt)));
  }

  /** Resolves a session cookie to the user; slides expiry on activity. */
  async authenticate(token: string): Promise<AuthUser | null> {
    const now = new Date();
    const rows = await this.db
      .select({ session: sessions, user: users, tenant: tenants })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .innerJoin(tenants, eq(tenants.id, sessions.tenantId))
      .where(
        and(eq(sessions.tokenHash, sha256(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)),
      )
      .limit(1);
    const row = rows[0];
    if (!row || !row.user.isActive) return null;
    const pinSession = row.session.authMethod === 'pin';
    // A PIN session stays valid only while the account is technician-only with a PIN.
    if (pinSession && (!row.user.pinHash || !isTechnicianOnly(row.user.roles, row.user.isOwner))) return null;
    if (this.cfg.TOTP_AUTH_ENABLED && !row.session.verifiedWithTotp && !pinSession) return null;

    if (now.getTime() - row.session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.db
        .update(sessions)
        .set({
          lastSeenAt: now,
          expiresAt: new Date(now.getTime() + this.cfg.SESSION_TTL_HOURS * 3_600_000),
        })
        .where(eq(sessions.id, row.session.id));
    }
    const authUser = this.toAuthUser(row.user, row.tenant, row.session.id);
    // A PIN never opens administrative permissions, whatever templates or overrides say.
    if (pinSession) for (const p of PIN_DENIED_PERMISSIONS) authUser.permissions.delete(p);
    return {
      ...authUser,
      verifiedWithTotp: row.session.verifiedWithTotp,
      authMethod: pinSession ? 'pin' : row.session.verifiedWithTotp ? 'totp' : 'password',
    };
  }

  me(user: AuthUser): Me {
    return {
      id: user.id,
      isOwner: user.isOwner,
      username: user.username,
      authentication: user.authMethod ?? (user.verifiedWithTotp ? 'totp' : 'password'),
      displayName: user.displayName,
      roles: user.roles,
      permissions: [...user.permissions],
      tenant: { id: user.tenantId, code: user.tenantCode, name: user.tenantName },
      environment: this.cfg.APP_ENV,
      modules: MODULES.map((m) => ({ key: m.key, status: m.status })),
    };
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  }

  /** Called only after consuming an Authenticator challenge in the same transaction. */
  async issueTotpSession(tx: Tx, userId: string, meta: { ip?: string; requestId?: string; userAgent?: string }) {
    const [found] = await tx.select({ user: users, tenant: tenants }).from(users)
      .innerJoin(tenants, eq(tenants.id, users.tenantId)).where(eq(users.id, userId));
    if (!found?.user.isActive || !found.user.activatedAt) throw invalidCredentials();
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.cfg.SESSION_TTL_HOURS * 3_600_000);
    const sessionId = newId();
    await tx.insert(sessions).values({ id: sessionId, userId, tenantId: found.tenant.id, tokenHash: sha256(token),
      verifiedWithTotp: true, expiresAt, ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0,300) ?? null });
    await tx.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id,userId));
    await this.audit.record(tx, { user: this.toAuthUser(found.user,found.tenant,sessionId), ip: meta.ip, requestId:meta.requestId },
      { entityType:'user',entityId:userId,action:'auth.totp_login' });
    return { token, expiresAt };
  }

  private toAuthUser(
    user: typeof users.$inferSelect,
    tenant: typeof tenants.$inferSelect,
    sessionId: string,
  ): AuthUser {
    // Stored legacy role codes (before migration 0020) resolve to their successors.
    const roles = normalizeRoles(user.roles);
    return {
      id: user.id,
      tenantId: tenant.id,
      isOwner: user.isOwner,
      tenantCode: tenant.code,
      tenantName: tenant.name,
      isTestTenant: tenant.isTest,
      username: user.username,
      displayName: user.displayName,
      roles,
      permissions: permissionsFor(roles, tenant.permissionTemplates, user.permissionOverrides, user.isOwner),
      sessionId,
    };
  }
}
