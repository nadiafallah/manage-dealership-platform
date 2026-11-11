import { Body, Controller, Get, Post, Put, Query } from '@nestjs/common';
import { alertResponseSchema, alertSettingsSchema, type AlertResponseInput, type AlertSettingsInput } from '@manage/shared';
import type { Actor } from '../auth/auth.types';
import { CurrentActor, RequirePermissions } from '../auth/decorators';
import { IdParam } from '../common/params';
import { ZodPipe } from '../common/zod.pipe';
import { AlertsService } from './alerts.service';

@Controller()
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @RequirePermissions('case.read') @Get('alerts')
  list(@CurrentActor() actor: Actor, @Query('caseId') caseId?: string) {
    return this.alerts.list(actor, caseId && /^[0-9a-f-]{36}$/i.test(caseId) ? caseId : undefined);
  }

  @RequirePermissions('case.read') @Get('cases/:id/alerts/history')
  history(@CurrentActor() actor: Actor, @IdParam() id: string) {
    return this.alerts.history(actor, id);
  }

  @RequirePermissions('case.update') @Post('cases/:id/alerts/respond')
  respond(@CurrentActor() actor: Actor, @IdParam() id: string, @Body(new ZodPipe(alertResponseSchema)) body: AlertResponseInput) {
    return this.alerts.respond(actor, id, body);
  }

  @RequirePermissions('settings.manage') @Get('settings/alerts')
  settings(@CurrentActor() actor: Actor) {
    return this.alerts.settings(actor);
  }

  @RequirePermissions('settings.manage') @Put('settings/alerts')
  save(@CurrentActor() actor: Actor, @Body(new ZodPipe(alertSettingsSchema)) body: AlertSettingsInput) {
    return this.alerts.saveSettings(actor, body);
  }
}
