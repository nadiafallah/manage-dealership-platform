# راهنمای استقرار نسخهٔ نامزد انتشار (RC1) — بازسازی طبق سند، بسته‌های ۰ تا ۹

این راهنما برای **مالک** است که پس از بازبینی، ادغام و سبز شدن CI، نسخه را روی سرور Manage منتشر کند. هیچ بخشی از آن تا امروز اجرا نشده است. Source by HEDAX، سرور آن، DNS و فایروال دست نمی‌خورند.

## ۱. نسخهٔ هدف

- PR یکپارچه از شاخهٔ `integration/spec-rebuild-rc1` (fork `nadiafallah/manage-dealership-platform`) به `main` مخزن `ali-hedax/manage-dealership-platform`؛ همهٔ commitهای بسته‌های ۰ تا ۹ حفظ شده‌اند.
- پایه: `cc1d7e1` (ادغام PR #74، همان نسخه‌ای که الان روی Production است).
- **نسخهٔ قابل انتشار فقط commit ادغام‌شده در `main` است که هر شش بررسی CI آن سبز باشد.** commitهای شاخه هرگز مستقیم منتشر نمی‌شوند.

## ۲. artifactها

| artifact | از کجا | بررسی |
|---|---|---|
| `preview-images-<SHA کامل main>` | همان اجرای CI روی commit ادغام‌شده (job «Docker images build and compose smoke test») | `sha256sum -c preview-images.sha256`؛ فایل منبع باید همان SHA را نام ببرد |
| `build` | job «Lint, typecheck, build…» | فقط برای بازبینی؛ روی سرور build نمی‌شود |
| `playwright-report` | job «End-to-end» | تصویرهای `role-journeys` (هر نقش، دسکتاپ و ۳۹۰px) برای مقایسه با [docs/design/p9](design/p9/) |

روی سرور **هیچ تصویری ساخته نمی‌شود**؛ فقط همان تصاویر CI بارگذاری می‌شوند.

## ۳. پیکربندی

- **متغیر محیطی تازهٔ اجباری: ندارد.** `DEMO_FLEET` (پیش‌فرض `true`) فقط جایی خوانده می‌شود که دادهٔ نمونه ساخته می‌شود (توسعه، CI، Preview). Production هرگز seed نمی‌کند؛ لازم نیست آن را در `.env` سرور بنویسید.
- `APP_ENV=production` بدون تغییر می‌ماند؛ migration هنگام شروع اجرا نمی‌شود و مرحلهٔ جداگانه دارد (پایین).
- تنظیمات تازه‌ای که در پایگاه داده نگه داشته می‌شوند و پیش‌فرض دارند: سقف «قطعهٔ گران» ۵۰۰٬۰۰۰٬۰۰۰ ریال، «امداد ویژه دیر شده» پس از ۳ روز. مدیر سیستم پس از انتشار از «تنظیمات ← تقویم، جایگاه‌ها و سقف هشدارها» بازبینی‌شان می‌کند.
- Caddy، گواهی، Arvan و gate عوض نمی‌شوند.

## ۴. migrationها

Production الان migrationهای `0000` تا `0019` را دارد. سه migration تازه، هر سه با فایل down در `apps/api/src/db/down`:

| migration | بسته | چه می‌کند | نکتهٔ بازبینی |
|---|---|---|---|
| `0020_six_roles` | ۱ | نقش‌ها را به شش نقش سند تبدیل می‌کند (هماهنگ‌کننده/سرپرست/QC ← کارشناس تصادفات)؛ حساب‌های «فقط صندوق» حفظ و **غیرفعال** می‌شوند؛ الگوهای دسترسی به پیش‌فرض سند برمی‌گردند و استثناهای شخصی می‌مانند | فهرست حساب‌هایی که غیرفعال می‌شوند را پیش از انتشار روی نسخهٔ بازیابی‌شده ببینید (کوئری مرحلهٔ ۵) |
| `0021_part_price_notices` | ۳ و ۴ | جدول اعلام قیمت قطعه | فقط افزایشی |
| `0022_reminder_part` | ۷ | ستون اختیاری «قطعهٔ مربوط» روی تذکر | فقط افزایشی |

بستهٔ ۹ (ظاهر تأییدشده) **migration ندارد**؛ فقط یک فیلد افزایشی `caseNumber` به پاسخ API اتاق کنترل اضافه کرده است.

## ۵. ترتیب انتشار (روی سرور Manage، با کاربر `manage`)

```bash
cd /opt/manage
# ۱) پشتیبان و بازیابی آزمایشی طبق BACKUP_RESTORE
bash deploy/operational/backup-operational.sh

# ۲) تمرین migration روی نسخهٔ بازیابی‌شده (پایگاه موقت، نه Production)
#    پیش از اجرا: حساب‌هایی که 0020 غیرفعال می‌کند
#    select username, display_name, roles from users where is_active and not is_owner and roles = '{cashier}';
#    پس از اجرا: جدول drizzle migrations باید ۲۳ ردیف داشته باشد؛ اثرانگشت جدول‌های قبلی بجز users و
#    tenants.settings برابر بماند.

# ۳) کد و تصاویر همان commit
git fetch origin && git checkout <SHA نهایی main>
sha256sum -c preview-images.sha256
docker image tag manage-api manage-api:rollback-$(date +%Y%m%d)   # نگه‌داشتن نسخهٔ فعلی (شناسه‌ها در image-ids.txt پشتیبان هم هست)
docker image tag manage-web manage-web:rollback-$(date +%Y%m%d)
gunzip -c preview-images.tar.gz | docker load

# ۴) migration روی Production (پس از تأیید تمرین)
bash deploy/operational/operational-compose.sh run --rm api node dist/scripts/migrate.js   # 0020، 0021، 0022

# ۵) راه‌اندازی و سلامت
bash deploy/operational/operational-compose.sh up -d api web
curl -fsS https://managebyhedax.ir/api/v1/health      # status: ok، db: ok، commit = SHA نهایی
```

تصاویر `manage-api` و `manage-web` همان نام‌هایی‌اند که CI در `preview-images.tar.gz` ذخیره می‌کند؛ اسکریپت پشتیبان شناسهٔ تصاویر در حال اجرا را در `image-ids.txt` می‌نویسد.

## ۶. آزمون دود پس از انتشار (حدود ۱۰ دقیقه)

1. `/login`: فرم روشن راست، صحنهٔ کارگاه چپ؛ «ورود کارکنان» با پین و «ورود مدیر سیستم» با رمز و Authenticator.
2. یک کارشناس: میز کار با پوشه‌ها، «پیگیری‌های امروز»، باز کردن یک پرونده، تب‌ها، «قدم بعدی».
3. مسئول قطعات: «قطعات» در منوی کناری؛ فهرست خودروها، فهرست قطعات خودروی انتخاب‌شده، «وضعیت موجودی».
4. مدیر خدمات: «اتاق کنترل»؛ چهار عدد، جریان پرونده‌ها، نقشهٔ کارگاه (انتخاب یک جایگاه با کلیک یا Enter خودروهایش را نشان می‌دهد)، هشدارهای بی‌پاسخ با شمارهٔ پرونده، «تذکر».
5. تکنسین روی گوشی: اجرت ماه، کار فعلی، یک دکمهٔ بزرگ.
6. مدیر سیستم: «تنظیمات» و بازبینی سقف هشدارها.
7. ثبت در «Deployment log» در [DEPLOYMENT](DEPLOYMENT.md): تاریخ، SHA، اجراکننده، migrationها، نتیجه.

## ۷. بازگشت (rollback)

- **پیش از migration:** فقط تصاویر `rollback-…` را برگردانید و `up -d` کنید.
- **پس از migration:** تصاویر `rollback-…` را برگردانید **و** پایگاه را از پشتیبان مرحلهٔ ۱ بازیابی کنید ([BACKUP_RESTORE](BACKUP_RESTORE.md)). نسخهٔ قبلی نقش‌های شش‌گانه را نمی‌شناسد؛ پس بازگشت بدون بازیابی پایگاه مجاز نیست.
```bash
docker image tag manage-api:rollback-<تاریخ> manage-api
docker image tag manage-web:rollback-<تاریخ> manage-web
bash deploy/operational/operational-compose.sh up -d api web
curl -fsS https://managebyhedax.ir/api/v1/health      # commit = نسخهٔ قبلی (cc1d7e1)
```

- فایل‌های down در `apps/api/src/db/down` فقط برای پایگاه‌های آزمایشی‌اند (روی PostgreSQL 16 آزموده شده‌اند)، نه Production.

## ۸. چیزهایی که پیش از انتشار باید سبز شود

- هر شش job CI روی commit ادغام‌شده (مستندات، lint/typecheck/build/unit+integration، migration و seed روی PostgreSQL 16، Playwright، Docker و compose smoke، audit و secret scan).
- بازبینی مالک بر تصاویر Playwright و [مقایسهٔ تصویرها](design/p9/) و گزارش آزمون ([TEST_REPORT](TEST_REPORT.md)).
