import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, notInArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { alertSettingsOf, DEFAULT_ALERT_SETTINGS, openAlerts, type AlertResponseInput, type AlertSettings, type AlertSettingsInput, type CaseAlert } from '@manage/shared';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../auth/auth.types';
import { badRequest, conflict, notFound } from '../common/errors';
import { newId } from '../common/ids';
import { DATABASE, type DatabaseHandle } from '../db/database';
import { caseAlertResponses, cases, partRequests, tenants, users, vehicles } from '../db/schema';

/** Spec decision 1 (2026-11-10): 100,000,000 toman = 1,000,000,000 Rial. */
export const DEFAULT_PARTS_ALERT_THRESHOLD_RIAL = DEFAULT_ALERT_SETTINGS.partsAlertThresholdRial;
/** Lines that no longer go into the vehicle (cancelled, returned) do not count. */
const INACTIVE_PART_STATUSES = ['cancelled', 'returned'];
const responsibleUser = alias(users, 'alert_responsible');

/**
 * Non-blocking cost alerts for the accident expert (spec section 9): money never
 * stops work. Manage asks one question, the expert records «گرفتم / نگرفتم /
 * لازم نیست» and the answer is kept. The former advance approval flow (expert
 * proposes, service manager approves, cashier confirms) is retired.
 *  - parts_amount: the parts total crossed N × threshold;
 *  - expensive_part: a personal-coverage line at or above the per-line threshold.
 */
@Injectable()
export class AlertsService {
  constructor(
    @Inject(DATABASE) private readonly handle: DatabaseHandle,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.handle.db;
  }

  async alertSettings(tenantId: string): Promise<AlertSettings> {
    const [t] = await this.db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
    return alertSettingsOf(t?.settings as Partial<Record<keyof AlertSettings, unknown>> | undefined);
  }

  async threshold(tenantId: string): Promise<number> {
    return (await this.alertSettings(tenantId)).partsAlertThresholdRial;
  }

  async settings(actor: Actor) {
    const current = await this.alertSettings(actor.user.tenantId);
    return { ...current, defaults: DEFAULT_ALERT_SETTINGS, defaultRial: DEFAULT_ALERT_SETTINGS.partsAlertThresholdRial };
  }

  async saveSettings(actor: Actor, input: AlertSettingsInput) {
    await this.db.transaction(async (tx) => {
      const [t] = await tx.select().from(tenants).where(eq(tenants.id, actor.user.tenantId)).for('update');
      const before = (t!.settings ?? {}) as Record<string, unknown>;
      const after: Record<string, unknown> = { ...before, partsAlertThresholdRial: input.partsAlertThresholdRial };
      if (input.expensivePartThresholdRial !== undefined) after.expensivePartThresholdRial = input.expensivePartThresholdRial;
      if (input.emdadLateDays !== undefined) after.emdadLateDays = input.emdadLateDays;
      await tx.update(tenants).set({ settings: after }).where(eq(tenants.id, actor.user.tenantId));
      await this.audit.record(tx, actor, { entityType: 'tenant', entityId: actor.user.tenantId, action: 'settings.alerts_updated', before, after });
    });
    return this.settings(actor);
  }

  /** Open alerts for every open case of the tenant, or for one case. */
  async list(actor: Actor, caseId?: string): Promise<CaseAlert[]> {
    const tenantId = actor.user.tenantId;
    const open = await this.db
      .select({ id: cases.id, caseNumber: cases.caseNumber, coverageType: cases.coverageType, plate: vehicles.plate, model: vehicles.model, responsibleId: responsibleUser.id, responsibleName: responsibleUser.displayName })
      .from(cases)
      .innerJoin(vehicles, eq(vehicles.id, cases.vehicleId))
      .leftJoin(responsibleUser, eq(responsibleUser.id, cases.responsibleUserId))
      .where(and(eq(cases.tenantId, tenantId), eq(cases.status, 'open'), caseId ? eq(cases.id, caseId) : undefined));
    if (!open.length) return [];
    const ids = open.map((c) => c.id);
    const [answers, partRows, settings] = await Promise.all([
      this.db.select().from(caseAlertResponses).where(and(eq(caseAlertResponses.tenantId, tenantId), inArray(caseAlertResponses.caseId, ids))),
      this.db
        .select({ caseId: partRequests.caseId, description: partRequests.description, quantity: partRequests.quantity, sale: partRequests.salePriceRial, unit: partRequests.unitPriceRial, approved: partRequests.approvedUnitPriceRial })
        .from(partRequests)
        .where(and(eq(partRequests.tenantId, tenantId), inArray(partRequests.caseId, ids), notInArray(partRequests.status, INACTIVE_PART_STATUSES)))
        .orderBy(partRequests.createdAt),
      this.alertSettings(tenantId),
    ]);
    const alerts: CaseAlert[] = [];
    for (const c of open) {
      const lines = partRows.filter((p) => p.caseId === c.id).map((p) => ({ description: p.description, quantity: p.quantity, unitRial: p.sale ?? p.unit ?? p.approved ?? null }));
      const answered = (kind: string, level: number) => answers.some((a) => a.caseId === c.id && a.kind === kind && a.level === level);
      for (const a of openAlerts({ coverageType: c.coverageType, lines, settings, answered })) {
        alerts.push({
          caseId: c.id,
          caseNumber: c.caseNumber,
          plate: c.plate,
          vehicleLabel: c.model ?? '',
          coverageType: c.coverageType,
          kind: a.kind,
          level: a.level,
          totalRial: a.totalRial,
          thresholdRial: a.thresholdRial,
          partDescription: a.partDescription,
          responsible: c.responsibleId ? { id: c.responsibleId, displayName: c.responsibleName ?? '' } : null,
        });
      }
    }
    return alerts;
  }

  /** Answer history of one case, newest first. */
  async history(actor: Actor, caseId: string) {
    const rows = await this.db
      .select({ a: caseAlertResponses, by: users.displayName })
      .from(caseAlertResponses)
      .innerJoin(users, eq(users.id, caseAlertResponses.respondedBy))
      .where(and(eq(caseAlertResponses.tenantId, actor.user.tenantId), eq(caseAlertResponses.caseId, caseId)));
    return rows
      .sort((x, y) => y.a.respondedAt.getTime() - x.a.respondedAt.getTime())
      .map(({ a, by }) => ({ kind: a.kind, level: a.level, response: a.response, note: a.note, respondedBy: by, respondedAt: a.respondedAt.toISOString() }));
  }

  async respond(actor: Actor, caseId: string, input: AlertResponseInput): Promise<CaseAlert[]> {
    const tenantId = actor.user.tenantId;
    const pending = await this.list(actor, caseId);
    const [kase] = await this.db.select({ id: cases.id }).from(cases).where(and(eq(cases.id, caseId), eq(cases.tenantId, tenantId)));
    if (!kase) throw notFound('پرونده');
    if (!pending.some((a) => a.kind === input.kind && a.level === input.level)) {
      throw badRequest('ALERT_NOT_OPEN', 'این هشدار برای پرونده باز نیست یا قبلاً جواب داده شده است');
    }
    await this.db.transaction(async (tx) => {
      const id = newId();
      try {
        await tx.insert(caseAlertResponses).values({ id, tenantId, caseId, kind: input.kind, level: input.level, response: input.response, note: input.note ?? null, respondedBy: actor.user.id });
      } catch {
        throw conflict('ALERT_ALREADY_ANSWERED', 'به این هشدار قبلاً جواب داده شده است');
      }
      await this.audit.record(tx, actor, { entityType: 'case', entityId: caseId, action: 'case.alert_answered', after: { kind: input.kind, level: input.level, response: input.response, note: input.note ?? null } });
    });
    return this.list(actor, caseId);
  }
}
