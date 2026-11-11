const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? '@playwright/test');
import { mkdirSync } from 'node:fs';
mkdirSync(process.env.OUT_DIR ?? '/tmp/p9shots', { recursive: true });
const executablePath = process.env.CHROME_PATH || undefined;
const base = 'http://127.0.0.1:4400';
const screens = [
  ['sign-in', 'none', '/login'], ['expert-desk', 'expert', '/accidents/expert'], ['case-folder', 'expert', '/cases/case-17'],
  ['parts-desk', 'parts', '/parts?case=case-11'], ['control-room', 'manager', '/control-room'],
  ['technician', 'techBody', '/workshop/technician'], ['reports', 'manager', '/reports'], ['settings', 'admin', '/settings'],
];
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
for (const [name, as, path] of screens) for (const [w, h] of [[1440, 900], [768, 1024], [390, 844]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, locale: 'fa-IR', timezoneId: 'Asia/Tehran' });
  await page.goto(`${base}${path}${path.includes('?') ? '&' : '?'}as=${as}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(500);
  await page.screenshot({ path: `${process.env.OUT_DIR ?? "/tmp/p9shots"}/${name}-${w}.png`, fullPage: w !== 1440 });
  if (w === 1440) await page.screenshot({ path: `${process.env.OUT_DIR ?? "/tmp/p9shots"}/${name}-${w}-full.png`, fullPage: true });
  await page.close();
}
await browser.close();
console.log('ok');
