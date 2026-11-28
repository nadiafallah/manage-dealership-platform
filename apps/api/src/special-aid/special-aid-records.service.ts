import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import {
  CARD_MAX_BYTES, FEEDBACK_KIND_LABELS, appointmentInstant, appointmentState, autoLinkedAppointments, effectiveRelation, normalizeVin,
  type AppointmentRelation, type AppointmentState, type CardMatchInput, type CardUploadInput, type FeedbackAckInput, type FeedbackInput,
  type FeedbackKind, type NonConsumptionReason, type SpecialAidAppointment, type SpecialAidCard, type SpecialAidFeedback, type SpecialAidReviewRow,
} from '@manage/shared';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../auth/auth.types';
import { badRequest, forbidden, notFound, versionConflict } from '../common/errors';
import { newId } from '../common/ids';
import { DATABASE, type DatabaseHandle, type DbOrTx } from '../db/database';
import {
  emdadRequests, referenceEntries, referenceImports, specialAidAdmissions, specialAidAppointmentLinks, specialAidCards, specialAidDossiers,
  specialAidFeedback, specialAidItems, users,
} from '../db/schema';
import type { EmdadOfficial } from '../daily-reports/report-rows';
import { notifyUsers } from '../parts/part-notify';
import { idKey, isAidVehicleKey } from '../vehicle-import/vehicle-sheet';
import { CARD_EXTRACTOR, type CardTextExtractor, sniffCardMime } from './card-extractor';

type CardRow = typeof specialAidCards.$inferSelect;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const vinOf = (v: string | null | undefined) => { const n = v ? normalizeVin(v) : ''; return isAidVehicleKey(n) ? n : null; };

/**
 * Evidence and records around a special-aid dossier: admission-card archive, appointment
 * tracking from the imported ISACO list, technical feedback / formal warnings and the
 * review queue of VINs that cannot open a dossier.
 */
@Injectable()
export class SpecialAidRecordsService {
  constructor(@Inject(DATABASE) private readonly handle: DatabaseHandle, private readonly audit: AuditService, @Inject(CARD_EXTRACTOR) private readonly extractor: CardTextExtractor) {}
  private get db() { return this.handle.db; }
  private need(actor: Actor, p: Parameters<Actor['user']['permissions']['has']>[0]) { if (!actor.user.permissions.has(p)) throw forbidden(); }

  // ------------------------------------------------------------------ admission cards

  private cardView(c: CardRow, names: Map<string, string>): SpecialAidCard {
    return {
      id: c.id, fileName: c.fileName, mime: c.mime, size: c.size, sha256: c.sha256, state: c.state as SpecialAidCard['state'],
      admissionNo: c.admissionNo, vin: c.vin, dossierId: c.dossierId, extraction: c.extraction ?? null,
      uploadedByName: names.get(c.uploadedBy) ?? '', uploadedAt: c.uploadedAt.toISOString(), matchedAt: iso(c.matchedAt), version: c.version,
    };
  }
  private async names(ids: string[]) {
    const list = [...new Set(ids)];
    if (!list.length) return new Map<string, string>();
    return new Map((await this.db.select({ id: users.id, n: users.displayName }).from(users).where(inArray(users.id, list))).map((u) => [u.id, u.n]));
  }

  /**
   * Links a card only on an exact, unambiguous match: a full VIN with a dossier, or an admission
   * number known to exactly one dossier (special-aid admissions, else the reception records).
   */
  private async tryMatch(tx: DbOrTx, tenantId: string, card: CardRow, by: string | null): Promise<boolean> {
    const vin = vinOf(card.vin ?? card.extraction?.vin);
    const admission = card.admissionNo ?? card.extraction?.admissionNo ?? null;
    const key = admission ? idKey(admission) : '';
    let dossierId: string | null = null, admissionId: string | null = null;
    if (key) {
      const found = await tx.select({ id: specialAidAdmissions.id, dossierId: specialAidAdmissions.dossierId }).from(specialAidAdmissions).where(and(eq(specialAidAdmissions.tenantId, tenantId), eq(specialAidAdmissions.admissionKey, key)));
      if (found.length === 1) { dossierId = found[0]!.dossierId; admissionId = found[0]!.id; }
      else if (found.length > 1) return false;
      else {
        const refs = await tx.select({ vin: referenceEntries.lookupKey }).from(referenceEntries).where(and(eq(referenceEntries.tenantId, tenantId), eq(referenceEntries.kind, 'customers'), sql`upper(regexp_replace(${referenceEntries.data}->>'admissionNo', '\\s', '', 'g')) = ${key}`));
        const vins = [...new Set(refs.map((r) => vinOf(r.vin)).filter((v): v is string => !!v))];
        if (vins.length > 1) return false;
        if (vins.length === 1) {
          if (vin && vin !== vins[0]) return false;
          const [d] = await tx.select({ id: specialAidDossiers.id }).from(specialAidDossiers).where(and(eq(specialAidDossiers.tenantId, tenantId), eq(specialAidDossiers.vin, vins[0]!)));
          dossierId = d?.id ?? null;
        }
      }
    }
    if (vin) {
      const [d] = await tx.select({ id: specialAidDossiers.id }).from(specialAidDossiers).where(and(eq(specialAidDossiers.tenantId, tenantId), eq(specialAidDossiers.vin, vin)));
      if (dossierId && d?.id !== dossierId) return false; // admission and VIN point at different vehicles
      dossierId ??= d?.id ?? null;
    }
    if (!dossierId) return false;
    const [saved] = await tx.update(specialAidCards).set({ state: 'matched', dossierId, admissionId, matchedBy: by, matchedAt: new Date(), version: card.version + 1 })
      .where(and(eq(specialAidCards.id, card.id), eq(specialAidCards.version, card.version))).returning();
    if (saved) Object.assign(card, saved);
    return !!saved;
  }

  /** Single or bulk upload; originals are kept byte-for-byte with their checksum and uploader. */
  async uploadCards(actor: Actor, input: CardUploadInput) {
    this.need(actor, 'special_aid.operate');
    const tenantId = actor.user.tenantId;
    const results: { fileName: string; outcome: 'matched' | 'unmatched' | 'duplicate' | 'rejected'; message: string | null; cardId: string | null }[] = [];
    for (const f of input.files) {
      const bytes = Buffer.from(f.dataBase64, 'base64');
      if (!bytes.length || bytes.length > CARD_MAX_BYTES) { results.push({ fileName: f.fileName, outcome: 'rejected', message: 'حجم فایل باید کمتر از چهار مگابایت باشد', cardId: null }); continue; }
      const real = sniffCardMime(bytes);
      if (!real || real !== f.mime) { results.push({ fileName: f.fileName, outcome: 'rejected', message: 'محتوای فایل تصویر JPEG/PNG/WEBP یا PDF نیست', cardId: null }); continue; }
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const [dupe] = await this.db.select({ id: specialAidCards.id }).from(specialAidCards).where(and(eq(specialAidCards.tenantId, tenantId), eq(specialAidCards.sha256, sha256)));
      if (dupe) { results.push({ fileName: f.fileName, outcome: 'duplicate', message: 'همین فایل قبلاً بایگانی شده است', cardId: dupe.id }); continue; }
      let extraction: CardRow['extraction'] = null;
      if (this.extractor.provider !== 'none') {
        try { const x = await this.extractor.extract(bytes, real); extraction = x ? { provider: this.extractor.provider, admissionNo: x.admissionNo, vin: x.vin } : null; }
        catch { extraction = null; }
      }
      const outcome = await this.db.transaction(async (tx) => {
        const id = newId();
        const [card] = await tx.insert(specialAidCards).values({
          id, tenantId, fileName: f.fileName, mime: real, sha256, size: bytes.length, dataBase64: f.dataBase64, extraction,
          admissionNo: f.admissionNo?.trim() || null, vin: f.vin ? normalizeVin(f.vin) : null, uploadedBy: actor.user.id, isTest: actor.user.isTestTenant,
        }).onConflictDoNothing().returning();
        if (!card) return { id: null, matched: false };
        const matched = await this.tryMatch(tx, tenantId, card, actor.user.id);
        await this.audit.record(tx, actor, { entityType: 'special_aid', entityId: id, action: 'special_aid.card_uploaded', after: { fileName: f.fileName, sha256, size: bytes.length, mime: real, matched, dossierId: card.dossierId, extractionProvider: extraction?.provider ?? null } });
        return { id, matched };
      });
      results.push({ fileName: f.fileName, outcome: !outcome.id ? 'duplicate' : outcome.matched ? 'matched' : 'unmatched', message: outcome.matched || !outcome.id ? null : 'خودرو یا پذیرش این کارت پیدا نشد؛ شمارهٔ پذیرش یا VIN را وارد کنید', cardId: outcome.id });
    }
    return { results };
  }

  async listCards(actor: Actor, state?: 'unmatched' | 'matched'): Promise<SpecialAidCard[]> {
    this.need(actor, 'special_aid.read');
    const rows = await this.db.select().from(specialAidCards).where(and(eq(specialAidCards.tenantId, actor.user.tenantId), state ? eq(specialAidCards.state, state) : undefined)).orderBy(desc(specialAidCards.uploadedAt)).limit(500);
    const names = await this.names(rows.map((r) => r.uploadedBy));
    return rows.map((r) => this.cardView({ ...r, dataBase64: '' }, names));
  }
  async cardsOf(tenantId: string, dossierId: string): Promise<SpecialAidCard[]> {
    const rows = await this.db.select().from(specialAidCards).where(and(eq(specialAidCards.tenantId, tenantId), eq(specialAidCards.dossierId, dossierId))).orderBy(desc(specialAidCards.uploadedAt));
    const names = await this.names(rows.map((r) => r.uploadedBy));
    return rows.map((r) => this.cardView({ ...r, dataBase64: '' }, names));
  }
  async cardFile(actor: Actor, id: string) {
    this.need(actor, 'special_aid.read');
    const [c] = await this.db.select().from(specialAidCards).where(and(eq(specialAidCards.id, id), eq(specialAidCards.tenantId, actor.user.tenantId)));
    if (!c) throw notFound('کارت پذیرش');
    return c;
  }

  /** Administrator-assisted matching: the typed numbers are kept even when no vehicle matches yet. */
  async matchCard(actor: Actor, id: string, input: CardMatchInput) {
    this.need(actor, 'special_aid.operate');
    const out = await this.db.transaction(async (tx) => {
      const [c] = await tx.select().from(specialAidCards).where(and(eq(specialAidCards.id, id), eq(specialAidCards.tenantId, actor.user.tenantId))).for('update');
      if (!c) throw notFound('کارت پذیرش');
      if (c.version !== input.expectedVersion) throw versionConflict(c.version);
      const vin = input.vin ? normalizeVin(input.vin) : null;
      if (vin && !isAidVehicleKey(vin)) throw badRequest('SPECIAL_AID_CARD_VIN', 'VIN کامل ۱۷ نویسه یا شمارهٔ شاسی ۸ نویسه‌ای ایساکو لازم است');
      const [saved] = await tx.update(specialAidCards).set({ admissionNo: input.admissionNo?.trim() || null, vin, state: 'unmatched', dossierId: null, admissionId: null, matchedAt: null, matchedBy: null, version: c.version + 1 })
        .where(and(eq(specialAidCards.id, c.id), eq(specialAidCards.version, c.version))).returning();
      if (!saved) throw versionConflict();
      const matched = await this.tryMatch(tx, actor.user.tenantId, saved, actor.user.id);
      await this.audit.record(tx, actor, { entityType: 'special_aid', entityId: c.id, action: 'special_aid.card_matched', before: { admissionNo: c.admissionNo, vin: c.vin, dossierId: c.dossierId }, after: { admissionNo: saved.admissionNo, vin, matched, dossierId: saved.dossierId } });
      return { matched, saved };
    });
    // Names are read after the commit (never through another connection inside the transaction).
    return { matched: out.matched, card: this.cardView({ ...out.saved, dataBase64: '' }, await this.names([out.saved.uploadedBy])) };
  }

  /** After each imported report: unmatched cards with numbers are tried again (no guessing). */
  async retryCards(tx: DbOrTx, tenantId: string): Promise<number> {
    const open = await tx.select().from(specialAidCards).where(and(eq(specialAidCards.tenantId, tenantId), eq(specialAidCards.state, 'unmatched')));
    let n = 0;
    for (const c of open) if ((c.admissionNo || c.vin || c.extraction) && (await this.tryMatch(tx, tenantId, c, null))) n += 1;
    return n;
  }

  // ------------------------------------------------------------------ appointments (tracking only)

  /**
   * Appointments of the vehicle from the imported ISACO list. Spec 29.3: one undecided appointment on or
   * after the earliest arrival of a waiting part (`since`) is linked automatically (`auto`); the operator's
   * decision wins and several candidates are left for review.
   */
  async appointmentsOf(tenantId: string, dossierId: string, vin: string, attendedAt: Date | null, now = new Date(), since: string | null = null): Promise<{ appointments: SpecialAidAppointment[]; state: AppointmentState }> {
    const [entries, links, [last]] = await Promise.all([
      this.db.select({ e: referenceEntries, fileName: referenceImports.fileName }).from(referenceEntries).leftJoin(referenceImports, eq(referenceImports.id, referenceEntries.sourceImportId))
        .where(and(eq(referenceEntries.tenantId, tenantId), eq(referenceEntries.kind, 'appointments'), eq(referenceEntries.lookupKey, vin))),
      this.db.select({ l: specialAidAppointmentLinks, by: users.displayName }).from(specialAidAppointmentLinks).innerJoin(users, eq(users.id, specialAidAppointmentLinks.decidedBy))
        .where(and(eq(specialAidAppointmentLinks.tenantId, tenantId), eq(specialAidAppointmentLinks.dossierId, dossierId))),
      this.db.select({ at: referenceImports.appliedAt }).from(referenceImports).where(and(eq(referenceImports.tenantId, tenantId), eq(referenceImports.kind, 'appointments'), eq(referenceImports.status, 'applied'))).orderBy(desc(referenceImports.appliedAt)).limit(1),
    ]);
    const linkOf = new Map(links.map((x) => [x.l.entryId, x]));
    const appointments = entries.map(({ e, fileName }): SpecialAidAppointment => {
      const d = e.data as Record<string, string | undefined>;
      const link = linkOf.get(e.id);
      return {
        id: e.id, at: appointmentInstant(d.appointmentDate, d.appointmentTime), dateText: d.appointmentDate ?? null, timeText: d.appointmentTime ?? null,
        status: d.status ?? null, serviceType: d.serviceType ?? null, admissionNo: d.admissionNo ?? null, appointmentNo: d.appointmentNo ?? null,
        relation: (link?.l.relation as AppointmentRelation | undefined) ?? null, relationByName: link?.by ?? null, fileName: fileName ?? '', importedAt: e.updatedAt.toISOString(), auto: false,
      };
    }).sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
    const auto = autoLinkedAppointments(appointments, since);
    const shown = appointments.map((a) => (auto.has(a.id) ? { ...a, relation: effectiveRelation(a, auto), auto: true } : a));
    const state = appointmentState({ appointments: shown.map((a) => ({ id: a.id, at: a.at, relation: a.relation })), lastReportAt: iso(last?.at), attendedAt: iso(attendedAt), now });
    return { appointments: shown, state };
  }

  /** The operator says whether an appointment of this VIN belongs to the special-aid follow-up. */
  async setAppointmentRelation(actor: Actor, dossierId: string, entryId: string, relation: AppointmentRelation | null) {
    this.need(actor, 'special_aid.operate');
    const tenantId = actor.user.tenantId;
    await this.db.transaction(async (tx) => {
      const [d] = await tx.select().from(specialAidDossiers).where(and(eq(specialAidDossiers.id, dossierId), eq(specialAidDossiers.tenantId, tenantId)));
      if (!d) throw notFound('پروندهٔ امداد ویژه');
      const [e] = await tx.select().from(referenceEntries).where(and(eq(referenceEntries.id, entryId), eq(referenceEntries.tenantId, tenantId), eq(referenceEntries.kind, 'appointments')));
      if (!e || e.lookupKey !== d.vin) throw badRequest('SPECIAL_AID_APPOINTMENT', 'این نوبت متعلق به همین خودرو نیست');
      const [old] = await tx.select().from(specialAidAppointmentLinks).where(and(eq(specialAidAppointmentLinks.dossierId, dossierId), eq(specialAidAppointmentLinks.entryId, entryId))).for('update');
      if (!relation) { if (old) await tx.delete(specialAidAppointmentLinks).where(eq(specialAidAppointmentLinks.id, old.id)); }
      else if (old) await tx.update(specialAidAppointmentLinks).set({ relation, decidedBy: actor.user.id, decidedAt: new Date(), version: old.version + 1 }).where(eq(specialAidAppointmentLinks.id, old.id));
      else await tx.insert(specialAidAppointmentLinks).values({ id: newId(), tenantId, dossierId, entryId, relation, decidedBy: actor.user.id, isTest: actor.user.isTestTenant });
      await this.audit.record(tx, actor, { entityType: 'special_aid', entityId: dossierId, action: 'special_aid.appointment_relation', before: { entryId, relation: old?.relation ?? null }, after: { entryId, relation } });
    });
  }

  // ------------------------------------------------------------------ technical feedback and formal warnings

  async issueFeedback(actor: Actor, input: FeedbackInput): Promise<SpecialAidFeedback> {
    this.need(actor, 'special_aid.warn');
    const tenantId = actor.user.tenantId;
    if (input.recipientId === actor.user.id) throw badRequest('SPECIAL_AID_FEEDBACK_SELF', 'بازخورد یا تذکر برای خودتان ثبت نمی‌شود');
    const id = await this.db.transaction(async (tx) => {
      const [r] = await tx.select({ id: users.id, isActive: users.isActive }).from(users).where(and(eq(users.id, input.recipientId), eq(users.tenantId, tenantId)));
      if (!r?.isActive) throw badRequest('SPECIAL_AID_FEEDBACK_RECIPIENT', 'کارمند فعال انتخاب کنید');
      let dossierId = input.dossierId ?? null;
      if (input.itemId) {
        const [i] = await tx.select({ dossierId: specialAidItems.dossierId }).from(specialAidItems).where(and(eq(specialAidItems.id, input.itemId), eq(specialAidItems.tenantId, tenantId)));
        if (!i || (dossierId && i.dossierId !== dossierId)) throw badRequest('SPECIAL_AID_FEEDBACK_ITEM', 'قطعه متعلق به این پرونده نیست');
        dossierId = i.dossierId;
      }
      if (dossierId) {
        const [d] = await tx.select({ id: specialAidDossiers.id }).from(specialAidDossiers).where(and(eq(specialAidDossiers.id, dossierId), eq(specialAidDossiers.tenantId, tenantId)));
        if (!d) throw notFound('پروندهٔ امداد ویژه');
      }
      const fid = newId();
      await tx.insert(specialAidFeedback).values({ id: fid, tenantId, kind: input.kind, reason: input.reason ?? null, message: input.message, recipientId: input.recipientId, dossierId, itemId: input.itemId ?? null, issuedBy: actor.user.id, isTest: actor.user.isTestTenant });
      await notifyUsers(tx, tenantId, [input.recipientId], { kind: `special_aid.${input.kind}`, urgent: input.kind === 'warning', category: 'special_aid', title: `${FEEDBACK_KIND_LABELS[input.kind]} از ${actor.user.displayName}`, body: input.message.slice(0, 200), link: '/special-aid/feedback', dedupeKey: `special-aid:feedback:${fid}` });
      await this.audit.record(tx, actor, { entityType: 'special_aid', entityId: fid, action: `special_aid.${input.kind}_issued`, after: { recipientId: input.recipientId, reason: input.reason ?? null, dossierId, itemId: input.itemId ?? null } });
      return fid;
    });
    return (await this.feedback(actor, { id }))[0]!;
  }

  /** Managers (warn/report) see every record; everyone else sees what was addressed to them. */
  async feedback(actor: Actor, f: { id?: string; dossierId?: string } = {}): Promise<SpecialAidFeedback[]> {
    const all = actor.user.permissions.has('special_aid.warn') || actor.user.permissions.has('special_aid.report');
    const rows = await this.db.select({ f: specialAidFeedback, vin: specialAidDossiers.vin }).from(specialAidFeedback).leftJoin(specialAidDossiers, eq(specialAidDossiers.id, specialAidFeedback.dossierId))
      .where(and(eq(specialAidFeedback.tenantId, actor.user.tenantId), all ? undefined : eq(specialAidFeedback.recipientId, actor.user.id), f.id ? eq(specialAidFeedback.id, f.id) : undefined, f.dossierId ? eq(specialAidFeedback.dossierId, f.dossierId) : undefined))
      .orderBy(desc(specialAidFeedback.issuedAt)).limit(300);
    const names = await this.names(rows.flatMap((r) => [r.f.recipientId, r.f.issuedBy]));
    return rows.map(({ f: x, vin }) => ({
      id: x.id, kind: x.kind as FeedbackKind, reason: x.reason as NonConsumptionReason | null, message: x.message,
      recipientId: x.recipientId, recipientName: names.get(x.recipientId) ?? '', issuedByName: names.get(x.issuedBy) ?? '', issuedAt: x.issuedAt.toISOString(),
      dossierId: x.dossierId, vin: vin ?? null, itemId: x.itemId, acknowledgedAt: iso(x.acknowledgedAt), reply: x.reply, version: x.version,
    }));
  }

  /** Receipt only: acknowledging is not accepting fault; the optional reply stays beside it. */
  async acknowledge(actor: Actor, id: string, input: FeedbackAckInput) {
    await this.db.transaction(async (tx) => {
      const [x] = await tx.select().from(specialAidFeedback).where(and(eq(specialAidFeedback.id, id), eq(specialAidFeedback.tenantId, actor.user.tenantId))).for('update');
      if (!x) throw notFound('بازخورد');
      if (x.recipientId !== actor.user.id) throw forbidden('فقط گیرنده دریافت را تأیید می‌کند');
      if (x.version !== input.expectedVersion) throw versionConflict(x.version);
      if (x.acknowledgedAt) throw badRequest('SPECIAL_AID_FEEDBACK_ACKED', 'دریافت قبلاً تأیید شده است');
      await tx.update(specialAidFeedback).set({ acknowledgedAt: new Date(), reply: input.reply || null, version: x.version + 1 }).where(eq(specialAidFeedback.id, x.id));
      await notifyUsers(tx, actor.user.tenantId, [x.issuedBy], { kind: 'special_aid.feedback_ack', category: 'special_aid', title: `${actor.user.displayName} دریافت ${FEEDBACK_KIND_LABELS[x.kind as FeedbackKind]} را تأیید کرد`, body: input.reply?.slice(0, 200) || 'تأیید دریافت (به معنای پذیرش تقصیر نیست).', link: '/special-aid/feedback', dedupeKey: `special-aid:feedback-ack:${x.id}` });
      await this.audit.record(tx, actor, { entityType: 'special_aid', entityId: x.id, action: 'special_aid.feedback_acknowledged', after: { reply: input.reply ?? null, acceptsFault: false } });
    });
    return (await this.feedback(actor, { id }))[0]!;
  }

  async openFeedbackCounts(tenantId: string) {
    const [r] = await this.db.select({ open: sql<number>`count(*) filter (where ${specialAidFeedback.acknowledgedAt} is null)::int`, warnings: sql<number>`count(*) filter (where ${specialAidFeedback.kind} = 'warning')::int` })
      .from(specialAidFeedback).where(eq(specialAidFeedback.tenantId, tenantId));
    return { open: r?.open ?? 0, warnings: r?.warnings ?? 0 };
  }

  // ------------------------------------------------------------------ VIN review queue

  /** Official lines whose VIN is incomplete or invalid: kept for review, never forced into a dossier. */
  async reviewQueue(actor: Actor): Promise<SpecialAidReviewRow[]> {
    this.need(actor, 'special_aid.read');
    const rows = await this.db.select().from(emdadRequests).leftJoin(specialAidItems, eq(specialAidItems.requestId, emdadRequests.id))
      .where(and(eq(emdadRequests.tenantId, actor.user.tenantId), isNull(specialAidItems.id), ne(emdadRequests.statusCategory, 'cancelled'))).orderBy(desc(emdadRequests.lastReportAt)).limit(2000);
    // A later row with the same special-aid number and a corrected VIN supersedes the invalid one (history stays).
    const placed = new Set((await this.db.select({ no: emdadRequests.emdadNo }).from(emdadRequests).innerJoin(specialAidItems, eq(specialAidItems.requestId, emdadRequests.id))
      .where(eq(emdadRequests.tenantId, actor.user.tenantId))).map((x) => x.no).filter(Boolean));
    return rows.filter(({ emdad_requests: r }) => !isAidVehicleKey(idKey(r.chassis ?? '')) && !(r.emdadNo && placed.has(r.emdadNo))).slice(0, 500).map(({ emdad_requests: r }) => {
      const o = (r.official ?? {}) as Partial<EmdadOfficial>;
      return { requestId: r.id, vinText: r.chassis, emdadNo: r.emdadNo, admissionNo: r.admissionNo, description: o.specialDescription || o.supplyDescription || null, officialStatus: o.emdadStatus ?? '', lastReportAt: iso(r.lastReportAt) };
    });
  }
}
