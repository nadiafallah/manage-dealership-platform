// Layout, focus, contrast, reduced-motion and print probes on the harness.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? '@playwright/test');
const executablePath = process.env.CHROME_PATH || undefined;
const base = 'http://127.0.0.1:4400';
const routes = [
  ['none', '/login'], ['expert', '/accidents/expert'], ['expert', '/cases/case-15'], ['expert', '/cases/case-18'], ['parts', '/parts'], ['parts', '/accidents/parts'],
  ['manager', '/control-room'], ['manager', '/reports'], ['admin', '/settings'], ['admin', '/accidents/admin'], ['techBody', '/workshop/technician'], ['expert3', '/cases/case-10'],
];
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
const out = { overflow: [], contrast: [], errors: [] };
for (const width of [360, 390, 768, 1440]) {
  for (const [as, path] of routes) {
    const page = await browser.newPage({ viewport: { width, height: 800 }, locale: 'fa-IR', timezoneId: 'Asia/Tehran' });
    page.on('pageerror', (e) => out.errors.push(`${width} ${path}: ${e.message}`));
    await page.goto(`${base}${path}?as=${as}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, err: !!document.querySelector('[data-harness-error]') }));
    out.overflow.push({ width, path, as, overflow: r.sw - r.cw, crashed: r.err });
    if (width === 1440 || width === 390) {
      // Approximate WCAG contrast: text colour against the nearest solid background.
      const low = await page.evaluate(() => {
        const lum = (c) => { const m = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0]; const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
        const alpha = (c) => { const m = c.match(/[\d.]+/g)?.map(Number) ?? []; return m.length > 3 ? m[3] : 1; };
        const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const s = getComputedStyle(e); if (s.backgroundImage !== 'none' && !s.backgroundImage.startsWith('url')) return null; if (alpha(s.backgroundColor) >= 0.95) return s.backgroundColor; } return 'rgb(243,241,236)'; };
        const res = [];
        for (const el of document.querySelectorAll('body *')) {
          if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
          const s = getComputedStyle(el); if (s.visibility === 'hidden' || s.display === 'none' || el.closest('[aria-hidden="true"]') || alpha(s.color) < 0.95) continue;
          const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
          const bg = bgOf(el); if (!bg) continue;
          const a = lum(s.color), b = lum(bg); const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          const large = parseFloat(s.fontSize) >= 24 || (parseFloat(s.fontSize) >= 18.66 && Number(s.fontWeight) >= 700);
          if (ratio < (large ? 3 : 4.5)) res.push({ text: el.textContent.trim().slice(0, 40), ratio: Math.round(ratio * 100) / 100, color: s.color, bg });
        }
        return res.slice(0, 12);
      });
      for (const l of low) out.contrast.push({ width, path, ...l });
    }
    await page.close();
  }
}
// Reduced motion: the stopped-car pulse and skeleton shimmer stop.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await page.goto(`${base}/control-room?as=manager`, { waitUntil: 'networkidle' });
  out.reducedMotion = await page.evaluate(() => [...document.querySelectorAll('.cr-ring.stop, .folder, .lg-folder')].map((e) => getComputedStyle(e).animationName));
  await page.close();
}
// Keyboard: tab to the first bay of the map and show its focus ring.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}/control-room?as=manager`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const seen = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => { const a = document.activeElement; return a ? `${a.tagName.toLowerCase()}${a.getAttribute('role') ? `[${a.getAttribute('role')}]` : ''}:${(a.getAttribute('aria-label') ?? a.textContent ?? '').trim().slice(0, 30)}` : ''; });
    seen.push(f);
    if (f.startsWith('polygon')) { await page.keyboard.press('Enter'); await page.waitForTimeout(200); await page.locator('.cr-map').screenshot({ path: '/tmp/probe-focus-bay.png' }); break; }
  }
  out.tabOrder = seen;
  await page.close();
}
// Print: case folder and control room as printed.
for (const [as, path, name] of [['expert', '/cases/case-15', 'case'], ['manager', '/control-room', 'control-room']]) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto(`${base}${path}?as=${as}`, { waitUntil: 'networkidle' });
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `/tmp/probe-print-${name}.png`, fullPage: true });
  await page.close();
}
await browser.close();
console.log(JSON.stringify(out, null, 1));
