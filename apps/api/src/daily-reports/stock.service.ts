import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import {
  RESERVATION_STATUS_LABELS,
  normalizePersian,
  parseStockCode,
  parseDecimal,
  toLatinDigits,
  type ReservationActionInput,
  type ReservationStatus,
  type ReserveInput,
  type StockOption,
  type StockReservation,
  type StockSearchQuery,
  type StockSnapshotInfo,
  type StockAliasInput,
} from '@manage/shared';
import type { Actor } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { badRequest, conflict, forbidden, notFound, versionConflict } from '../common/errors';
import { newId } from '../common/ids';
import { DATABASE, type DatabaseHandle, type DbOrTx } from '../db/database';
import { cases, partRequests, stockCodeAliases, stockReservations, stockSnapshotItems, stockSnapshots, users } from '../db/schema';
import { writeSheet } from '../parts/xlsx';
import { tehranDate } from './daily-time';
import { safeCell } from './safe-cell';

type Snapshot = typeof stockSnapshots.$inferSelect;
type Reservation = typeof stockReservations.$inferSelect;
const dec = (v: string | null | undefined) => (v == null ? null : (parseDecimal(v, { allowNegative: true }) ?? v));

export function snapshotInfo(s: Snapshot, now = new Date()): StockSnapshotInfo {
  return {
    id: s.id,
    reportedAt: s.reportedAt.toISOString(),
    reportedAtPrecision: s.reportedAtPrecision,
    publishedAt: s.publishedAt.toISOString(),
    itemCount: s.itemCount,
    currency: s.currency,
    taxIncluded: s.taxIncluded,
    completeness: s.completeness,
    scope: s.scope,
    quantityMeaning: s.quantityMeaning,
    fresh: tehranDate(s.reportedAt) === tehranDate(now),
    // Reserving against the report needs the owner's confirmation of what it covers.
    reservable: !!s.scope && !!s.completeness && !!s.quantityMeaning,
  };
}

@Injectable()
export class StockService {
  constructor(
    @Inject(DATABASE) private readonly handle: DatabaseHandle,
    private readonly audit: AuditService,
  ) {}
  private get db() {
    return this.handle.db;
  }

  async saveAlias(actor: Actor, input: StockAliasInput) {
    if (!actor.user.permissions.has('daily_reports.settings')) throw forbidden();
    const code = input.fullStockCode.toUpperCase();
    if (parseStockCode(code)?.basePartNumber) throw badRequest('STANDARD_CODE_ALIAS', 'کد استاندارد از قاعده هشت رقم پایه و دو رقم تدارکاتی پیروی می‌کند و قابل تغییر نیست');
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`stock-alias:${actor.user.tenantId}:${code}`}))`);
      const [before] = await tx.select().from(stockCodeAliases).where(and(eq(stockCodeAliases.tenantId, actor.user.tenantId), eq(stockCodeAliases.fullStockCode, code)));
      if ((before?.version ?? 0) !== input.expectedVersion) throw versionConflict();
      const patch = { basePartNumber: input.basePartNumber, reason: input.reason, approvedBy: actor.user.id, updatedAt: new Date(), version: (before?.version ?? 0) + 1 };
      const [row] = before
        ? await tx.update(stockCodeAliases).set(patch).where(eq(stockCodeAliases.id, before.id)).returning()
        : await tx.insert(stockCodeAliases).values({ ...patch, id: newId(), tenantId: actor.user.tenantId, fullStockCode: code }).returning();
      await this.audit.record(tx, actor, { entityType: 'daily_report', entityId: row.id, action: 'stock.alias.updated', before: before ? { basePartNumber: before.basePartNumber, reason: before.reason } : null, after: { fullStockCode: code, basePartNumber: row.basePartNumber, reason: row.reason }, snapshot: { version: row.version, row } });
      return { id: row.id, basePartNumber: row.basePartNumber, reason: row.reason, version: row.version };
    });
  }

  async active(tx: DbOrTx, tenantId: string): Promise<Snapshot | null> {
    const [s] = await tx
      .select()
      .from(stockSnapshots)
      .where(and(eq(stockSnapshots.tenantId, tenantId), eq(stockSnapshots.status, 'active')));
    return s ?? null;
  }

  /** Manage commitments per code and location: active reservations and issues not yet in the report. */
  private commitments(tx: DbOrTx, tenantId: string) {
    return tx
      .select({
        code: stockReservations.fullStockCode,
        loc: stockReservations.locationAddress,
        reserved: sql<string>`coalesce(sum(${stockReservations.quantity}) filter (where ${stockReservations.status} = 'reserved'), 0)`.as('reserved'),
        issued: sql<string>`coalesce(sum(${stockReservations.quantity}) filter (where ${stockReservations.status} = 'issued' and ${stockReservations.reflectedAt} is null), 0)`.as('issued'),
      })
      .from(stockReservations)
      .where(and(eq(stockReservations.tenantId, tenantId), inArray(stockReservations.status, ['reserved', 'issued'])))
      .groupBy(stockReservations.fullStockCode, stockReservations.locationAddress)
      .as('c');
  }

  /**
   * Options of the active report by base code, full code or description, with
   * paging and the total count. Each code+location is its own option; the
   * same code in different locations is never summed.
   */
  async options(actor: Actor, q: StockSearchQuery): Promise<{ snapshot: StockSnapshotInfo | null; items: StockOption[]; total: number; page: number; pageSize: number }> {
    const tenantId = actor.user.tenantId;
    const snap = await this.active(this.db, tenantId);
    if (!snap) return { snapshot: null, items: [], total: 0, page: q.page, pageSize: q.pageSize };
    // Owner's rule: zero physical stock is kept in history, not offered for selection.
    const conds: (SQL | undefined)[] = [eq(stockSnapshotItems.snapshotId, snap.id), eq(stockSnapshotItems.tenantId, tenantId), sql`${stockSnapshotItems.quantity} > 0`];
    const effectiveBase = sql<string>`coalesce(${stockSnapshotItems.basePartNumber}, ${stockCodeAliases.basePartNumber})`;
    const term = toLatinDigits(q.q).replace(/\s+/g, ' ').trim();
    const code = term.replace(/\s+/g, '').toUpperCase();
    if (q.base) conds.push(sql`${effectiveBase} = ${q.base}`);
    if (q.needsMapping) conds.push(eq(stockSnapshotItems.codeKind, 'needs_mapping'), isNull(stockCodeAliases.basePartNumber));
    if (term) {
      if (/^\d{8}$/.test(code)) conds.push(sql`${effectiveBase} = ${code}`);
      else if (/^[0-9A-Z]{3,}$/.test(code)) conds.push(ilike(stockSnapshotItems.fullStockCode, `%${code}%`));
      else {
        // Report text uses Arabic ي/ك; compare in Persian form.
        const words = normalizePersian(term).split(' ').filter(Boolean).slice(0, 5);
        for (const w of words) conds.push(sql`translate(coalesce(${stockSnapshotItems.description}, ''), 'يكة', 'یکه') ilike ${`%${w}%`}`);
      }
    }
    const where = and(...conds);
    const aliasJoin = and(eq(stockCodeAliases.tenantId, tenantId), eq(stockCodeAliases.fullStockCode, stockSnapshotItems.fullStockCode));
    const [{ total }] = (await this.db.select({ total: sql<number>`count(*)::int` }).from(stockSnapshotItems).leftJoin(stockCodeAliases, aliasJoin).where(where)) as [{ total: number }];
    const c = this.commitments(this.db, tenantId);
    const rows = await this.db
      .select({ i: stockSnapshotItems, alias: stockCodeAliases, reserved: sql<string>`coalesce(${c.reserved}, 0)`, issued: sql<string>`coalesce(${c.issued}, 0)` })
      .from(stockSnapshotItems)
      .leftJoin(stockCodeAliases, aliasJoin)
      .leftJoin(c, and(eq(c.code, stockSnapshotItems.fullStockCode), eq(c.loc, stockSnapshotItems.locationAddress)))
      .where(where)
      .orderBy(asc(stockSnapshotItems.basePartNumber), asc(stockSnapshotItems.fullStockCode), asc(stockSnapshotItems.locationAddress))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const avail = await this.available(
      this.db,
      rows.map((r) => ({ quantity: r.i.quantity, reserved: r.reserved, issued: r.issued })),
    );
    // «رزرو فعال برای پروندهٔ …» (spec section 7): who holds each code, so it is never picked for another vehicle.
    const holders = new Map<string, { caseId: string; caseNumber: string; quantity: string }[]>();
    const codes = [...new Set(rows.map((r) => r.i.fullStockCode))];
    if (codes.length) {
      const held = await this.db
        .select({ code: stockReservations.fullStockCode, loc: stockReservations.locationAddress, caseId: cases.id, caseNumber: cases.caseNumber, quantity: stockReservations.quantity })
        .from(stockReservations)
        .innerJoin(cases, eq(cases.id, stockReservations.caseId))
        .where(and(eq(stockReservations.tenantId, tenantId), inArray(stockReservations.fullStockCode, codes), sql`(${stockReservations.status} = 'reserved' or (${stockReservations.status} = 'issued' and ${stockReservations.reflectedAt} is null))`));
      for (const h of held) {
        const k = `${h.code}@${h.loc}`;
        holders.set(k, [...(holders.get(k) ?? []), { caseId: h.caseId, caseNumber: h.caseNumber, quantity: dec(h.quantity)! }]);
      }
    }
    return {
      snapshot: snapshotInfo(snap),
      items: rows.map(({ i, alias, reserved, issued }, n) => ({
        reservedFor: holders.get(`${i.fullStockCode}@${i.locationAddress}`) ?? [],
        fullStockCode: i.fullStockCode,
        rawCode: i.rawCode,
        basePartNumber: i.basePartNumber ?? alias?.basePartNumber ?? null,
        alias: alias ? { id: alias.id, basePartNumber: alias.basePartNumber, reason: alias.reason, version: alias.version } : null,
        supplySuffix: i.supplySuffix,
        codeKind: i.codeKind as StockOption['codeKind'],
        description: i.description,
        unit: i.unit,
        vehicleModel: i.vehicleModel,
        locationAddress: i.locationAddress,
        locationText: i.locationText,
        reported: dec(i.quantity)!,
        reserved: dec(reserved)!,
        issuedUnreflected: dec(issued)!,
        available: avail[n]!,
        salePrice: dec(i.salePrice),
        avgPrice: dec(i.avgPrice),
        carriedReportedAt: i.carriedReportedAt?.toISOString() ?? null,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /** Match only exact full codes or an unambiguous eligible location for a base code. */
  async exactOptions(actor: Actor, partNumbers: string[], tx: DbOrTx = this.db, includeUnavailable = false) {
    const out = new Map<string, {
      snapshotId: string; fullStockCode: string; locationAddress: string;
      available: string; salePrice: string | null; currency: string | null;
    }[]>();
    if (!partNumbers.length) return out;
    this.needPermission(actor, 'stock.read');
    const tenantId = actor.user.tenantId;
    const snap = await this.active(tx, tenantId);
    if (!snap || !snapshotInfo(snap).reservable) return out;
    const byCode = new Map<string, string[]>();
    for (const raw of partNumbers) {
      const code = toLatinDigits(raw).replace(/\s+/g, '').toUpperCase();
      if (!/^[0-9A-Z]+$/.test(code)) continue;
      byCode.set(code, [...(byCode.get(code) ?? []), raw]);
    }
    const codes = [...byCode.keys()];
    const base = sql<string>`coalesce(${stockSnapshotItems.basePartNumber}, ${stockCodeAliases.basePartNumber})`;
    const commitments = this.commitments(tx, tenantId);
    for (let i = 0; i < codes.length; i += 500) {
      const batch = codes.slice(i, i + 500);
      const rows = await tx.select({
        fullStockCode: stockSnapshotItems.fullStockCode, locationAddress: stockSnapshotItems.locationAddress,
        salePrice: stockSnapshotItems.salePrice, base,
        available: sql<string>`(${stockSnapshotItems.quantity} - coalesce(${commitments.reserved}, 0) - coalesce(${commitments.issued}, 0))::text`,
      }).from(stockSnapshotItems)
        .leftJoin(stockCodeAliases, and(eq(stockCodeAliases.tenantId, tenantId), eq(stockCodeAliases.fullStockCode, stockSnapshotItems.fullStockCode)))
        .leftJoin(commitments, and(eq(commitments.code, stockSnapshotItems.fullStockCode), eq(commitments.loc, stockSnapshotItems.locationAddress)))
        .where(and(eq(stockSnapshotItems.tenantId, tenantId), eq(stockSnapshotItems.snapshotId, snap.id),
          sql`(${inArray(stockSnapshotItems.fullStockCode, batch)} or ${inArray(base, batch)})`));
      for (const row of rows) {
        if (!includeUnavailable && Number(row.available) <= 0) continue;
        const match = new Set([...(byCode.get(row.fullStockCode) ?? []), ...(byCode.get(row.base) ?? [])]);
        for (const raw of match) {
          const { fullStockCode, locationAddress, salePrice, available } = row;
          const option = { snapshotId: snap.id, fullStockCode, locationAddress, salePrice, available, currency: snap.currency };
          out.set(raw, [...(out.get(raw) ?? []), option]);
        }
      }
    }
    return out;
  }

  /** Exact decimal subtraction in the database (no float). */
  private async available(tx: DbOrTx, rows: { quantity: string; reserved: string; issued: string }[]): Promise<string[]> {
    if (!rows.length) return [];
    const values = sql.join(
      rows.map((r, n) => sql`(${n}::int, ${r.quantity}::numeric, ${r.reserved}::numeric, ${r.issued}::numeric)`),
      sql`, `,
    );
    const result = (await tx.execute(sql`select n, (q - r - i)::text as a from (values ${values}) as v(n, q, r, i) order by n`)) as unknown as { rows: { a: string }[] };
    return result.rows.map((r) => dec(r.a)!);
  }

  private needPermission(actor: Actor, p: 'stock.read' | 'stock.reserve' | 'stock.release' | 'stock.issue') {
    if (!actor.user.permissions.has(p)) throw forbidden();
  }

  async reserve(actor: Actor, input: ReserveInput): Promise<StockReservation> {
    const id = await this.db.transaction((tx) => this.reserveIn(tx, actor, input));
    return (await this.reservations(actor, { ids: [id] }))[0]!;
  }

  async reserveIn(tx: DbOrTx, actor: Actor, input: ReserveInput): Promise<string> {
    this.needPermission(actor, 'stock.reserve');
    const tenantId = actor.user.tenantId;
    const id = newId();
    const [need] = await tx
      .select()
      .from(partRequests)
      .where(and(eq(partRequests.id, input.partRequestId), eq(partRequests.tenantId, tenantId)))
      .for('update');
    if (!need) throw notFound('نیاز قطعه');
    if (['cancelled', 'handed_over'].includes(need.status)) throw badRequest('PART_NOT_OPEN', 'این نیاز قطعه لغو یا تحویل شده است');
    const [kase] = await tx.select({ id: cases.id, stage: cases.stage, status: cases.status }).from(cases).where(and(eq(cases.id, need.caseId), eq(cases.tenantId, tenantId)));
    if (!kase || kase.stage === 'delivered' || kase.status !== 'open') throw badRequest('CASE_NOT_OPEN', 'پرونده باز نیست؛ رزرو ثبت نشد');
    // Serializes every reservation of the same code and location, across requests and workers.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`stock:${tenantId}:${input.fullStockCode}:${input.locationAddress}`}))`);
    const snap = await this.active(tx, tenantId);
    if (!snap) throw badRequest('NO_STOCK_REPORT', 'گزارش موجودی ثبت نشده است');
    if (snap.id !== input.snapshotId) throw conflict('STOCK_REPORT_CHANGED', 'گزارش موجودی تازه‌تری ثبت شده است؛ گزینه‌ها را دوباره ببینید و انتخاب کنید');
    if (!snapshotInfo(snap).reservable) throw badRequest('STOCK_NOT_CONFIRMED', 'دامنه انبار، کامل‌بودن گزارش و معنای ستون موجودی هنوز توسط مالک تأیید نشده است؛ رزرو فعال نیست');
    const [item] = await tx
      .select()
      .from(stockSnapshotItems)
      .where(and(eq(stockSnapshotItems.snapshotId, snap.id), eq(stockSnapshotItems.tenantId, tenantId), eq(stockSnapshotItems.fullStockCode, input.fullStockCode), eq(stockSnapshotItems.locationAddress, input.locationAddress)));
    if (!item) throw notFound('این کد کامل در این محل در گزارش فعال');
    const sums = (await tx.execute(sql`
      select
        (${need.quantity}::numeric - coalesce((select sum(quantity) from stock_reservations where part_request_id = ${need.id} and status in ('reserved','issued')), 0))::text as need_left,
        (${item.quantity}::numeric - coalesce((select sum(quantity) from stock_reservations where tenant_id = ${tenantId} and full_stock_code = ${item.fullStockCode} and location_address = ${item.locationAddress} and (status = 'reserved' or (status = 'issued' and reflected_at is null))), 0))::text as stock_left,
        (${input.quantity}::numeric > ${need.quantity}::numeric - coalesce((select sum(quantity) from stock_reservations where part_request_id = ${need.id} and status in ('reserved','issued')), 0)) as over_need,
        (${input.quantity}::numeric > ${item.quantity}::numeric - coalesce((select sum(quantity) from stock_reservations where tenant_id = ${tenantId} and full_stock_code = ${item.fullStockCode} and location_address = ${item.locationAddress} and (status = 'reserved' or (status = 'issued' and reflected_at is null))), 0)) as over_stock
    `)) as unknown as { rows: { need_left: string; stock_left: string; over_need: boolean; over_stock: boolean }[] };
    const s = sums.rows[0]!;
    if (s.over_need) throw badRequest('OVER_NEED', `مقدار بیشتر از باقی‌مانده نیاز است (باقی‌مانده: ${dec(s.need_left)})`, { needLeft: dec(s.need_left) });
    if (s.over_stock) throw conflict('INSUFFICIENT_STOCK', `موجودی قابل رزرو کافی نیست (قابل رزرو: ${dec(s.stock_left)})`, { available: dec(s.stock_left) });
    await tx.insert(stockReservations).values({
      id,
      tenantId,
      caseId: need.caseId,
      partRequestId: need.id,
      fullStockCode: item.fullStockCode,
      locationAddress: item.locationAddress,
      quantity: input.quantity,
      snapshotId: snap.id,
      unitSalePrice: item.salePrice,
      unitAvgPrice: item.avgPrice,
      currency: snap.currency,
      reservedBy: actor.user.id,
      isTest: actor.user.isTestTenant,
    });
    await this.audit.record(tx, actor, {
      entityType: 'part',
      entityId: need.id,
      caseId: need.caseId,
      action: 'stock.reserved',
      after: { reservationId: id, fullStockCode: item.fullStockCode, locationAddress: item.locationAddress, quantity: input.quantity, snapshotId: snap.id, unitSalePrice: item.salePrice, currency: snap.currency },
      snapshot: { version: 1, row: { id, partRequestId: need.id, fullStockCode: item.fullStockCode, quantity: input.quantity, status: 'reserved' } },
    });
    return id;
  }

  async act(actor: Actor, id: string, input: ReservationActionInput): Promise<StockReservation> {
    await this.db.transaction((tx) => this.actIn(tx, actor, id, input));
    return (await this.reservations(actor, { ids: [id] }))[0]!;
  }

  async actIn(tx: DbOrTx, actor: Actor, id: string, input: ReservationActionInput, assignedTechnicianPickup = false): Promise<void> {
    if (!assignedTechnicianPickup || input.action !== 'issue') this.needPermission(actor, input.action === 'release' || input.action === 'cancel' ? 'stock.release' : 'stock.issue');
    const tenantId = actor.user.tenantId;
    const [r] = await tx
      .select()
      .from(stockReservations)
      .where(and(eq(stockReservations.id, id), eq(stockReservations.tenantId, tenantId)))
      .for('update');
    if (!r) throw notFound('رزرو');
    if (r.version !== input.expectedVersion) throw versionConflict(r.version);
    const now = new Date();
    const invalid = () => conflict('INVALID_RESERVATION_STEP', 'این اقدام در وضعیت فعلی رزرو ممکن نیست');
    let patch: Partial<Reservation>;
    switch (input.action) {
      case 'issue':
        if (r.status !== 'reserved') throw invalid();
        patch = { status: 'issued', issuedAt: now, issuedBy: actor.user.id };
        break;
      case 'release':
        if (r.status !== 'reserved') throw invalid();
        patch = { status: 'released', closedAt: now, closedBy: actor.user.id, reason: input.reason! };
        break;
      case 'cancel':
        // Undoes an issue recorded by mistake, only before the report reflects it.
        if (r.status !== 'issued' || r.reflectedAt) throw invalid();
        patch = { status: 'cancelled', closedAt: now, closedBy: actor.user.id, reason: input.reason! };
        break;
      case 'reflect':
        // Spec section 7: deduction stops automatically with «پایان کار»; there is no manual step any more.
        throw badRequest('REFLECT_AUTOMATIC', 'کسر از موجودی با «پایان کار» پرونده خودکار متوقف می‌شود؛ تأیید دستی لازم نیست');
    }
    const [row] = await tx
      .update(stockReservations)
      .set({ ...patch, updatedAt: now, version: r.version + 1 })
      .where(and(eq(stockReservations.id, id), eq(stockReservations.version, r.version)))
      .returning();
    if (!row) throw versionConflict();
    await this.audit.record(tx, actor, {
      entityType: 'part',
      entityId: r.partRequestId,
      caseId: r.caseId,
      action: `stock.${input.action === 'issue' ? 'issued' : input.action === 'release' ? 'released' : 'issue_cancelled'}`,
      reason: input.reason ?? null,
      before: { reservationId: id, status: r.status, reflectedAt: r.reflectedAt?.toISOString() ?? null },
      after: { reservationId: id, status: row.status, reflectedAt: row.reflectedAt?.toISOString() ?? null },
      snapshot: { version: row.version, row: { id, status: row.status } },
    });
  }

  /**
   * «پایان کار» (spec section 7): every part handed over to this case stops
   * lowering the usable quantity, because from now on the business system's own
   * report shows the consumption. Also marks the handed-over lines as consumed.
   */
  async finishCase(tx: DbOrTx, actor: Actor, caseId: string): Promise<number> {
    const tenantId = actor.user.tenantId;
    const now = new Date();
    const snap = await this.active(tx, tenantId);
    const open = await tx
      .select()
      .from(stockReservations)
      .where(and(eq(stockReservations.tenantId, tenantId), eq(stockReservations.caseId, caseId), eq(stockReservations.status, 'issued'), isNull(stockReservations.reflectedAt)))
      .for('update');
    for (const r of open) {
      await tx
        .update(stockReservations)
        .set({ reflectedAt: now, reflectedBy: actor.user.id, reflectedSnapshotId: snap?.id ?? null, updatedAt: now, version: r.version + 1 })
        .where(and(eq(stockReservations.id, r.id), eq(stockReservations.version, r.version)));
    }
    const consumed = await tx
      .update(partRequests)
      .set({ consumedAt: now, updatedAt: now })
      .where(and(eq(partRequests.tenantId, tenantId), eq(partRequests.caseId, caseId), eq(partRequests.status, 'handed_over'), isNull(partRequests.consumedAt)))
      .returning({ id: partRequests.id });
    if (open.length || consumed.length) {
      await this.audit.record(tx, actor, {
        entityType: 'case',
        entityId: caseId,
        caseId,
        action: 'stock.finished_with_case',
        after: { reservations: open.map((r) => r.id), consumedParts: consumed.map((c) => c.id), snapshotId: snap?.id ?? null },
      });
    }
    return open.length;
  }

  async reservations(
    actor: Actor,
    f: { ids?: string[]; caseId?: string; partRequestId?: string; status?: ReservationStatus; reconcile?: boolean; page?: number; pageSize?: number },
  ): Promise<StockReservation[]> {
    const tenantId = actor.user.tenantId;
    const conds: (SQL | undefined)[] = [eq(stockReservations.tenantId, tenantId)];
    if (f.ids) conds.push(inArray(stockReservations.id, f.ids));
    if (f.caseId) conds.push(eq(stockReservations.caseId, f.caseId));
    if (f.partRequestId) conds.push(eq(stockReservations.partRequestId, f.partRequestId));
    if (f.status) conds.push(eq(stockReservations.status, f.status));
    if (f.reconcile) conds.push(eq(stockReservations.status, 'issued'), isNull(stockReservations.reflectedAt));
    const snap = await this.active(this.db, tenantId);
    const rows = await this.db
      .select({ r: stockReservations, caseNumber: cases.caseNumber, admissionNo: cases.admissionNo, need: partRequests, reservedByName: users.displayName })
      .from(stockReservations)
      .innerJoin(cases, eq(cases.id, stockReservations.caseId))
      .innerJoin(partRequests, eq(partRequests.id, stockReservations.partRequestId))
      .leftJoin(users, eq(users.id, stockReservations.reservedBy))
      .where(and(...conds))
      .orderBy(desc(stockReservations.reservedAt))
      .limit(f.pageSize ?? 200)
      .offset(((f.page ?? 1) - 1) * (f.pageSize ?? 200));
    const short = await this.shortfallKeys(tenantId, snap);
    return rows.map(({ r, caseNumber, admissionNo, need, reservedByName }) => ({
      id: r.id,
      caseId: r.caseId,
      caseNumber,
      admissionNo,
      partRequestId: r.partRequestId,
      partDescription: need.description,
      partNumber: need.partNumber,
      needQuantity: need.quantity,
      fullStockCode: r.fullStockCode,
      locationAddress: r.locationAddress,
      quantity: dec(r.quantity)!,
      status: r.status as ReservationStatus,
      snapshotId: r.snapshotId,
      unitSalePrice: dec(r.unitSalePrice),
      unitAvgPrice: dec(r.unitAvgPrice),
      currency: r.currency,
      reservedByName,
      reservedAt: r.reservedAt.toISOString(),
      issuedAt: r.issuedAt?.toISOString() ?? null,
      closedAt: r.closedAt?.toISOString() ?? null,
      reason: r.reason,
      reflectedAt: r.reflectedAt?.toISOString() ?? null,
      shortfall: (r.status === 'reserved' || (r.status === 'issued' && !r.reflectedAt)) && short.has(`${r.fullStockCode}@${r.locationAddress}`),
      version: r.version,
    }));
  }

  /** Excel of Manage reservations; case identifiers and codes only, formula-safe text. */
  async exportReservations(actor: Actor, f: { caseId?: string; partRequestId?: string; status?: ReservationStatus; reconcile?: boolean }) {
    const all: StockReservation[] = [];
    for (let page = 1; page <= 50; page++) {
      const rows = await this.reservations(actor, { ...f, page, pageSize: 200 });
      all.push(...rows);
      if (rows.length < 200) break;
    }
    return writeSheet('رزروهای داخلی منیج', [
      ['پرونده منیج', 'پذیرش ایران‌خودرو', 'نیاز قطعه', 'کد کامل', 'محل', 'مقدار', 'وضعیت', 'قیمت فروش زمان انتخاب', 'قیمت میانگین زمان انتخاب', 'واحد پول', 'مسئول', 'زمان رزرو', 'کسری'],
      ...all.map((r) => [safeCell(r.caseNumber), safeCell(r.admissionNo ?? ''), safeCell(r.partDescription), safeCell(r.fullStockCode), safeCell(r.locationAddress), safeCell(r.quantity), RESERVATION_STATUS_LABELS[r.status], safeCell(r.unitSalePrice ?? ''), safeCell(r.unitAvgPrice ?? ''), safeCell(r.currency ?? 'تأییدنشده'), safeCell(r.reservedByName ?? ''), r.reservedAt, r.shortfall ? 'کسری' : '']),
    ]);
  }

  /** Code+locations where Manage commitments exceed the newest report (reservations are kept, only flagged). */
  async shortfallKeys(tenantId: string, snap: Snapshot | null): Promise<Set<string>> {
    const result = (await this.db.execute(sql`
      select c.full_stock_code as code, c.location_address as loc
      from (
        select full_stock_code, location_address, sum(quantity) as committed
        from stock_reservations
        where tenant_id = ${tenantId} and (status = 'reserved' or (status = 'issued' and reflected_at is null))
        group by 1, 2
      ) c
      left join stock_snapshot_items i on i.snapshot_id = ${snap?.id ?? null} and i.full_stock_code = c.full_stock_code and i.location_address = c.location_address
      where coalesce(i.quantity, 0) < c.committed
    `)) as unknown as { rows: { code: string; loc: string }[] };
    return new Set(result.rows.map((r) => `${r.code}@${r.loc}`));
  }
}
