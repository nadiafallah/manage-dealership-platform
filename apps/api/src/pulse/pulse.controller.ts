import { Body, Controller, Get, Post, Put, StreamableFile } from '@nestjs/common';
import { z } from 'zod';
import {
  pulseCaptchaSchema, pulseCommandSchema, pulseCredentialsSchema, pulseSettingsSchema, pulseToggleSchema,
  receptionExternalCancelSchema, receptionExternalUpdateSchema, receptionExternalWorkSchema, receptionInvoiceSchema, receptionNoteSchema, receptionSearchSchema, receptionSettingsSchema, receptionStatsQuerySchema, nightListItemSchema, nightListQuerySchema, nightListSendSchema,
  type PulseCommandInput, type PulseCredentialsInput, type PulseSettingsInput, type ReceptionExternalUpdateInput, type ReceptionExternalWorkInput, type ReceptionSearchInput, type ReceptionSettingsInput, type NightListItemInput,
} from '@manage/shared';
import type { Actor } from '../auth/auth.types';
import { CurrentActor, RequirePermissions } from '../auth/decorators';
import { IdParam } from '../common/params';
import { ZodPipe } from '../common/zod.pipe';
import { NightListService } from './night-list.service';
import { PulseService } from './pulse.service';
import { ReceptionService } from './reception.service';

/** «منیج پالس · اتصال کسب‌وکار» (spec section 26): owner and system administrator only. The password is never returned. */
@Controller('pulse')
export class PulseController {
  constructor(private readonly pulse: PulseService) {}

  @RequirePermissions('integration.manage') @Get('status')
  status(@CurrentActor() actor: Actor) { return this.pulse.status(actor); }

  @RequirePermissions('integration.manage') @Put('credentials')
  credentials(@CurrentActor() actor: Actor, @Body(new ZodPipe(pulseCredentialsSchema)) body: PulseCredentialsInput) { return this.pulse.saveCredentials(actor, body); }

  @RequirePermissions('integration.manage') @Put('settings')
  settings(@CurrentActor() actor: Actor, @Body(new ZodPipe(pulseSettingsSchema)) body: PulseSettingsInput) { return this.pulse.saveSettings(actor, body); }

  @RequirePermissions('integration.manage') @Post('start')
  start(@CurrentActor() actor: Actor, @Body(new ZodPipe(pulseToggleSchema)) body: { expectedVersion: number }) { return this.pulse.toggle(actor, body.expectedVersion, true); }

  @RequirePermissions('integration.manage') @Post('stop')
  stop(@CurrentActor() actor: Actor, @Body(new ZodPipe(pulseToggleSchema)) body: { expectedVersion: number }) { return this.pulse.toggle(actor, body.expectedVersion, false); }

  @RequirePermissions('integration.manage') @Post('commands')
  command(@CurrentActor() actor: Actor, @Body(new ZodPipe(pulseCommandSchema)) body: PulseCommandInput) { return this.pulse.command(actor, body); }

  @RequirePermissions('integration.manage') @Post('captcha')
  captcha(@CurrentActor() actor: Actor, @Body(new ZodPipe(pulseCaptchaSchema)) body: { answer: string }) { return this.pulse.captcha(actor, body.answer); }

  @RequirePermissions('integration.manage') @Get('review')
  review(@CurrentActor() actor: Actor) { return this.pulse.review(actor); }
}

const versionReason = receptionExternalCancelSchema;
const invoiceSchema = receptionInvoiceSchema;

/** «پذیرش و ترخیص»: read-only folders from کسب‌وکار plus outside work and notes recorded in Manage. Search is POSTed to keep VINs out of URLs. */
@Controller('reception')
export class ReceptionController {
  constructor(private readonly reception: ReceptionService, private readonly night: NightListService) {}

  /** «لیست شب» of a Tehran day (scenario 2026-11-25). Declared before ':id'. */
  @RequirePermissions('reception.read') @Post('night-list')
  nightList(@CurrentActor() actor: Actor, @Body(new ZodPipe(nightListQuerySchema)) body: { day?: string }) { return this.night.view(actor, body.day); }

  @RequirePermissions('reception.read', 'reception.night_list_send') @Post('night-list/generate')
  nightListGenerate(@CurrentActor() actor: Actor, @Body(new ZodPipe(nightListQuerySchema)) body: { day?: string }) { return this.night.generateNow(actor, body.day); }

  @RequirePermissions('reception.read', 'reception.night_list') @Post('night-list/items/:id')
  nightListItem(@CurrentActor() actor: Actor, @IdParam('id') id: string, @Body(new ZodPipe(nightListItemSchema)) body: NightListItemInput) { return this.night.setItem(actor, id, body); }

  @RequirePermissions('reception.read', 'reception.night_list_send') @Post('night-list/:id/send')
  nightListSend(@CurrentActor() actor: Actor, @IdParam('id') id: string, @Body(new ZodPipe(nightListSendSchema)) body: { expectedVersion: number }) { return this.night.send(actor, id, body.expectedVersion); }

  @RequirePermissions('reception.read') @Get('night-list/:id/excel')
  async nightListExcel(@CurrentActor() actor: Actor, @IdParam('id') id: string) {
    const { day, bytes } = await this.night.excel(actor, id);
    return new StreamableFile(Buffer.from(bytes), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', disposition: `attachment; filename="night-list-${day}.xlsx"` });
  }

  @RequirePermissions('reception.read') @Post('search')
  search(@CurrentActor() actor: Actor, @Body(new ZodPipe(receptionSearchSchema)) body: ReceptionSearchInput) { return this.reception.search(actor, body); }

  // Declared before ':id' so the word is never read as an id.
  @RequirePermissions('reception.read', 'reception.external_work') @Get('contractors')
  contractors(@CurrentActor() actor: Actor) { return this.reception.contractors(actor); }

  /** Daily statistics: repair / periodic service / no labour yet, per receptionist (scenario 2026-11-25). */
  @RequirePermissions('reception.read') @Post('stats')
  stats(@CurrentActor() actor: Actor, @Body(new ZodPipe(receptionStatsQuerySchema)) body: { date?: string }) { return this.reception.stats(actor, body.date); }

  /** Labour codes that count as periodic service and oil change; edited by the owner or system administrator. */
  @RequirePermissions('reception.read') @Get('settings')
  settings(@CurrentActor() actor: Actor) { return this.reception.settings(actor); }

  @RequirePermissions('settings.manage') @Put('settings')
  saveSettings(@CurrentActor() actor: Actor, @Body(new ZodPipe(receptionSettingsSchema)) body: ReceptionSettingsInput) { return this.reception.saveSettings(actor, body); }

  @RequirePermissions('reception.read') @Get('invoices/:documentId')
  async invoice(@CurrentActor() actor: Actor, @IdParam('documentId') documentId: string) {
    const row = await this.reception.invoice(actor, documentId);
    return new StreamableFile(Buffer.from(row.dataBase64, 'base64'), { type: row.mime, disposition: `attachment; filename*=UTF-8''${encodeURIComponent(row.fileName)}` });
  }

  @RequirePermissions('reception.read') @Get(':id')
  detail(@CurrentActor() actor: Actor, @IdParam() id: string) { return this.reception.detail(actor, id); }

  @RequirePermissions('reception.read', 'reception.external_work') @Post(':id/external-work')
  addWork(@CurrentActor() actor: Actor, @IdParam() id: string, @Body(new ZodPipe(receptionExternalWorkSchema)) body: ReceptionExternalWorkInput) { return this.reception.addExternalWork(actor, id, body); }

  @RequirePermissions('reception.read', 'reception.external_work') @Post('external-work/:id')
  updateWork(@CurrentActor() actor: Actor, @IdParam() id: string, @Body(new ZodPipe(receptionExternalUpdateSchema)) body: ReceptionExternalUpdateInput) { return this.reception.updateExternalWork(actor, id, body); }

  @RequirePermissions('reception.read', 'reception.external_work') @Post('external-work/:id/cancel')
  cancelWork(@CurrentActor() actor: Actor, @IdParam() id: string, @Body(new ZodPipe(versionReason)) body: z.infer<typeof versionReason>) { return this.reception.cancelExternalWork(actor, id, body.expectedVersion, body.reason); }

  @RequirePermissions('reception.read', 'reception.external_work') @Post('external-work/:id/invoices')
  uploadInvoice(@CurrentActor() actor: Actor, @IdParam() id: string, @Body(new ZodPipe(invoiceSchema)) body: z.infer<typeof invoiceSchema>) { return this.reception.uploadInvoice(actor, id, body); }

  @RequirePermissions('reception.read', 'reception.external_work') @Post(':id/notes')
  note(@CurrentActor() actor: Actor, @IdParam() id: string, @Body(new ZodPipe(receptionNoteSchema)) body: { text: string }) { return this.reception.addNote(actor, id, body.text); }
}
