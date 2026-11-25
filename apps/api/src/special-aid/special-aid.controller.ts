import { Body, Controller, Get, Param, Post, Query, StreamableFile } from '@nestjs/common';
import { z } from 'zod';
import {
  appointmentRelationSchema, cardMatchSchema, funnelPeriodSchema, type FunnelPeriod, cardUploadSchema, feedbackAckSchema, feedbackSchema, replacementSchema,
  type CardMatchInput, type CardUploadInput, type FeedbackAckInput, type FeedbackInput, type ReplacementInput,
  contactSchema, dossierSearchSchema, groupDecisionSchema, groupSchema, itemActionSchema, nonConsumptionSchema, postponeSchema, supplySearchSchema,
  type ContactInput, type DossierSearchInput, type ItemActionInput, type NonConsumptionInput, type PostponeInput, type SupplySearchInput,
} from '@manage/shared';
import type { Actor } from '../auth/auth.types';
import { CurrentActor, RequirePermissions } from '../auth/decorators';
import { IdParam } from '../common/params';
import { ZodPipe } from '../common/zod.pipe';
import { SpecialAidService } from './special-aid.service';
import { SpecialAidRecordsService } from './special-aid-records.service';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const versionSchema = z.object({ expectedVersion: z.number().int().min(1) });
const cardStateQuery = z.object({ state: z.enum(['unmatched', 'matched']).optional() });
const decisionBody = groupDecisionSchema.extend({ decision: z.enum(['wait', 'partial']).nullable(), dissolve: z.boolean().optional() });

/** «پیگیری امداد ویژه» (spec section 25). Search bodies are POSTed to keep VINs out of URLs and logs. */
@Controller('special-aid')
export class SpecialAidController {
  constructor(private readonly aid: SpecialAidService, private readonly records: SpecialAidRecordsService) {}

  @RequirePermissions('special_aid.read') @Get('today')
  today(@CurrentActor() actor: Actor) { return this.aid.today(actor); }

  @RequirePermissions('special_aid.read') @Post('dossiers/search')
  list(@CurrentActor() actor: Actor, @Body(new ZodPipe(dossierSearchSchema)) body: DossierSearchInput) { return this.aid.list(actor, body); }

  /** Inspection file of one vehicle: parts, contacts and audit trail (scenario 2026-11-25). */
  @RequirePermissions('special_aid.read') @Get('dossiers/:id/inspection')
  async inspection(@CurrentActor() actor: Actor, @IdParam('id') id: string) {
    const { bytes } = await this.aid.inspectionExport(actor, id);
    return new StreamableFile(Buffer.from(bytes), { type: XLSX, disposition: 'attachment; filename="special-aid-inspection.xlsx"' });
  }

  @RequirePermissions('special_aid.read') @Get('dossiers/:id')
  get(@CurrentActor() actor: Actor, @IdParam() id: string) { return this.aid.get(actor, id); }

  @RequirePermissions('special_aid.operate') @Post('sync')
  sync(@CurrentActor() actor: Actor) { return this.aid.sync(actor); }

  @RequirePermissions('special_aid.operate') @Post('dossiers/:id/contacts')
  contact(@CurrentActor() actor: Actor, @IdParam() id: string, @Body(new ZodPipe(contactSchema)) body: ContactInput) { return this.aid.contact(actor, id, body); }

  @RequirePermissions('special_aid.operate') @Post('dossiers/:id/postpone')
  postpone(@CurrentActor() actor: Actor, @IdParam() id: string, @Body(new ZodPipe(postponeSchema)) body: PostponeInput) { return this.aid.postpone(actor, id, body); }

  @RequirePermissions('special_aid.operate') @Post('dossiers/:id/attended')
  attended(@CurrentActor() actor: Actor, @IdParam() id: string, @Body(new ZodPipe(versionSchema)) body: { expectedVersion: number }) { return this.aid.attended(actor, id, body.expectedVersion); }

  @RequirePermissions('special_aid.operate') @Post('dossiers/:id/groups')
  group(@CurrentActor() actor: Actor, @IdParam() id: string, @Body(new ZodPipe(groupSchema)) body: { itemIds: string[]; label?: string }) { return this.aid.group(actor, id, body); }

  @RequirePermissions('special_aid.operate') @Post('groups/:id/decision')
  decision(@CurrentActor() actor: Actor, @IdParam() id: string, @Body(new ZodPipe(decisionBody)) body: z.infer<typeof decisionBody>) { return this.aid.groupDecision(actor, id, body); }

  // special_aid.release is checked in the service for the release action.
  @RequirePermissions('special_aid.read') @Post('items/:id/action')
  action(@CurrentActor() actor: Actor, @IdParam() id: string, @Body(new ZodPipe(itemActionSchema)) body: ItemActionInput) { return this.aid.itemAction(actor, id, body); }

  @RequirePermissions('special_aid.operate') @Post('items/:id/non-consumption')
  nonConsumption(@CurrentActor() actor: Actor, @IdParam() id: string, @Body(new ZodPipe(nonConsumptionSchema)) body: NonConsumptionInput) { return this.aid.nonConsumption(actor, id, body); }

  @RequirePermissions('special_aid.supply') @Post('supply/search')
  supply(@CurrentActor() actor: Actor, @Body(new ZodPipe(supplySearchSchema)) body: SupplySearchInput) { return this.aid.supply(actor, body); }

  @RequirePermissions('special_aid.supply') @Post('supply/export')
  async supplyExport(@CurrentActor() actor: Actor, @Body(new ZodPipe(supplySearchSchema)) body: SupplySearchInput) {
    return new StreamableFile(Buffer.from(await this.aid.supplyExport(actor, body)), { type: XLSX, disposition: 'attachment; filename="special-aid-supply.xlsx"' });
  }

  @RequirePermissions('special_aid.report') @Get('summary')
  summary(@CurrentActor() actor: Actor, @Query(new ZodPipe(funnelPeriodSchema)) q: FunnelPeriod) { return this.aid.summary(actor, q); }
  @RequirePermissions('special_aid.operate') @Post('items/:id/replacement')
  replacement(@CurrentActor() actor: Actor, @IdParam() id: string, @Body(new ZodPipe(replacementSchema)) body: ReplacementInput) { return this.aid.replacement(actor, id, body); }

  @RequirePermissions('special_aid.read') @Get('review-queue')
  reviewQueue(@CurrentActor() actor: Actor) { return this.records.reviewQueue(actor); }

  // Admission card archive: single or bulk upload, administrator-assisted matching, original download.
  @RequirePermissions('special_aid.operate') @Post('cards')
  uploadCards(@CurrentActor() actor: Actor, @Body(new ZodPipe(cardUploadSchema)) body: CardUploadInput) { return this.records.uploadCards(actor, body); }

  @RequirePermissions('special_aid.read') @Get('cards')
  cards(@CurrentActor() actor: Actor, @Query(new ZodPipe(cardStateQuery)) q: z.infer<typeof cardStateQuery>) { return this.records.listCards(actor, q.state); }

  @RequirePermissions('special_aid.read') @Get('cards/:id/file')
  async cardFile(@CurrentActor() actor: Actor, @IdParam() id: string) {
    const c = await this.records.cardFile(actor, id);
    return new StreamableFile(Buffer.from(c.dataBase64, 'base64'), { type: c.mime, disposition: `attachment; filename*=UTF-8''${encodeURIComponent(c.fileName)}` });
  }

  @RequirePermissions('special_aid.operate') @Post('cards/:id/match')
  matchCard(@CurrentActor() actor: Actor, @IdParam() id: string, @Body(new ZodPipe(cardMatchSchema)) body: CardMatchInput) { return this.records.matchCard(actor, id, body); }

  // Appointments are tracked from the imported ISACO list only; the operator says related / unrelated.
  @RequirePermissions('special_aid.operate') @Post('dossiers/:id/appointments/:entryId')
  async relation(@CurrentActor() actor: Actor, @IdParam() id: string, @Param('entryId', new ZodPipe(z.uuid())) entryId: string, @Body(new ZodPipe(appointmentRelationSchema)) body: z.infer<typeof appointmentRelationSchema>) {
    await this.records.setAppointmentRelation(actor, id, entryId, body.relation);
    return this.aid.get(actor, id);
  }

  // Feedback: every signed-in person reads what was addressed to them; issuing needs special_aid.warn.
  @RequirePermissions() @Get('feedback')
  feedback(@CurrentActor() actor: Actor) { return this.records.feedback(actor); }

  @RequirePermissions('special_aid.warn') @Post('feedback')
  issue(@CurrentActor() actor: Actor, @Body(new ZodPipe(feedbackSchema)) body: FeedbackInput) { return this.records.issueFeedback(actor, body); }

  @RequirePermissions() @Post('feedback/:id/acknowledge')
  acknowledge(@CurrentActor() actor: Actor, @IdParam() id: string, @Body(new ZodPipe(feedbackAckSchema)) body: FeedbackAckInput) { return this.records.acknowledge(actor, id, body); }
}
