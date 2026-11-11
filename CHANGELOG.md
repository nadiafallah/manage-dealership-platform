## 2026-11-11 — کیفیت و تحویل (بستهٔ ۸)

- دادهٔ نمونهٔ واقع‌نما: ۱۵ خودروی ساختگی دیگر (جمعاً حدود ۲۰) در همهٔ مرحله‌ها، پنج جایگاه، سه تکنسین جایگاه، امداد ویژهٔ دیرشده، خرید بازار رسیده، قطعهٔ گران، اعلام قیمت، «قطعه ندارم» بی‌پاسخ، قدم عقب‌تر از برنامه و کار منتظر تأیید؛ همه از سرویس‌های واقعی با ممیزی. `DEMO_FLEET=false` فقط پنج خودروی پایه را می‌سازد (پیش‌فرض مجموعهٔ Playwright).
- آزمون‌ها: `demo-fleet.e2e-spec.ts` و `role-journeys.spec.ts` (مسیر هر نقش با تصویر دسکتاپ و ۳۹۰px).
- مستندات: [راهنمای کاربر](docs/USER_GUIDE_FA.md) از نو، [TEST_REPORT](docs/TEST_REPORT.md)، گزارش نهایی و دستور استقرار در [PROGRESS](PROGRESS.md).

## 2026-11-10 — اتاق کنترل، هشدارها و تذکر (بستهٔ ۷)

- اتاق کنترل مدیر خدمات و مالک (`GET /api/v1/control-room?range=today|week|month`، صفحهٔ `/control-room` و میز مدیر خدمات/مالک): چهار عدد اصلی، قیف مسیر با میانگین روز در هر مرحله و گلوگاه گرم، نقشهٔ ایزومتریک زندهٔ کارگاه با سه رنگ (طبق برنامه / عقب‌تر / متوقف) و کلیک به پرونده، «تحلیل امروز» در سه تا پنج جملهٔ قاعده‌محور بدون تعیین تقصیر، عملکرد افراد (کارشناس‌ها، مسئول قطعات، هر جایگاه) و هشدارهای بی‌پاسخ با مدت انتظار، قدیمی‌ترین بالا. تنها اقدام: «تذکر».
- جدول کامل هشدارهای بخش ۹ با گیرنده و پاسخ (`ALERT_TABLE`)؛ سه هشدار زمانی تازه با اعلان یک‌باره: «گزارش امداد ویژهٔ امروز بارگذاری نشده» ساعت ۱۲، «امداد ویژه دیر شده» بعد از N روز (قابل تنظیم) و «عقب‌تر از برنامه».
- تذکر می‌تواند به یک قلم قطعهٔ همان خودرو وصل شود (migration 0022، برگشت‌پذیر)؛ دکمهٔ «تذکر دربارهٔ این قطعه» در فهرست قطعات.

## 2026-11-10 — لایهٔ نمایش جدید (بستهٔ ۶)

- یک زبان طراحی ([docs/design/DESIGN_SYSTEM.md](docs/design/DESIGN_SYSTEM.md)): فضای کاغذی برای میزها، پوشهٔ پرونده و تکنسین؛ فضای تیره برای ورود و اتاق کنترل. پوستهٔ «Signature» و سوییچ `?ui=classic` حذف شدند.
- میز هر نقش = کارت پوشه برای هر خودرو (زبانهٔ پوشش، منگنه، پلاک بزرگ، «پرونده … · پذیرش …»، جایگاه فعلی، روز در تعمیرگاه، یک خط «قدم بعدی») با سلام «صبح بخیر، …»، شمار «منتظر اقدام شما»، صافی‌ها و جست‌وجو. «قدم بعدی» با قاعدهٔ ثابت از داده ساخته می‌شود (`GET /api/v1/desk/folders`).
- میز مسئول قطعات: فقط خودروهای دارای قلم باز با شمارش «تعیین تکلیف نشده · در جریان · آمادهٔ تحویل · امداد دیرشده» روی کارت. میز مدیر سیستم: «گره‌ها»، وضعیت بارگذاری گزارش‌ها و دسترسی به هر پرونده.
- پوشهٔ پرونده به‌جای صفحهٔ ۹ بخشی: سربرگ (نام کوتاه، پوشش، مشتری، روز در تعمیرگاه، پلاک، شماره‌ها)، نوار مسیر ۵ مرحله‌ای، تب‌های «کار امروز · کارشناسی · قطعات · مدارک · تاریخچه» و کارت «قدم بعدی شما» مخصوص نقش. پیوندهای `#case-…` تب مربوط را باز می‌کنند؛ چاپ همهٔ تب‌ها را چاپ می‌کند.
- ورود با صحنهٔ تیرهٔ سه‌بعدی (پوشه‌های شناور، کف شبکه‌ای) و دو در؛ حرکت فقط وقتی کاربر کاهش حرکت نخواسته باشد.
- جست‌وجوی بالای صفحه با Ctrl+K؛ هر صفحه دکمهٔ بازگشت دارد.

## 2026-11-10 — مسیر تعمیر و کارتابل تکنسین (بستهٔ ۵)

- «ساخت مسیر تعمیر» در پروندهٔ خودرو: قدم‌های آزاد و مرتب با واحد/جایگاه، نفر، روز کاری و اجرت؛ یک جایگاه می‌تواند دو بار بیاید؛ «هم‌زمان با قبلی»؛ جابه‌جایی ترتیب؛ مدت کل خودکار (مثال سند: ۸ روز). همهٔ قدم‌ها و اجرت‌ها در یک تراکنش با ثبت ممیزی (`POST /api/v1/cases/:id/repair-plan/steps`).
- کارتابل تکنسین طبق ماکت: اجرت این ماه بالای صفحه، کارت کار فعلی با پلاک، وقت باقی‌مانده و اجرت؛ یک دکمهٔ بزرگ که «شروع کار» ← «پایان کار» ← «تمام شد. منتظر تأیید کارشناس» می‌شود؛ «قطعه ندارم» با یک لمس؛ «قطعه آماده است، تحویل بگیرید»؛ فهرست کارهای بعدی با اجرت.
- «قطعه ندارم» و «قطعه دیر شده» تکنسین علاوه بر کارشناس خودرو به مسئول قطعات هم می‌رسد.

## 2026-11-10 — فهرست واحد قطعات و موجودی قابل‌استفاده (بسته‌های ۳ و ۴)

- هر خودرو یک فهرست قطعه دارد (`docs/PARTS_LIST_FA.md`): سطر بسته با نام، تعداد، نشان «الحاقیه»، وضعیت با تاریخ و تنها دکمهٔ معتبر؛ جزئیات کشویی؛ جست‌وجو و صافی‌های «تعیین تکلیف نشده · در جریان · آمادهٔ تحویل · تحویل‌شده».
- ماشین وضعیت سند سمت سرور و سمت کاربر؛ اقدام نامعتبر با پیام فارسی رد می‌شود.
- امداد ویژه با شمارهٔ درخواست اجباری؛ گزارش روزانه قطعه را خودکار «آمادهٔ تحویل» می‌کند یا برای «تأمین توسط نمایندگی» به مسئول قطعات خبر می‌دهد.
- خرید بازار با فروشنده، قیمت خرید و قیمت فروش؛ ثبت رسید؛ تحویل به جایگاه؛ لغو و مرجوعی با علت اجباری.
- قیمت آزاد و بی‌پیام؛ «اعلام قیمت» اختیاری با پاسخ کارشناس (تأیید یا دستور دیگر).
- ضدتکرار با کد فنی برای افزودن تکی و ورود اکسل (با پیش‌نمایش تکراری‌ها).
- موجودی قابل‌استفاده طبق فرمول سند؛ با پایان کار پرونده کسر خودکار متوقف می‌شود و دکمهٔ دستی انعکاس حذف شد؛ نشان «رزرو فعال برای پروندهٔ …» روی گزینه‌های موجودی.
- خواندن مقاوم گزارش موجودی کسب‌وکار (جدول HTML با پسوند xls، فاصله قبل از `<html>`، حروف عربی، charset ویندوز).
- میز مسئول قطعات: `GET /api/v1/parts/desk` خودروهای دارای قلم تعیین تکلیف‌نشده، در جریان یا آمادهٔ تحویل را با شمارش برمی‌گرداند.

## 2026-11-10 — هشدار هزینه به‌جای روال پیش‌پرداخت (بستهٔ ۲)

- روال قبلی «پیشنهاد کارشناس ← تأیید مدیر خدمات ← دریافت صندوق ← استثنا با سقف» و ثبت دریافت تسویه خاموش شد؛ مسیرهای API پاسخ `FINANCE_FLOW_RETIRED` می‌دهند و سابقهٔ قبلی فقط‌خواندنی می‌ماند.
- دو هشدار غیرمسدودکننده برای کارشناس تصادفات: «هزینهٔ قطعات از سقف گذشت» (پیش‌فرض ۱٬۰۰۰٬۰۰۰٬۰۰۰ ریال، هر مضرب تازه دوباره می‌پرسد) و «قطعهٔ گران» در خودروی شخصی (پیش‌فرض ۵۰۰٬۰۰۰٬۰۰۰ ریال برای یک قلم). جواب: گرفتم / نگرفتم / لازم نیست.
- صفحهٔ تنظیم سقف‌ها برای مدیر سیستم و مالک با کنترل بالا/پایین؛ روزهای «امداد ویژهٔ دیرشده» هم همین‌جا تنظیم می‌شود.
- بستن مالی دیگر به سهم مشتری، مانده یا پیشنهاد مالی وابسته نیست؛ فاکتور رسمی در سامانهٔ حسابداری صادر می‌شود.

## 2026-11-10 — شش نقش طبق سند (بستهٔ ۱)

- نقش‌ها پنج کد به‌علاوهٔ پرچم مالک شدند: کارشناس تصادفات، مسئول قطعات، تکنسین جایگاه، مدیر خدمات، مدیر سیستم؛ مالک پرچم حساب است.
- «مسئول تصادفات»، «سرپرست» و «کنترل کیفیت» به کارشناس تصادفات تبدیل شدند. نقش «صندوق» حذف شد و کارش به کارشناس تصادفات رسید؛ حسابی که نقشی برایش نماند حفظ و غیرفعال می‌شود (migration 0020، برگشت‌پذیر).
- مجوزهای هر نقش طبق جدول سند: ثبت مجوز پرداخت‌کننده با کارشناس تصادفات است، نه مسئول قطعات؛ مسئول قطعات گزارش روزانه را خودش ثبت نهایی می‌کند؛ مدیر خدمات فقط می‌بیند و تذکر می‌دهد؛ مدیر سیستم می‌تواند هر کاری را به‌جای هر نقش انجام دهد.
- الگوهای دسترسی سمت‌ها به پیش‌فرض سند برگشتند؛ استثناهای شخصی حفظ شدند.
- صفحهٔ ورود: «ورود کارکنان» و «ورود مدیر سیستم»؛ کلمهٔ «مالک» در صفحهٔ ورود نیست.
- میزهای «مالی و صندوق» و «کنترل کیفیت» حذف شدند؛ همه کارشناسان تصادفات همهٔ پرونده‌ها را می‌بینند.

## 2026-11-10 — سند جامع محصول به‌عنوان منبع واحد (بستهٔ ۰)

- سند جامع تأییدشده در `docs/PRODUCT_SPEC_FA.md` و ماکاپ‌های تأییدشده در `docs/design/mockups/` قرار گرفت؛ `AGENTS.md`، `CLAUDE.md` و README به آن ارجاع می‌دهند.
- PROGRESS قدیمی به `docs/archive/PROGRESS_2026-11.md` رفت و PROGRESS.md کوتاه تازه ساخته شد.
- نمونهٔ اولیهٔ تک‌فایلی بدون تغییر به `legacy/` منتقل شد.


## 2026-11-09 — یک روش ورود برای همهٔ کارکنان (PR #74)

- صفحهٔ ورود فقط دو گزینه دارد. پیش‌فرض «ورود کارکنان» است: نام کاربری و رمز ۴ رقمی. گزینهٔ دیگر «ورود مالک و مدیر سیستم» است: ایمیل، رمز و Google Authenticator.
- همهٔ سمت‌های عملیاتی با رمز ۴ رقمی وارد می‌شوند: مدیر خدمات، مسئول تصادفات، قطعات، مالی و صندوق، کنترل کیفیت و تعمیرکار.
- در نشست رمز ۴ رقمی، دسترسی‌های همان سمت حفظ می‌شود. فقط مدیریت کاربران و تنظیمات در آن نشست نیست.
- ساخت همهٔ کارکنان یک فرم دارد: نام، سمت، نام کاربری، رمز ۴ رقمی و رمز ثبت دستگاه. واحد و جایگاه فقط برای تعمیرکار پرسیده می‌شود.
- زبانهٔ «حساب‌های قدیمی و دعوت‌ها» حذف شد. دعوت با ایمیل فقط برای مدیر سیستم مانده است.
- حساب‌های غیرفعال و نمونه از فهرست فعال بیرون رفتند و در بخش جمع‌شدهٔ «حساب‌های غیرفعال و بایگانی» هستند.

## 2026-11-08 — Additional supply-source and station ownership refinements (PR #70)

- Parts workbench now shows collapsible vehicle parts; each needed part has an explicit choice: reserve from exact available stock location, buy from market, or submit emergency/company order. Stock availability is informative and does not force a supply source.
- Market purchasing distinguishes quote proposal from recorded purchase; the existing official-payer and finance gates remain server-side.
- Parts clerk can view and record an actual quoted-price response, including to their own proposal, with required payer source/reference and audit. Financial advance-payment approval remains separate, and PIN session high-trust permission restrictions remain intact.
- Every part lists possible repair destinations. The staff member chooses an exact active task/station; the server validates it belongs to the case (and if blockers exist, to the blocked task) before notifying assigned technician, station responsible, case responsible, accident supervisor and other parts staff. The receipt is still recorded only on physical pickup/handover.
- Added API tests for station isolation and quoted-price self-registration (with official reference required).
- Latest CI result must be checked before merge: prior run found and fixed one TypeScript narrowing error; no direct local build or Production deploy performed.
# Changelog

## 2026-11-09 — HEDAX Signature visual layer (PR #62, integrated in #72)

- New default look: dark mineral ground, graphite plates with machined edges, a champagne key light and restrained blue. The navigation rail sits above the workspace and the active destination is lit. Opened case sections rise as an inspector, and dialogs enter as a separate layer. Desk cards respond to the pointer.
- The dashboard opens with an operations view: the share of active cases within their deadline, plus overdue, blocked, due-within-48-hours and ready-for-delivery figures. Each figure links to the existing filtered case list.
- Redrawn engineered icon set. The sign-in screen has a showroom plinth and a one-time light sweep.
- The previous interface stays available: add `?ui=classic` to any address (remembered per browser) or build with `NEXT_PUBLIC_UI_THEME=classic`. Print keeps the light layout. Reduced-motion settings remove all motion.


## 2026-11-08 — ورود ساده کارکنان

- کارکنان عادی (تعمیرکار، قطعات، کنترل کیفیت) روی دستگاه ثبت‌شده با نام کاربری و رمز ۴ رقمی وارد می‌شوند؛ دستگاه تازه یک بار «رمز ثبت دستگاه» می‌خواهد.
- مالک در «کارکنان › ورود ساده (PIN)» کارمند را با نام، نام کاربری، رمز، رمز ثبت دستگاه و نقش می‌سازد، رمز را عوض می‌کند، غیرفعال می‌کند یا از همهٔ دستگاه‌ها خارج می‌کند؛ برای کارمند فعلی «فعال‌سازی ورود ساده» حساب تکراری نمی‌سازد.
- مالک و مدیر سیستم مثل قبل فقط با ایمیل و Google Authenticator وارد می‌شوند.



## 2026-11-08 — دریافت کامل کارشناسی چندصفحه‌ای

- **همهٔ صفحه‌ها:** گزارش کارشناسی چندصفحه‌ای با سربرگ تکراری هر صفحه و چند تاریخ پشت سر هم کامل خوانده می‌شود. ستون‌ها با عنوانشان شناخته می‌شوند، هر قلم تاریخ، واحد، صفحه و ردیف خودش را نگه می‌دارد و قطعه‌ای که در شرحش کلمهٔ سربرگ باشد دیگر حذف نمی‌شود.
- **پیش‌نمایش روشن‌تر:** خلاصهٔ صفحه‌ها، قطعات و اجرت‌های نهایی و ردشده، تاریخ‌ها و جمع‌ها. جمع قطعات، اجرت و مجموع با جمع چاپ‌شده در فایل مقایسه می‌شود و اختلاف مانع ورود است.
- **ردشده و اجرت معادل جدا:** ردیف‌های ردشده یا «درخواست اصلاح» و اجرت‌های معادل با وضعیتشان در بخش‌های جدا دیده می‌شوند و در سابقهٔ ورود می‌مانند. هیچ‌کدام قلم فعال، درخواست تأمین یا مبلغ تازه نمی‌شوند.

## 2026-11-07 — منیج پیشنهاد می‌دهد

- **یادآور گزارش روزانه:** جمعه و تعطیلات ثبت‌شده در تقویم نمایندگی دیگر یادآوری موجودی و امداد ویژه نمی‌سازد و «دیرکرد» نشان نمی‌دهد.
- **تقسیم کار در پرونده:** هنگام افزودن کار برای هر واحد، منیج تعداد روز را از کارهای واقعی قبلی (اول همان مدل خودرو) پیشنهاد می‌دهد، جایگاهی را که زودتر آزاد می‌شود با تعداد خودروهای در صف نشان می‌دهد و با یک دکمه در فرم می‌نشاند. تا سه کار واقعی ثبت نشده، مقدار پایه هر رشته نمایش داده می‌شود. ترتیب معمول واحدها هم نمایش داده می‌شود.
- **میز کار قطعه:** برای هر قطعه توصیهٔ قدم بعد نمایش داده می‌شود؛ از جمله وقتی میانگین رسیدن امداد ویژه از شروع واحد بعدی دیرتر است، بررسی خرید از بازار پیشنهاد می‌شود.

## 2026-11-07 — جایگاه تعمیرکار هنگام ساختن حساب

- **فرم افزودن تعمیرکار:** نام، واحد، کد جایگاه و رمز ۴ رقمی. کد تازه جایگاه را می‌سازد و کد آزادِ همان واحد به تعمیرکار سپرده می‌شود.
- **فهرست تعمیرکارها:** ستون «جایگاه» اضافه شد، مثل «صافکاری · B-01».

## 2026-11-07 — صفحهٔ کارکنان ساده شد

- **سه زبانه:** «کارکنان»، «تعمیرکارها» و «دسترسی‌ها» (فقط مالک)، به‌جای یک صفحهٔ بلند.
- **تعمیرکارها:** فقط نام و رمز ۴ رقمی. نام کاربری خودکار ساخته می‌شود (`tech01`، …) و بعد از ساختن، نام کاربری و رمز برای تحویل حضوری نشان داده می‌شود.
- **افزودن کارمند:** فرم پشت یک دکمه رفت. نقش «تعمیرکار» از سمت‌های کارمند ایمیلی حذف شد. وقتی ارسال ایمیل ممکن نیست، دکمهٔ اصلی «ساخت لینک دعوت خصوصی» است و یک خط علت را می‌گوید.
- **اختیارات مدیر سیستم:** جای «مرز مالک و مدیر سیستم» را گرفت، با یک سؤال ساده. گزارش اقدامات جمع شد.
- **میان‌برهای بالای صفحه:** به «افزودن کارمند» و «افزودن تعمیرکار» تغییر کردند.

## [2026-11-07] — phase 3 of the role-based plan (released to production, `be3dd66`)

- Anyone, technicians included, can send a short reminder (up to 300 characters or a ready-made text) to a person, several people or a role, optionally tied to a case or plate, normal or urgent. It appears as a card on top of the recipient's desk with «دیدم», «انجام شد» and a one-line reply; the sender sees sent / seen / done and the reply. A reminder not seen within two working hours sends a notification again. It is not a chat.
- The service manager has «تذکر» beside every report row and finding; it goes to the executive role (parts clerk, the case responsible or the accident coordinators), never to the manager.
- The technician's job card has «مشکل دارم» with four ready-made messages to the case's accident responsible, shows «اجرت شما» with a «تغییر کرد» label when it changes, and a bottom bar with this month's work.
- The accident coordinator records the technician's wage per job, independent from the assessment labour (optional «همان مبلغ کارشناسی»); each change needs a reason and stays in its history. «کارکرد من» lists the technician's approved jobs of a Jalali month with totals per golden card / insurance / personal. The service manager and the owner see paid wages against assessment labour per technician and month, with Excel.
- «انتقال پرونده» hands a case to another active accident coordinator; the responsibility bar shows who was responsible from when to when, and each coordinator's statistics follow their own period.
- The owner turns «دعوت و غیرفعال کردن کارکنان» on or off for each system administrator and alone sees the report of system-admin actions. The system administrator must give a reason for unlocking a technician, correcting a recorded value, moving a case back or transferring it.

## [2026-11-07] — phase 2 of the role-based plan (released to production, `be3dd66`)

- The parts clerk opens a prioritized vehicle workbench with stock, Emdad, market and handover actions. The prior queues remain available.
- The parts clerk or assigned technician can record a priced handover. The accident coordinator sees long waits.
- Confirmed consumption produces a versioned parts statement with Persian PDF and Excel exports.
- External work follows the repair plan, contractor coordination and coordinator approval, with missed promises in both workbenches.

## [2026-11-07] — phase 1 of the role-based plan, built 2026-11-05 (released to production, `be3dd66`)

- Technicians sign in with a username and a 4-digit PIN (no email or Authenticator) and see only their own work. Owner and system administrator create technicians, set a new PIN and deactivate them under «کارکنان». Five wrong PINs lock the account for 15 minutes.
- Money never blocks a part purchase. The finance state is still recorded and shown as a warning.
- The accident coordinator answers alerts with one tap («گرفتم / نگرفتم / لازم نیست»): advance not recorded, a costlier supplement after an advance, and parts total above the threshold (default 500,000,000 Rial, set by owner or system administrator in workshop settings; every further multiple asks again). Answers stay in the case history.
- Parts are priced freely. A recorded payer approval is needed only when golden card or insurance pays and the outside price is above the assessment-approved price.
- The technician card shows «قطعه آماده است؛ از انبار بگیرید» with the part names, and how many parts are still on the way.

## [2026-11-07] — navy and gold interface, built 2026-11-05 (released to production, `be3dd66`)

- The login, sidebar, dashboard and workspace selection use a navy-and-gold palette with clearer focus states and larger touch targets.
- The login screen separates staff sign-in from technician sign-in. Staff keep their existing sign-in, recovery and phone-install flows. The technician tab accepts a four-digit PIN, including pasted Persian or English digits, and displays an availability message until the separate server endpoint is enabled.

## [Published] — assessment dispatch and working-day repair plans, 2026-11-05

Application `79f6585` published after all six CI checks and restored-copy migration/data-preservation verification. Single/all assessment dispatch, duplicate-safe complete supplements, working-day intake and station shares are operational. Existing official approval history, outside-market quote controls, dates and user access are preserved. See [release record](docs/RELEASE_DISPATCH_DAYS_20261105.md).

## [In review] — assessment dispatch and working-day repair plans, 2026-11-05

- Select individual/all replacement lines in assessment and send needs directly to parts; show already sent quantities and dispatch only increases. Full supplement files reconcile prior exact codes and preserve previous versions; reductions/code changes with supply history require review.
- Recording assessments no longer creates a generic authorization wait. Outside-market purchases still require the exact approved quote; regular company supply follows its normal path.
- Enter repair duration in working days; the server calculates the forecast from a frozen dealership calendar. Allocate day shares to stations, automatically sequence dependencies and report the case budget without counting parallel allocations twice. Existing case dates remain unchanged until explicitly revised.
## [Unreleased] — platform states and search, 2026-11-05

- Quick case search in the sidebar from any page (plate, chassis or case number); press "/" to focus.
- Shared empty/permission state with icon, explanation and next step; branded "page not found" and error pages with retry.
- User avatar with initials in the account area.
- Repair plan page uses the same brand blue as the rest of the platform; neutral style for plain notices.
- Dashboard: duplicate desk card removed (the «ورود به میز کار» button remains); each «نیازمند اقدام» row ends in an arrow instead of a repeated «مشاهده».
- Case page: for overview roles (e.g. service manager) the section matching the current stage opens automatically, and «موانع» opens when blockers are open.

## [2026-11-07] — staff access recovery, built 2026-11-05 (released to production, `be3dd66`)

- The owner can make a private one-hour recovery link for a colleague who lost the password or Authenticator. The colleague sets a new password and reconnects Authenticator, and old sessions end. The owner account cannot use this path. Not yet on the server.

## [Unreleased] — interface polish, 2026-11-05

- SVG logo set (full lockup and compact wordmark); sidebar and phone bar show "by HEDAX" as readable text.
- Case, plate and admission numbers in Persian digits on every list and board.
- Removed developer text from the interface (local-sync line, documentation file name, repeated "no admission number" sentence).
- Tab title per area; distinct menu icons; hamburger icon on the phone menu button; duplicate logo removed from desk selection.

## [Unreleased] — login page refresh, 2026-11-05

- Login heading «ورود به حساب کاری», email label «ایمیل کاری», shorter guidance; product descriptor «سامانهٔ یکپارچهٔ مدیریت عملیات نمایندگی‌های خودرو» under the approved slogan.
- Show/hide password moved into the password field as an eye icon; «رمز را فراموش کرده‌اید؟» directly under the password; submit button no longer greyed out before typing (native required-field validation instead).
- Two-factor note under the continue button in personal (email + Authenticator) mode; install action restyled as a quiet phone link.
- Numbered route (01 پذیرش و کارشناسی · 02 تأمین و تعمیر · 03 کنترل و تحویل) and «محصولی از هداکس» signature on the brand panel. No API, auth or permission change.

## [Released on Manage] — production domain managebyhedax.ir, 2026-11-05

- Manage now answers at `https://managebyhedax.ir`, with 301 redirects from HTTP, `www`, the raw IP and the former temporary address. Staff sign in once more, and installed mobile apps need reinstalling from the new address. Invitation links use the new address.
- Removed the Preview wording from the site-gate page, which staff do not see while Authenticator sign-in is on. It reaches the server with the next release.
- Traffic now passes through the ArvanCloud proxy. Login limits, sessions and audit records keep each visitor's real address.

## [Released on Manage] — entry and operational workbench, 2026-11-05

- Refined Persian login and explicit selection among permitted desks, with a consistent return destination and fewer duplicate menu entries.
- Case flags folded behind filters, applied criteria visible; exact-code stock reservation placed beside the actual part request instead of repeating every part below it.
- Iran public-holiday suggestions from Google, excluding observances and flagging tentative dates; local ICS fallback when the server cannot reach Google. Reviewed changes use existing versioned calendar save; personal calendars and previous repair plans are not changed.
- Owner-authorized `ad54f15` published after all six CI checks and verified restores; 40-second switch with existing data/auth/permissions preserved. Direct Google access from the host currently times out; file fallback is available. [Release evidence](docs/RELEASE_ENTRY_20261105.md).

## [Released on Manage] — short vehicle labels in case lists, 2026-11-05

- Case lists and accident-desk queues show brand/model name above the owner name, omitting the long manufacturer trim and explicit engine/gearbox annotations embedded in model cells. Full model/trim and search/detail data are retained.
- Published owner-approved `696eb6f` using exact verified CI images, restored backups and preserved data/authentication/settings; final switch 35 seconds. [Release evidence](docs/RELEASE_SHORT_LABEL_20261105.md).

## [Released on Manage] — assessment intake and compact case workbench, 2026-11-04

- Added header-driven XLSX assessment preview/import for sparse PDF-copy tables, separate labour and parts, explicit currency, rejected/correction/equivalent-row review, validation and atomic versioned audited draft insertion.
- Collapsed secondary case information, part stock suggestions, Emdad, reservations, evidence and tracking; preserved role-specific primary work, deep links, printing and all permissions. Desk overflow actions remain available on demand.
- Scoped case/part Emdad results to relevant technical codes in the API, keeping independent history intact. Added exact vehicle-history lookup and safe repeat-admission profile prefill without copying prior damage, coverage, money or workflow.
- Published owner-approved `d0a66b2` using the exact verified CI images, with restored backups, unchanged data/authentication/settings and a 39-second switch. No database migration, dependency/account change, main merge, DNS or email configuration. [Release record](docs/RELEASE_ASSESSMENT_20261104.md).

## [Released on Manage] — online mobile installation, 2026-11-04

- Added installation metadata and existing-brand Android/Apple icons, standalone display, role-aware launch, optional browser installation and manual Safari instructions from login and account menus.
- Added a network-loss warning; technician actions still require a successful server response and clear earlier success text before retrying. No offline queue, service-worker data cache or phone Push is included.
- Public branding metadata passes the personal-auth gate while launch and operational APIs remain protected. Published tested `9e82246` with verified backups and existing authentication/data preserved. [Installation guide](docs/PWA_FA.md), [release record](docs/RELEASE_PWA_20261104.md). Native installation on actual phones remains to be checked.

## [Released on Manage] — complete system support desk, 2026-11-04

- Grouped system support work into daily reports/parts, cases/repairs and oversight/support; added searchable case queue and permission-gated access to operational desks while keeping the owner desk protected.
- Separately, the owner requested all operational permissions for the existing real system-admin template (32→45); applied through the owner UI and backed up. The owner flag and owner-only API protections remain separate. Daily reminders include the newly authorized uploader at the configured due time. [Guide](docs/SYSTEM_ADMIN_FA.md).
- Preserved a later personal denial of staff administration during release: the template has 45 operational permissions and the current support account has 44 effective permissions. Existing owner-only controls remain enforced.

## [Released on Manage] — accident workflow redesign, 2026-11-04

- Unified accident coordinator desk and default responsibilities; parts operations remain with parts, the service manager receives reporting access, and system support assists operations without owner-only access administration. Existing accounts and custom access templates are not migrated.
- Added coded repair stations, an effective-dated Tehran work calendar, explicit holiday review, working-minute planning, parallel/dependent repair work, immutable original deadlines and recorded rescheduling reasons.
- Added a restricted technician phone page for assigned start/end actions, separate coordinator handover confirmation, station delay/transfer reports and per-case union of blocker intervals.
- Added parts market quotes and coordinator-recorded payer decisions; purchase requires matching, unexpired authorization, including price increases above the assessment. Customer receipts and release authority belong to the coordinator; spending exceptions remain separately controlled.
- Station-code filtering now follows the report into matching case lists, event counts, Excel and Persian PDF; unknown station codes are explicitly shown as unknown.
- Published tested `880b121` with all six CI checks passing; restored-copy migration and final backup recovery verified, existing records and authentication preserved. Owner saved the weekly work schedule and separately approved five additions to the existing system-support template. Added the [Persian workflow guide](docs/ACCIDENT_WORKFLOW_FA.md) and [release record](docs/RELEASE_ACCIDENT_20261104.md). Actual station codes, reviewed holidays and technician phone/LAN rollout remain operational setup.

## [Released on Manage] — daily parts reports, 2026-11-03

- Published tested 40b389f (CI 41614528596, all six jobs successful) with the operational environment and existing accounts/cases preserved. Added daily stock/Emdad upload and review, exact-SKU reservations/reconciliation, audited family aliases, internal 11:00 Tehran reminders and a Persian staff guide.
- Owner's stock definitions saved: rial, excluding tax, full physical dealership stock; zero quantity omitted from selection without deleting commitments/history. Supplied files are format samples only and were not activated in production. Fresh exports are the next user step. Main remains unmerged.

## [Unreleased] — branch `feature/daily-parts-reports`

- Owner-confirmed stock definitions: full dealership physical stock, rial prices excluding tax. Zero-quantity items remain in history but are omitted from stock options; reservations are retained for shortfall review.

- Stock option balances and daily totals refresh after reservation, issue and release actions. Daily report desk links apply the matching due/review filters.
- Nonstandard stock codes support an audited, versioned human family alias without rewriting source codes, stock quantities or reservation history (0013). Unmapped codes remain independent.
- Added Persian staff guide and recorded the owner's rial/full-warehouse/physical-quantity definitions. Tax inclusion is still unknown. Not deployed.

- در دست ساخت و منتشرنشده: بارگذاری روزانه موجودی انبار و امداد ویژه، رزرو داخلی با انتخاب کد کامل، پیگیری امداد و یادآوری داخلی ساعت ۱۱ تهران. API روی شاخه ثبت شده و رابط کاربری هنوز کامل آزموده و commit نشده است؛ وضعیت در [HANDOFF_DAILY_PARTS.md](HANDOFF_DAILY_PARTS.md).

## [Unreleased] — branch `feature/department-workspaces`

- نسخه آزموده‌شده `e7319eb` با مجوز مالک روی Manage عملیاتی منتشر شد؛ حساب موجود مالک با ثبت تاریخی تعیین و پرونده‌ها، کاتالوگ، سوابق، رمزها و نقش‌های کارکنان حفظ شدند. پشتیبان پیش/پس از نصب و بازیابی تأیید شد.

- اصلاح پیوند مستقیم به بخش پرونده پس از بارگذاری غیرهم‌زمان؛ به‌روزرسانی داده در همان پرونده، موقعیت پیمایش کاربر را تغییر نمی‌دهد.

- منوی واحد تصادفات با پرونده/ثبت/گزارش و میزهای کار نقش‌ها، کارت‌های کار با آیکون و صف مرتبط، میان‌بر بخش‌های پرونده و نمایش جمع‌شده واحدهای آینده.
- پنل مالک برای تغییر الگوهای سمت و مجوز اضافه/ممنوع هر کارمند، بازبینی قبل ذخیره، اعمال در درخواست بعدی، حفاظت حساب مالک، کنترل هم‌زمانی و ثبت تاریخی. ماسک تماس بر اساس مجوز نهایی و جلوگیری از دعوت فراتر از مجوز مدیر غیرمالک.

All notable changes. Versions follow semantic versioning once releases start.

## [Unreleased] — branch `feature/reference-data`

- نسخه `a25292e` با مجوز مالک روی Manage عملیاتی نصب شد؛ ۴۷۰۴۵ کد قطعه و ۲۷۳۲ سابقه پذیرش وارد اطلاعات پایه شد، بدون ساخت پرونده یا تغییر موجودی انبار. پشتیبان پیش/پس از نصب و بازیابی تأیید شد. جست‌وجوی سابقه در ویرایش پرونده موجود نیز در دسترس است.

- افزایش ظرفیت فایل مرجع به پنج مگابایت با بخش‌های ۵۰۰۰تایی؛ نگهداری فقط ستون‌های انتخاب‌شده، کنترل تکرار کد در کل فایل، ورود ماهانه سوابق و نمایش پذیرش تاریخی همراه پرونده‌های منیج منطبق.
- رفع محدودیت ۸۰ نویسه‌ای شرح تیپ/مدل (اکنون ۱۰۰۰)، نام مشتری ۵۰۰؛ شرح تیپ چندخطی، خطاهای فارسی، پذیرش قابل ویرایش و نمایش هر دو شماره در فهرست، پرونده و گزارش Excel/PDF. پذیرش بدون شماره ایران‌خودرو همچنان با شماره منیج پیگیری می‌شود.

- «اطلاعات پایه»: ورود چند فایل کاتالوگ قطعات و سوابق مشتری/خودرو با انتخاب برگه، سربرگ و نگاشت ستون‌ها، پیش‌نمایش و گزارش فارسی تمام ردیف‌ها، کنترل تکرار و نسخه هم‌زمان، بدون ایجاد پرونده یا رزرو انبار.
- انتخاب کد/نام قطعه در فرم افزودن قطعه؛ جست‌وجوی دقیق شاسی/VIN و انتخاب سابقه در فرم پذیرش با تکمیل فقط خانه‌های خالی. حفاظت از شماره‌های متنی و مالکیت تاریخی، تفکیک مجوزها و نمای موبایل. [راهنما](docs/REFERENCE_DATA_FA.md).

## [Unreleased] — branch `feature/reports-center`

- شروع واقعی نمایندگی ۱۳۰۷ حسینی با تأیید مالک: حذف محدود پنج پرونده نمونه، غیرفعال‌سازی هفت حساب نمونه با حفظ حساب شخصی و تاریخچه، ورود پانزده خودرو و حفظ هشت ردیف نیازمند بررسی؛ حالت Production و پشتیبان روزانه با overlay مستقل. تصاویر برنامه همان نسخه آزموده‌شده‌اند. [راهنما](docs/REAL_START_FA.md).
- دعوت خصوصی اولین همکار با همه نقش‌های فعلی، بنا بر انتخاب صریح مالک؛ فعال‌سازی شخصی و Authenticator توسط خود همکار انجام می‌شود. ایمیل ارسال نشده است.

- «گزارش‌ها» در منو و میان‌بر در داشبورد، فهرست پرونده‌ها، قطعات و فعالیت‌ها: نماهای مدیر خدمات، انبار و قطعات، تصادفات، واحدهای تعمیر و کنترل کیفیت؛ نمای پیش‌فرض بر اساس نقش و کنترل دسترسی در API.
- «کارهای امروز» با اولویت موعد گذشته، امروز، نزدیک، بعدی و بدون موعد و دلیل اولویت؛ «آمار و روند» با حداکثر شش شاخص (واحد و تعریف)، نمودار مراحل، علل توقف، کامل‌بودن داده، سن پرونده، ماندن در مرحله (با شمار موارد کنارگذاشته)، روند پذیرش و تحویل و مقایسه با بازه هم‌طول قبل؛ هر شاخص و ستون به فهرست همان رکوردها متصل است و جدول جایگزین دارد.
- فیلترها در نشانی صفحه می‌مانند (بازگشت از پرونده)؛ خروجی Excel همه ردیف‌های فیلترشده با عنوان، زمان، بازه و فیلتر؛ چاپ سیاه‌وسفید.
- فهرست پرونده‌ها: فیلتر علت مانع و «عبور از مهلت رسمی»، «عبور از پیش‌بینی» و «بدون موعد». داشبورد «پرونده فعال» را درست می‌نامد. تعریف‌ها: `docs/REPORTS_FA.md`.

## [Unreleased] — branch `feature/vehicle-excel-import`

- ورود خودروهای موجود از اکسل (مدیر خدمات): خواندن برگه «لیست خودروها» با تشخیص خودکار سربرگ، پیش‌نمایش فارسی (جدید، به‌روزرسانی، بدون تغییر، تکراری، ناقص، نیازمند بررسی، خطا)، ثبت ردیف‌به‌ردیف، گزارش Excel نتیجه با شماره پرونده صادرشده و فایل نمونه ساختگی.
- تطبیق فقط با شماره پرونده، VIN کامل، شماره کارت پذیرش و شاسی ثبت‌شده؛ خانه خالی مقدار قبلی را پاک نمی‌کند؛ ورود دوباره پرونده یا وظیفه تکراری نمی‌سازد؛ تاریخ بدون ساعت فقط با تصمیم صریح و با نمایش «ساعت نامعلوم».
- پرونده: شماره کارت پذیرش و شاسی ثبت‌شده (قابل جست‌وجو) و «سابقه ورود از اکسل» با متن اصلی سلول‌ها. Migration افزایشی 0008.

## [Unreleased] — branch `fix/invitation-email-delivery`

- کارکنان: «بررسی اتصال ایمیل» (اتصال، TLS و احراز هویت فرستنده از همان سرور، بدون ارسال پیام) و نمایش علت شکست ارسال (اتصال مسدود، DNS، TLS، احراز هویت، رد گیرنده) زیر نام همکار؛ متن «ارسال شد» به «پذیرفته‌شده توسط سرور ایمیل» اصلاح شد.
- Migration افزایشی 0007 (`invitation_failure`)، اسکریپت `mail:check` و `deploy/preview/configure-smtp.sh` برای تنظیم خصوصی App Password روی سرور با بررسی پیش از فعال‌سازی و پشتیبان `.env`.

## [Unreleased] — staff email invitations

- Rename account administration to کارکنان. Owner enters name, email and roles, sends invitation email, sees activation/delivery state, and explicitly resends failed/expired invitations.
- Optional private-link invitation lets the owner onboard colleagues while email setup is unavailable; the UI explicitly states that no email was sent.
- Preserve personal password and TOTP enrollment; no SMTP link/token in email-endpoint responses or audit. Add private SMTP configuration and additive delivery-state migration 0006.
- Record owner-approved integration of platform PRs #16–#21 and #23 into main; legacy prototype work remains separate.

## [Unreleased] — repository documentation and preservation (2026-11-01)

- Reconcile bilingual setup guides with the current TypeScript platform, hosted personal login and owner-reported successful sign-in.
- Add API reference with controller route drift checks, gradual prototype migration plan, refreshed branch/CI audit and GitHub tracking guide.
- Preserve discovered local prototype tooling/docs separately; no runtime feature, schema or deployment changes.

## [Unreleased] — personal Preview authentication (2026-11-01)

- Email identifier and personal password followed by Google Authenticator, with private invitation links, QR enrollment and administrator invitation management. No SMTP or Google account configuration is needed.
- Encrypted TOTP seeds, one-use challenges and codes, rate limits, account lockout, tenant isolation and audited activation. Personal mode rejects shared-gate and password-only sessions.
- Protect personal Preview accounts from demo reset. Automatic password/factor recovery is not yet available; see docs/PERSONAL_AUTH_FA.md.
## [Unreleased] — branch `feature/qc-delivery`

### Added
- Quality control and delivery (issue #12): QC checklist per round (10 items; safety items cannot be skipped). A failed item needs a description and a unit, opens a corrective activity and returns the case to repair; a new round is required after any later change to the work.
- Technical close (supervisor/manager) only when all work is approved, no blocker is open, no draft or pending authorization remains, every approved replaced line has a part handed over to the unit and the latest QC passed. Labour without a matching approved activity is shown as a warning.
- Financial close (cashier/manager) as a separate gate: final assessment, known customer share, no pending finance proposal and the customer share received — or a service-manager decision to accept the remaining balance, with a reason. Settlement payments are recorded by the cashier with a receipt reference.
- Handover with recipient name and relation, time and the recipient's confirmation; needs both closes and archives the case (status closed, read-only). A close that no longer matches the case (reopened work, new share or estimate) must be repeated.
- Case page: "کنترل کیفیت و تحویل" panel with QC history and what still blocks each step; corrective activities are marked; history labels for the new events.

### Changed
- The stage selector can no longer set "آماده تحویل" or "تحویل‌شده"; they come from the technical close and the handover. Moving a closed case back into the workflow cancels its technical close.
- Demo case 5 shows a failed QC round, the corrective work, a passed round and the technical close; settlement and handover are left to try.

## [Unreleased] — isolated Preview deployment (2026-11-01)

- Preview updated with QC, corrective work, technical/financial close and handover (merge of PR #20 into the Preview branch only); demo data recreated.

- Dedicated ArvanCloud Preview with trusted HTTPS, password gate and synthetic data is available; see docs/PREVIEW_DEPLOYMENT_20261101.md. Source and Production remain unchanged.
- Fix Arvan SSH configuration precedence and socket-activated service startup; explicitly install Buildx, normalize application file umask, and keep generated credentials out of command logs.

## [Unreleased] — branch `feature/parts-finance`

### Added
- Parts lifecycle (issue #9): needs from authorized assessment lines, manual entry or .xlsx import with preview (synthetic sample download); stock check, reservation, order with supplier/price/ETA (first ETA kept), receipt with inspection (wrong/defective → re-order), handover to the repair unit, cancel — each with its time.
- Ordering requires the assessment line's authorization; a price above the approved price needs the assessor's approval reference.
- "Part not arrived" blockers can name the part; its handover resolves them and returns the activity to work.
- Financial gate (issue #10): payer shares, advance proposed by the expert, approved by the service manager (never their own proposal), receipt confirmed by the cashier; exceptions with a spending limit. Only part purchases are held; a supplement raising the estimate needs a new approval.
- Dashboard and case-list filters: waiting for authorization, overdue parts, parts not ordered, pending finance decision/receipt.
- Local Preview: `pnpm preview` (production build, persistent synthetic data, http://localhost:3100).

### Changed
- Login rate limit can be set with `LOGIN_RATE_LIMIT` (default unchanged: 10 per minute); the E2E suite raises it.

## [Unreleased] — branch `feature/assessment-parts`

### Added
- Versioned assessments and supplements (issue #8): initial assessment and supplements after hidden damage with replace/repair lines, part numbers, quantities, prices and labour per department, evidence references; the approved version is kept unchanged when a supplement is finalized.
- Authorization recording: source, method, official reference (required for golden card and insurer), partial approval per line; an «مجوز» blocker holds the case (and delivery) until the decision is recorded.
- A supplement can move the internal delivery forecast; the official deadline is untouched. Supplements that raise the cost are flagged for financial re-approval.
- Demo case 1 shows an approved assessment and a supplement waiting for authorization.
- History shows assessment changes with amounts in Rials. On phones the assessment lines are shown as stacked cards.

## [0.1.0] — Unreleased (branch `feature/accident-mvp`)

### Added
- Manage platform monorepo alongside the earlier prototype: `packages/shared`, `apps/api` (NestJS + Drizzle + PostgreSQL), `apps/web` (Next.js, Persian RTL).
- Login with roles (accident expert, accident supervisor, service manager, parts, cashier, QC, system admin); permissions enforced by the API; account lockout and rate limiting.
- Accident cases: vehicle and owner, coverage type and references, responsible person, official deadline vs forecast vs actual delivery, legacy entry with past admission, "needs completion" flags, search by plate/VIN/name/phone/number.
- Repair activities per department with dependencies, weights, planned/actual times; start, complete, supervisor approval, reopen with reason.
- Blockers with occurrence, recording, follow-up and resolution times; activity unblocks when its last blocker is resolved.
- Delivery gate (all activities approved, no open blockers).
- Manager dashboard: stage pipeline, attention list, blocker reasons, department load — each linked to the matching filtered list.
- Append-only audit trail (database trigger), change-log outbox, idempotency keys, optimistic locking.
- Synthetic demo dealership, auto-seeded in development/preview; reset script that removes only synthetic tenants.
- Iranian licence-plate display, Jalali date/time input in Tehran time, self-hosted Vazirmatn.
- Tests: shared unit tests, API integration tests, Playwright E2E (desktop + phone); CI with PostgreSQL 16, Docker compose smoke test, dependency audit and secret scan.
- Documentation set (architecture, database, workflows, offline sync design, security, deployment, backup/restore, roadmap, user guide, IT server checklist, GitHub audit).

### Security
- `drizzle-orm` raised to 0.45.x and `multer` overridden to ≥ 2.5.0 to clear high-severity advisories reported by `pnpm audit`.

## Preview browser sign-in compatibility — 2026-11-01

- Replace the native browser password challenge with an accessible Persian sign-in form and a signed secure cookie, preserving the Preview password and isolation. Actual in-app browser login to the manager dashboard was verified.

## [Unreleased] — reports stage 3b

- Persian A4 PDF reports with embedded Vazirmatn, dealership header, row-limit disclosure, repeated table header, multi-page long rows and page numbers.
- Parts discrepancy queue in warehouse and manager reports: deduplicated findings, assignee, reasoned outcomes, optimistic locking and tenant isolation. Detection, condition changes and review actions retain transactional audit/change history.
- CI exports the images it smoke-tests for an owner-approved Preview installation; CI does not deploy or connect to the server.
