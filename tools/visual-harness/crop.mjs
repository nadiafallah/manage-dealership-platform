// usage: node crop.mjs <as> <path> <width> <selector> <out.png> [dpr]
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? '@playwright/test');
const executablePath = process.env.CHROME_PATH || undefined;
const [as, path, width, sel, out, dpr] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: Number(width), height: 900 }, deviceScaleFactor: Number(dpr ?? 2), locale: 'fa-IR', timezoneId: 'Asia/Tehran' });
await page.goto(`http://127.0.0.1:4400${path}${path.includes('?') ? '&' : '?'}as=${as}`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(500);
await page.locator(sel).first().screenshot({ path: out });
await browser.close();
