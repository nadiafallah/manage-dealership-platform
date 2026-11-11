import { expect, test, type Page } from '@playwright/test';
import { login, openCaseSections } from './helpers';

// Issue #12 in the browser, on demo case 5 (personal): QC failed once, the
// corrective activity was approved, round 2 passed and the case is technically
// closed. Since the six-role change (spec section 3) the accident experts also
// settle, close financially and hand over; the cashier role is retired.
async function openCase5(page: Page, user: string) {
  await page.goto('about:blank');
  await page.context().clearCookies();
  await login(page, user);
  await page.goto('/cases?q=' + encodeURIComponent('مشتری نمونه پنج'));
  await page.locator('tbody tr').filter({ hasText: 'مشتری نمونه پنج' }).click();
  await openCaseSections(page,'quality','tasks','finance','history');
  await expect(page.getByTestId('completion-panel')).toBeVisible();
}

test('QC history, settlement, financial close and handover archive the case', async ({ page }) => {
  const dialog = page.getByRole('dialog');
  const panel = page.getByTestId('completion-panel');

  // An accident expert: both QC rounds visible, the corrective activity is marked.
  await openCase5(page, 'qc');
  await expect(page.getByTestId('qc-round')).toHaveCount(2);
  await expect(panel).toContainText('دور ۲: قبول');
  await expect(panel).toContainText('پوست‌پرتقالی روی لبه درب');
  await expect(page.getByTestId('task').filter({ hasText: 'کار اصلاحی کنترل کیفیت' })).toHaveCount(1);
  await expect(panel.getByRole('button', { name: 'تحویل خودرو' })).toBeDisabled();

  // A second accident expert closes financially: the invoice is issued in the
  // accounting system, so no settlement is recorded in Manage (spec decision 3).
  await openCase5(page, 'supervisor');
  await panel.getByRole('button', { name: 'بستن مالی' }).click();
  await dialog.getByRole('button', { name: 'ثبت', exact: true }).click();
  await expect(panel.getByText('انجام شد', { exact: true })).toHaveCount(2);

  // Expert: handover needs the recipient's confirmation; afterwards the case is archived.
  await openCase5(page, 'expert');
  await panel.getByRole('button', { name: 'تحویل خودرو' }).click();
  await expect(dialog.getByLabel('نام تحویل‌گیرنده *')).toHaveValue('مشتری نمونه پنج');
  const submit = dialog.getByRole('button', { name: 'ثبت', exact: true });
  await expect(submit).toBeDisabled();
  await dialog.getByLabel('تحویل‌گیرنده خودرو را بازدید کرد و برگه تحویل را امضا کرد *').check();
  await submit.click();
  await expect(page.getByTestId('delivery-done')).toContainText('تحویل به مشتری نمونه پنج (مالک)');
  await expect(page.getByTestId('delivery-done')).toContainText('بایگانی');
  await expect(page.locator('.case-hero')).toContainText('تحویل‌شده');
  await expect(page.getByRole('link', { name: 'ویرایش پرونده' })).toHaveCount(0);
});
