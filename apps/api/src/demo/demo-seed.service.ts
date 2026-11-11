import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DEFAULT_DEPARTMENTS, permissionsFor, QC_CHECK_ITEMS, ROLE_LABELS, type Role } from '@manage/shared';
import { AssessmentsService } from '../assessments/assessments.service';
import { hashPassword } from '../auth/password';
import type { Actor } from '../auth/auth.types';
import { BlockersService } from '../blockers/blockers.service';
import { FinanceService } from '../finance/finance.service';
import { PartsService } from '../parts/parts.service';
import { CasesService } from '../cases/cases.service';
import { CompletionService } from '../completion/completion.service';
import { APP_CONFIG, type AppConfig } from '../config';
import { newId } from '../common/ids';
import { DATABASE, type DatabaseHandle } from '../db/database';
import { departments, tenants, users } from '../db/schema';
import { TasksService } from '../tasks/tasks.service';

export const DEMO_TENANT_CODE = 'demo';
export const CREDENTIALS_FILE = resolve(__dirname, '../../.data/demo-credentials.local.txt');

const DEMO_USERS: { username: string; displayName: string; roles: Role[] }[] = [
  { username:'technician',displayName:'تکنسین نمونه',roles:['technician'] },
  { username: 'expert', displayName: 'کارشناس تصادفات نمونه', roles: ['accident_expert'] },
  // A second and third accident expert: the specification has several experts on one desk.
  { username: 'supervisor', displayName: 'کارشناس تصادفات نمونهٔ دوم', roles: ['accident_expert'] },
  { username: 'manager', displayName: 'مدیر خدمات نمونه', roles: ['service_manager'] },
  { username: 'parts', displayName: 'مسئول قطعات نمونه', roles: ['parts_clerk'] },
  { username: 'qc', displayName: 'کارشناس تصادفات نمونهٔ سوم', roles: ['accident_expert'] },
  { username: 'admin', displayName: 'مدیر سیستم نمونه', roles: ['system_admin'] },
];

const DAY = 86_400_000;
const HOUR = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const ahead = (ms: number) => new Date(Date.now() + ms).toISOString();

/**
 * Creates the synthetic demo dealership. Every row is flagged is_test and all
 * names, phones, plates and VINs are obviously fictitious (phones 0900…,
 * VINs TESTVIN…). Sample cases go through the real services, so they carry
 * the same audit trail and invariants as real data.
 */
@Injectable()
export class DemoSeedService {
  private readonly logger = new Logger('DemoSeed');

  constructor(
    @Inject(DATABASE) private readonly handle: DatabaseHandle,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly cases: CasesService,
    private readonly tasks: TasksService,
    private readonly blockers: BlockersService,
    private readonly assessments: AssessmentsService,
    private readonly parts: PartsService,
    private readonly finance: FinanceService,
    private readonly completion: CompletionService,
  ) {}

  async isSeeded(): Promise<boolean> {
    const rows = await this.handle.db.select({ id: tenants.id }).from(tenants).limit(1);
    return rows.length > 0;
  }

  /** Returns the password used for every demo account. */
  async seed(opts: { password?: string; withCases?: boolean } = {}): Promise<string> {
    const db = this.handle.db;
    const password = opts.password || this.cfg.SEED_DEMO_PASSWORD || randomBytes(9).toString('base64url');
    const passwordHash = await hashPassword(password);
    const tenantId = newId();

    await db.transaction(async (tx) => {
      await tx.insert(tenants).values({
        id: tenantId,
        code: DEMO_TENANT_CODE,
        name: 'نمایندگی نمونه (آزمایشی)',
        brand: 'ایران‌خودرو',
        isTest: true,
      });
      await tx.insert(departments).values(
        DEFAULT_DEPARTMENTS.map((d, i) => ({ id: newId(), tenantId, code: d.code, name: d.name, sortOrder: i })),
      );
      await tx.insert(users).values(
        DEMO_USERS.map((u) => ({
          id: newId(),
          tenantId,
          username: u.username,
          displayName: u.displayName,
          passwordHash,
          roles: u.roles,
          isOwner: u.username === this.cfg.DEMO_OWNER_USERNAME,
          isTest: true,
        })),
      );
    });

    if (opts.withCases !== false) await this.seedCases(tenantId);
    return password;
  }

  writeCredentials(password: string): void {
    const lines = [
      'Manage by HEDAX — demo accounts (synthetic data only). Do not share or commit.',
      `tenant code: ${DEMO_TENANT_CODE}`,
      `password (all accounts): ${password}`,
      '',
      ...DEMO_USERS.map((u) => `${u.username.padEnd(12)} ${u.roles.map((r) => ROLE_LABELS[r]).join('، ')}`),
      '',
    ];
    try {
      mkdirSync(dirname(CREDENTIALS_FILE), { recursive: true });
      writeFileSync(CREDENTIALS_FILE, lines.join('\n'), { encoding: 'utf8', mode: 0o600 });
      this.logger.log(`Demo credentials written to ${CREDENTIALS_FILE}`);
    } catch (err) {
      // e.g. a read-only container filesystem. The password itself is never logged.
      this.logger.warn(
        `Could not write ${CREDENTIALS_FILE} (${(err as Error).message}); set SEED_DEMO_PASSWORD and run db:reset-demo`,
      );
    }
  }

  private async actorFor(tenantId: string, username: string): Promise<Actor> {
    const [row] = await this.handle.db
      .select({ u: users, t: tenants })
      .from(users)
      .innerJoin(tenants, eq(tenants.id, users.tenantId))
      .where(sql`${users.tenantId} = ${tenantId} and ${users.username} = ${username}`);
    const roles = row!.u.roles as Role[];
    return {
      user: {
        id: row!.u.id,
        tenantId,
        tenantCode: row!.t.code,
        tenantName: row!.t.name,
        isTestTenant: true,
        username,
        displayName: row!.u.displayName,
        roles,
        permissions: permissionsFor(roles),
        sessionId: 'seed',
      },
      requestId: 'demo-seed',
    };
  }

  private async seedCases(tenantId: string): Promise<void> {
    const expert = await this.actorFor(tenantId, 'expert');
    const supervisor = await this.actorFor(tenantId, 'supervisor');
    const partsClerk = await this.actorFor(tenantId, 'parts');
    const qc = await this.actorFor(tenantId, 'qc');
    const depts = await this.handle.db.select().from(departments).where(eq(departments.tenantId, tenantId));
    const dept = (code: string) => depts.find((d) => d.code === code)!.id;

    // 1. Golden card, in repair: body work started, paint waits on body.
    const c1 = await this.cases.create(expert, {
      customer: { fullName: 'مشتری نمونه یک', phone: '09000000001' },
      vehicle: { brand: 'ایران‌خودرو', model: 'دنا پلاس', trim: 'توربو', modelYear: 1402, plate: '۱۱ ب ۱۱۱ - ۱۰', vin: 'TESTVIN0000000001', color: 'سفید' },
      odometerKm: 41200,
      admittedAt: ago(3 * DAY),
      damageDescription: 'تصادف از جلو؛ سپر، چراغ راست و گلگیر جلو راست آسیب دیده است.',
      vehicleLocation: 'سالن بدنه — جایگاه ۳',
      coverageType: 'golden_card',
      goldenCardFileNo: 'GC-TEST-1001',
      responsibleUserId: supervisor.user.id,
      officialDeadlineAt: ahead(4 * DAY),
      forecastDeliveryAt: ahead(3 * DAY),
    });
    const body1 = await this.tasks.create(supervisor, c1.id, {
      departmentId: dept('body'),
      title: 'صافکاری گلگیر و سینی جلو',
      technicianName: 'تکنسین نمونه الف',
      technicianCode: 'T-01',
      plannedStartAt: ago(2 * DAY),
      plannedEndAt: ahead(1 * DAY),
      weight: 3,
    });
    await this.tasks.create(supervisor, c1.id, {
      departmentId: dept('paint'),
      title: 'نقاشی گلگیر و سپر',
      technicianName: 'تکنسین نمونه ب',
      technicianCode: 'T-02',
      dependsOn: [body1.id],
      weight: 2,
    });
    // Assessment approved in the golden-card system, then hidden damage found
    // during body work: the supplement is recorded without a generic approval wait.
    let a1 = await this.assessments.create(expert, c1.id, {
      kind: 'initial',
      assessorName: 'کارشناس امداد نمونه',
      assessorOrg: 'امداد خودرو (نمونه)',
      assessedAt: ago(3 * DAY - 2 * HOUR),
    });
    for (const item of [
      { action: 'replace' as const, description: 'سپر جلو', partNumber: 'TEST-PN-1001', quantity: 1, unitPriceRial: 42_000_000, labourDepartmentId: dept('assembly'), labourRial: 4_000_000 },
      { action: 'replace' as const, description: 'چراغ جلو راست', partNumber: 'TEST-PN-1002', quantity: 1, unitPriceRial: 31_000_000, labourDepartmentId: dept('electrical'), labourRial: 2_500_000 },
      { action: 'repair' as const, description: 'صافکاری و نقاشی گلگیر جلو راست', quantity: 1, unitPriceRial: 0, labourDepartmentId: dept('body'), labourRial: 18_000_000 },
    ]) {
      a1 = await this.assessments.addItem(expert, a1.id, { ...item, evidence: null, expectedVersion: a1.version });
    }
    a1 = await this.assessments.finalize(expert, a1.id, { expectedVersion: a1.version });
    await this.assessments.recordAuthorization(expert, a1.id, {
      expectedVersion: a1.version,
      decision: 'approved',
      source: 'golden_card',
      method: 'official_system',
      reference: 'GC-AUTH-TEST-1001',
      at: ago(2 * DAY + 4 * HOUR),
      rejectedItemIds: [],
    });
    // Parts of the approved lines: bumper ordered from the company, headlight from stock.
    const [bumper, light] = await this.parts.fromAssessment(expert, c1.id, { source: 'company' });
    await this.parts.act(partsClerk, bumper!.id, {
      action: 'order',
      expectedVersion: 1,
      at: ago(2 * DAY + 2 * HOUR),
      supplier: 'شرکت ایران‌خودرو (نمونه)',
      orderRef: 'ORD-TEST-1001',
      unitPriceRial: 42_000_000,
      etaAt: ahead(1 * DAY),
    });
    await this.parts.act(partsClerk, light!.id, { action: 'check_stock', expectedVersion: 1, inStock: true, at: ago(2 * DAY + 3 * HOUR) });
    await this.parts.act(partsClerk, light!.id, { action: 'reserve', expectedVersion: 2, at: ago(2 * DAY + 3 * HOUR) });
    await this.parts.act(partsClerk, light!.id, {
      action: 'hand_over',
      expectedVersion: 3,
      at: ago(2 * DAY),
      departmentId: dept('electrical'),
      recipientName: 'تکنسین نمونه د',
      salePriceRial: 12_000_000,
    });
    await this.tasks.act(supervisor, body1.id, { action: 'start', expectedVersion: 1, at: ago(2 * DAY) });
    let s1 = await this.assessments.create(expert, c1.id, {
      kind: 'supplement',
      assessorName: 'کارشناس امداد نمونه',
      assessorOrg: 'امداد خودرو (نمونه)',
      reason: 'پس از باز کردن سپر، ترک در سینی جلو و شکستگی براکت چراغ دیده شد.',
      discoveredAt: ago(5 * HOUR),
    });
    s1 = await this.assessments.addItem(expert, s1.id, {
      action: 'replace',
      description: 'سینی جلو',
      partNumber: 'TEST-PN-1003',
      quantity: 1,
      unitPriceRial: 27_000_000,
      labourDepartmentId: dept('body'),
      labourRial: 9_000_000,
      evidence: 'عکس نمونه ۳ و ۴',
      expectedVersion: s1.version,
    });
    await this.assessments.finalize(expert, s1.id, { expectedVersion: s1.version });

    // 2. Body insurance, waiting for a part: blocker recorded a day after it occurred.
    const c2 = await this.cases.create(expert, {
      customer: { fullName: 'مشتری نمونه دو', phone: '09000000002' },
      vehicle: { brand: 'ایران‌خودرو', model: 'پژو ۲۰۷', trim: 'دنده‌ای', modelYear: 1401, plate: '۲۲ ج ۲۲۲ - ۲۰', vin: 'TESTVIN0000000002' },
      odometerKm: 68000,
      admittedAt: ago(6 * DAY),
      damageDescription: 'ضربه از عقب؛ درب صندوق و سپر عقب.',
      coverageType: 'insurance',
      insurerName: 'بیمه نمونه',
      insuranceClaimNo: 'INS-TEST-2002',
      responsibleUserId: supervisor.user.id,
      forecastDeliveryAt: ahead(1 * DAY),
      stage: 'awaiting_parts',
    });
    const t2 = await this.tasks.create(supervisor, c2.id, {
      departmentId: dept('assembly'),
      title: 'تعویض درب صندوق',
      technicianName: 'تکنسین نمونه ج',
      technicianCode: 'T-03',
      weight: 1,
    });
    const trunkLid = await this.parts.create(partsClerk, c2.id, {
      description: 'درب صندوق عقب',
      partNumber: 'TEST-PN-2001',
      quantity: 1,
      source: 'insurer_supplier',
      approvedUnitPriceRial: 36_000_000,
      notes: null,
    });
    await this.parts.act(partsClerk, trunkLid.id, {
      action: 'order',
      expectedVersion: 1,
      at: ago(5 * DAY),
      supplier: 'تأمین‌کننده معرفی‌شده بیمه (نمونه)',
      orderRef: 'ORD-TEST-2001',
      unitPriceRial: 36_000_000,
      etaAt: ago(1 * DAY),
    });
    await this.blockers.create(supervisor, c2.id, {
      reason: 'part_not_arrived',
      description: 'درب صندوق سفارش داده شده، هنوز به انبار نرسیده است.',
      taskId: t2.id,
      partRequestId: trunkLid.id,
      occurredAt: ago(4 * DAY),
    });

    // 3. Personal payment, received today; contact details still unknown. The
    // customer approved the estimate; parts wait for the advance payment.
    const c3 = await this.cases.create(expert, {
      customer: { fullName: 'مشتری نمونه سه' },
      vehicle: { brand: 'ایران‌خودرو', model: 'تارا', plate: '۳۳ د ۳۳۳ - ۳۰' },
      admittedAt: ago(5 * HOUR),
      coverageType: 'personal',
      vehicleLocation: 'پارکینگ پذیرش',
    });
    let a3 = await this.assessments.create(expert, c3.id, {
      kind: 'initial',
      assessorName: 'کارشناس نمونه',
      assessorOrg: 'نمایندگی',
      assessedAt: ago(4 * HOUR),
    });
    a3 = await this.assessments.addItem(expert, a3.id, {
      action: 'replace',
      description: 'آینه بغل چپ',
      partNumber: 'TEST-PN-3001',
      quantity: 1,
      unitPriceRial: 14_000_000,
      labourDepartmentId: dept('assembly'),
      labourRial: 1_500_000,
      evidence: null,
      expectedVersion: a3.version,
    });
    a3 = await this.assessments.addItem(expert, a3.id, {
      action: 'repair',
      description: 'رنگ درب جلو چپ',
      quantity: 1,
      unitPriceRial: 0,
      labourDepartmentId: dept('paint'),
      labourRial: 6_000_000,
      evidence: null,
      expectedVersion: a3.version,
    });
    a3 = await this.assessments.finalize(expert, a3.id, { expectedVersion: a3.version });
    await this.assessments.recordAuthorization(expert, a3.id, {
      expectedVersion: a3.version,
      decision: 'approved',
      source: 'customer',
      method: 'in_person',
      at: ago(3 * HOUR),
      rejectedItemIds: [],
    });
    await this.parts.fromAssessment(expert, c3.id, { source: 'external' });
    await this.finance.propose(expert, c3.id, {
      kind: 'advance',
      amountRial: 15_000_000,
      reason: 'پیش‌پرداخت قطعه و نیمی از اجرت',
    });

    // 4. Vehicle already in the workshop before Manage: legacy entry, overdue.
    const c4 = await this.cases.create(expert, {
      customer: { fullName: 'مشتری نمونه چهار', phone: '09000000004' },
      vehicle: { brand: 'ایران‌خودرو', model: 'سورن پلاس', modelYear: 1400, plate: '۴۴ س ۴۴۴ - ۴۰', vin: 'TESTVIN0000000004' },
      odometerKm: 120500,
      admittedAt: ago(20 * DAY),
      damageDescription: 'تصادف از پهلو؛ درب‌های سمت چپ.',
      coverageType: 'golden_card',
      goldenCardFileNo: 'GC-TEST-1004',
      responsibleUserId: supervisor.user.id,
      officialDeadlineAt: ago(3 * DAY),
      stage: 'in_repair',
      isLegacyEntry: true,
    });
    const t4 = await this.tasks.create(supervisor, c4.id, {
      departmentId: dept('body'),
      title: 'صافکاری درب‌های چپ',
      technicianName: 'تکنسین نمونه الف',
      technicianCode: 'T-01',
      weight: 1,
    });
    await this.tasks.act(supervisor, t4.id, { action: 'start', expectedVersion: 1, at: ago(10 * DAY) });

    // 5. Ready for delivery: personal repair approved by the customer. QC round 1
    // failed (paint), the corrective activity was approved, round 2 passed and
    // the supervisor closed it technically. Settlement and handover are open.
    const c5 = await this.cases.create(expert, {
      customer: { fullName: 'مشتری نمونه پنج', phone: '09000000005' },
      vehicle: { brand: 'ایران‌خودرو', model: 'رانا پلاس', modelYear: 1401, plate: '۵۵ ص ۵۵۵ - ۵۰', vin: 'TESTVIN0000000005' },
      odometerKm: 30500,
      admittedAt: ago(9 * DAY),
      damageDescription: 'خط و خش درب جلو راست.',
      coverageType: 'personal',
      responsibleUserId: supervisor.user.id,
      forecastDeliveryAt: ahead(6 * HOUR),
    });
    let a5 = await this.assessments.create(expert, c5.id, {
      kind: 'initial',
      assessorName: 'کارشناس نمونه',
      assessorOrg: 'نمایندگی',
      assessedAt: ago(9 * DAY - HOUR),
    });
    a5 = await this.assessments.addItem(expert, a5.id, {
      action: 'repair',
      description: 'رنگ درب جلو راست',
      quantity: 1,
      unitPriceRial: 0,
      labourDepartmentId: dept('paint'),
      labourRial: 8_000_000,
      evidence: null,
      expectedVersion: a5.version,
    });
    a5 = await this.assessments.finalize(expert, a5.id, { expectedVersion: a5.version });
    await this.assessments.recordAuthorization(expert, a5.id, {
      expectedVersion: a5.version,
      decision: 'approved',
      source: 'customer',
      method: 'in_person',
      at: ago(8 * DAY),
      rejectedItemIds: [],
    });
    const t5 = await this.tasks.create(supervisor, c5.id, {
      departmentId: dept('paint'),
      title: 'رنگ درب جلو راست',
      technicianName: 'تکنسین نمونه ب',
      technicianCode: 'T-02',
      weight: 1,
    });
    await this.tasks.act(supervisor, t5.id, { action: 'start', expectedVersion: 1, at: ago(3 * DAY) });
    await this.tasks.act(supervisor, t5.id, { action: 'complete', expectedVersion: 2, at: ago(2 * DAY) });
    await this.tasks.act(supervisor, t5.id, { action: 'approve', expectedVersion: 3, at: ago(2 * DAY - HOUR) });
    const allOk = QC_CHECK_ITEMS.map((item) => ({ item, result: 'ok' as const }));
    let k5 = await this.cases.detail(supervisor, c5.id);
    const round1 = await this.completion.recordQc(qc, c5.id, {
      expectedVersion: k5.version,
      at: ago(2 * DAY - 2 * HOUR),
      checks: allOk.map((c) =>
        c.item === 'paint'
          ? { item: 'paint', result: 'fail', note: 'پوست‌پرتقالی روی لبه درب', departmentId: dept('paint') }
          : c,
      ),
    });
    const fixId = round1.qc[0]!.checks.find((c) => c.item === 'paint')!.correctiveTaskId!;
    await this.tasks.act(supervisor, fixId, { action: 'start', expectedVersion: 1, at: ago(DAY + 4 * HOUR) });
    await this.tasks.act(supervisor, fixId, { action: 'complete', expectedVersion: 2, at: ago(DAY) });
    await this.tasks.act(supervisor, fixId, { action: 'approve', expectedVersion: 3, at: ago(22 * HOUR) });
    k5 = await this.cases.detail(supervisor, c5.id);
    await this.completion.recordQc(qc, c5.id, { expectedVersion: k5.version, at: ago(20 * HOUR), checks: allOk });
    k5 = await this.cases.detail(supervisor, c5.id);
    await this.completion.technicalClose(supervisor, c5.id, { expectedVersion: k5.version });
  }
}
