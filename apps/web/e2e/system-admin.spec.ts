import {test,expect} from '@playwright/test';
import {PERMISSIONS} from '@manage/shared';
import {buildStockXlsx} from '../../api/src/daily-reports/fixtures';
import {login} from './helpers';

test('owner-configured support desk exposes daily upload, all operational queues and keeps owner controls protected',async({page},info)=>{
 await login(page,'manager');
 const catalog=await (await page.request.get('/api/v1/access')).json();
 const changed=await page.request.put('/api/v1/access/templates/system_admin',{headers:{'x-manage-client':'test'},data:{expectedVersion:catalog.version,permissions:[...PERMISSIONS]}});
 expect(changed.ok()).toBe(true);
 await login(page,'admin');await expect(page).toHaveURL(/\/launch$/);await page.getByRole('navigation',{name:'میزهای کار مجاز من'}).getByRole('link',{name:/مدیر سیستم/}).click();
 const me=await (await page.request.get('/api/v1/auth/me')).json();
 expect(me.isOwner).toBe(false);expect(me.permissions).toHaveLength(PERMISSIONS.length);
 const desk=page.getByRole('navigation',{name:'کارهای مدیر سیستم',exact:true});
 // Locator.all() does not wait for the newly navigated workspace to render.
 await expect(desk.locator('details > summary')).toHaveCount(2);
 for(const summary of await desk.locator('details > summary').all())await summary.click();
 for(const name of ['به‌روزرسانی گزارش‌های روزانه','موجودی روزانه و رزرو','پیگیری امداد ویژه','پذیرش خودرو','برنامه و پیگیری تعمیر','مالی و تسویه','کنترل کیفیت و تحویل','گزارش جامع خدمات','کارکنان و دعوت'])await expect(desk.getByRole('link',{name:new RegExp(`^${name}(?:\\s|$)`)})).toBeVisible();
 await expect(page.getByRole('heading',{name:'پرونده‌ها برای پیگیری و پشتیبانی',exact:true})).toBeVisible();
 await expect(page.getByLabel('جست‌وجو در همین صف')).toBeVisible();
 await expect(page.getByTestId('daily-status')).toBeVisible();
 await page.screenshot({path:info.outputPath('support-desk-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('support-desk-mobile.png'),fullPage:true});
 await desk.getByRole('link',{name:/به‌روزرسانی گزارش‌های روزانه/}).click();
 await expect(page.getByRole('button',{name:'موجودی روزانه انبار',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'موجودی روزانه انبار',exact:true}).click();
 const file=buildStockXlsx([{'کد کالا':'8765432101','شرح کالا':'قطعه ساختگی پشتیبانی','موجودي':'2','قيمت فروش':'1000','قيمت ميانگين':'900','واحد شمارش':'عدد','آدرس':'TEST-A'}]);
 const upload=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/daily-reports/uploads?'));
 await page.getByLabel('انتخاب فایل').setInputFiles({name:'synthetic-admin-stock.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(file)});
 expect((await upload).ok()).toBe(true);
 await expect(page.getByTestId('daily-job')).toBeVisible();
 await expect(page.getByRole('button',{name:'ثبت گزارش',exact:true})).toBeVisible();
 // The non-owner support session cannot retrieve or mutate access administration.
 expect((await page.request.get('/api/v1/access')).status()).toBe(403);
 await page.goto('/users');await expect(page.locator('#access-control')).toHaveCount(0);
 await page.goto('/accidents/expert');await expect(page.locator('.desk-kicker')).toHaveText('میز کار کارشناس تصادفات');
 await page.goto('/accidents/owner');await expect(page.getByRole('heading',{name:'این میز کار برای شما فعال نیست',exact:true})).toBeVisible();
});

test('owner gives and takes "invite and deactivate staff" of the system administrator and sees the report of support actions', async ({ page }, info) => {
  await login(page, 'manager');
  await page.goto('/users#owner-admin');
  const section = page.getByTestId('owner-admin');
  await expect(section.getByRole('heading', { name: 'اختیارات مدیر سیستم', exact: true })).toBeVisible();
  const toggle = section.getByRole('switch', { name: /دعوت و غیرفعال کردن کارکنان؛ مدیر سیستم نمونه/ });
  // A CI retry reuses the same database, so start from the granted state either way.
  await expect(toggle).toBeVisible();
  if (!(await toggle.isChecked())) {
    await toggle.click();
    await expect(toggle).toBeChecked();
  }
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(section).toContainText('نمی‌تواند دعوت و غیرفعال کند');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await section.screenshot({ path: info.outputPath('owner-admin-mobile.png') });
  await page.setViewportSize({ width: 1366, height: 860 });

  await login(page, 'admin');
  expect((await page.request.get('/api/v1/staff/technicians')).status()).toBe(403);
  expect((await page.request.get('/api/v1/access/admin-actions')).status()).toBe(403);
  await page.goto('/users');
  await expect(page.getByText('به بخش کارکنان دسترسی ندارید.', { exact: true })).toBeVisible();

  await login(page, 'manager');
  await page.goto('/users#owner-admin');
  await page.getByTestId('owner-admin').getByRole('switch', { name: /مدیر سیستم نمونه/ }).click();
  await expect(page.getByTestId('owner-admin').getByRole('switch', { name: /مدیر سیستم نمونه/ })).toBeChecked();
  await login(page, 'admin');
  expect((await page.request.get('/api/v1/staff/technicians')).status()).toBe(200);
});
