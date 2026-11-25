import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import type { TimelineEvent } from '@manage/shared';
import type { Actor } from '../auth/auth.types';
import { APP_CONFIG, type AppConfig } from '../config';
import { newId } from '../common/ids';
import { DATABASE, type DatabaseHandle, type DbOrTx } from '../db/database';
import { auditEvents, changeLog, users } from '../db/schema';

export interface AuditEntry {
  entityType: 'case_document' | 'tenant' | 'work_calendar' | 'workshop_station' | 'part_quote' | 'case' | 'task' | 'blocker' | 'user' | 'customer' | 'vehicle' | 'assessment' | 'assessment_technical_review' | 'part' | 'finance' | 'qc' | 'discrepancy' | 'reference' | 'daily_report' | 'emdad' | 'external_work' | 'external_contractor' | 'parts_statement' | 'reminder' | 'task_wage' | 'picking_batch' | 'special_aid' | 'pulse' | 'reception' | 'night_list';
  entityId: string;
  caseId?: string | null;
  action: string;
  reason?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  /** Full row after the change; when present a sync change-log entry is written. */
  snapshot?: { version: number; row: Record<string, unknown> };
  occurredAt?: Date;
}

/** Fields whose before/after values differ, for compact audit records. */
export function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    const x = before[key] instanceof Date ? (before[key] as Date).toISOString() : before[key];
    const y = after[key] instanceof Date ? (after[key] as Date).toISOString() : after[key];
    if (JSON.stringify(x ?? null) !== JSON.stringify(y ?? null)) {
      b[key] = x ?? null;
      a[key] = y ?? null;
    }
  }
  return Object.keys(a).length ? { before: b, after: a } : null;
}

@Injectable()
export class AuditService {
  constructor(
    @Inject(DATABASE) private readonly handle: DatabaseHandle,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  /**
   * A change made by a background process (Manage Pulse) with no signed-in user: same audit row
   * without an actor; `requestId` names the run.
   */
  async recordSystem(tx: DbOrTx, scope: { tenantId: string; isTest: boolean; requestId: string }, entry: Omit<AuditEntry, 'snapshot'>): Promise<void> {
    await tx.insert(auditEvents).values({
      id: newId(),
      tenantId: scope.tenantId,
      caseId: entry.caseId ?? null,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      actorUserId: null,
      occurredAt: entry.occurredAt ?? new Date(),
      reason: entry.reason ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      requestId: scope.requestId,
      ip: null,
      isTest: scope.isTest,
    });
  }

  /** Must be called inside the same transaction as the change it records. */
  async record(tx: DbOrTx, actor: Actor, entry: AuditEntry): Promise<void> {
    const isTest = actor.user.isTestTenant;
    await tx.insert(auditEvents).values({
      id: newId(),
      tenantId: actor.user.tenantId,
      caseId: entry.caseId ?? null,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      actorUserId: actor.user.id,
      occurredAt: entry.occurredAt ?? new Date(),
      reason: entry.reason ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      requestId: actor.requestId ?? null,
      ip: actor.ip ?? null,
      isTest,
    });
    if (entry.snapshot) {
      await tx.insert(changeLog).values({
        id: newId(),
        tenantId: actor.user.tenantId,
        nodeId: this.cfg.NODE_ID,
        entityType: entry.entityType,
        entityId: entry.entityId,
        op: entry.action,
        entityVersion: entry.snapshot.version,
        payload: entry.snapshot.row,
        isTest,
      });
    }
  }

  async caseTimeline(actor: Actor, caseId: string): Promise<TimelineEvent[]> {
    const rows = await this.handle.db
      .select({
        id: auditEvents.id,
        action: auditEvents.action,
        entityType: auditEvents.entityType,
        entityId: auditEvents.entityId,
        occurredAt: auditEvents.occurredAt,
        reason: auditEvents.reason,
        before: auditEvents.before,
        after: auditEvents.after,
        actorId: users.id,
        actorName: users.displayName,
      })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorUserId))
      .where(and(eq(auditEvents.tenantId, actor.user.tenantId), eq(auditEvents.caseId, caseId)))
      .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
      .limit(500);

    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      occurredAt: r.occurredAt.toISOString(),
      actor: r.actorId ? { id: r.actorId, displayName: r.actorName! } : null,
      reason: r.reason,
      summary: { before: r.before ?? null, after: r.after ?? null },
    }));
  }
}
