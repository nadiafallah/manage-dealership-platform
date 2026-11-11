// usage: node shot.mjs <as> <path> <width> <out.png> [full]
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? '@playwright/test');
const executablePath = process.env.CHROME_PATH || undefined;
const [as, path, width, out, full] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: Number(width), height: Number(width) < 600 ? 844 : 900 }, deviceScaleFactor: 1, locale: 'fa-IR', timezoneId: 'Asia/Tehran' });
const logs = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(`http://127.0.0.1:4400${path}${path.includes('?') ? '&' : '?'}as=${as}`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(600);
await page.screenshot({ path: out, fullPage: full === 'full' });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log(JSON.stringify({ out, overflow, logs: logs.filter((l) => !l.includes('Download the React DevTools')).slice(0, 30) }));
await browser.close();
