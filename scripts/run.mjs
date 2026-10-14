// Scroll-performance harness for the VirtualizerItem memo experiment.
//
//   node scripts/run.mjs --arms baseline,memo,compiled-vi --runs 20 --out results/main.json
//   node scripts/run.mjs --arms baseline-count,memo-count --runs 3 --sanity --out results/sanity.json
//
// Every run: fresh browser context + page load, warm-up scroll, CPU throttle applied, idle, then a scripted 3 s
// scroll starting at y=3000 while recording rAF frame timestamps, Long Animation Frames, CDP Performance.getMetrics
// deltas and (cheap, inline-style based) blank-area samples. Arms are interleaved in randomised order within
// each round of each condition, and every condition block waits for the 1-min load average to drop first.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';

const args = Object.fromEntries(
    process.argv.slice(2).reduce((acc, a, i, all) => {
        if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
        return acc;
    }, []),
);
const ARMS = String(args.arms ?? 'baseline,memo').split(',');
const RUNS = Number(args.runs ?? 20);
const SANITY = Boolean(args.sanity);
const OUT = args.out ?? 'results/run.json';
const MAX_LOAD = Number(args['max-load'] ?? 12);
const HARNESS_TAG = '--memo-exp-harness'; // harmless unknown switch so we can tell our Chrome from anyone else's
const SCROLL_MS = 3000;
const list = (k, d) => String(args[k] ?? d).split(',');
const conditions = [];
for (const cells of list('cells', 'trivial,realistic'))
    for (const sizing of list('sizing', 'fixed,estimated'))
        for (const cpu of list('cpu', '1,4').map(Number))
            for (const pattern of list('pattern', 'wheel,raf'))
                for (const region of list('region', 'fresh,revisited')) conditions.push({ cells, sizing, cpu, pattern, region });

// Installed in every page before app code: buffers Long Animation Frames and exposes the in-page recorder.
function pageInit() {
    window.__loafs = [];
    try {
        new PerformanceObserver((l) => window.__loafs.push(...l.getEntries())).observe({ type: 'long-animation-frame', buffered: true });
    } catch {}
    window.__rec = null;
    // Blank-area sample from inline styles only (VirtualizerItem writes top/height inline), so no forced layout.
    window.__blank = (table, bodyWrap) => {
        const st = table.scrollTop;
        const bodyTop = parseFloat(bodyWrap.style.top) || 0;
        const visTop = st; // in content coords; header is sticky and overlays bodyTop px
        const visBottom = st + table.clientHeight;
        let min = Infinity;
        let max = -Infinity;
        for (const w of bodyWrap.firstElementChild.children) {
            const top = bodyTop + parseFloat(w.style.top);
            const bottom = top + parseFloat(w.style.height);
            if (bottom > visTop && top < visBottom) {
                if (top < min) min = top;
                if (bottom > max) max = bottom;
            }
        }
        if (min === Infinity) return table.clientHeight;
        return Math.max(0, min - (visTop + bodyTop)) + Math.max(0, visBottom - max);
    };
    window.__start = ({ sanity }) => {
        const table = document.querySelector('[data-testid=table]');
        const groups = table.querySelectorAll('[role=rowgroup]');
        const bodyWrap = groups[groups.length - 1].parentElement;
        const rec = { frames: [], blank: [], rows: [], cells: [], t0: performance.now(), renders0: globalThis.__viRenders ?? null, stop: false };
        const tick = (t) => {
            if (rec.stop) return;
            rec.frames.push(t);
            rec.blank.push(window.__blank(table, bodyWrap));
            if (sanity) {
                rec.rows.push(table.querySelectorAll('[role=row]').length);
                rec.cells.push(table.querySelectorAll('[role=gridcell],[role=rowheader]').length);
            }
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        window.__rec = rec;
    };
    window.__stop = () => {
        const rec = window.__rec;
        rec.stop = true;
        rec.t1 = performance.now();
        const loafs = window.__loafs
            .filter((e) => e.startTime >= rec.t0 && e.startTime <= rec.t1)
            .map((e) => ({ d: e.duration, b: e.blockingDuration, s: e.scripts.reduce((a, s) => a + s.duration, 0) }));
        const table = document.querySelector('[data-testid=table]');
        return {
            frames: rec.frames,
            blank: rec.blank,
            rows: rec.rows,
            cells: rec.cells,
            loafs,
            renders: rec.renders0 == null ? null : globalThis.__viRenders - rec.renders0,
            scrollTop: table.scrollTop,
            elapsed: rec.t1 - rec.t0,
        };
    };
    // Continuous, time-based programmatic scroll: scrollTop follows a constant velocity independent of frame rate.
    window.__rafScroll = (ms, pxPerSec) =>
        new Promise((resolve) => {
            const table = document.querySelector('[data-testid=table]');
            const start = performance.now();
            const y0 = table.scrollTop;
            const step = (t) => {
                const e = t - start;
                table.scrollTop = y0 + (Math.min(e, ms) * pxPerSec) / 1000;
                if (e < ms) requestAnimationFrame(step);
                else resolve();
            };
            requestAnimationFrame(step);
        });
}

const metricsMap = (m) => Object.fromEntries(m.metrics.map((x) => [x.name, x.value]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Other automated Chrome instances (another benchmark) = browser processes started with remote debugging or
// automation switches that are not ours, and that are busy: their process tree uses > 15% CPU. An idle automated
// Chrome (e.g. a signed-in session parked between tasks) does not block.
function otherBenchmarkChromes() {
    const ps = execSync('ps -Ao pid=,ppid=,pcpu=,command=', { encoding: 'utf8', maxBuffer: 1 << 26 })
        .split('\n')
        .filter(Boolean)
        .map((l) => {
            const [, pid, ppid, cpu, cmd] = l.match(/^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(.*)$/) ?? [];
            return { pid: Number(pid), ppid: Number(ppid), cpu: Number(cpu), cmd: cmd ?? '' };
        });
    const roots = ps.filter(
        (p) =>
            /Chrom(e|ium)/.test(p.cmd) &&
            !p.cmd.includes('--type=') &&
            /--remote-debugging|--enable-automation/.test(p.cmd) &&
            !p.cmd.includes(HARNESS_TAG),
    );
    return roots
        .map((r) => ({ pid: r.pid, cpu: r.cpu + ps.filter((p) => p.ppid === r.pid).reduce((a, p) => a + p.cpu, 0) }))
        .filter((r) => r.cpu > 15);
}

async function waitForQuietMachine() {
    for (;;) {
        const l = os.loadavg()[0];
        const others = otherBenchmarkChromes();
        if (l < MAX_LOAD && others.length === 0) return l;
        console.log(`  load ${l.toFixed(2)} (max ${MAX_LOAD}), other automated Chromes: ${others.length}; waiting...`);
        await sleep(15000);
    }
}

async function oneRun(browser, arm, cond) {
    const context = await browser.newContext({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.addInitScript(pageInit);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable', { timeDomain: 'timeTicks' });
    await page.goto(`http://localhost:4789/${arm}/?cells=${cond.cells}&sizing=${cond.sizing}`);
    await page.waitForFunction(() => window.__ready);
    // Warm-up (unthrottled) so JIT and the view reuse pool are primed. TableLayout builds layoutInfos lazily as
    // the visible rect grows, and only rows whose layoutInfo object is unchanged can be skipped by the memo, so:
    //   fresh:     warm up over 0..3000 only; the measured scroll (3000 -> ~21800) enters never-laid-out rows.
    //   revisited: warm up over 0..24000 first; the measured scroll covers rows that are already laid out.
    const warmTo = cond.region === 'fresh' ? 3000 : 24000;
    await page.evaluate((to) => window.__rafScroll(to === 3000 ? 400 : 1500, (to * 1000) / (to === 3000 ? 400 : 1500)), warmTo);
    await page.evaluate(() => {
        document.querySelector('[data-testid=table]').scrollTop = 3000;
    });
    await sleep(300);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cond.cpu });
    await sleep(500);

    const box = await page.locator('[data-testid=table]').boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await sleep(100);

    const m0 = metricsMap(await cdp.send('Performance.getMetrics'));
    await page.evaluate((o) => window.__start(o), { sanity: SANITY });
    const tStart = Date.now();
    if (cond.pattern === 'wheel') {
        // 100 px wheel tick every 16 ms for 3 s, paced against wall-clock time (not cumulative awaits).
        for (let i = 0; ; i++) {
            const due = tStart + i * 16;
            if (due - tStart >= SCROLL_MS) break;
            const wait = due - Date.now();
            if (wait > 0) await sleep(wait);
            await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: 100 });
        }
    } else {
        await page.evaluate((ms) => window.__rafScroll(ms, 6000), SCROLL_MS);
    }
    await sleep(100); // let the last scroll commit
    const rec = await page.evaluate(() => window.__stop());
    const m1 = metricsMap(await cdp.send('Performance.getMetrics'));
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await context.close();

    const iv = rec.frames.slice(1).map((t, i) => t - rec.frames[i]);
    const d = (k) => (m1[k] - m0[k]) * 1000; // seconds -> ms
    const secs = rec.elapsed / 1000;
    return {
        arm,
        ...cond,
        intervals: iv,
        frames: rec.frames.length,
        loafCount: rec.loafs.length,
        loafTotalMs: rec.loafs.reduce((a, l) => a + l.d, 0),
        loafBlockingMs: rec.loafs.reduce((a, l) => a + l.b, 0),
        loafScriptMs: rec.loafs.reduce((a, l) => a + l.s, 0),
        scriptMsPerSec: d('ScriptDuration') / secs,
        taskMsPerSec: d('TaskDuration') / secs,
        layoutMsPerSec: d('LayoutDuration') / secs,
        styleMsPerSec: d('RecalcStyleDuration') / secs,
        blankFramePct: (100 * rec.blank.filter((b) => b > 0).length) / rec.blank.length,
        blankMeanPx: rec.blank.reduce((a, b) => a + b, 0) / rec.blank.length,
        renders: rec.renders,
        scrollTop: rec.scrollTop,
        elapsedMs: rec.elapsed,
        rows: SANITY ? rec.rows : undefined,
        cellCounts: SANITY ? rec.cells : undefined,
    };
}

function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

const server = await serve();
await waitForQuietMachine();
const browser = await chromium.launch({ channel: 'chrome', headless: !args.headed, args: [HARNESS_TAG] });
const meta = {
    chrome: browser.version(),
    node: process.version,
    cpu: os.cpus()[0].model,
    cores: os.cpus().length,
    arms: ARMS,
    runs: RUNS,
    sanity: SANITY,
    startedAt: new Date().toISOString(),
    loadAtStart: os.loadavg(),
};
console.log(JSON.stringify(meta));
const results = [];
const save = () => {
    fs.mkdirSync('results', { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ meta, results }));
};
for (const cond of conditions) {
    const load = await waitForQuietMachine();
    console.log(`condition ${JSON.stringify(cond)} (load ${load.toFixed(2)})`);
    for (let r = 0; r < RUNS; r++) {
        for (const arm of shuffle([...ARMS])) {
            const loadBefore = os.loadavg();
            const res = await oneRun(browser, arm, cond);
            res.round = r;
            res.loadAvgBefore = loadBefore; // [1, 5, 15] min
            res.loadAvg = os.loadavg()[0];
            results.push(res);
        }
        if (r % 5 === 4) console.log(`  round ${r + 1}/${RUNS} load ${os.loadavg()[0].toFixed(2)}`);
        await waitForQuietMachine(); // gate every round (pair of arms), so a whole pair runs under the same conditions
    }
    save();
}
meta.finishedAt = new Date().toISOString();
save();
await browser.close();
server.close();
console.log(`wrote ${OUT}`);
