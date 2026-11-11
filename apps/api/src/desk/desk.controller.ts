import { Controller, Get } from '@nestjs/common';
import type { Actor } from '../auth/auth.types';
import { IdParam } from '../common/params';
import { CurrentActor, RequirePermissions } from '../auth/decorators';
import { DeskService } from './desk.service';

@Controller('desk')
export class DeskController {
  constructor(private readonly desk: DeskService) {}

  /** Folder cards of all open cars: plate, place, days in the shop, coverage and one «قدم بعدی». */
  @Get('folders')
  @RequirePermissions('case.read')
  folders(@CurrentActor() actor: Actor) {
    return this.desk.folders(actor);
  }

  /** The folder header of one case (also closed ones). */
  @Get('folders/:id')
  @RequirePermissions('case.read')
  folder(@CurrentActor() actor: Actor, @IdParam() id: string) {
    return this.desk.folder(actor, id);
  }
}
