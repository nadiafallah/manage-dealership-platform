import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('parts workbench opens by default and keeps legacy queues usable at 390px', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'parts');
  await page.goto('/accidents/parts');
  await expect(page.getByRole('heading', { name: 'میز قطعات', level: 1 })).toBeVisible();
  // The cross-car planning board of the Manage advisor sits under the parts desk.
  await page.getByText('برنامه‌ریزی گروهی قطعات همهٔ خودروها با دستیار منیج', { exact: true }).click();
  await expect(page.getByRole('heading', { name: /امروز .* کار با شماست/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'بارگذاری گزارش امداد ویژهٔ امروز' })).toHaveAttribute('href', '/daily-reports?kind=emdad');
  await expect(page.getByText('منتظر تصمیم شما', { exact: true })).toBeVisible();
  await expect(page.getByTestId('daily-status')).toBeHidden();
  await page.screenshot({ path: info.outputPath('parts-workbench-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath('parts-workbench-mobile.png'), fullPage: true });
  await page.getByText('همهٔ صف‌ها', { exact: true }).click();
  await expect(page.getByTestId('daily-status')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('Manage creates a group plan but requires an independent decision for each part', async ({ page }) => {
  await login(page, 'parts');
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const part = (n: number, description: string) => ({
    id: uuid(n), description, partNumber: `TEST-${n}`, quantity: 1, version: 1, action: 'emdad',
    suggestedPriceRial: null, companyPriceRial: null, stock: null, stockOptions: [], destinations: [],
    emdadId: null, emdadRef: null, emdadAverageDays: null, blocking: false, overdue: false,
    overdueHandover: false, advice: null, negativeRecommendations: [], preferredRoute: 'market',
    manageAdvice: {
      route: 'market', confidence: 'low', headline: 'پیشنهاد منیج: استعلام خرید بازار',
      why: ['برای این قطعه موجودی کافی ثبت نشده است.'], required: ['استعلام واقعی بازار'],
    },
  });
  const payload = {
    counts: {decision: 2, ready: 0, overdueEmdad: 0}, inTransit: 0,
    cards: [{id: uuid(100), plate: null, model: 'دنا', color: 'سفید', coverage: 'personal',
      caseNumber: 'MG-TEST', admissionNo: '12345', vin: null, chassisRef: null,
      emdadRefs: [], waiting: null, items: [part(1,'چراغ جلو'),part(2,'گلگیر جلو')]}],
  };
  const writes: string[] = [];
  await page.route('**/api/v1/parts/workbench?**', async route => {
    await route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(payload)});
  });
  page.on('request', request => {
    const endpoint = new URL(request.url()).pathname;
    if (request.method() === 'POST' && (endpoint.startsWith('/api/v1/parts/') || endpoint.startsWith('/api/v1/workshop/parts/'))) writes.push(request.url());
  });
  await page.goto('/accidents/parts');
  await page.getByText('برنامه‌ریزی گروهی قطعات همهٔ خودروها با دستیار منیج', { exact: true }).click();
  const planButton = page.getByRole('button', {name: 'برنامه‌ریزی همهٔ قطعات این خودرو با منیج'});
  await expect(planButton).toBeVisible();
  await planButton.click();
  const region = page.getByRole('region', {name: 'برنامه گروهی پیشنهادی منیج'});
  await expect(region).toBeVisible();
  await expect(region.getByText('چراغ جلو', {exact: false})).toBeVisible();
  await expect(region.getByText('گلگیر جلو', {exact: false})).toBeVisible();
  await region.getByRole('combobox', {name: 'روش تأمین گلگیر جلو'}).selectOption('emdad');
  await expect(region.getByRole('combobox', {name: 'روش تأمین چراغ جلو'})).toHaveValue('market');
  await expect(region.getByRole('combobox', {name: 'روش تأمین گلگیر جلو'})).toHaveValue('emdad');
  await expect.poll(() => writes.length).toBe(0);
  await region.getByRole('button', {name: 'تأیید و آماده‌کردن فرم این قطعه'}).first().click();
  await expect(region.getByText('پیشنهاد پذیرفته شد؛ ثبت نشده')).toHaveCount(1);
  await expect.poll(() => writes.length).toBe(0);
});
