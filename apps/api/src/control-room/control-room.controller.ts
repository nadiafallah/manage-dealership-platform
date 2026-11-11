import { Controller, Get, Query } from '@nestjs/common';
import { CONTROL_RANGES, type ControlRange } from '@manage/shared';
import { z } from 'zod';
import type { Actor } from '../auth/auth.types';
import { CurrentActor, RequirePermissions } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ControlRoomService } from './control-room.service';

const querySchema = z.object({ range: z.enum(CONTROL_RANGES).default('today') });

@Controller('control-room')
export class ControlRoomController {
  constructor(private readonly room: ControlRoomService) {}

  /** Service manager and owner: four numbers, funnel, live map, analysis, people and unanswered alerts. Read-only. */
  @Get()
  @RequirePermissions('report.manager')
  snapshot(@CurrentActor() actor: Actor, @Query(new ZodPipe(querySchema)) q: { range: ControlRange }) {
    return this.room.snapshot(actor, q.range);
  }
}
