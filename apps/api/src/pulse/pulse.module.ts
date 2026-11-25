import { Module } from '@nestjs/common';
import { PulseController, ReceptionController } from './pulse.controller';
import { NightListService } from './night-list.service';
import { PulseService } from './pulse.service';
import { ReceptionService } from './reception.service';

/**
 * API side of Manage Pulse and the «پذیرش و ترخیص» module (spec section 26). The worker that
 * connects to کسب‌وکار is a separate process (src/pulse/main.ts, compose service `pulse`), so a
 * failure there can never stop the API or the web app.
 */
@Module({
  controllers: [PulseController, ReceptionController],
  providers: [PulseService, ReceptionService, NightListService],
  exports: [NightListService],
})
export class PulseModule {}
