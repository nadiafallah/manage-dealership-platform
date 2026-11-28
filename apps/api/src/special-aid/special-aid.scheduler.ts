import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config';
import { SpecialAidService } from './special-aid.service';

/**
 * Time-based alert of «پیگیری امداد ویژه» (spec 29.2): the end of the 20-working-day deadline.
 * Runs on the server like the daily-report reminders (never a browser timer); notices carry a
 * unique key per vehicle and deadline day, so restarts and several API workers never repeat them.
 */
@Injectable()
export class SpecialAidScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('SpecialAidDeadline');
  private timer: NodeJS.Timeout | null = null;
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig, private readonly aid: SpecialAidService) {}

  onApplicationBootstrap() {
    if (!this.cfg.DAILY_SCHEDULER || this.cfg.APP_ENV === 'test') return;
    const run = () => void this.aid.deadlineSweep().catch((e: unknown) => this.logger.error(`deadline sweep failed: ${e instanceof Error ? e.message : 'unknown'}`));
    this.timer = setInterval(run, 30 * 60_000);
    this.timer.unref();
    run();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }
}
