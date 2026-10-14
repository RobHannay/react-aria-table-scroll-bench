// CPU-profile harness for "where is the frame time spent" (adobe/react-spectrum#10748, #10706).
//
//   node run-profile.mjs --arms baseline,memo,fix,memo-fix --runs 6 --region fresh,revisited --out ../results/profile-raw.json
//
// Same scenario as ../scripts/run.mjs (realistic cells, fixed row height, 4x CPU, raf pattern: scrollTop follows
// 6000 px/s for 3 s from y=3000). Each round runs every arm in random order, twice: once with the CDP sampling
// profiler on (100us) and once without (clean frame timings). Profiles are reduced in-process to per-file/function
// self time, buckets, inclusive time under layoutIfNeeded and VirtualizerItem, split into early/late halves.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const args = Object.fromEntries(
    process.argv.slice(2).reduce((acc, a, i, all) => {
        if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
        return acc;
    }, []),
);
const ARMS = String(args.arms ?? 'baseline,memo,fix,memo-fix').split(',');
const RUNS = Number(args.runs ?? 6);
const REGIONS = String(args.region ?? 'fresh,revisited').split(',');
const OUT = args.out ?? '../results/profile-raw.json';
const SAVE_PROFILES = args['save-profiles']; // dir: keep one raw .cpuprofile per arm x region (round 0)
const CPU = 4;
const SCROLL_MS = 3000;
const MAX_LOAD = Number(args['max-load'] ?? 12);
const HARNESS_TAG = '--memo-exp-profile-harness';
const PORT = 4791;

const root = path.resolve('builds');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(root, p);
    if (!file.startsWith(root) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

function pageInit() {
    window.__start = () => {
        const rec = { frames: [], t0: performance.now(), stop: false };
        const tick = (t) => {
            if (rec.stop) return;
            rec.frames.push(t);
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        window.__rec = rec;
    };
    window.__stop = () => {
        const rec = window.__rec;
        rec.stop = true;
        return { frames: rec.frames, t0: rec.t0, elapsed: performance.now() - rec.t0 };
    };
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const metricsMap = (m) => Object.fromEntries(m.metrics.map((x) => [x.name, x.value]));

async function waitForQuietMachine() {
    for (;;) {
        const l = os.loadavg()[0];
        if (l < MAX_LOAD) return l;
        console.log(`  load ${l.toFixed(2)} (max ${MAX_LOAD}); waiting...`);
        await sleep(15000);
    }
}

// ---- profile reduction ----------------------------------------------------------------------------------------
const VI_FILE = /react-aria\/dist\/private\/virtualizer\/(VirtualizerItem|useVirtualizerItem)/;
function fileOf(url) {
    const m = url.match(/assets\/(.*?)(-[A-Za-z0-9_-]{8})?\.js$/);
    return m ? m[1].replace(/^node_modules\//, '') : url;
}
function bucketOf(cf) {
    const fn = cf.functionName;
    if (fn === '(garbage collector)') return 'gc';
    if (fn === '(program)') return 'program';
    if (fn === '(idle)') return 'idle';
    if (fn === '(root)') return 'idle';
    const f = fileOf(cf.url);
    if (!cf.url) return 'other';
    // The Table's scroll listener in useSelectableCollection reads scrollTop right after ScrollView's flushSync
    // render, forcing a synchronous style + layout of the freshly committed DOM. Its self time is browser layout.
    if (/selection\/useSelectableCollection$/.test(f) && cf.lineNumber === 216) return 'forcedLayout';
    if (/^react-dom\/|^_virtual\/react-dom|^scheduler\/|^_virtual\/scheduler|^react\/|^_virtual\/react|jsx-runtime/.test(f)) return 'react';
    if (VI_FILE.test(f)) return 'virtualizerItem';
    if (/^react-stately\/dist\/private\/layout\/|^react-aria-components\/dist\/private\/TableLayout/.test(f)) return 'layout';
    if (/^react-stately\/dist\/private\/virtualizer\/|^react-aria-components\/dist\/private\/Virtualizer|^react-aria\/dist\/private\/virtualizer\//.test(f)) return 'virtualizer';
    if (/^src\//.test(f) || /^react-aria-components\/dist\/private\/Table/.test(f)) return 'cells';
    if (/^react-aria\/|^react-aria-components\/|^react-stately\/|^@react-aria|^@react-stately|^@internationalized/.test(f)) return 'ariaOther';
    return 'other';
}

function reduceProfile(profile) {
    const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
    const parent = new Map();
    for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
    const isLayoutIfNeeded = (n) => n.callFrame.functionName === 'layoutIfNeeded';
    const isBuildRowLike = (n) => /^(buildRow|buildCell|buildRowGroup|buildChild|buildNode|buildCollection)$/.test(n.callFrame.functionName);
    const isVI = (n) => VI_FILE.test(fileOf(n.callFrame.url));
    const anc = new Map(); // id -> {lin, vi, render, updateSubviews}
    const ancOf = (id) => {
        if (anc.has(id)) return anc.get(id);
        const n = nodes.get(id);
        const p = parent.has(id) ? ancOf(parent.get(id)) : { lin: false, vi: false, render: false };
        const fn = n.callFrame.functionName;
        const fromVirtualizer = /react-stately\/dist\/private\/virtualizer\/Virtualizer/.test(fileOf(n.callFrame.url));
        const r = {
            lin: p.lin || isLayoutIfNeeded(n),
            vi: p.vi || isVI(n),
            render: p.render || (fromVirtualizer && fn === 'render'),
        };
        anc.set(id, r);
        return r;
    };
    const t0 = profile.startTime;
    const t1 = profile.endTime;
    const mid = (t0 + t1) / 2;
    const zero = () => ({ forcedLayout: 0, react: 0, virtualizerItem: 0, layout: 0, virtualizer: 0, cells: 0, ariaOther: 0, gc: 0, program: 0, other: 0, idle: 0, layoutIfNeededIncl: 0, virtualizerItemIncl: 0, virtualizerRenderIncl: 0, buildFnsSelf: 0 });
    const halves = [zero(), zero()];
    const byFn = new Map();
    let t = t0;
    for (let i = 0; i < profile.samples.length; i++) {
        t += profile.timeDeltas[i];
        // Attribute the interval until the next sample to this sample (Chrome's convention).
        const dt = (profile.timeDeltas[i + 1] ?? 0) / 1000; // ms
        if (dt <= 0) continue;
        const n = nodes.get(profile.samples[i]);
        const h = halves[t < mid ? 0 : 1];
        h[bucketOf(n.callFrame)] += dt;
        const a = ancOf(n.id);
        if (a.lin) h.layoutIfNeededIncl += dt;
        if (a.vi) h.virtualizerItemIncl += dt;
        if (a.render) h.virtualizerRenderIncl += dt;
        if (isBuildRowLike(n)) h.buildFnsSelf += dt;
        const key = `${fileOf(n.callFrame.url)}::${n.callFrame.functionName || '(anonymous)'}:${n.callFrame.lineNumber}`;
        byFn.set(key, (byFn.get(key) ?? 0) + dt);
    }
    const top = [...byFn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 400);
    return { durationMs: (t1 - t0) / 1000, halves, top };
}

// ---- one run --------------------------------------------------------------------------------------------------
async function oneRun(browser, arm, region, profiled, saveTo) {
    const context = await browser.newContext({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.addInitScript(pageInit);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable', { timeDomain: 'timeTicks' });
    await page.goto(`http://localhost:${PORT}/${arm}/?cells=realistic&sizing=fixed`);
    await page.waitForFunction(() => window.__ready);
    const warmTo = region === 'fresh' ? 3000 : 24000;
    await page.evaluate((to) => window.__rafScroll(to === 3000 ? 400 : 1500, (to * 1000) / (to === 3000 ? 400 : 1500)), warmTo);
    await page.evaluate(() => {
        document.querySelector('[data-testid=table]').scrollTop = 3000;
    });
    await sleep(300);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
    if (profiled) {
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
    }
    await sleep(500);

    const m0 = metricsMap(await cdp.send('Performance.getMetrics'));
    if (profiled) await cdp.send('Profiler.start');
    await page.evaluate(() => window.__start());
    await page.evaluate((ms) => window.__rafScroll(ms, 6000), SCROLL_MS);
    await sleep(100);
    const rec = await page.evaluate(() => window.__stop());
    const profile = profiled ? (await cdp.send('Profiler.stop')).profile : null;
    const m1 = metricsMap(await cdp.send('Performance.getMetrics'));
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await context.close();

    if (profile && saveTo) fs.writeFileSync(saveTo, JSON.stringify(profile));
    const iv = rec.frames.slice(1).map((x, i) => x - rec.frames[i]);
    const half = rec.elapsed / 2;
    const ivHalves = [[], []];
    rec.frames.slice(1).forEach((x, i) => ivHalves[x - rec.t0 < half ? 0 : 1].push(iv[i]));
    const d = (k) => (m1[k] - m0[k]) * 1000;
    const secs = rec.elapsed / 1000;
    const longPct = (a) => (100 * a.filter((x) => x > 25).length) / Math.max(1, a.length);
    return {
        arm,
        region,
        profiled,
        elapsedMs: rec.elapsed,
        frames: rec.frames.length,
        meanFrameMs: iv.reduce((a, b) => a + b, 0) / iv.length,
        longFramePct: longPct(iv),
        longFramePctHalves: ivHalves.map(longPct),
        meanFrameMsHalves: ivHalves.map((a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)),
        metricsMsPerSec: {
            script: d('ScriptDuration') / secs,
            layout: d('LayoutDuration') / secs,
            style: d('RecalcStyleDuration') / secs,
            task: d('TaskDuration') / secs,
        },
        profile: profile ? reduceProfile(profile) : null,
    };
}

function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

await waitForQuietMachine();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: [HARNESS_TAG] });
const meta = { chrome: browser.version(), cpu: os.cpus()[0].model, cores: os.cpus().length, arms: ARMS, runs: RUNS, regions: REGIONS, cpuThrottle: CPU, samplingIntervalUs: 100, startedAt: new Date().toISOString(), loadAtStart: os.loadavg() };
console.log(JSON.stringify(meta));
if (SAVE_PROFILES) fs.mkdirSync(SAVE_PROFILES, { recursive: true });
const results = [];
const save = () => fs.writeFileSync(OUT, JSON.stringify({ meta, results }));
for (let r = 0; r < RUNS; r++) {
    for (const region of shuffle([...REGIONS])) {
        await waitForQuietMachine();
        const jobs = shuffle(ARMS.flatMap((arm) => [{ arm, profiled: true }, { arm, profiled: false }]));
        for (const { arm, profiled } of jobs) {
            const saveTo = SAVE_PROFILES && r === 0 && profiled ? path.join(SAVE_PROFILES, `${arm}-${region}.cpuprofile`) : null;
            const res = await oneRun(browser, arm, region, profiled, saveTo);
            res.round = r;
            res.loadAvg = os.loadavg()[0];
            results.push(res);
            console.log(`r${r} ${region} ${arm} ${profiled ? 'prof' : 'clean'} long=${res.longFramePct.toFixed(1)}% script=${res.metricsMsPerSec.script.toFixed(0)}ms/s load=${res.loadAvg.toFixed(1)}`);
        }
    }
    save();
}
meta.finishedAt = new Date().toISOString();
save();
await browser.close();
server.close();
console.log(`wrote ${OUT}`);
