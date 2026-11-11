import { expect, test } from '@playwright/test';
import { login, openCaseSections } from './helpers';

// Phase 3 through the real API and synthetic data: reminder cards, the technician's
// "I have a problem", wage and monthly work, responsibility bar and case transfer.
const headers = { 'x-manage-client': 'test' };
const noHorizontalScroll = () => document.documentElement.scrollWidth <= innerWidth;

test('reminder, technician problem, wage, monthly work and case transfer', async ({ page }, info) => {
  test.setTimeout(180_000);
  await login(page, 'expert');
  const me = await (await page.request.get('/api/v1/auth/me')).json();
  const staff = await (await page.request.get('/api/v1/workshop/staff')).json();
  const technician = staff.find((s: { displayName: string }) => s.displayName === 'تعمیرکار نمونه');
  expect(technician).toBeTruthy();
  const departments = await (await page.request.get('/api/v1/departments')).json();
  const body = departments.find((d: { code: string }) => d.code === 'body');
  const created = await page.request.post('/api/v1/cases', {
    headers,
    data: { customer: { fullName: 'مشتری ساختگی فاز سه', phone: '09000003131' }, vehicle: { model: 'دنا آزمون فاز سه', plate: '۲۲ ج ۲۲۲ - ۱۶', vin: 'TESTVIN000PHASE31' }, admittedAt: new Date().toISOString(), coverageType: 'golden_card', responsibleUserId: me.id },
  });
  expect(created.ok()).toBe(true);
  const kase = await created.json();
  const taskRes = await page.request.post(`/api/v1/cases/${kase.id}/tasks`, { headers, data: { departmentId: body.id, assignedUserId: technician.id, title: 'صافکاری گلگیر فاز سه' } });
  expect(taskRes.ok()).toBe(true);
  const task = await taskRes.json();

  // Coordinator: wage of the job on the case page, then a reminder to the technician.
  await page.goto(`/cases/${kase.id}`);
  await openCaseSections(page, 'tasks');
  const wages = page.getByTestId('case-wages');
  await wages.getByRole('button', { name: 'ثبت اجرت', exact: true }).click();
  const wageDialog = page.getByRole('dialog');
  await wageDialog.getByLabel('اجرت تعمیرکار (ریال)').fill('45000000');
  await wageDialog.getByRole('button', { name: 'ثبت اجرت', exact: true }).click();
  await expect(wages).toContainText('۴۵,۰۰۰,۰۰۰ ریال');
  await expect(page.getByTestId('responsibility-bar')).toContainText('کارشناس نمونه');
  await page.getByRole('button', { name: 'تذکر', exact: true }).click();
  const compose = page.getByRole('dialog', { name: 'فرستادن تذکر' });
  await compose.getByRole('checkbox', { name: /تعمیرکار نمونه/ }).check();
  await compose.getByRole('button', { name: 'لطفاً امروز پیگیری کن.', exact: true }).click();
  await compose.getByRole('button', { name: 'فوری', exact: true }).click();
  await compose.getByRole('button', { name: 'فرستادن تذکر', exact: true }).click();
  await expect(compose).toBeHidden();

  // Technician on a phone: the reminder card on top, the own wage on the job card, "I have a problem".
  await login(page, 'technician');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/workshop/technician');
  await expect(page.getByRole('heading', { level: 1, name: /^سلام/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'اجرت این ماه' })).toBeVisible();
  const card = page.getByTestId('reminder-card').filter({ hasText: 'لطفاً امروز پیگیری کن.' });
  await expect(card).toContainText('تذکر از کارشناس نمونه');
  await card.getByRole('button', { name: 'دیدم', exact: true }).click();
  await card.getByRole('button', { name: 'انجام شد', exact: true }).click();
  await expect(card).toHaveCount(0);
  const job = page.locator('.tc-card').filter({ hasText: 'صافکاری گلگیر فاز سه' });
  await expect(job).toContainText('اجرت شما');
  await expect(job).toContainText('۴۵,۰۰۰,۰۰۰');
  // «قطعه ندارم» is one tap, straight on the card (spec §9).
  await job.getByRole('button', { name: 'قطعه ندارم', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'قطعه ندارم' })).toBeVisible();
  await job.getByRole('button', { name: 'شروع کار', exact: true }).click();
  await expect(job).toContainText('در حال کار از ساعت');
  await job.getByRole('button', { name: 'پایان کار', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'منتظر تأیید کارشناس' }).first()).toBeVisible();
  expect(await page.evaluate(noHorizontalScroll)).toBe(true);
  await page.screenshot({ path: info.outputPath('technician-phase3-mobile.png'), fullPage: true });

  // Not in the monthly work before the coordinator approves the handover.
  await page.goto('/workshop/technician/work');
  await expect(page.getByRole('heading', { name: 'کارکرد من', exact: true })).toBeVisible();
  await expect(page.getByTestId('my-work-row').filter({ hasText: 'صافکاری گلگیر فاز سه' })).toHaveCount(0);

  // Coordinator: the problem arrives as an urgent card; approve the job and transfer the case.
  await login(page, 'expert');
  await page.setViewportSize({ width: 1366, height: 860 });
  await page.goto('/accidents/expert');
  await expect(page.getByTestId('reminder-card').filter({ hasText: 'قطعه ندارم' }).first()).toBeVisible();
  const detail = await (await page.request.get(`/api/v1/cases/${kase.id}`)).json();
  const done = detail.tasks.find((t: { id: string }) => t.id === task.id);
  expect((await page.request.post(`/api/v1/tasks/${task.id}/actions`, { headers, data: { action: 'approve', expectedVersion: done.version } })).ok()).toBe(true);
  await page.goto(`/cases/${kase.id}`);
  await page.getByRole('button', { name: 'انتقال پرونده', exact: true }).click();
  const transfer = page.getByRole('dialog', { name: 'انتقال پرونده' });
  await transfer.getByLabel('مسئول تازه').selectOption({ label: 'سرپرست نمونه' });
  await transfer.getByLabel(/دلیل/).fill('تقسیم کار آزمون');
  await transfer.getByRole('button', { name: 'انتقال', exact: true }).click();
  const bar = page.getByTestId('responsibility-bar');
  await expect(bar.locator('li')).toHaveCount(2);
  await expect(bar).toContainText('سرپرست نمونه');
  await expect(bar).toContainText('تقسیم کار آزمون');

  // Technician: approved job with its wage in this month's work, per coverage.
  await login(page, 'technician');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/workshop/technician/work');
  await expect(page.getByTestId('my-work-row').filter({ hasText: 'صافکاری گلگیر فاز سه' })).toContainText('۴۵,۰۰۰,۰۰۰ ریال');
  await expect(page.locator('.my-work-buckets')).toContainText('کارت طلایی');
  expect(await page.evaluate(noHorizontalScroll)).toBe(true);
  // Never the case, the assessment or anyone else's wage.
  expect((await page.request.get(`/api/v1/cases/${kase.id}/wages`)).status()).toBe(403);
  expect((await page.request.get('/api/v1/reports/wages')).status()).toBe(403);
});

test('service manager sends a reminder from a report row to the executive role and sees the wage report', async ({ page }) => {
  await login(page, 'manager');
  await page.goto('/reports?view=accident');
  await expect(page.getByTestId('work-row').first()).toBeVisible();
  const button = page.getByRole('button', { name: /^تذکر دربارهٔ/ }).first();
  await expect(button).toBeVisible();
  await button.click();
  const compose = page.getByRole('dialog', { name: 'فرستادن تذکر' });
  await expect(compose.getByRole('textbox', { name: 'متن تذکر' })).toHaveValue(/^پیگیری: /);
  await compose.getByRole('button', { name: 'فرستادن تذکر', exact: true }).click();
  await expect(compose).toBeHidden();
  const sent = (await (await page.request.get('/api/v1/reminders')).json()).sent;
  expect(sent[0].source).toBe('manager_report');
  expect(sent[0].recipients.some((r: { displayName: string }) => r.displayName === 'مدیر خدمات نمونه')).toBe(false);
  await page.goto('/reports/people');
  await expect(page.getByRole('heading', { name: 'اجرت تعمیرکاران و مسئولیت پرونده‌ها' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'خروجی Excel' })).toHaveAttribute('href', /\/api\/v1\/reports\/wages\/export\?month=\d{4}-\d{2}/);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(noHorizontalScroll)).toBe(true);
});
