import { test, expect, type APIRequestContext } from '@playwright/test';
import { formatJalaliDateInput, formatTimeInput, isWorkingDay, type WorkCalendar } from '@manage/shared';
import { login } from './helpers';
test.use({ actionTimeout: 15000 });

// Special-aid mission of 2026-11-28 in the browser: «کارهای امروز» in three parts (due calls, newly
// arrived parts to invite, yellow/red dossiers), one-click call and release, the complete dossier and
// the management report. Screenshots go to the «special-aid-screenshots» CI artifact. Synthetic data only.
const headers = { 'x-manage-client': 'e2e' };
const FIELDS = ['شماره کارت پذيرش', 'شماره شاسی', 'شماره امداد ویژه', 'کد اختصاصی اولیه', 'کد قطعه', 'وضعیت امداد ویژه', 'تاريخ رسيد شدن امداد ويژه در انبار', 'تعداد اختصاصي', 'شرح قطعه اختصاصي', 'تاریخ ثبت امداد ویژه'];
const SHOTS = 'test-results/special-aid-screenshots';
const VIN = { yellow: 'TESTVIN0000DKY012', red: 'TESTVIN0000DKR019', expired: 'TESTVIN0000DKX025', fresh: 'TESTVIN0000DKF000', call: 'TESTVIN0000DKC012' };

const DAY = 86_400_000;
const key = (d: Date) => new Date(d.getTime() + 210 * 60_000).toISOString().slice(0, 10); // Tehran day
// The dealership calendar of this run (other suites may have saved one): read from the API in the test.
let working = (k: string) => new Date(`${k}T12:00:00Z`).getUTCDay() !== 5;
const prev = (k: string) => new Date(Date.parse(`${k}T00:00:00Z`) - DAY).toISOString().slice(0, 10);
const jalali = (k: string) => formatJalaliDateInput(new Date(`${k}T12:00:00+03:30`));
/** Report date of an arrival that leaves exactly `n` working days after it, up to today. */
function arrivalOnDay(n: number) {
  let k = key(new Date());
  for (let count = 0; count < n; k = prev(k)) if (working(k)) count += 1;
  return jalali(k);
}
const daysAgo = (n: number) => jalali(key(new Date(Date.now() - n * DAY)));

async function publish(api: APIRequestContext, rows: string[][]) {
  const row = (cells: string[]) => `<Row>${cells.map((v) => `<Cell><Data ss:Type="String">${v}</Data></Cell>`).join('')}</Row>`;
  const xml = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="ساختگی"><Table>${row(FIELDS)}${rows.map(row).join('')}</Table></Worksheet></Workbook>`;
  const uploaded = await api.post('/api/v1/daily-reports/uploads?kind=emdad&fileName=synthetic.xml', { headers: { ...headers, 'content-type': 'application/octet-stream' }, data: Buffer.from(xml) });
  expect(uploaded.status()).toBe(201);
  let job = await uploaded.json();
  await expect.poll(async () => { job = await (await api.get(`/api/v1/daily-reports/imports/${job.id}`)).json(); return job.status; }).not.toMatch(/uploaded|parsing/);
  const at = new Date(Date.now() - 5 * 60000);
  const applied = await api.post(`/api/v1/daily-reports/imports/${job.id}/apply`, { headers, data: { declaration: true, declaredToday: true, acceptTemplate: true, reportDate: formatJalaliDateInput(at), reportTime: formatTimeInput(at) } });
  expect(applied.status(), await applied.text()).toBe(201);
}

test('special-aid desk: three parts of today, one-click call and release, dossier and management report', async ({ page }) => {
  test.setTimeout(180000);
  await login(page, 'admin');
  const cal = await page.request.get('/api/v1/workshop/calendar', { headers });
  expect(cal.status()).toBe(200);
  const calendar = (await cal.json()).current.calendar as WorkCalendar;
  working = (k: string) => isWorkingDay(k, calendar);
  const arrived = (adm: string, vin: string, no: string, code: string, day: number, name: string) => [adm, vin, no, code, code, 'وارد موجودی شده است', arrivalOnDay(day), '1', name, daysAgo(60)];
  await publish(page.request, [
    arrived('9981012', VIN.yellow, '0081012', '00818181', 12, 'چراغ جلو ساختگی'),
    arrived('9981019', VIN.red, '0081019', '00828282', 19, 'سپر عقب ساختگی'),
    arrived('9981025', VIN.expired, '0081025', '00838383', 25, 'آینه ساختگی'),
    arrived('9981000', VIN.fresh, '0081000', '00848484', 0, 'گلگیر ساختگی'),
    ['9981112', VIN.call, '0081112', '00858585', '00858585', 'در مرحله خرید', '', '1', 'درب ساختگی', daysAgo(12)],
  ]);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/special-aid');
  const calls = page.getByTestId('aid-today-calls'), invite = page.getByTestId('aid-today-invite'), deadline = page.getByTestId('aid-today-deadline');
  const rowOf = (part: typeof calls, vin: string) => part.getByTestId('aid-today-row').filter({ hasText: vin });
  // Each vehicle sits in the part its work belongs to; the plate column keeps the list size of other lists.
  await expect(rowOf(calls, VIN.call)).toContainText('تماس ده‌روزه');
  await expect(rowOf(invite, VIN.fresh)).toContainText('قطعه رسیده و مشتری هنوز خبر ندارد');
  await expect(rowOf(deadline, VIN.yellow).locator('[data-deadline="yellow"]')).toContainText('زرد');
  await expect(rowOf(deadline, VIN.red).locator('[data-deadline="red"]')).toContainText('قرمز');
  await expect(rowOf(deadline, VIN.expired).locator('[data-deadline="expired"]')).toBeVisible();
  await expect(rowOf(deadline, VIN.fresh)).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/08-desk-1440.png`, fullPage: true });

  // One click records the call; the ten-day call moves on and the row leaves «تماس‌های سررسیده».
  await rowOf(calls, VIN.call).getByRole('button', { name: 'پاسخ داد' }).click();
  await expect(rowOf(calls, VIN.call)).toHaveCount(0);
  // One click releases the part whose 20 working days have ended (recorded with name and time).
  await rowOf(deadline, VIN.expired).getByRole('button', { name: /آزاد کردن .* برای مشتری دیگر/ }).click();
  await expect(rowOf(deadline, VIN.expired)).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/special-aid');
  await expect(rowOf(page.getByTestId('aid-today-deadline'), VIN.red)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/09-desk-390.png`, fullPage: true });

  // The dossier: request and arrival dates, the deadline of each part, the call history.
  await page.setViewportSize({ width: 1440, height: 900 });
  await rowOf(page.getByTestId('aid-today-deadline'), VIN.yellow).getByRole('link', { name: 'باز کردن پرونده' }).click();
  await page.waitForURL(/\/special-aid\/vehicles\/[0-9a-f-]+$/);
  const item = page.getByTestId('aid-items').getByTestId('aid-item');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('درخواست (ثبت رسمی امداد)');
  await expect(item).toContainText('رسید انبار (رسمی)');
  await expect(item.locator('[data-deadline="yellow"]')).toContainText('روز کاری ۱۲ از ۲۰');
  await expect(page.getByRole('heading', { name: 'تماس‌ها' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/10-dossier-deadline.png`, fullPage: true });

  // The management report: funnels, yellow and red dossiers, expired deadlines and overdue calls.
  await page.goto('/special-aid/reports');
  const followUp = page.getByRole('region', { name: 'مهلت و تماس' });
  await expect(followUp.getByRole('link', { name: /پرونده‌های زرد/ })).toBeVisible();
  await expect(followUp.getByRole('link', { name: /پرونده‌های قرمز/ })).toBeVisible();
  await expect(followUp.getByRole('link', { name: /تماس‌های عقب‌افتاده/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'قیف امداد ویژه' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/11-report-1440.png`, fullPage: true });
  await followUp.getByRole('link', { name: /پرونده‌های قرمز/ }).click();
  await page.waitForURL(/\/special-aid\/vehicles\?view=red$/);
  await expect(page.getByTestId('aid-folders').locator('.folder').filter({ hasText: VIN.red.slice(-6) })).toBeVisible();
});
