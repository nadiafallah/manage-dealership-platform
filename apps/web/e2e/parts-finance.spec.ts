import { expect, test, type Page } from '@playwright/test';
import { login, openCaseSections } from './helpers';

// Issues #9 and #10 in the browser, on demo case 3 (personal payment): the
// customer approved the estimate. Payments are not recorded in Manage any more
// (spec decision 3); the advance decision is an answer on the cost alert.
async function openCase3(page: Page, user: string) {
  // Leave the app first: a background request of the old page would otherwise
  // get 401 after the cookies are cleared and redirect, aborting our navigation.
  await page.goto('about:blank');
  await page.context().clearCookies();
  await login(page, user);
  await page.goto('/cases?q=' + encodeURIComponent('مشتری نمونه سه'));
  await page.locator('tbody tr').filter({ hasText: 'مشتری نمونه سه' }).click();
  await openCaseSections(page,'parts','finance','history');
  await expect(page.getByTestId('finance-panel')).toBeVisible();
}

test('expert records customer price approval; parts orders and hands over', async ({
  page,
}) => {
  const dialog = page.getByRole('dialog');

  // No payment buttons: the finance panel only explains where the decision is recorded.
  await openCase3(page, 'expert');
  await expect(page.getByTestId('finance-gate')).toContainText('هشدار هزینه');
  await expect(page.getByRole('button', { name: 'ثبت دریافت از مشتری', exact: true })).toHaveCount(0);
  // Market purchase: parts quotes, the coordinator records customer consent.
  await openCase3(page, 'parts');
  const currentParts=await (await page.request.get('/api/v1/cases/'+page.url().split('/cases/')[1]+'/parts')).json();
  const need=currentParts.find((p:{description:string})=>p.description==='آینه بغل چپ');
  const proposal=await page.request.post(`/api/v1/workshop/parts/${need.id}/quotes`,{headers:{'x-manage-client':'test'},data:{expectedVersion:need.version,unitPriceRial:14000000,supplier:'فروشگاه آزمون',validUntil:new Date(Date.now()+86400000).toISOString()}});
  expect(proposal.ok()).toBe(true);const quote=(await proposal.json()).find((q:{partId:string;status:string})=>q.partId===need.id&&q.status==='pending');
  await openCase3(page,'expert');
  await page.getByRole('button',{name:'ثبت پاسخ پرداخت‌کننده',exact:true}).click();
  const decision=page.locator('form').filter({has:page.getByRole('heading',{name:'پاسخ به قیمت آینه بغل چپ'})});
  await decision.getByLabel('مرجع پاسخ').selectOption('customer');
  await decision.getByLabel('نام تأییدکننده').fill('مشتری آزمون');
  await decision.getByLabel('شماره ثبت رسمی / مرجع تأیید مشتری').fill('TEST-CUSTOMER-APPROVAL');
  await decision.getByLabel('شرح پاسخ').fill('مشتری قیمت بازار را تأیید کرد');
  await decision.getByRole('button',{name:'ثبت پاسخ',exact:true}).click();
  await expect(page.getByText('پاسخ و مرجع تأیید ثبت شد.')).toBeVisible();
  expect(quote.id).toBeTruthy();

  // Parts clerk: order the approved mirror, receive it, hand it over.
  await openCase3(page, 'parts');
  const mirror = page.getByTestId('part').filter({ hasText: 'آینه بغل چپ' });
  await expect(mirror).toContainText('نیاز ثبت شد');
  await mirror.getByRole('button', { name: 'سفارش قطعه' }).click();
  await dialog.getByLabel('تأمین‌کننده', { exact: true }).fill('فروشگاه آزمون');
  await expect(dialog.getByLabel('قیمت واحد خرید (ریال) *')).toHaveValue('14000000');
  await dialog.getByRole('button', { name: 'ثبت', exact: true }).click();
  await expect(mirror).toContainText('سفارش داده شد');

  await mirror.getByRole('button', { name: 'رسید و کنترل قطعه' }).click();
  await dialog.getByLabel('شماره رسید انبار').fill('RCV-E2E-1');
  await dialog.getByRole('button', { name: 'ثبت', exact: true }).click();
  await expect(mirror).toContainText('رسید و کنترل شد');

  await mirror.getByRole('button', { name: 'تحویل به واحد تعمیر' }).click();
  await dialog.getByLabel('واحد تعمیر').selectOption({ label: 'مونتاژ و دمونتاژ' });
  await dialog.getByLabel('تحویل‌گیرنده *').fill('تکنسین آزمون');
  await dialog.getByRole('button', { name: 'ثبت', exact: true }).click();
  await expect(mirror).toContainText('تحویل واحد تعمیر');
  await expect(mirror).toContainText('تکنسین آزمون (مونتاژ و دمونتاژ)');

  // Excel import: preview first, then import all rows of the sample.
  await openCase3(page,'expert');
  await page.getByTestId('parts-panel').getByRole('button', { name: 'ورود از اکسل' }).click();
  await dialog.getByLabel('فایل اکسل (.xlsx)').setInputFiles('public/samples/parts-import-sample.xlsx');
  await expect(dialog.getByTestId('import-preview')).toContainText('۴ ردیف آماده ورود');
  await dialog.getByRole('button', { name: 'ورود ۴ ردیف' }).click();
  await expect(page.getByTestId('part')).toHaveCount(5);
  await expect(page.getByTestId('parts-panel')).toContainText('آرم صندوق');

  // History (not visible to the parts clerk) records every step with its actor.
  await openCase3(page, 'manager');
  await expect(page.locator('.timeline')).toContainText('تحویل قطعه به واحد تعمیر');
});
