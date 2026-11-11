import { expect, test } from '@playwright/test';
import { login, openCaseSections } from './helpers';

// Existing-vehicle Excel import in the browser with the synthetic sample:
// preview categories, apply, issued case numbers, provenance on the case.
test('system support previews and applies the vehicle sheet, then sees provenance on the case', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/cases');
  await page.getByRole('link', { name: 'ورود خودروهای موجود از اکسل' }).click();
  await expect(page.getByRole('heading', { name: 'ورود خودروهای موجود از اکسل' })).toBeVisible();

  const sample = await page.request.get('/api/v1/vehicle-imports/sample', { headers: { 'x-manage-client': 'web' } });
  expect(sample.ok()).toBe(true);
  await page.getByLabel('فایل اکسل (.xlsx)').setInputFiles({
    name: 'vehicle-import-sample.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: await sample.body(),
  });
  await page.getByLabel('ثبت تاریخ پذیرش بدون ساعت', { exact: false }).check();
  await page.getByRole('button', { name: 'پیش‌نمایش' }).click();

  const result = page.getByTestId('import-result');
  await expect(result).toContainText('برگه «لیست خودروها»، سربرگ در ردیف ۳');
  await expect(result).toContainText('۲ ردیف خالی قالب نادیده گرفته شد');
  const rows = page.getByTestId('import-row');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('جدید');
  await expect(rows.nth(1)).toContainText('جدید');
  await expect(rows.nth(2)).toContainText('ناقص');
  await expect(rows.nth(2)).toContainText('تاریخ پذیرش نامعلوم است');
  await expect(rows.nth(3)).toContainText('دارای خطا');

  page.once('dialog', (d) => void d.accept());
  await result.getByRole('button', { name: 'ثبت ۲ ردیف' }).click();
  await expect(result).toContainText('نتیجه ثبت');
  const caseLink = rows.nth(0).getByRole('link');
  await expect(caseLink).toHaveText(/AC-\d{4}-\d{4}/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await caseLink.click();
  await openCaseSections(page,'info','provenance');
  await expect(page.locator('#case-info').getByText('شماره کارت پذیرش', { exact: true })).toBeVisible();
  // The same source identifier can also occur in the import-history panel.
  const details = page.locator('#case-info');
  await expect(details).toHaveCount(1);
  await expect(details.getByText('TST00001', { exact: true })).toBeVisible();
  const prov = page.getByTestId('provenance-panel');
  await expect(prov).toContainText('vehicle-import-sample.xlsx');
  await prov.locator('summary').click();
  await expect(prov).toContainText('متن نمونه برگه اولیه');
  await openCaseSections(page,'tasks');
  await expect(page.getByTestId('task').filter({ hasText: 'صافکاری گلگیر جلو' })).toHaveCount(1);
});
