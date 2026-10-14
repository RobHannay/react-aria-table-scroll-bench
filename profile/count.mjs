// Render-count sanity check (not timed): VirtualizerItem renders per frame, fresh region, 4x CPU, raf pattern.
import fs from 'node:fs'; import http from 'node:http'; import path from 'node:path'; import { chromium } from 'playwright-core';
const root = path.resolve('builds-count');
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(root, p); if (!fs.existsSync(f)) return res.writeHead(404).end(); res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(4792, r));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const out = [];
for (const region of ['fresh', 'revisited']) for (const arm of ['baseline-count', 'memo-count', 'fix-count', 'memo-fix-count']) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } }); const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
  await page.goto(`http://localhost:4792/${arm}/?cells=realistic&sizing=fixed`); await page.waitForFunction(() => window.__ready);
  const scroll = (ms, pxs) => page.evaluate(([ms, pxs]) => new Promise((res) => { const t = document.querySelector('[data-testid=table]'); const s = performance.now(); const y0 = t.scrollTop; let frames = 0; const step = (now) => { frames++; const e = now - s; t.scrollTop = y0 + Math.min(e, ms) * pxs / 1000; if (e < ms) requestAnimationFrame(step); else res(frames); }; requestAnimationFrame(step); }), [ms, pxs]);
  const warm = region === 'fresh' ? 3000 : 24000; await scroll(region === 'fresh' ? 400 : 1500, warm * 1000 / (region === 'fresh' ? 400 : 1500));
  await page.evaluate(() => { document.querySelector('[data-testid=table]').scrollTop = 3000; }); await new Promise((r) => setTimeout(r, 300));
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const r0 = await page.evaluate(() => globalThis.__viRenders); const frames = await scroll(3000, 6000); const r1 = await page.evaluate(() => globalThis.__viRenders);
  const mounted = await page.evaluate(() => document.querySelectorAll('[data-testid=table] [role=presentation]').length);
  out.push({ region, arm, renders: r1 - r0, frames, rendersPerFrame: (r1 - r0) / frames, mountedItems: mounted }); console.log(JSON.stringify(out.at(-1)));
  await ctx.close();
}
fs.writeFileSync('../results/profile-render-counts.json', JSON.stringify(out, null, 1)); await browser.close(); server.close();
