import { expect, test } from '@playwright/test';
import { login, openCaseSections } from './helpers';

test.describe.configure({ mode: 'serial' });

test('supervisor: create a golden-card case, run a repair activity through a blocker to approval, find it again', async ({
  page,
}) => {
  await login(page, 'supervisor');

  // Dashboard opens with the stage pipeline linked to filtered lists.
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'وضعیت تعمیرگاه' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'مراحل پرونده‌ها' })).toContainText('در حال تعمیر');

  await page.getByRole('link', { name: 'ثبت پرونده' }).first().click();
  await expect(page.getByRole('heading', { name: 'ثبت پرونده خودروی تصادفی' })).toBeVisible();

  await page.getByLabel('پلاک').fill('۶۸ ط ۴۲۱ - ۷۷');
  await page.getByLabel('VIN (شماره شاسی)').fill('TESTVIN00000E2E01');
  await page.getByLabel('کیلومتر').fill('۵۲۰۰۰');
  await page.getByLabel('مدل', { exact: true }).fill('دنا پلاس');
  await page.getByLabel('نام و نام خانوادگی').fill('مشتری آزمون خودکار');
  await page.getByLabel('تلفن همراه').fill('۰۹۰۰۰۰۰۹۹۹۹');
  await page.getByLabel('شرح خسارت').fill('ضربه به گلگیر جلو چپ');
  await page.getByRole('button', { name: 'کارت طلایی / امداد خودرو' }).click();
  await page.getByLabel('شماره پرونده کارت طلایی / امداد').fill('GC-E2E-1');
  await page.getByText('موعد رسمی یا پیش‌بینی ثبت‌شده از قبل',{exact:true}).click();
  await page.getByLabel('مهلت رسمی / تعهد اولیه', { exact: true }).fill('۱۵۰۰/۰۱/۱۰');
  await page.getByLabel('مهلت رسمی / تعهد اولیه — ساعت').fill('۱۲:۰۰');
  await page.getByLabel('مهلت رسمی / تعهد اولیه — ساعت').blur();
  await page.getByRole('button', { name: 'ثبت پرونده' }).click();

  // Case detail: number, plate, three independent times, no missing fields.
  await expect(page.locator('.case-number')).toHaveText(/AC-/);
  const caseNumber = (await page.locator('.case-number').textContent())!;
  await expect(page.getByRole('img', { name: /پلاک/ })).toBeVisible();
  await expect(page.getByLabel('زمان‌ها')).toContainText('۱۵۰۰/۰۱/۱۰ ۱۲:۰۰');
  await expect(page.getByText('نیازمند تکمیل:')).toHaveCount(0);

  // Add a body-shop activity and record start.
  await openCaseSections(page,'tasks','blockers','history');
  await page.getByRole('button', { name: 'افزودن فعالیت' }).click();
  await page.locator('select[name="departmentId"]').selectOption({ label: 'صافکاری' });
  await page.locator('input[name="technicianName"]').fill('تکنسین آزمون');
  await page.getByRole('button', { name: 'ذخیره فعالیت' }).click();
  const task = page.getByTestId('task').first();
  await expect(task).toContainText('شروع‌نشده');
  await task.getByRole('button', { name: 'شروع', exact: true }).click();
  await expect(task).toContainText('در حال انجام');
  await expect(page.locator('.case-hero')).toContainText('در حال تعمیر');

  // Block: part not arrived, then resolve with a note.
  await task.getByRole('button', { name: 'ثبت مانع' }).click();
  await page.getByRole('dialog').getByLabel('توضیح', { exact: true }).fill('قطعه شرکت هنوز نرسیده');
  await page.getByRole('dialog').getByRole('button', { name: 'ثبت مانع' }).click();
  await expect(task).toContainText('دارای مانع');
  await expect(task).toContainText('قطعه نرسیده');

  await page.getByRole('button', { name: 'رفع مانع' }).click();
  await page.getByRole('dialog').getByLabel('شرح رفع مانع *').fill('قطعه تحویل واحد شد');
  await page.getByRole('dialog').getByRole('button', { name: 'ثبت رفع مانع' }).click();
  await expect(task).toContainText('در حال انجام');

  await task.getByRole('button', { name: 'اتمام' }).click();
  await expect(task).toContainText('اتمام (منتظر تأیید)');
  await task.getByRole('button', { name: 'تأیید تحویل' }).click();
  await expect(task).toContainText('تأییدشده');
  await expect(page.getByLabel('زمان‌ها')).toContainText('۱۰۰٪');

  // History records each step with the actor.
  await expect(page.locator('.timeline')).toContainText('رفع مانع');
  await expect(page.locator('.timeline')).toContainText('سرپرست نمونه');

  // Search by plate in loose form finds the case.
  await page.getByRole('link', { name: 'پرونده‌ها', exact: true }).click();
  await page.getByLabel('جست‌وجوی پرونده').fill('68ط421');
  await page.waitForURL(/q=/);
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody')).toContainText(caseNumber);
});

test('legacy entry: a vehicle already in the workshop keeps its past admission and current stage', async ({ page }) => {
  await login(page, 'expert');
  await page.goto('/cases/new');
  await page.getByLabel('پلاک').fill('۲۱ م ۵۵۵ - ۱۱');
  await page.getByLabel('زمان پذیرش واقعی', { exact: true }).fill('۱۴۰۵/۰۷/۱۵');
  await page.getByLabel('زمان پذیرش واقعی — ساعت').fill('۰۹:۳۰');
  await page.getByLabel('زمان پذیرش واقعی — ساعت').blur();
  await page.getByLabel('خودرو از قبل در تعمیرگاه است').check();
  await page.getByLabel('مرحله فعلی').selectOption('awaiting_parts');
  await page.getByRole('button', { name: 'ثبت پرونده' }).click();

  await expect(page.locator('.case-hero')).toContainText('در انتظار قطعه');
  await expect(page.locator('.case-hero')).toContainText('ثبت‌شده از قبل از Manage');
  await expect(page.getByLabel('زمان‌ها')).toContainText('۱۴۰۵/۰۷/۱۵ ۰۹:۳۰');
  // Unknown data stays empty and is flagged, never invented.
  await expect(page.getByText('نیازمند تکمیل:')).toContainText('نام مالک');
});

test('parts clerk: read-only view with masked customer phone and no create action', async ({ page }) => {
  await login(page, 'parts');
  await page.goto('/cases');
  await expect(page.getByRole('heading', { name: 'پرونده‌های تصادفی' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'ثبت پرونده' })).toHaveCount(0);
  await page.getByLabel('جست‌وجوی پرونده').fill('09000000001');
  await page.waitForURL(/q=09000000001/);
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.locator('tbody tr').first().click();
  // Details panel (the finance panel has its own list).
  await openCaseSections(page,'info');
  const details = page.locator('#case-info');
  await expect(details.locator('dl')).toContainText('***');
  await expect(page.getByRole('button', { name: 'افزودن فعالیت' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'ویرایش پرونده' })).toHaveCount(0);
});

test('planned modules are visible as roadmap and expose no actions', async ({ page }) => {
  await login(page, 'manager');
  await page.getByText('سایر واحدها',{exact:true}).click();
  await page.getByRole('link', { name: /انبار، قطعات و تأمین‌کنندگان/ }).click();
  await expect(page.getByText('این بخش در دست توسعه است و هنوز قابل استفاده نیست.')).toBeVisible();
  await expect(page.locator('main').getByRole('button')).toHaveCount(0);
});
