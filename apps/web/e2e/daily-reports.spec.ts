import { expect, test, type Page } from '@playwright/test';
import { formatJalaliDateInput } from '@manage/shared';
import { buildEmdadXml, buildStockXlsx, emdadRow, type StockRow } from '../../api/src/daily-reports/fixtures';
import { login } from './helpers';

// Daily parts reports through the real browser, web proxy and API. Synthetic data only.

const BASE = '12345678';
const sku = (suffix: string, over: StockRow = {}): StockRow => ({ 'کد کالا': `_x001F_ ${BASE}${suffix}`, 'شرح کالا': 'لنت ساختگی', 'واحد شمارش': 'عدد', 'موجودي': suffix === '99' ? '0.5' : '3', 'قيمت ميانگين': `10${suffix}.125`, 'قيمت فروش': `20${suffix}`, 'آدرس': `A-${suffix}`, ...over });
const family = ['01', '02', '03', '04', '05', '06', '07', '99'];
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const headers = { 'x-manage-client': 'test' };

async function uploadAndConfirm(page: Page, label: string, file: { name: string; mimeType: string; buffer: Buffer }, expected: RegExp) {
  const typeButton = page.getByRole('button', { name: label, exact: true });
  await typeButton.click();
  await expect(typeButton).toHaveAttribute('aria-pressed', 'true');
  const uploadResponse = page.waitForResponse(r => r.request().method() === 'POST' && r.url().includes('/api/v1/daily-reports/uploads?'));
  await page.getByLabel('انتخاب فایل').setInputFiles(file);
  const uploaded = await uploadResponse;
  expect(new URL(uploaded.url()).searchParams.get('kind')).toBe(label === 'موجودی روزانه انبار' ? 'stock' : 'emdad');
  expect(uploaded.ok()).toBe(true);
  const job = page.getByTestId('daily-job');
  await expect(job.getByTestId('daily-counts')).toContainText(expected);
  await job.getByLabel('تاریخ گزارش را خودم بررسی کردم').check();
  await job.getByRole('button', { name: 'ثبت گزارش', exact: true }).click();
  await expect(page.getByTestId('daily-job')).toHaveCount(0);
}
async function noSidewaysScroll(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${path} at phone width`).toBe(true);
}

test('daily stock and Emdad files, exact option choice, reservation steps and history', async ({ page }, info) => {
  await login(page, 'manager');
  await page.goto('/daily-reports');
  await expect(page.getByTestId('daily-kind-stock')).toContainText('برای امروز به‌روزرسانی نشده');

  // Stock: control prefix, leading zeros, letter code and decimal quantity; today's task turns done.
  await uploadAndConfirm(page, 'موجودی روزانه انبار', { name: 'موجودی انبار.xlsx', mimeType: XLSX, buffer: Buffer.from(buildStockXlsx([...family.map((s) => sku(s)), sku('', { 'کد کالا': '_x001F_ 9999999999A', 'شرح کالا': 'کد حرفی ساختگی' })])) }, /نیازمند تطبیق کد/);
  await expect(page.getByTestId('daily-kind-stock')).toContainText('امروز ثبت شد');
  await expect(page.getByTestId('daily-kind-emdad')).toContainText('برای امروز به‌روزرسانی نشده');

  // Reserving stays off until the owner confirms what the report covers.
  await page.getByLabel('دامنه انبار').fill('انبار آزمون');
  await page.getByLabel('کامل‌بودن گزارش').selectOption('partial');
  await page.getByLabel('معنای ستون موجودی').selectOption('on_hand');
  await page.getByLabel('واحد پول قیمت‌ها').selectOption('IRR');
  await page.getByRole('button', { name: 'ذخیره تنظیمات' }).click();
  await expect(page.getByText('تنظیمات ذخیره شد')).toBeVisible();

  // Emdad: .xls extension, whitespace before the declaration and raw ampersands, read as they are.
  const emdad = buildEmdadXml([emdadRow(1, { 'شرح اختصاصی': 'قطعه A & B', 'شماره کارت پذيرش': '910001', 'كد تداركاتي كالا': `${BASE}01`, 'کد قطعه': BASE, 'کد اختصاصی اولیه': BASE }), emdadRow(2, { 'كد تداركاتي كالا': '' })]);
  await uploadAndConfirm(page, 'پیگیری روزانه امداد ویژه', { name: 'RepEmdadVijeh.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from(emdad) }, /ردیف جمع/);
  await expect(page.getByTestId('daily-kind-emdad')).toContainText('امروز ثبت شد');
  await page.getByRole('button', { name: /RepEmdadVijeh/ }).first().click();
  await expect(page.getByTestId('daily-rows')).toContainText('ردیف جمع');
  await page.screenshot({ path: info.outputPath('daily-reports-desktop.png'), fullPage: true });

  // A later file changes the status of the same request; no new request appears.
  const later = buildEmdadXml([emdadRow(1, { 'شرح اختصاصی': 'قطعه A & B', 'شماره کارت پذيرش': '910001', 'كد تداركاتي كالا': `${BASE}01`, 'کد قطعه': BASE, 'کد اختصاصی اولیه': BASE, 'وضعیت امداد ویژه': 'آماده جمع آوری' }), emdadRow(2, { 'كد تداركاتي كالا': '' })]);
  await uploadAndConfirm(page, 'پیگیری روزانه امداد ویژه', { name: 'RepEmdadVijeh2.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from(later) }, /تغییرکرده/);

  // A need on a real case: all eight options, independent prices, nothing chosen automatically.
  const c = await page.request.post('/api/v1/cases', { headers, data: { customer: { fullName: 'مشتری ساختگی', phone: '09000007777' }, vehicle: { brand: 'ایران‌خودرو', model: 'دنا', vin: 'TESTVIN0000000777' }, admissionNo: '910001', admittedAt: new Date(Date.now() - 86_400_000).toISOString(), damageDescription: 'آزمون مرورگر' } });
  expect(c.status()).toBe(201);
  const kase = await c.json();
  expect((await page.request.post(`/api/v1/cases/${kase.id}/parts`, { headers, data: { description: 'لنت جلو', partNumber: BASE, quantity: 1, source: 'stock' } })).status()).toBe(201);
  expect((await page.request.post(`/api/v1/cases/${kase.id}/parts`, { headers, data: { description: 'لنت عقب', partNumber: `${BASE}01`, quantity: 1, source: 'stock' } })).status()).toBe(201);

  // Unified parts list (spec section 7): the parts clerk reserves by the first 8 digits.
  await page.goto('about:blank');
  await page.context().clearCookies();
  await login(page, 'parts');
  await page.goto(`/cases/${kase.id}#case-parts`);
  const ledger = page.getByTestId('parts-ledger');
  const front = ledger.getByTestId('part').filter({ hasText: 'لنت جلو' });
  await expect(front).toContainText('تعیین تکلیف نشده');
  await front.getByRole('button', { name: 'انتخاب مسیر تأمین' }).click();
  await front.getByRole('button', { name: 'رزرو از موجودی', exact: true }).click();
  // All suffixes of the base code with usable quantity; nothing chosen automatically when several fit.
  await expect(front.getByRole('radio')).toHaveCount(8);
  await expect(front.getByRole('radio', { checked: true })).toHaveCount(0);
  // ${BASE}99 has only 0.5 usable: it is shown but cannot be chosen for a need of 1.
  await expect(front.getByRole('radio').last()).toBeDisabled();
  await front.getByRole('radio').nth(1).check();
  await page.screenshot({ path: info.outputPath('reserve-option-desktop.png') });
  await front.getByRole('button', { name: 'رزرو از موجودی', exact: true }).last().click();
  await expect(front).toContainText('رزرو از موجودی');
  await expect(front.getByRole('button', { name: 'تحویل به واحد تعمیر' })).toBeVisible();
  // The cancel button turns into «لغو رزرو».
  await front.locator('.m-row-head').click();
  await expect(front.getByRole('button', { name: 'لغو رزرو' })).toBeVisible();
  const rear = ledger.getByTestId('part').filter({ hasText: 'لنت عقب' });
  await rear.getByRole('button', { name: 'انتخاب مسیر تأمین' }).click();
  await rear.getByRole('button', { name: 'رزرو از موجودی', exact: true }).click();
  await rear.getByRole('radio').first().check();
  await rear.getByRole('button', { name: 'رزرو از موجودی', exact: true }).last().click();
  await expect(rear).toContainText('رزرو از موجودی');

  // Issue, then the option shows it as still deducted; release needs a reason.
  await page.goto('/stock');
  await page.getByLabel('کد پایه، کد کامل یا نام قطعه').fill(`${BASE}02`);
  await page.getByRole('button', { name: 'جست‌وجو', exact: true }).click();
  const option = page.getByTestId('stock-option');
  await expect(option).toHaveCount(1);
  await expect(option.locator('td').nth(9)).toHaveText('۲');
  const row = page.getByTestId('reservation').filter({ hasText: '۱۲۳۴۵۶۷۸۰۲' });
  await row.getByRole('button', { name: 'ثبت خروج از انبار' }).click();
  await page.getByRole('button', { name: 'تأیید', exact: true }).click();
  await expect(row).toContainText('تا پایان کار پرونده از موجودی کم می‌شود');
  // Check persisted arithmetic independently of the UI cache: handed over to an open case still counts.
  const issuedOptions = await page.request.get(`/api/v1/stock/options?q=${BASE}02`);
  expect(issuedOptions.ok()).toBe(true);
  expect((await issuedOptions.json()).items[0]).toMatchObject({ reserved: '0', issuedUnreflected: '1', available: '2' });
  await expect(option.locator('td').nth(8)).toHaveText('۱');
  const other = page.getByTestId('reservation').filter({ hasText: '۱۲۳۴۵۶۷۸۰۱' });
  await other.getByRole('button', { name: 'آزادکردن رزرو' }).click();
  await expect(page.getByRole('button', { name: 'تأیید', exact: true })).toBeDisabled();
  await page.getByLabel(/دلیل/).fill('تأمین از کد دیگر');
  await page.getByRole('button', { name: 'تأیید', exact: true }).click();
  await expect(other).toContainText('آزاد شد');

  // Letter codes stay separate and labelled.
  await page.getByLabel('کد پایه، کد کامل یا نام قطعه').fill('9999999999A');
  await page.getByRole('button', { name: 'جست‌وجو', exact: true }).click();
  await expect(page.getByTestId('stock-option')).toContainText('نیازمند تطبیق کد');
  await page.getByRole('button', { name: 'تنظیم اتصال خانواده' }).click();
  const aliasDialog = page.getByRole('dialog');
  await aliasDialog.getByLabel('کد پایه تأییدشده (هشت رقم)').fill(BASE);
  await aliasDialog.getByLabel('دلیل تأیید یا قطع اتصال').fill('تأیید خانواده ساختگی برای آزمون');
  await aliasDialog.getByRole('button', { name: 'ثبت اتصال خانواده' }).click();
  await expect(page.getByTestId('stock-option')).toContainText('اتصال خانواده با تأیید انسانی');
  await page.getByLabel('کد پایه، کد کامل یا نام قطعه').fill(BASE);
  await page.getByRole('button', { name: 'جست‌وجو', exact: true }).click();
  await expect(page.getByTestId('stock-option')).toHaveCount(9);

  // Emdad: official text, code issue label, history of the status change, kept follow-up.
  await page.goto('/emdad');
  await expect(page.getByTestId('emdad-row')).toHaveCount(2);
  await expect(page.getByTestId('emdad-list')).toContainText('مغایرت کد');
  await page.getByLabel('پذیرش، شاسی، پرونده، شماره امداد یا کد').fill('910001');
  await page.getByRole('button', { name: 'جست‌وجو', exact: true }).click();
  await expect(page.getByTestId('emdad-row')).toHaveCount(1);
  await page.getByTestId('emdad-row').getByRole('button').first().click();
  const detail = page.getByTestId('emdad-detail');
  await expect(detail.getByTestId('emdad-history')).toContainText('آماده جمع آوری');
  await detail.getByLabel('اقدام بعدی').fill('هماهنگی با دفتر منطقه');
  await detail.getByRole('button', { name: 'ذخیره پیگیری' }).click();
  await expect(page.getByText('پیگیری ذخیره شد')).toBeVisible();
  await page.screenshot({ path: info.outputPath('emdad-detail-desktop.png') });
  await detail.getByLabel('جست‌وجوی پرونده').fill('910001');
  await detail.getByRole('button', { name: 'جست‌وجو', exact: true }).click();
  await detail.getByRole('combobox', { name: 'پرونده', exact: true }).selectOption(kase.id);
  await expect(detail.getByRole('combobox', { name: 'پرونده', exact: true })).toHaveValue(kase.id);
  await detail.getByLabel(/دلیل/).fill('بررسی برگه پذیرش');
  await detail.getByRole('button', { name: 'ثبت تصمیم اتصال' }).click();
  await expect(page.getByText('تصمیم اتصال ثبت شد')).toBeVisible();
  await page.getByRole('button', { name: 'بستن', exact: true }).click();

  // The case shows both identifiers; the parts list stays the single place for supply.
  await page.goto(`/cases/${kase.id}#case-parts`);
  await expect(page.locator('main')).toContainText('۹۱۰۰۰۱');
  await expect(page.getByTestId('parts-ledger').getByTestId('part')).toHaveCount(2);

  // Parts desk header.
  await page.goto('/accidents/parts');
  await page.getByText('همهٔ صف‌ها', { exact: true }).click();
  await expect(page.getByTestId('daily-status')).toContainText('خروج‌های منتظر انعکاس');

  // Phone width on every new screen.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/daily-reports', '/stock', '/emdad']) await noSidewaysScroll(page, path);
  await page.screenshot({ path: info.outputPath('emdad-mobile.png'), fullPage: true });
});

test('permissions, a full-size file through the web proxy and internal reminders', async ({ page }) => {
  // System support can upload and inspect stock and Emdad.
  await login(page, 'admin');
  await page.goto('/daily-reports');
  await expect(page.getByLabel('انتخاب فایل')).toBeVisible();
  await page.goto('/stock');
  await expect(page.getByRole('heading', { name: 'موجودی روزانه و رزرو' })).toBeVisible();
  expect((await page.request.post('/api/v1/emdad/requests/search', { headers, data: {} })).status()).toBe(201);

  // A technician sees neither, and direct API calls are refused.
  await page.context().clearCookies();
  await login(page, 'technician');
  await page.goto('/daily-reports');
  await expect(page.getByText('برای این بخش مجوز ندارید')).toBeVisible();
  expect((await page.request.get('/api/v1/stock/options?q=12345678')).status()).toBe(403);
  expect((await page.request.post('/api/v1/daily-reports/uploads?kind=stock', { headers: { ...headers, 'content-type': 'application/octet-stream' }, data: Buffer.from(buildStockXlsx([sku('01')])) })).status()).toBe(403);

  // ~23.6 MB of synthetic SpreadsheetML through the proxy: raw upload, background parsing, paged rows.
  await login(page, 'admin');
  const big = Buffer.from(buildEmdadXml(Array.from({ length: 5183 }, (_, i) => emdadRow(i + 100, { 'شرح اختصاصی': `قطعه ${i} & ${'x'.repeat(4200)}` }))));
  expect(big.length).toBeGreaterThan(23_000_000);
  const u = await page.request.post('/api/v1/daily-reports/uploads?kind=emdad&fileName=large.xls', { headers: { ...headers, 'content-type': 'application/octet-stream' }, data: big, timeout: 120_000 });
  expect(u.status()).toBe(201);
  const { id } = await u.json();
  await expect.poll(async () => (await (await page.request.get(`/api/v1/daily-reports/imports/${id}`)).json()).status, { timeout: 180_000, intervals: [1000] }).toBe('preview');
  const rows = await (await page.request.get(`/api/v1/daily-reports/imports/${id}/rows?pageSize=5`)).json();
  expect(rows.total).toBe(5184);
  expect(rows.items).toHaveLength(5);
  expect((await page.request.post(`/api/v1/daily-reports/imports/${id}/discard`, { headers })).status()).toBe(201);

  // An oversize file is refused by the API through the same path.
  const tooBig = await page.request.post('/api/v1/daily-reports/uploads?kind=emdad&fileName=big.xls', { headers: { ...headers, 'content-type': 'application/octet-stream' }, data: Buffer.alloc(32 * 1024 * 1024 + 10), timeout: 120_000 });
  expect(tooBig.status()).toBe(413);

  // A reminder shows on every page, links to the upload and never blocks the page.
  const today = formatJalaliDateInput(new Date());
  let items = [{ id: '00000000-0000-4000-8000-000000000011', kind: 'daily_report_due', title: 'یادآوری: موجودی روزانه انبار', body: `گزارش ${today} هنوز ثبت نشده است.`, link: '/daily-reports?kind=stock', createdAt: new Date().toISOString(), readAt: null as string | null }];
  await page.route('**/api/v1/notifications', (r) => r.fulfill({ json: { unread: items.filter((n) => !n.readAt).length, items } }));
  await page.route('**/api/v1/notifications/read', (r) => {
    items = items.map((n) => ({ ...n, readAt: new Date().toISOString() }));
    return r.fulfill({ json: { unread: 0, items } });
  });
  await page.goto('/cases');
  const bar = page.getByTestId('notifications');
  await expect(bar).toContainText('یادآوری: موجودی روزانه انبار');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await bar.getByRole('button', { name: 'خواندم' }).click();
  await expect(bar).toHaveCount(0);
});
