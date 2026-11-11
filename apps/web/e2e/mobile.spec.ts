import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('phone width: login, dashboard and case list fit without horizontal scrolling', async ({ page }) => {
  await login(page, 'manager');
  for (const path of ['/', '/cases']) {
    await page.goto(path);
    await expect(page.locator('main')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(1);
  }
  await page.getByRole('button', { name: 'منو' }).click();
  await expect(page.getByRole('link', { name: 'پرونده‌ها', exact: true })).toBeVisible();
});
