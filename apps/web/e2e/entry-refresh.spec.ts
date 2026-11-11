import {test,expect} from '@playwright/test';
import {login} from './helpers';

test('entry, permitted desk selection and folded filters stay usable on phone',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/login');
 await expect(page.getByRole('heading',{name:'خوش آمدید'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('entry-login-mobile.png'),fullPage:true});
 await login(page,'qc');await expect(page).toHaveURL(/\/launch$/);
 const desks=page.getByRole('navigation',{name:'میزهای کار مجاز من'});
 await expect(desks.getByRole('link',{name:/کارشناس تصادفات/})).toBeVisible();
 await expect(desks.getByRole('link',{name:/مالک|مسئول قطعات|کنترل کیفیت|مالی و صندوق/})).toHaveCount(0);
 await page.screenshot({path:info.outputPath('entry-desks-mobile.png'),fullPage:true});
 await page.goto('/cases');const filters=page.locator('details.case-filters');
 await expect(filters).not.toHaveAttribute('open','');
 await expect(filters.getByRole('button',{name:'مهلت گذشته',exact:true})).not.toBeVisible();
 await filters.locator('summary').click();await filters.getByRole('button',{name:'مهلت گذشته',exact:true}).click();
 await expect(page).toHaveURL(/flag=overdue/);await filters.locator('summary').click();
 await expect(page.getByRole('button',{name:'برداشتن فیلتر',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'برداشتن فیلتر',exact:true}).click();await expect(page).not.toHaveURL(/flag=/);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('Google holiday refresh excludes tentative dates by default and preserves local closures until audited save',async({page})=>{
 await login(page,'admin');const today=new Date(Date.now()+210*60_000).toISOString().slice(0,10);
 let saved=false;
 await page.route('**/api/v1/workshop/calendar/iran-holidays',r=>r.fulfill({json:{fetchedAt:new Date().toISOString(),from:today,to:'2030-12-31',items:[{date:'2029-03-21',title:'نوروز',tentative:false},{date:'2029-03-22',title:'عید فطر',tentative:true}]}}));
 await page.route('**/api/v1/workshop/calendar',async route=>{if(route.request().method()==='POST'){saved=true;await route.fulfill({json:{}});}else{const response=await route.fetch();const data=await response.json();data.current.calendar.holidays.push({date:'2029-03-23',title:'تعطیلی اختصاصی آزمون',official:false});await route.fulfill({json:data});}});
 await page.goto('/workshop/settings');await page.getByRole('button',{name:'اعمال فهرست در پیش‌نویس تقویم'}).click();
 await expect(page.locator('.calendar-week')).toContainText('پنجشنبه');
 await expect(page.getByText('نوروز',{exact:false}).last()).toBeVisible();
 await expect(page.getByText('عید فطر',{exact:false})).not.toBeVisible();
 await expect(page.getByText(/تعطیلی اختصاصی آزمون/)).toBeVisible();
 expect(saved).toBe(false);
 await page.getByText('بررسی تعطیلات دریافتی',{exact:true}).click();await page.getByRole('checkbox',{name:'تاریخ احتمالی؛ پس از بررسی انتخاب کنید'}).check();
 await page.getByRole('button',{name:'اعمال فهرست در پیش‌نویس تقویم'}).click();
 await expect(page.getByText(/عید فطر/).last()).toBeVisible();expect(saved).toBe(false);
});

test('operational navigation and each synthetic case retain working destinations after decluttering',async({page},info)=>{
 test.setTimeout(180_000);
 await login(page,'admin');
 const routes=['/launch','/','/accidents','/accidents/admin','/accidents/expert','/accidents/parts','/accidents/manager','/cases','/cases/new','/cases/import','/workshop','/workshop/settings','/reports','/daily-reports','/stock','/emdad','/users','/reference-data'];
 // No external service or customer mutation: traverse the seeded local app only.
 await page.route('**/api/v1/workshop/calendar/iran-holidays',r=>r.fulfill({json:{fetchedAt:new Date().toISOString(),items:[]}}));
 for(const route of routes){await page.goto(route);await expect(page.locator('main#page-content h1').first()).toBeVisible();await expect(page.getByText('Application error: a client-side exception has occurred',{exact:false})).toHaveCount(0);}
 const cases=await(await page.request.get('/api/v1/cases?pageSize=100')).json();
 for(const kase of cases.items){await page.goto(`/cases/${kase.id}`);await expect(page.locator('.case-hero')).toBeVisible();for(const section of await page.locator('details.case-section').all()){await section.locator(':scope > summary').click();}}
 await page.goto('/launch');await page.setViewportSize({width:1366,height:860});await page.screenshot({path:info.outputPath('entry-desks-desktop.png'),fullPage:true});
 await page.goto('/login');await page.screenshot({path:info.outputPath('entry-login-desktop.png'),fullPage:true});
});

test('public Iran calendar file remains usable when server cannot reach Google',async({page})=>{
 await login(page,'admin');await page.route('**/api/v1/workshop/calendar/iran-holidays',r=>r.fulfill({status:422,json:{code:'HOLIDAY_SOURCE_UNAVAILABLE',message:'دریافت گوگل ناموفق بود'}}));
 await page.goto('/workshop/settings');await page.getByText('دریافت از فایل؛ اگر اتصال مستقیم برقرار نیست',{exact:true}).click();
 const year=new Date().getFullYear();const calendar=`BEGIN:VCALENDAR\r\nX-WR-CALNAME:Holidays in Iran\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:${year+1}0321\r\nDESCRIPTION:Public holiday\r\nSUMMARY:Norooz\r\nEND:VEVENT\r\nEND:VCALENDAR`;
 await page.getByLabel('فایل تقویم گوگل (.ics)').setInputFiles({name:'synthetic-iran.ics',mimeType:'text/calendar',buffer:Buffer.from(calendar)});
 await expect(page.getByRole('button',{name:'اعمال فهرست در پیش‌نویس تقویم'})).toBeVisible();await page.getByRole('button',{name:'اعمال فهرست در پیش‌نویس تقویم'}).click();
 await expect(page.getByText(/نوروز/).last()).toBeVisible();await expect(page.getByRole('button',{name:'ثبت نسخه تازه تقویم'})).toBeVisible();
});
