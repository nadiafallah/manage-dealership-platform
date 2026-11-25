import {
  DynamicModule,
  RequestMethod,
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { AccidentModule } from './accident/accident.module';
import { DailyReportsModule } from './daily-reports/daily-reports.module';
import { PeopleModule } from './people/people.module';
import { PulseModule } from './pulse/pulse.module';
import { AuditService } from './audit/audit.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { AccessService } from './auth/access.service';
import { AccessController } from './auth/access.controller';
import { EmailAuthController } from './auth/email-auth.controller';
import { EmailAuthService } from './auth/email-auth.service';
import { TechniciansController } from './auth/technicians.controller';
import { TechniciansService } from './auth/technicians.service';
import { InvitationMailService } from './auth/invitation-mail.service';
import { SessionGuard } from './auth/session.guard';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { GuestMaskInterceptor } from './common/guest-mask.interceptor';
import { IdempotencyInterceptor } from './common/idempotency.interceptor';
import { APP_CONFIG, type AppConfig } from './config';
import { DATABASE, openDatabase, type DatabaseHandle } from './db/database';
import { DemoSeedService } from './demo/demo-seed.service';
import { HealthController } from './health/health.controller';
import { ReferenceController } from './reference/reference.controller';

@Injectable()
class Lifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Lifecycle');
  constructor(
    @Inject(DATABASE) private readonly handle: DatabaseHandle,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly seeder: DemoSeedService,
  ) {}

  // Development and Preview hold synthetic data only: an empty database gets
  // the demo dealership automatically, so the stack is immediately usable.
  async onApplicationBootstrap() {
    const synthetic = this.cfg.APP_ENV === 'development' || this.cfg.APP_ENV === 'preview';
    if (synthetic && !(await this.seeder.isSeeded())) {
      const password = await this.seeder.seed();
      // A password given via SEED_DEMO_PASSWORD is already known; only generated ones are written.
      if (!this.cfg.SEED_DEMO_PASSWORD) this.seeder.writeCredentials(password);
      this.logger.log(`Empty ${this.cfg.APP_ENV} database: synthetic demo dealership created`);
    }
  }

  async onApplicationShutdown() {
    await this.handle.close();
  }
}

/** Configuration, database, audit and authentication shared by all modules. */
@Global()
@Module({})
export class CoreModule {
  static forRoot(cfg: AppConfig): DynamicModule {
    return {
      module: CoreModule,
      providers: [
        { provide: APP_CONFIG, useValue: cfg },
        {
          provide: DATABASE,
          useFactory: async () => {
            const handle = openDatabase(cfg);
            // Production applies migrations as an explicit, backed-up deploy step.
            if (cfg.APP_ENV !== 'production') await handle.migrate();
            return handle;
          },
        },
        AuditService,
        AuthService,
        EmailAuthService,
        InvitationMailService,
      ],
      exports: [APP_CONFIG, DATABASE, AuditService, AuthService, EmailAuthService, InvitationMailService],
    };
  }
}

@Module({})
export class AppModule {
  static forRoot(cfg: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot(cfg),
        LoggerModule.forRoot({
          // Named wildcard: Express 5 / path-to-regexp v8 rejects a bare "*".
          forRoutes: [{ path: '{*splat}', method: RequestMethod.ALL }],
          pinoHttp: {
            level: cfg.APP_ENV === 'test' ? 'silent' : 'info',
            genReqId: (req, res) => {
              const incoming = req.headers['x-request-id'];
              const id = typeof incoming === 'string' && incoming.length <= 64 ? incoming : randomUUID();
              res.setHeader('x-request-id', id);
              return id;
            },
            redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
            autoLogging: { ignore: (req) => req.url?.endsWith('/health') ?? false },
          },
        }),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: cfg.APP_ENV === 'test' ? 10_000 : 600 }]),
        AccidentModule,
        DailyReportsModule,
        PeopleModule,
        PulseModule,
      ],
      controllers: [AuthController, EmailAuthController, TechniciansController, HealthController, ReferenceController, AccessController],
      providers: [
        AccessService,
        TechniciansService,
        DemoSeedService,
        Lifecycle,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: SessionGuard },
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
        { provide: APP_INTERCEPTOR, useClass: GuestMaskInterceptor },
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
      ],
    };
  }
}
