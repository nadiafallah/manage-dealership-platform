> **Superseded (package 6, 2026-11-10):** the Signature theme and the `?ui=classic` switch were removed. The current design system is [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md); this file is kept as history.

# تحویل طراحی HEDAX Signature — منیج

- **شاخه:** `feature/hedax-signature-3d-manage` در fork `nadiafallah/manage-dealership-platform`
- **پایه:** `main` در `5cf9c72` (ادغام #60، ۱۶ آبان ۱۴۰۵)
- **commit پیاده‌سازی:** `dbe8c0a`. commitهای بعدی شاخه حرکت را بهینه و مستندات را کامل می‌کنند. SHA نهایی در صفحهٔ PR است.
- **وضعیت:** آمادهٔ بررسی مالک است. **ادغام نشده و منتشر نشده.** آماده‌بودن برای انتشار را ادعا نمی‌کنیم؛ بخش «پیش از انتشار» را ببینید.

## چه تغییر کرد

یک لایهٔ ظاهری تازه به نام «HEDAX Signature» روی همان رابط فعلی سوار شده است: زمینهٔ سنگ تیره، سطح‌های گرافیتی با لبهٔ ماشین‌کاری‌شده، نور گرم شامپاینی و نور سرد آبی کنترل‌شده، و عمق واقعی بین لایه‌ها.

- منوی کناری یک لایه بالاتر از میز کار می‌نشیند. مقصد فعال مثل یک کلید نورانی دیده می‌شود.
- بخش بازشدهٔ پرونده یک لایه جلو می‌آید و محتوایش باز می‌شود.
- پنجره‌های گفت‌وگو از عمق به جلو می‌آیند و پشت‌شان مات می‌شود.
- کارت‌های میز کار زیر نشانگر موس کمی بالا می‌آیند و نور را می‌گیرند.
- داشبورد یک «نمای عملیات» تازه دارد: درصد پرونده‌های فعال در مهلت روی یک صفحهٔ مدرج، با چهار عدد کلیدی (از مهلت گذشته، متوقف با مانع، تحویل تا ۴۸ ساعت، آمادهٔ تحویل). همه از دادهٔ واقعی همان داشبورد می‌آیند و هر کدام به همان فهرست پرونده‌ها باز می‌شود.
- صفحهٔ ورود یک «سکوی نمایشگاهی» از حلقه‌های نورانی و یک عبور نور یک‌باره دارد.
- آیکون‌ها با زبان مهندسی تازه بازطراحی شده‌اند: گوشهٔ پخ، اتصال تیز، و هندسهٔ مهره برای افراد و تنظیمات.

## صفحه‌های بازطراحی‌شده

همهٔ ۲۳ صفحهٔ فعال، به‌اضافهٔ ورود، فعال‌سازی و بازیابی رمز، ظاهر تازه را می‌گیرند. کار اختصاصی (ترکیب تازه) روی ورود، پوستهٔ برنامه، داشبورد، میزهای کار و ایستگاه تعمیرکار انجام شده است. بقیه، یعنی پرونده‌ها، قطعات، کارگاه، کارکنان، تذکرها، گزارش‌ها و اطلاعات پایه، در سطح سامانه بازطراحی شده‌اند: رنگ، سطح، کنترل‌ها، جدول‌ها، وضعیت‌ها و پنجره‌ها. چیدمان و ترتیب کارشان عمداً همان قبلی است تا کارکنان آموزش دوباره نخواهند. جدول کامل در [پیاده‌سازی](HEDAX_3D_IMPLEMENTATION.md) است.

## بازبینی دوم (۱۶ آبان ۱۴۰۵)

داشبورد، ورود، پرونده‌ها و میز قطعات دوباره با طراحی HEDAX سنجیده شدند.

- **تغییر کرد:** فقط داشبورد. نوار خوش‌آمد و «نمای عملیات» دو کادر سنگین پشت‌سرهم بودند. حالا نوار خوش‌آمد یک عنوان ساده است و «نمای عملیات» تنها کانون صفحه است. عنوان، زمان به‌روزرسانی و دکمه‌ها همان است و عددهای عملیاتی حدود ۸۵ پیکسل بالاتر آمده‌اند.
- **تغییر نکرد:** ورود، پرونده‌ها و میز قطعات. هماهنگ و خوانا بودند و تغییر بیشتر فقط ریسک اضافه می‌کرد.
- **آزمون‌ها:** پس از تغییر همه دوباره موفق شدند.

## چه چیزی تغییر نکرد

API، پایگاه داده، migration، مجوزها و نقش‌ها، ورود و احراز هویت، قواعد مالی، مسیرها، داده‌ها، سرور، `.env`، `deploy/**` و `.github/**`. هیچ دکمه یا کاری حذف نشده و هیچ قابلیت ساختگی اضافه نشده است. چاپ همان ظاهر روشن قبلی را دارد.

## مقایسهٔ قبل و بعد (اسکرین‌شات واقعی از برنامه با دادهٔ ساختگی)

| صفحه | قبل | بعد |
| --- | --- | --- |
| ورود | [قبل](hedax-signature/before/login-desktop.webp) | [بعد](hedax-signature/after/login-desktop.webp) |
| داشبورد | [قبل](hedax-signature/before/dashboard-desktop.webp) | [بعد](hedax-signature/after/dashboard-desktop.webp) |
| انتخاب میز کار | [قبل](hedax-signature/before/launch-desktop.webp) | [بعد](hedax-signature/after/launch-desktop.webp) |
| جزئیات پرونده | [قبل](hedax-signature/before/case-detail-desktop.webp) | [بعد](hedax-signature/after/case-detail-desktop.webp) |
| میز قطعات | [قبل](hedax-signature/before/parts-workbench-desktop.webp) | [بعد](hedax-signature/after/parts-workbench-desktop.webp) |
| ایستگاه تعمیرکار (گوشی) | [قبل](hedax-signature/before/technician-mobile.webp) | [بعد](hedax-signature/after/technician-mobile.webp) |
| کارکنان | [قبل](hedax-signature/before/users-desktop.webp) | [بعد](hedax-signature/after/users-desktop.webp) |
| گزارش‌ها | [قبل](hedax-signature/before/reports-desktop.webp) | [بعد](hedax-signature/after/reports-desktop.webp) |
| تذکرها | [قبل](hedax-signature/before/reminders-desktop.webp) | [بعد](hedax-signature/after/reminders-desktop.webp) |
| داشبورد (گوشی) | [قبل](hedax-signature/before/dashboard-mobile.webp) | [بعد](hedax-signature/after/dashboard-mobile.webp) |
| جزئیات پرونده (گوشی) | [قبل](hedax-signature/before/case-detail-mobile.webp) | [بعد](hedax-signature/after/case-detail-mobile.webp) |
| ورود (گوشی) | [قبل](hedax-signature/before/login-mobile.webp) | [بعد](hedax-signature/after/login-mobile.webp) |

ویدیوی کوتاه از تعامل واقعی (ورود، میز کار، باز کردن بخش پرونده، پنجرهٔ تذکر): [signature-interactions.webm](hedax-signature/signature-interactions.webm)

## اجرا و دیدن نتیجه

```bash
git fetch https://github.com/nadiafallah/manage-dealership-platform.git feature/hedax-signature-3d-manage
git checkout FETCH_HEAD
pnpm install --frozen-lockfile
pnpm dev
```

سپس `http://localhost:3000` را باز کنید و با کاربرهای نمونه وارد شوید (مثلاً `manager`، `admin`، `parts` یا `technician`؛ رمز همان رمز دادهٔ نمونه است).

- **دیدن نسخهٔ قبلی برای مقایسه:** به آخر هر نشانی `?ui=classic` اضافه کنید. انتخاب در همان مرورگر می‌ماند. با `?ui=signature` برمی‌گردید.
- **پیش‌فرض کردن نسخهٔ قبلی برای همه:** `NEXT_PUBLIC_UI_THEME=classic` در زمان build.

## آزمون‌ها

- **موفق:**
  - lint، typecheck، build و کنترل مستندات
  - آزمون‌های API: ۲۲۳ موفق، ۹ ردشده که فقط با PostgreSQL اجرا می‌شوند
  - Playwright اصلی: ۴۳ موفق
  - Playwright روزانه و مالک: ۴ موفق
  - شواهد طراحی: ۵ از ۵
- **نتیجهٔ بررسی‌ها:**
  - هیچ اسکرول افقی در ۲۳ صفحه و ۶ عرض (۳۶۰ تا ۱۹۲۰) نیست.
  - کنتراست متن: صفر خطا.
  - با «کاهش حرکت»، هیچ حرکتی اجرا نمی‌شود.
  - چاپ روشن است.
  - فوکوس صفحه‌کلید دیده می‌شود.
  - حالت classic دقیقاً همان `main` است.
- **اجرانشده:**
  - CI گیت‌هاب از این جلسه
  - آزمون روی دستگاه واقعی (Edge ویندوز، Safari آیفون، اندروید ارزان)
  - صفحه‌خوان
  - پژوهش زندهٔ وب
- **عملکرد:** کندی محسوس یا فریم کُند دیده نشد. ورود سرد حدود ۲۵ میلی‌ثانیه و داشبورد حدود ۵۰ میلی‌ثانیه دیرتر به بزرگ‌ترین نقاشی می‌رسند. JavaScript حدود ۷٫۵ کیلوبایت و CSS حدود ۲۹ کیلوبایت بیشتر شده است.

جزئیات کامل در [QA](HEDAX_3D_QA.md) است.

## بررسی PR

۱. اول اسکرین‌شات‌ها و ویدیو را ببینید.
۲. بعد خودتان روی گوشی و کامپیوتر نمایندگی با `?ui=classic` و `?ui=signature` مقایسه کنید.
۳. فایل‌های تغییرکرده کم‌اند:
   - `apps/web/app/signature.css`
   - `apps/web/app/layout.tsx`
   - `apps/web/components/AppIcon.tsx`
   - `apps/web/components/SpatialLight.tsx`
   - `apps/web/components/OperationsInstrument.tsx`
   - یک خط در صفحهٔ داشبورد و یک خط در صفحهٔ ورود
   - آزمون شواهد و مستندات

## برگرداندن

- **بدون تغییر کد:** `NEXT_PUBLIC_UI_THEME=classic`، یا `?ui=classic` برای هر کاربر.
- **کامل:** revert کردن commitهای این شاخه. داده یا migration‌ای برای برگرداندن نیست.

## پیش از انتشار لازم است

۱. تأیید ظاهری مالک (این تم فقط تیره است و نسخهٔ روشنش همان classic است).
۲. سبز شدن همهٔ بررسی‌های CI روی PR.
۳. امتحان روی یک کامپیوتر واقعی نمایندگی و یک گوشی متوسط.
۴. ادغام و انتشار فقط با تأیید صریح مالک.

جزئیات فنی: [سیستم طراحی](HEDAX_3D_DESIGN_SYSTEM.md) · [پژوهش](HEDAX_3D_RESEARCH.md) · [پیاده‌سازی](HEDAX_3D_IMPLEMENTATION.md) · [QA](HEDAX_3D_QA.md)
