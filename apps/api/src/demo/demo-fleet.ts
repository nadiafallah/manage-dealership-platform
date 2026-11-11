import type { Actor } from '../auth/auth.types';
import type { CasesService } from '../cases/cases.service';
import type { PartsService } from '../parts/parts.service';
import type { RemindersService } from '../people/reminders.service';
import type { BlockersService } from '../blockers/blockers.service';
import type { TasksService } from '../tasks/tasks.service';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

export interface FleetActors {
  expert: Actor;
  expert2: Actor;
  expert3: Actor;
  parts: Actor;
  techBody: Actor;
  techPaint: Actor;
  techFront: Actor;
}
export interface FleetServices {
  cases: CasesService;
  tasks: TasksService;
  parts: PartsService;
  blockers: BlockersService;
  reminders: RemindersService;
}
export interface FleetPlaces {
  dept: (code: string) => string;
  station: (code: string) => string;
}

/**
 * Package 8: fifteen more synthetic cars so every desk, the case folder and the
 * control room are seen full (spec: about twenty cars in different stages, some
 * Emdad requests and some alerts). Everything goes through the real services,
 * so audit, versions and the part state machine apply. Synthetic only:
 * phones 0900…, VINs TESTVIN…, is_test tenant.
 */
export async function seedFleet(a: FleetActors, s: FleetServices, p: FleetPlaces): Promise<number> {
  let n = 0;
  const car = async (i: number, model: string, plate: string, coverageType: 'golden_card' | 'insurance' | 'personal', daysIn: number, by: Actor = a.expert) => {
    n += 1;
    return s.cases.create(by, {
      customer: { fullName: `مشتری نمونه ${toFa(i)}`, phone: `0900100${String(i).padStart(4, '0')}` },
      vehicle: { brand: 'ایران‌خودرو', model, plate, vin: `TESTVIN1${String(i).padStart(9, '0')}`, color: i % 2 ? 'سفید' : 'نقره‌ای', modelYear: 1400 + (i % 5) },
      admittedAt: ago(daysIn * DAY),
      coverageType,
      responsibleUserId: by.user.id,
      damageDescription: 'خسارت نمونه برای نمایش (ساختگی).',
      ...(coverageType === 'golden_card' ? { goldenCardFileNo: `GC-TEST-${i}` } : coverageType === 'insurance' ? { insurerName: 'بیمهٔ نمونه', insuranceClaimNo: `INS-TEST-${i}` } : {}),
    } as never);
  };
  const stage = async (id: string, by: Actor, to: 'assessment' | 'awaiting_parts' | 'quality_control') => {
    const k = await s.cases.detail(by, id);
    await s.cases.changeStage(by, id, { stage: to, expectedVersion: k.version } as never);
  };
  const part = (caseId: string, description: string, code: string, extra: Record<string, unknown> = {}) =>
    s.parts.create(a.expert, caseId, { description, partNumber: code, quantity: 1, source: 'company', ...extra } as never);

  // Reception: just admitted, the assessment is the next step.
  await car(6, 'ریرا', '۲۳ ب ۴۵۶ - ۱۶', 'insurance', 0.1);
  await car(7, 'سورن پلاس', '۴۷ ج ۸۱۲ - ۱۶', 'golden_card', 0.3, a.expert2);
  await car(8, 'رانا پلاس', '۱۹ ه ۵۳۸ - ۱۶', 'insurance', 1);

  // Assessment: lines entered, not decided by the parts clerk yet.
  const c9 = await car(9, 'پژو پارس', '۵۲ م ۹۰۷ - ۱۶', 'personal', 2);
  await stage(c9.id, a.expert, 'assessment');
  await part(c9.id, 'سپر جلو', '1101012301');
  await part(c9.id, 'چراغ جلو راست', '1101045601');
  const c10 = await car(10, 'تارا', '۶۸ د ۱۹۳ - ۱۶', 'personal', 2, a.expert3);
  await stage(c10.id, a.expert3, 'assessment');
  // A body shell on a personal car: «قطعهٔ گران» asks the expert about the advance.
  await part(c10.id, 'اتاق کامل', '1201000001', { approvedUnitPriceRial: 650_000_000 });

  // Waiting for Emdad Vijeh: two are already late (more than three days).
  for (const [i, model, plate, daysOrdered] of [[11, 'دنا پلاس', '۳۳ ل ۲۲۴ - ۱۶', 5], [12, 'سمند', '۷۱ س ۶۰۲ - ۱۶', 4], [13, 'پژو ۲۰۷', '۸۴ ط ۱۱۹ - ۱۶', 1]] as const) {
    const c = await car(i, model, plate, 'golden_card', daysOrdered + 2, i === 12 ? a.expert2 : a.expert);
    await stage(c.id, a.expert, 'awaiting_parts');
    const line = await part(c.id, 'گلگیر جلو چپ', `13010${i}0001`);
    await s.parts.flow(a.parts, line.id, { action: 'emdad', expectedVersion: line.version, requestNo: `4027${i}135`, requestedAt: ago(daysOrdered * DAY) } as never);
  }

  // Market purchase that arrived: «قطعه آماده است» for the expert and the bay.
  const c14 = await car(14, 'هایما', '۱۵ ی ۸۸۰ - ۱۶', 'insurance', 3);
  await stage(c14.id, a.expert, 'awaiting_parts');
  const mirror = await part(c14.id, 'آینهٔ بغل راست', '1401007701');
  const ordered = await s.parts.flow(a.parts, mirror.id, { action: 'market', expectedVersion: mirror.version, supplier: 'فروشگاه نمونه', purchaseUnitRial: 42_000_000, saleUnitRial: 48_000_000 } as never);
  await s.parts.flow(a.parts, mirror.id, { action: 'receive', expectedVersion: ordered.version } as never);

  // In repair, on plan: body on bay B1, paint waits.
  const c15 = await car(15, 'ریرا', '۲۹ ق ۳۴۵ - ۱۶', 'insurance', 4);
  const plan15 = await s.tasks.addPlanSteps(a.expert, c15.id, { steps: [
    { departmentId: p.dept('body'), stationId: p.station('B1'), assignedUserId: a.techBody.user.id, days: 2, wageRial: 45_000_000, title: 'صافکاری گلگیر و در', concurrentWithPrevious: false },
    { departmentId: p.dept('paint'), stationId: p.station('P1'), assignedUserId: a.techPaint.user.id, days: 2, wageRial: 60_000_000, title: 'نقاشی', concurrentWithPrevious: false },
  ] });
  await s.tasks.act(a.techBody, plan15[0]!.id, { action: 'start', expectedVersion: 1 } as never, true);

  // Behind schedule on the front-end bay, and the technician has no part (unanswered).
  const c16 = await car(16, 'دنا', '۶۲ ص ۷۱۴ - ۱۶', 'golden_card', 6, a.expert2);
  const late = await s.tasks.create(a.expert2, c16.id, { departmentId: p.dept('suspension'), stationId: p.station('S1'), assignedUserId: a.techFront.user.id, title: 'جلوبندی', plannedStartAt: ago(4 * DAY), plannedEndAt: ago(DAY), weight: 1 } as never);
  await s.tasks.act(a.techFront, late.id, { action: 'start', expectedVersion: 1, at: ago(3 * DAY) } as never, true);
  await s.reminders.problem(a.techFront, late.id, 'no_part');

  // Finished on the bay, waiting for the expert's approval.
  const c17 = await car(17, 'پژو ۴۰۵', '۴۴ ن ۲۳۰ - ۱۶', 'personal', 3);
  const plan17 = await s.tasks.addPlanSteps(a.expert, c17.id, { steps: [
    { departmentId: p.dept('body'), stationId: p.station('B2'), assignedUserId: a.techBody.user.id, days: 1, wageRial: 25_000_000, title: 'صافکاری سپر عقب', concurrentWithPrevious: false },
    { departmentId: p.dept('paint'), stationId: p.station('P1'), assignedUserId: a.techPaint.user.id, days: 1, wageRial: 30_000_000, title: 'نقاشی سپر عقب', concurrentWithPrevious: false },
  ] });
  await s.tasks.act(a.techBody, plan17[0]!.id, { action: 'start', expectedVersion: 1, at: ago(DAY) } as never, true);
  await s.tasks.act(a.techBody, plan17[0]!.id, { action: 'complete', expectedVersion: 2, at: ago(2 * HOUR) } as never, true);

  // Stopped by a missing part (blocker), with a price announcement to answer.
  const c18 = await car(18, 'سورن', '۵۸ و ۴۴۱ - ۱۶', 'insurance', 7, a.expert3);
  const t18 = await s.tasks.create(a.expert3, c18.id, { departmentId: p.dept('mechanical'), stationId: p.station('M1'), assignedUserId: a.techFront.user.id, title: 'مکانیک — پایین آوردن موتور', weight: 1 } as never);
  await s.tasks.act(a.techFront, t18.id, { action: 'start', expectedVersion: 1, at: ago(2 * DAY) } as never, true);
  await s.blockers.create(a.expert3, c18.id, { reason: 'part_not_arrived', description: 'رادیاتور نرسیده (نمونه)', taskId: t18.id } as never);
  const radiator = await part(c18.id, 'رادیاتور', '1501003301');
  const bought = await s.parts.flow(a.parts, radiator.id, { action: 'market', expectedVersion: radiator.version, supplier: 'فروشگاه نمونهٔ دوم', purchaseUnitRial: 90_000_000, saleUnitRial: 98_000_000 } as never);
  await s.parts.flow(a.parts, radiator.id, { action: 'announce_price', expectedVersion: bought.version, saleUnitRial: 105_000_000, note: 'قیمت بازار بالا رفته (نمونه)' } as never);

  // Final control: every step approved.
  const c19 = await car(19, 'تارا اتوماتیک', '۹۱ ر ۵۵۰ - ۱۶', 'golden_card', 8);
  const t19 = await s.tasks.create(a.expert, c19.id, { departmentId: p.dept('paint'), stationId: p.station('P1'), assignedUserId: a.techPaint.user.id, title: 'نقاشی کامل', plannedStartAt: ago(5 * DAY), plannedEndAt: ago(2 * DAY), weight: 1 } as never);
  await s.tasks.act(a.techPaint, t19.id, { action: 'start', expectedVersion: 1, at: ago(5 * DAY) } as never, true);
  await s.tasks.act(a.techPaint, t19.id, { action: 'complete', expectedVersion: 2, at: ago(2 * DAY + 2 * HOUR) } as never, true);
  await s.tasks.act(a.expert, t19.id, { action: 'approve', expectedVersion: 3, at: ago(2 * DAY) } as never);
  await stage(c19.id, a.expert, 'quality_control');

  // Two more on plan in repair so the map has several bays in use.
  const c20 = await car(20, 'رانا', '۱۲ ک ۶۷۸ - ۱۶', 'personal', 2, a.expert3);
  const plan20 = await s.tasks.addPlanSteps(a.expert3, c20.id, { steps: [{ departmentId: p.dept('paint'), stationId: p.station('P1'), assignedUserId: a.techPaint.user.id, days: 1.5, wageRial: 35_000_000, title: 'نقاشی درب عقب', concurrentWithPrevious: false }] });
  await s.tasks.act(a.techPaint, plan20[0]!.id, { action: 'start', expectedVersion: 1 } as never, true);
  return n;
}

const toFa = (n: number) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]!);
