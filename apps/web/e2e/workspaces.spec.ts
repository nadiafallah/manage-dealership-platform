import {test,expect} from '@playwright/test';
import {PERMISSIONS,permissionsFor,type AccessCatalog} from '@manage/shared';
import {login} from './helpers';

test('department menu exposes only the desks of the six roles, on desktop and phone',async({page},info)=>{
 // Since the six-role change the former QC demo user is a third accident expert.
 await login(page,'qc');await expect(page).toHaveURL(/\/launch$/);await page.goto('/accidents');
 await expect(page.getByRole('heading',{name:'واحد تصادفات',exact:true})).toBeVisible();
 const launch=page.getByRole('navigation',{name:'میزهای کار مجاز من'});
 await expect(launch.getByRole('link',{name:/کارشناس تصادفات/})).toBeVisible();await expect(launch.getByRole('link',{name:/مالک|مالی و صندوق|کنترل کیفیت/})).toHaveCount(0);
 await launch.getByRole('link',{name:/کارشناس تصادفات/}).click();await expect(page.getByRole('heading',{name:'میز کار کارشناس تصادفات'})).toBeVisible();
 await page.screenshot({path:info.outputPath('expert-workspace-desktop.png'),fullPage:true});
 await page.goto('/accidents/owner');await expect(page.getByRole('heading',{name:'این میز کار برای شما فعال نیست'})).toBeVisible();
 await page.setViewportSize({width:390,height:844});await page.goto('/accidents/expert');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:'منو',exact:true}).click();const sidebar=page.getByRole('complementary',{name:'منوی اصلی'});
 await expect(sidebar.getByText('واحد تصادفات',{exact:true})).toBeVisible();await expect(sidebar.getByRole('link',{name:'میز کار من',exact:true})).toBeVisible();
 await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'منو',exact:true})).toBeFocused();
 // A direct section link must scroll after asynchronously loaded case data arrives.
 const cases=await (await page.request.get('/api/v1/cases')).json();
 await page.goto(`/cases/${cases.items[0].id}#case-quality`);
 await expect(page.locator('#case-quality')).toBeInViewport();
 const shortcut=page.getByRole('link',{name:'کنترل کیفیت و تحویل',exact:true});
 await shortcut.scrollIntoViewIfNeeded();await shortcut.click();
 await expect(page.locator('#case-quality')).toBeInViewport();
});
test('owner edits individual exceptions and role defaults with review and an intact phone layout',async({page},info)=>{
 await login(page,'manager');
 await page.route('**/api/v1/auth/me',async route=>{const response=await route.fetch();const me=await response.json();await route.fulfill({json:{...me,isOwner:true,permissions:[...PERMISSIONS]}});});
 let catalog:AccessCatalog={version:1,templates:{},staff:[{id:'00000000-0000-4000-8000-000000000001',displayName:'همکار تکنسین آزمون',email:'tech@example.test',roles:['technician'],isOwner:false,isActive:true,version:1,overrides:{allow:[],deny:[]},permissions:[...permissionsFor(['technician'])]}]};
 await page.route('**/api/v1/access',route=>route.fulfill({json:catalog}));
 await page.route('**/api/v1/access/users/*',async route=>{const body=route.request().postDataJSON();expect(body.expectedVersion).toBe(1);expect(body.expectedTemplateVersion).toBe(1);expect(body.allow).toContain('part.request');catalog={...catalog,staff:[{...catalog.staff[0],version:2,overrides:{allow:body.allow,deny:body.deny},permissions:[...permissionsFor(body.roles,catalog.templates,body)]}]};await route.fulfill({json:{status:'ok'}});});
 await page.route('**/api/v1/access/templates/*',async route=>{const body=route.request().postDataJSON();expect(body.expectedVersion).toBe(1);catalog={...catalog,version:2,templates:{accident_expert:body.permissions}};await route.fulfill({json:{status:'ok'}});});
 await page.route('**/api/v1/auth/invitations',r=>r.fulfill({json:[]}));await page.route('**/api/v1/auth/invitations/email/status',r=>r.fulfill({json:{configured:false}}));
 await page.goto('/users#access');const panel=page.locator('#access-control');await panel.getByText('همکار تکنسین آزمون',{exact:true}).click();
 await panel.locator('.access-person').getByLabel('ثبت نیاز قطعه',{exact:true}).check();await panel.getByRole('button',{name:'بازبینی تغییر دسترسی',exact:true}).click();await expect(panel).toContainText('۱ تغییر');
 await panel.getByRole('button',{name:'تأیید و ذخیره دسترسی',exact:true}).click();await expect(panel.getByRole('status')).toContainText('دسترسی ذخیره شد');
 await panel.getByText('الگوهای پیش‌فرض سمت‌ها',{exact:true}).click();const template=panel.locator('.access-template');await template.getByLabel('ثبت نیاز قطعه',{exact:true}).uncheck();
 await template.getByRole('button',{name:'بازبینی تغییر الگو',exact:true}).click();await expect(template).toContainText('برای همه افراد');await template.getByRole('button',{name:'تأیید و ذخیره الگوی سمت',exact:true}).click();
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('heading',{name:'کارکنان',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('owner-access-mobile.png'),fullPage:true,animations:'disabled'});
});
