import { Controller, Get, Inject, Query, StreamableFile } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { formatJalali, REPORT_VIEW_LABELS, reportQuerySchema, WORK_PRIORITY_LABELS, type ReportQuery, type ReportView, type Role } from '@manage/shared';
import type { Actor } from '../auth/auth.types';
import { CurrentActor, RequirePermissions } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { DATABASE, type DatabaseHandle } from '../db/database';
import { tenants } from '../db/schema';
import { writeWorkbook } from '../parts/xlsx';
import { renderReportPdf } from './pdf';
import { allowedViews, MAX_EXPORT_ROWS, ReportsService } from './reports.service';

/** Default view by role: what the person works on first. */
function defaultView(roles: Role[], views: ReportView[]): ReportView | null {
  const order: [Role, ReportView][] = [
    ['service_manager', 'manager'],
    ['parts_clerk', 'parts'],
    ['accident_expert', 'accident'],
  ];
  return order.find(([r, v]) => roles.includes(r) && views.includes(v))?.[1] ?? views[0] ?? null;
}

@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    @Inject(DATABASE) private readonly handle: DatabaseHandle,
  ) {}

  @Get('views')
  @RequirePermissions('case.read')
  views(@CurrentActor() actor: Actor) {
    const views = allowedViews(actor.user.permissions);
    // Every accident expert sees all accident vehicles; their own cases are marked, not filtered (spec section 3).
    return { views, defaultView: defaultView(actor.user.roles, views), defaultResponsible: null };
  }

  @Get()
  @RequirePermissions('case.read')
  report(@CurrentActor() actor: Actor, @Query(new ZodPipe(reportQuerySchema)) q: ReportQuery) {
    return this.reports.report(actor, q);
  }

  /** Persian A4 PDF (embedded font, dealership header, black and white); up to MAX_PDF_ROWS rows. */
  @Get('pdf')
  @RequirePermissions('case.read')
  async pdf(@CurrentActor() actor: Actor, @Query(new ZodPipe(reportQuerySchema)) q: ReportQuery) {
    const r = await this.reports.report(actor, q, { allItems: true });
    const [tenant] = await this.handle.db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, actor.user.tenantId));
    const data = await renderReportPdf(r, tenant?.name ?? 'Manage by HEDAX');
    return new StreamableFile(data, { type: 'application/pdf', disposition: `attachment; filename="manage-report-${r.view}.pdf"` });
  }

  /** Every filtered row (up to MAX_EXPORT_ROWS) with title, time, period and filters. */
  @Get('export')
  @RequirePermissions('case.read')
  async export(@CurrentActor() actor: Actor, @Query(new ZodPipe(reportQuerySchema)) q: ReportQuery) {
    const r = await this.reports.report(actor, q, { allItems: true });
    const [tenant] = await this.handle.db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, actor.user.tenantId));
    const head = [
      [tenant?.name ?? 'Manage by HEDAX'],
      [`گزارش ${REPORT_VIEW_LABELS[r.view]}${r.isTestData ? ' — داده آزمایشی' : ''}`],
      [`زمان تهیه: ${formatJalali(r.generatedAt, { time: true })}`],
      [`بازه رویدادها: ${r.period.label} (${formatJalali(r.period.from)} تا ${formatJalali(r.period.to)})`],
      [`فیلترها: ${r.filters.map((f) => `${f.label}: ${f.value}`).join('، ')}`],
      [],
    ];
    const summary = [
      ...head,
      ['شاخص', 'مقدار', 'واحد', 'عدد قطعه', 'تعریف'],
      ...r.kpis.map((k) => [k.label, k.value, k.unit, k.quantity ?? null, k.definition]),
      [],
      ...(r.events.length ? [['رویداد در بازه', 'بازه فعلی', 'بازه قبل هم‌طول', 'واحد'], ...r.events.map((e) => [e.label, e.current, e.previous, e.unit])] : []),
    ];
    const truncated = r.items.total > MAX_EXPORT_ROWS;
    const items = [
      ...head,
      ...(truncated ? [[`توجه: ${r.items.total} ردیف وجود دارد؛ فقط ${MAX_EXPORT_ROWS} ردیف اول در این فایل است. فیلتر را محدودتر کنید.`], []] : []),
      ['اولویت', 'دلیل اولویت', 'نوع', 'شماره پرونده منیج', 'شماره پذیرش ایران‌خودرو', 'پلاک', 'خودرو', 'شرح', 'شماره فنی', 'تعداد', 'وضعیت', 'موعد', 'نوع موعد', 'مسئول', 'علت توقف', 'اقدام بعدی', 'کد جایگاه‌ها'],
      ...r.items.rows.map((i) => [
        WORK_PRIORITY_LABELS[i.priority],
        i.priorityReason,
        i.kindLabel,
        i.caseNumber,
        i.admissionNo||'',
        i.plate,
        i.vehicleLabel,
        i.description,
        i.partNumber ?? null,
        i.quantity ?? null,
        i.status,
        i.dueAt ? formatJalali(i.dueAt, { time: true }) : null,
        i.dueLabel,
        i.responsible?.displayName ?? null,
        i.stoppedBy,
        i.nextAction,
        i.stationCodes?.join('، ')||'نامعلوم',
      ]),
    ];
    const data = writeWorkbook([
      { name: 'خلاصه', rows: summary },
      { name: 'کارهای امروز', rows: items },
    ]);
    return new StreamableFile(Buffer.from(data), {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="manage-report-${r.view}.xlsx"`,
    });
  }
}
