import {test,expect,type Page} from '@playwright/test';
import {login} from './helpers';

const sysAdminRow=(extra:Record<string,unknown>)=>({id:'synthetic',email:'sysadmin@example.test',displayName:'مدیر سیستم آزمون',roles:['system_admin'],isActive:false,invitationExpiresAt:new Date(Date.now()+86400000).toISOString(),...extra});
async function openAdminTab(page:Page){
  await page.goto('/users');await expect(page.getByRole('heading',{name:'کارکنان',exact:true})).toBeVisible();
  await page.getByRole('tab',{name:/^مدیر سیستم/}).click();
}
async function pinSignIn(page:Page,username:string,pin:string){
  await page.context().clearCookies();
  await page.goto('/login');
  // Staff sign-in is the default of exactly two options.
  await expect(page.getByRole('tab')).toHaveText(['ورود کارکنان','ورود مدیر سیستم']);
  await expect(page.getByRole('tab',{name:'ورود کارکنان',exact:true})).toHaveAttribute('aria-selected','true');
  const form=page.locator('#login-panel-technician');
  await form.getByLabel('نام کاربری',{exact:true}).fill(username);
  for(const [i,d] of [...pin].entries())await form.getByLabel(`رقم ${['۱','۲','۳','۴'][i]} رمز`,{exact:true}).fill(d);
  // Spec section 3: username + PIN only, also on a device never used before.
  await expect(form.getByLabel(/رمز ثبت دستگاه/)).toHaveCount(0);
  await form.getByRole('button',{name:/ورود/}).click();
}

test('owner invites a system administrator by email from the مدیر سیستم tab',async({page},testInfo)=>{
  await login(page,'admin');
  await page.route('**/api/v1/auth/invitations/email/status',r=>r.fulfill({json:{configured:true}}));
  let sent=false;
  await page.route('**/api/v1/auth/invitations',r=>r.fulfill({json:sent?[sysAdminRow({invitationDelivery:'sent'})]:[]}));
  await page.route('**/api/v1/auth/invitations/email',async r=>{
    expect(r.request().postDataJSON()).toEqual({email:'sysadmin@example.test',displayName:'مدیر سیستم آزمون',roles:['system_admin']});
    sent=true;await r.fulfill({json:{id:'synthetic',status:'invited',emailDelivery:'sent'}});
  });
  await openAdminTab(page);
  await page.getByRole('button',{name:'افزودن مدیر سیستم',exact:true}).click();
  // Only the system administrator role is offered here.
  await expect(page.locator('input[name="roles"]')).toHaveCount(1);
  await page.getByLabel('نام و نام خانوادگی',{exact:true}).fill('مدیر سیستم آزمون');await page.getByLabel('ایمیل',{exact:true}).fill('sysadmin@example.test');
  await page.getByRole('button',{name:'افزودن و ارسال دعوت',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('sysadmin@example.test');
  await expect(page.getByText('دعوت ایمیل شد؛ در انتظار فعال‌سازی',{exact:false})).toBeVisible();
  await expect(page.getByText('لینک دعوت محرمانه')).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath('staff-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'ارسال دوباره دعوت برای مدیر سیستم آزمون'}).click();
  await expect(page.getByRole('status')).toContainText('سرور ایمیل دعوت‌نامه');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test('system-admin invitation explains mail failures and offers a private link without email',async({page})=>{
  await login(page,'admin');
  await page.route('**/api/v1/auth/invitations/email/status',r=>r.fulfill({json:{configured:true}}));
  await page.route('**/api/v1/auth/invitations/email',r=>r.fulfill({json:{emailDelivery:'failed'}}));
  await openAdminTab(page);await page.getByRole('button',{name:'افزودن مدیر سیستم',exact:true}).click();
  await page.getByLabel('نام و نام خانوادگی',{exact:true}).fill('مدیر سیستم آزمون');await page.getByLabel('ایمیل',{exact:true}).fill('sysadmin@example.test');
  await page.getByRole('button',{name:'افزودن و ارسال دعوت',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'کارمند ثبت شد'})).toContainText('ارسال ایمیل موفق نبود');
  await page.route('**/api/v1/auth/invitations/email/status',r=>r.fulfill({json:{configured:false}}));
  await openAdminTab(page);await page.getByRole('button',{name:'افزودن مدیر سیستم',exact:true}).click();
  await expect(page.getByRole('button',{name:'افزودن و ارسال دعوت',exact:true})).toHaveCount(0);
  await page.getByLabel('نام و نام خانوادگی',{exact:true}).fill('مدیر سیستم موقت');
  await page.getByLabel('ایمیل',{exact:true}).fill('private-sysadmin@example.test');
  await page.getByRole('button',{name:'ساخت لینک دعوت خصوصی',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'لینک خصوصی برای'})).toContainText('ایمیلی ارسال نشده است');
  await expect(page.getByLabel('لینک دعوت محرمانه',{exact:true})).toHaveValue(/\/activate#token=/);
});

test('owner sees why email failed and can check the connection without sending',async({page})=>{
  await login(page,'admin');
  await page.route('**/api/v1/auth/invitations/email/status',r=>r.fulfill({json:{configured:true}}));
  await page.route('**/api/v1/auth/invitations',r=>r.fulfill({json:[sysAdminRow({invitationDelivery:'failed',invitationFailure:'connection_blocked'})]}));
  let checks=0;
  await page.route('**/api/v1/auth/invitations/email/check',r=>{checks++;return r.fulfill({json:{status:'failed',failure:'connection_blocked'}});});
  await openAdminTab(page);
  await expect(page.getByText('علت: سرور Manage به سرور ایمیل وصل نشد',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'افزودن مدیر سیستم',exact:true}).click();
  await page.getByRole('button',{name:'بررسی اتصال ایمیل'}).click();
  await expect(page.getByTestId('mail-check')).toContainText('مشکل شبکه سرور است');
  expect(checks).toBe(1);
  await expect(page.getByRole('button',{name:'ساخت لینک خصوصی برای مدیر سیستم آزمون'})).toBeEnabled();
});

test('a technician is created with name, role, username, PIN, unit and bay, and signs in with the PIN',async({page},testInfo)=>{
  await login(page,'admin');
  await page.goto('/users');
  const panel=page.getByRole('tabpanel');
  await expect(page.getByRole('tab',{name:/^کارکنان/})).toHaveAttribute('aria-selected','true');
  await expect(panel.getByRole('heading',{name:'افزودن کارمند',exact:true})).toBeVisible();
  await expect(panel.getByLabel('ایمیل')).toHaveCount(0);
  await panel.getByLabel('نام و نام خانوادگی',{exact:true}).fill('صافکار تصویری آزمون');
  await expect(panel.getByRole('combobox',{name:'سمت',exact:true})).toHaveValue('technician');
  await panel.getByRole('combobox',{name:'واحد',exact:true}).selectOption({label:'صافکاری'});
  await panel.getByLabel('کد جایگاه',{exact:true}).fill('B-77');
  await panel.getByLabel('رمز ۴ رقمی',{exact:true}).fill('۴۸۱۵');
  await expect(panel.getByLabel('رمز ثبت دستگاه',{exact:true})).toHaveCount(0);
  const username='techb-77';
  await expect(panel.getByLabel('نام کاربری',{exact:true})).toHaveValue(username);
  await panel.getByRole('button',{name:'افزودن کارمند',exact:true}).click();
  const created=panel.locator('.technician-created');
  await expect(created).toContainText('صافکار تصویری آزمون ساخته شد');
  await expect(created).toContainText(username);
  await expect(created).toContainText('۴۸۱۵');
  await expect(created).toContainText('صافکاری · B-77');
  const row=panel.getByRole('row',{name:/صافکار تصویری آزمون/});
  await expect(row).toContainText('فعال');
  await expect(row).toContainText('صافکاری · B-77');
  await page.screenshot({path:testInfo.outputPath('technicians-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('technicians-mobile.png'),fullPage:true});

  await pinSignIn(page,username,'4815');
  await expect(page).toHaveURL(/\/workshop\/technician$/);
});

test('a service manager is created the same way without unit or bay, signs in with the PIN, and deactivation archives him',async({page,browser,baseURL})=>{
  await login(page,'admin');
  await page.goto('/users');
  const panel=page.getByRole('tabpanel');
  await panel.getByLabel('نام و نام خانوادگی',{exact:true}).fill('مدیر خدمات آزمون');
  await panel.getByRole('combobox',{name:'سمت',exact:true}).selectOption({label:'مدیر خدمات'});
  await expect(panel.getByRole('combobox',{name:'واحد',exact:true})).toHaveCount(0);
  await expect(panel.getByLabel('کد جایگاه',{exact:true})).toHaveCount(0);
  await panel.getByLabel('کد دو رقمی کارشناس',{exact:true}).fill('20');
  await panel.getByLabel('رمز ۴ رقمی',{exact:true}).fill('2580');
  await panel.getByRole('button',{name:'افزودن کارمند',exact:true}).click();
  await expect(panel.locator('.technician-created')).toContainText('مدیر خدمات آزمون ساخته شد');
  await expect(panel.getByRole('row',{name:/مدیر خدمات آزمون/})).toContainText('مدیر خدمات');

  // Use a fresh device for staff sign-in and keep the administrator session intact.
  const staffContext=await browser.newContext({baseURL});
  try{
    const staffPage=await staffContext.newPage();
    // Scenario 2026-11-25: a service manager's two-digit code makes MGR (not EXP).
    await expect(panel.getByRole('row',{name:/مدیر خدمات آزمون/})).toContainText('MGR 20');
    await pinSignIn(staffPage,'MGR 20','2580');
    await expect(staffPage).toHaveURL(/\/launch$/);
  }finally{
    await staffContext.close();
  }
  await page.getByRole('row',{name:/مدیر خدمات آزمون/}).getByRole('button',{name:'غیرفعال کردن',exact:true}).click();
  // The system administrator (not the owner) must give a reason for the owner's report.
  await page.getByLabel('دلیل (در گزارش مالک دیده می‌شود)',{exact:true}).fill('بایگانی حساب آزمون');
  await page.locator('.technician-confirm').getByRole('button',{name:'تأیید',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'غیرفعال شد'})).toBeVisible();
  const archive=page.locator('details.technicians-archived');
  await expect(archive.locator('summary')).toContainText('حساب‌های غیرفعال و بایگانی');
  await archive.locator('summary').click();
  await expect(archive.getByRole('row',{name:/مدیر خدمات آزمون/})).toContainText('غیرفعال');
});
