import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { loadConfig, type AppConfig } from '../src/config';
import { DATABASE, type DatabaseHandle } from '../src/db/database';
import { DEMO_TENANT_CODE, DemoSeedService } from '../src/demo/demo-seed.service';
import { eq } from 'drizzle-orm';
import type { Permission, Role } from '@manage/shared';
import { hashPassword } from '../src/auth/password';
import { newId } from '../src/common/ids';
import { tenants, users } from '../src/db/schema';

export const TEST_PASSWORD = 'test-only-password-1';

export interface Harness {
  app: INestApplication;
  db: DatabaseHandle;
  seeder: DemoSeedService;
  login(username: string, tenantCode?: string): Promise<Client>;
  /** Adds a synthetic user to the demo dealership and logs in (e.g. a second manager). */
  loginAs(username: string, roles: Role[], allow?: Permission[]): Promise<Client>;
  close(): Promise<void>;
}

/** HTTP client that keeps the session cookie and sends the CSRF header. */
export class Client {
  constructor(
    private readonly app: INestApplication,
    readonly cookie: string,
  ) {}

  private withAuth(req: request.Test) {
    return req.set('Cookie', this.cookie).set('x-manage-client', 'test');
  }
  get(url: string) {
    return this.withAuth(request(this.app.getHttpServer()).get(`/api/v1${url}`));
  }
  post(url: string, body: object = {}) {
    return this.withAuth(request(this.app.getHttpServer()).post(`/api/v1${url}`)).send(body);
  }
  patch(url: string, body: object) {
    return this.withAuth(request(this.app.getHttpServer()).patch(`/api/v1${url}`)).send(body);
  }
  put(url: string, body: object) {
    return this.withAuth(request(this.app.getHttpServer()).put(`/api/v1${url}`)).send(body);
  }
}

export async function createHarness(opts: { withCases?: boolean; fleet?: boolean; config?:Partial<Record<keyof AppConfig,string>> } = {}): Promise<Harness> {
  const cfg = loadConfig({ APP_ENV: 'test', DB_DRIVER: 'pglite', PGLITE_DATA_DIR: 'memory://', NODE_ID: 'test', ...opts.config });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(cfg)] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app, cfg);
  await app.init();
  const seeder = app.get(DemoSeedService);
  // The ~20-car demo fleet is opt-in in tests: older suites count the five base cases.
  await seeder.seed({ password: TEST_PASSWORD, withCases: opts.withCases ?? false, fleet: opts.fleet ?? false });

  async function login(username: string, tenantCode?: string): Promise<Client> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('x-manage-client', 'test')
      .send({ username, password: TEST_PASSWORD, tenantCode });
    if (res.status !== 200) throw new Error(`login ${username} failed: ${res.status} ${JSON.stringify(res.body)}`);
    const setCookie = res.headers['set-cookie'] as unknown as string[];
    return new Client(app, setCookie.map((c) => c.split(';')[0]).join('; '));
  }

  return {
    app,
    db: app.get<DatabaseHandle>(DATABASE),
    seeder,
    login,
    async loginAs(username: string, roles: Role[], allow: Permission[] = []) {
      const db = app.get<DatabaseHandle>(DATABASE).db;
      const [tenant] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.code, DEMO_TENANT_CODE));
      await db.insert(users).values({
        id: newId(),
        tenantId: tenant!.id,
        username,
        displayName: `کاربر آزمون ${username}`,
        passwordHash: await hashPassword(TEST_PASSWORD),
        roles,
        permissionOverrides: { allow, deny: [] },
        isTest: true,
      });
      return login(username);
    },
    async close() {
      await app.close();
    },
  };
}

export const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
export const daysAhead = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

/**
 * The permissions of the retired cashier role (before migration 0020), given as
 * personal overrides to a role-less test account so payment tests keep their meaning.
 */
export const LEGACY_CASHIER_PERMISSIONS: Permission[] = ['case.read', 'customer.pii.read', 'finance.payment', 'finance.close', 'dashboard.read'];
/** The permissions of the retired QC role, for tests that need a narrow read-mostly colleague. */
export const LEGACY_QC_PERMISSIONS: Permission[] = ['case.read', 'blocker.report', 'qc.inspect', 'dashboard.read'];
