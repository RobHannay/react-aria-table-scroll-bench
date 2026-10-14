// Debug: which VirtualizerItem props change between renders during a scroll (memo-diff build only).
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve('builds-debug');
const server = http.createServer((q, r) => { let p = new URL(q.url, 'http://x').pathname; if (p.endsWith('/')) p += 'index.html'; const f = path.join(root, p); if (!fs.existsSync(f)) return r.writeHead(404).end(); r.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(f).pipe(r); }).listen(4790);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
for (const sizing of ['fixed', 'estimated']) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  await page.goto(`http://localhost:4790/memo-diff/?cells=trivial&sizing=${sizing}`);
  await page.waitForFunction(() => window.__ready);
  const scroll = (d) => page.evaluate((d) => new Promise((res) => { const t = document.querySelector('[data-testid=table]'); let i = 0; const f = () => { t.scrollTop += d; if (++i < 100) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); }), d);
  for (const [label, d] of [['first pass down', 100], ['back up (already laid out)', -100], ['down again (already laid out)', 100]]) {
    await page.evaluate(() => (globalThis.__viDiff = {}));
    await scroll(d);
    await new Promise((r) => setTimeout(r, 200));
    const diff = await page.evaluate(() => globalThis.__viDiff);
    const tot = Object.values(diff).reduce((a, b) => a + b, 0);
    const eq = Object.entries(diff).filter(([k]) => k.endsWith(':equal')).reduce((a, [, v]) => a + v, 0);
    console.log(sizing, label, `skipped ${eq}/${tot} (${((100 * eq) / tot).toFixed(0)}%)`, JSON.stringify(diff));
  }
  await page.close();
}
await browser.close(); server.close();
