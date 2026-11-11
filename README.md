<div align="center">

<img src="apps/web/public/brand/logo-light.png" alt="Manage by HEDAX" width="300">

### از پذیرش تا تحویل، با دید روشن.

سامانهٔ یکپارچهٔ مدیریت عملیات نمایندگی‌های خودرو

[English](README.en.md) · [راهنمای کاربر](docs/USER_GUIDE_FA.md) · [معماری](docs/ARCHITECTURE.md) · [API](docs/API.md) · [نقشهٔ راه](docs/ROADMAP.md) · [وضعیت پیشرفت](PROGRESS.md)

</div>

منیج یک سامانهٔ **داخلی و مکمل** برای نمایندگی است، نه جایگزین سامانه‌های رسمی ایران‌خودرو و امداد خودرو. هر خودروی تصادفی یک مسیر روشن دارد، هر نفر فقط کار خودش را می‌بیند و مدیر می‌بیند گلوگاه کجاست. منیج تأیید رسمی را فقط **ثبت** می‌کند و هیچ‌وقت صادر نمی‌کند. رابط فارسی و راست‌به‌چپ است و ساختار داده از روز اول برای چند نمایندگی و چند برند جا دارد.

**منبع واحد حقیقت:** [سند جامع محصول](docs/PRODUCT_SPEC_FA.md) و [ماکاپ‌های تأییدشده](docs/design/mockups/). هرجا کد یا مستند دیگری با سند فرق دارد، سند درست است.

**وضعیت:** ماژول اول (خودروهای تصادفی) در نمایندگی ۱۳۰۷ ایران‌خودرو قم در حال استفاده است. جزئیات هر انتشار در [CHANGELOG.md](CHANGELOG.md) و وضعیت جاری در [PROGRESS.md](PROGRESS.md).

<p align="center">
  <img src="docs/screenshots/readme-dashboard.jpg" alt="داشبورد مدیر خدمات" width="74%">
  &nbsp;
  <img src="docs/screenshots/readme-cases-mobile.jpg" alt="فهرست پرونده‌ها روی گوشی" width="22%">
  <br><sub>تصاویر با دادهٔ ساختگی.</sub>
</p>

## شش نقش

| نقش | کار اصلی | ورود |
| --- | --- | --- |
| کارشناس تصادفات (چند نفر) | پذیرش، کارشناسی و الحاقیه، برنامهٔ تعمیر و اجرت، تأیید پایان هر جایگاه، کنترل نهایی، پیش‌پرداخت، صورت و تحویل | نام کاربری + پین ۴ رقمی |
| مسئول قطعات | تعیین تکلیف هر قطعه، رزرو، امداد ویژه، خرید بازار، قیمت، کار بیرون، صورت نهایی | نام کاربری + پین ۴ رقمی |
| تکنسین جایگاه | شروع و پایان کار، «قطعه ندارم»، تذکر — روی گوشی | نام کاربری + پین ۴ رقمی |
| مدیر خدمات | فقط دیدن، تحلیل و تذکر (اتاق کنترل) | نام کاربری + پین ۴ رقمی |
| مدیر سیستم | باز کردن گره کار، رفع ایراد، تنظیم سقف‌ها، بارگذاری گزارش‌ها، انجام کار به‌جای هر نقش | ایمیل + رمز + Google Authenticator |
| مالک | همهٔ دسترسی‌ها و کارهای حساس؛ پرچم حساب، نه نقش جدا | از همان در مدیر سیستم |

## مسیر یک خودرو

پذیرش ← نوع پوشش (کارت طلایی، بیمه، شخصی) ← کارشناسی ← **دو کار موازی:** تأمین قطعه (مسئول قطعات) و مسیر تعمیر (کارشناس + تکنسین) ← صورت نهایی (مسئول قطعات) ← پایان کار (کارشناس تصادفات).

| بخش | آنچه منیج انجام می‌دهد |
| --- | --- |
| پذیرش و کارشناسی | پذیرش رسمی یا دستی، کارشناسی و الحاقیه تکی یا از اکسل با پیش‌نمایش و ضدتکرار |
| قطعات | **یک فهرست قطعه برای هر خودرو**؛ رزرو از موجودی با کد ۸+۲ رقمی، امداد ویژه با شمارهٔ درخواست، خرید بازار؛ وضعیت امداد ویژه خودکار از گزارش روزانه؛ تحویل به جایگاه؛ مرجوعی و لغو با علت |
| موجودی | موجودی قابل‌استفاده = گزارش امروز − رزروهای فعال − تحویل‌شده‌های پرونده‌های باز |
| تعمیر | توالی آزاد قدم‌ها (جایگاه، روز، اجرت، نفر)؛ شروع و پایان با تکنسین، تأیید با کارشناس |
| هشدار و تذکر | هشدار هزینهٔ قطعات با سقف قابل تنظیم، امداد دیرشده، عقب‌تر از برنامه؛ تذکر از هر نفر به هر نفر؛ هیچ هشداری کار را قفل نمی‌کند |
| اتاق کنترل | چهار عدد اصلی، قیف مسیر و گلوگاه، نقشهٔ زندهٔ کارگاه، تحلیل امروز، عملکرد افراد |

ورود کارکنان: دعوت خصوصی، انتخاب رمز شخصی، اتصال Google Authenticator. [راهنمای ورود](docs/PERSONAL_AUTH_FA.md) · [کارکنان و دسترسی‌ها](docs/STAFF_FA.md).

## اجرای محلی (بدون Docker و بدون نصب PostgreSQL)

پیش‌نیاز: Node.js 22 یا جدیدتر و pnpm 10.

```bash
git clone https://github.com/ali-hedax/manage-dealership-platform.git
cd manage-dealership-platform
git switch main
pnpm install --frozen-lockfile
pnpm dev
```

- وب: <http://localhost:3000> و API: <http://localhost:4000/api/v1/health>
- در اولین اجرا یک نمایندگی نمونه با داده کاملاً ساختگی ساخته می‌شود. نام‌های کاربری (`expert`، `supervisor`، `manager`، `parts`، `cashier`، `qc`، `admin`) و رمز مشترک در فایل `apps/api/.data/demo-credentials.local.txt` نوشته می‌شود؛ این فایل در Git ثبت نمی‌شود.
- پایگاه داده محلی PGlite (PostgreSQL تعبیه‌شده) در `apps/api/.data/` است. برای شروع دوباره: `pnpm --filter @manage/api build && pnpm db:reset-demo`.

## نسخه Preview محلی (برای آزمایش با مرورگر)

```bash
pnpm install
pnpm preview
```

- نشانی: <http://localhost:3100> (نسخه build‌شده، داده ساختگی ماندگار). رمز حساب‌های نمونه در `apps/api/.data/preview/credentials.local.txt` است.
- `pnpm preview --reset` داده نمونه را از نو می‌سازد؛ `pnpm preview --lan` برای باز کردن با گوشی در همان شبکه است.

## اجرای کامل با PostgreSQL (Docker)

```bash
cp .env.example .env    # POSTGRES_PASSWORD و SEED_DEMO_PASSWORD را تعیین کنید
docker compose up -d --build
```

وب روی پورت `WEB_PORT` (پیش‌فرض ۳۰۰۰). جزئیات و نکات امنیتی در [DEPLOYMENT.md](docs/DEPLOYMENT.md).

## آزمون

```bash
pnpm test        # آزمون واحد و یکپارچه (API روی PostgreSQL تعبیه‌شده)
pnpm build
pnpm test:e2e    # Playwright؛ روی ویندوز از Edge نصب‌شده استفاده می‌کند
```

نتیجه آخرین اجرا در [TEST_REPORT.md](docs/TEST_REPORT.md).

## ساختار

```
apps/api         NestJS + Drizzle + PostgreSQL — قواعد کسب‌وکار، دسترسی، Audit
apps/web         Next.js — رابط فارسی راست‌به‌چپ
packages/shared  قراردادهای مشترک: نقش‌ها و مجوزها، اعتبارسنجی، تاریخ شمسی
docs/            معماری، پایگاه داده، فرایندها، استقرار، امنیت، آزمون
legacy/          نمونهٔ اولیهٔ تک‌فایلی قدیمی، دست‌نخورده
```

## نمونهٔ اولیهٔ قبلی

فایل `legacy/index (4).html` نمونهٔ اولیهٔ تک‌فایلی قبلی است و بدون تغییر نگه داشته شده؛ محصول فعلی به آن وابسته نیست. [مراحل مهاجرت قابلیت‌ها](docs/PROTOTYPE_MIGRATION.md).

## مستندات

[سند محصول](docs/PRODUCT_SPEC_FA.md) · [AGENTS.md](AGENTS.md) · [CLAUDE.md](CLAUDE.md) · [PROGRESS.md](PROGRESS.md) · [CHANGELOG.md](CHANGELOG.md) · [CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) · [ARCHITECTURE](docs/ARCHITECTURE.md) · [DATABASE](docs/DATABASE.md) · [WORKFLOWS](docs/WORKFLOWS.md) · [OFFLINE_SYNC](docs/OFFLINE_SYNC.md) · [DEPLOYMENT](docs/DEPLOYMENT.md) · [BACKUP_RESTORE](docs/BACKUP_RESTORE.md) · [ROADMAP](docs/ROADMAP.md) · [چک‌لیست سرور برای IT](docs/IT_SERVER_CHECKLIST_FA.md)

## حقوق

© هداکس. همهٔ حقوق محفوظ است. این مخزن مجوز متن‌باز ندارد و اجازهٔ بازنشر کد یا هویت برند را نمی‌دهد. نگهدارنده: [ali-hedax](https://github.com/ali-hedax).
