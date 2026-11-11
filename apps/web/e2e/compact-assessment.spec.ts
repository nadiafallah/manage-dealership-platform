import { test, expect } from '@playwright/test';
import { writeSheet } from '../../api/src/parts/xlsx';
import { login } from './helpers';

test('compact case, PDF-style assessment preview and safe repeat-admission prefill', async ({page}, info) => {
  await login(page,'expert');
  const headers = {'x-manage-client':'e2e'};
  const vin = 'TESTVIN00009E2E50';
  const created = await page.request.post('/api/v1/cases',{headers,data:{
    customer:{fullName:'مشتری ساختگی بازطراحی',phone:'09000008888'},
    vehicle:{brand:'ایران‌خودرو',model:'تارا',trim:'تیپ آزمون',vin,color:'سفید',modelYear:1403},
    admittedAt:new Date(Date.now()-86400000).toISOString(),coverageType:'personal',
    damageDescription:'خسارت قبلی نباید کپی شود',admissionNo:'TEST-RECEPTION-50',
  }});
  expect(created.ok()).toBe(true); const c = await created.json();
  await page.goto(`/cases/${c.id}`);
  await expect(page.locator('#case-assessment')).toHaveAttribute('open','');
  await expect(page.getByRole('tab',{name:'کارشناسی',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.locator('#case-parts')).toHaveCount(0);
  await expect(page.getByTestId('finance-panel')).not.toBeVisible();
  await page.getByRole('button',{name:'شروع کارشناسی',exact:true}).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('نام کارشناس *').fill('کارشناس ساختگی');
  await dialog.getByRole('button',{name:'ثبت',exact:true}).click();
  await page.getByRole('button',{name:'دریافت اکسل کارشناسی',exact:true}).click();
  const line = Array<string>(42).fill('');
  const header = [...line]; header[0]='وضعیت';header[5]='مبلغ';header[9]='فی';header[16]='تعداد';header[25]='شرح';header[38]='کد';
  const row = [...line]; row[0]='نهايي';row[5]='200';row[9]='100';row[16]='2';row[25]='قطعه ساختگی اکسل';row[38]='00123456';
  const rejected = [...line]; rejected[0]='رد';rejected[5]='50';rejected[9]='50';rejected[16]='1';rejected[25]='قطعه ردشده ساختگی';rejected[38]='00999999';
  const eqHeader = [...line]; eqHeader[0]='وضعیت';eqHeader[7]='شرح';eqHeader[34]='کد';
  const eq = [...line]; eq[0]='نهايي';eq[7]='اجرت معادل ساختگی';eq[34]='TEST-EQ1';
  const total = [...line]; total[5]='200';
  const file = writeSheet('کارشناسی آزمون',[['لیست قطعات و اجرتهای دستور کار'],['قطعات'],header,row,rejected,total,['اجرت های معادل'],eqHeader,eq]);
  await dialog.getByLabel('فایل کارشناسی (.xlsx)').setInputFiles({name:'synthetic-assessment.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(file)});
  await dialog.getByRole('button',{name:'بررسی و پیش‌نمایش'}).click();
  await expect(dialog.getByRole('table').first()).toContainText('قطعه ساختگی اکسل');
  await expect(dialog.getByTestId('import-summary')).toContainText('۱ نهایی، ۱ ردشده');
  await expect(dialog.getByTestId('import-summary')).toContainText('برابر با جمع فایل');
  await dialog.getByTestId('import-set-aside').locator('summary').click();
  await expect(dialog.getByTestId('import-set-aside')).toContainText('قطعه ردشده ساختگی');
  await dialog.getByTestId('import-equivalents').locator('summary').click();
  await expect(dialog.getByTestId('import-equivalents')).toContainText('اجرت معادل ساختگی');
  await page.screenshot({path:info.outputPath('assessment-import-preview.png'),fullPage:true});
  await expect(dialog.getByRole('button',{name:'افزودن به پیش‌نویس'})).toBeDisabled();
  await dialog.getByLabel('اقلام و واحد مبلغ را بررسی کردم').check();
  await dialog.getByRole('button',{name:'افزودن به پیش‌نویس'}).click();
  await expect(page.getByTestId('assessment-item')).toContainText('قطعه ساختگی اکسل');
  await expect(page.getByTestId('assessment-item')).toHaveCount(1);
  await expect(page.getByTestId('assessment-panel')).toContainText('پیش‌نویس');
  await page.screenshot({path:info.outputPath('compact-case-desktop.png'),fullPage:true});
  await page.getByRole('tab',{name:'قطعات',exact:true}).click();
  await expect(page.locator('#case-parts')).toHaveAttribute('open','');
  await page.locator('#case-parts > summary').click();
  await expect(page.locator('#case-parts')).not.toHaveAttribute('open','');
  // Printing renders every tab of the folder; afterwards only the chosen tab stays.
  await page.evaluate(()=>window.dispatchEvent(new Event('beforeprint')));
  await expect(page.locator('#case-history')).toHaveAttribute('open','');
  await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
  await expect(page.locator('#case-history')).toHaveCount(0);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('compact-case-mobile.png'),fullPage:true});
  await page.goto('/cases/new');
  const lookup = page.getByTestId('vehicle-history-lookup');
  await lookup.getByLabel('VIN کامل یا شماره شاسی عین سابقه').fill(vin);
  await lookup.getByRole('button',{name:'جست‌وجوی پذیرش‌های قبلی خودرو'}).click();
  await lookup.getByRole('button',{name:'استفاده از مشخصات خودرو و مشتری'}).first().click();
  await expect(page.getByLabel('مدل',{exact:true})).toHaveValue('تارا');
  await expect(page.getByLabel('سال ساخت',{exact:true})).toHaveValue('1403');
  await expect(page.getByLabel('نام و نام خانوادگی',{exact:true})).toHaveValue('مشتری ساختگی بازطراحی');
  await expect(page.getByLabel('تلفن همراه',{exact:true})).toHaveValue('09000008888');
  await expect(page.getByLabel('شرح خسارت',{exact:true})).toHaveValue('');
  await expect(page.getByLabel('شماره کارت پذیرش ایران‌خودرو',{exact:true})).toHaveValue('');
  await page.screenshot({path:info.outputPath('intake-history-mobile.png'),fullPage:true});
});
