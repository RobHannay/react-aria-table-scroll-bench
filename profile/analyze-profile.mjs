// node analyze-profile.mjs ../results/profile-raw.json ../results/profile-summary.json
import fs from 'node:fs';

const [inp, out] = process.argv.slice(2);
const { meta, results } = JSON.parse(fs.readFileSync(inp, 'utf8'));
const ARMS = meta.arms;
const REGIONS = ['fresh', 'revisited'];
const median = (a) => {
    const s = [...a].sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const q = (a, p) => {
    const s = [...a].sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
};
const JS = ['react', 'virtualizerItem', 'layout', 'virtualizer', 'cells', 'ariaOther', 'other'];
const ALL = ['forcedLayout', ...JS, 'gc', 'program', 'idle'];
const EXTRA = ['layoutIfNeededIncl', 'virtualizerItemIncl', 'virtualizerRenderIncl', 'buildFnsSelf'];

const summary = { meta, conditions: {} };
for (const region of REGIONS) {
    for (const arm of ARMS) {
        const clean = results.filter((r) => r.arm === arm && r.region === region && !r.profiled);
        const prof = results.filter((r) => r.arm === arm && r.region === region && r.profiled);
        if (!clean.length) continue;
        const c = {
            n: { clean: clean.length, profiled: prof.length },
            clean: {
                longFramePct: median(clean.map((r) => r.longFramePct)),
                longFramePctRange: [q(clean.map((r) => r.longFramePct), 0.25), q(clean.map((r) => r.longFramePct), 0.75)],
                longFramePctEarly: median(clean.map((r) => r.longFramePctHalves[0])),
                longFramePctLate: median(clean.map((r) => r.longFramePctHalves[1])),
                meanFrameMs: median(clean.map((r) => r.meanFrameMs)),
                meanFrameMsEarly: median(clean.map((r) => r.meanFrameMsHalves[0])),
                meanFrameMsLate: median(clean.map((r) => r.meanFrameMsHalves[1])),
                fps: 1000 / median(clean.map((r) => r.meanFrameMs)),
                scriptMsPerSec: median(clean.map((r) => r.metricsMsPerSec.script)),
                layoutMsPerSec: median(clean.map((r) => r.metricsMsPerSec.layout)),
                styleMsPerSec: median(clean.map((r) => r.metricsMsPerSec.style)),
                taskMsPerSec: median(clean.map((r) => r.metricsMsPerSec.task)),
            },
            profiledMetrics: {
                longFramePct: median(prof.map((r) => r.longFramePct)),
                scriptMsPerSec: median(prof.map((r) => r.metricsMsPerSec.script)),
                layoutMsPerSec: median(prof.map((r) => r.metricsMsPerSec.layout)),
                styleMsPerSec: median(prof.map((r) => r.metricsMsPerSec.style)),
            },
            buckets: {},
            halves: {},
        };
        // Buckets: ms per second of profile window, median across profiled runs.
        const perSec = (r, k, h) => {
            const hs = h == null ? r.profile.halves : [r.profile.halves[h]];
            const secs = r.profile.durationMs / 1000 / (h == null ? 1 : 2);
            return hs.reduce((a, x) => a + x[k], 0) / secs;
        };
        for (const k of [...ALL, ...EXTRA]) c.buckets[k] = median(prof.map((r) => perSec(r, k)));
        c.buckets.jsTotal = median(prof.map((r) => JS.reduce((a, k) => a + perSec(r, k), 0)));
        c.buckets.busy = median(prof.map((r) => ALL.filter((k) => k !== 'idle').reduce((a, k) => a + perSec(r, k), 0)));
        for (const k of ['layoutIfNeededIncl', 'buildFnsSelf', 'virtualizerItemIncl', 'react', 'forcedLayout', 'program'])
            c.halves[k] = [0, 1].map((h) => median(prof.map((r) => perSec(r, k, h))));
        // Top functions (mean ms/s across profiled runs).
        const fn = new Map();
        for (const r of prof) for (const [k, v] of r.profile.top) fn.set(k, (fn.get(k) ?? 0) + v / (r.profile.durationMs / 1000) / prof.length);
        c.topFunctions = [...fn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => ({ fn: k, msPerSec: +v.toFixed(1) }));
        summary.conditions[`${arm}/${region}`] = c;
    }
}
fs.writeFileSync(out, JSON.stringify(summary, null, 1));

const f0 = (x) => (x == null ? '-' : x.toFixed(0));
const f1 = (x) => (x == null ? '-' : x.toFixed(1));
const lines = [];
const P = (s = '') => lines.push(s);
for (const region of REGIONS) {
    P(`### ${region}`);
    P();
    P(`| bucket (ms per s of scrolling, profiled runs) | ${ARMS.join(' | ')} |`);
    P(`|---|${ARMS.map(() => '---:').join('|')}|`);
    const label = {
        react: '(a) React reconcile + commit (react-dom, react, scheduler)',
        virtualizerItem: '(b) VirtualizerItem + useVirtualizerItem (self)',
        layout: '(c1) TableLayout/ListLayout (self)',
        virtualizer: '(c2) Virtualizer, Rect/LayoutInfo, RAC Virtualizer (self)',
        cells: '(d) Row/cell components (app + RAC Table)',
        ariaOther: '(d2) other react-aria hooks (press, focus, selection, collection)',
        other: '(g) other JS',
        gc: '(e) GC',
        forcedLayout: '(f1) forced layout in scroll listener (useSelectableCollection reads scrollTop)',
        program: '(f2) (program): native browser work (style, layout, paint)',
        jsTotal: 'JS total (a+b+c+d+g)',
        busy: 'busy total (all but idle)',
    };
    for (const k of ['react', 'virtualizerItem', 'layout', 'virtualizer', 'cells', 'ariaOther', 'other', 'jsTotal', 'gc', 'forcedLayout', 'program', 'busy']) {
        const row = ARMS.map((a) => {
            const c = summary.conditions[`${a}/${region}`];
            const v = c.buckets[k];
            return k === 'busy' ? f0(v) : `${f0(v)} (${f0((100 * v) / c.buckets.busy)}%)`;
        });
        P(`| ${label[k]} | ${row.join(' | ')} |`);
    }
    P(`| inclusive: under layoutIfNeeded | ${ARMS.map((a) => f0(summary.conditions[`${a}/${region}`].buckets.layoutIfNeededIncl)).join(' | ')} |`);
    P(`| inclusive: VirtualizerItem render + hooks | ${ARMS.map((a) => f0(summary.conditions[`${a}/${region}`].buckets.virtualizerItemIncl)).join(' | ')} |`);
    P(`| inclusive: Virtualizer.render | ${ARMS.map((a) => f0(summary.conditions[`${a}/${region}`].buckets.virtualizerRenderIncl)).join(' | ')} |`);
    P();
    P(`| clean runs (no profiler) | ${ARMS.join(' | ')} |`);
    P(`|---|${ARMS.map(() => '---:').join('|')}|`);
    const cr = (k, fmt = f1) => ARMS.map((a) => fmt(summary.conditions[`${a}/${region}`].clean[k])).join(' | ');
    P(`| frames > 25ms (median %) | ${cr('longFramePct')} |`);
    P(`| frames > 25ms, early / late half | ${ARMS.map((a) => { const c = summary.conditions[`${a}/${region}`].clean; return `${f1(c.longFramePctEarly)} / ${f1(c.longFramePctLate)}`; }).join(' | ')} |`);
    P(`| mean frame ms (fps) | ${ARMS.map((a) => { const c = summary.conditions[`${a}/${region}`].clean; return `${f1(c.meanFrameMs)} (${f0(c.fps)})`; }).join(' | ')} |`);
    P(`| ScriptDuration ms/s | ${cr('scriptMsPerSec', f0)} |`);
    P(`| LayoutDuration ms/s | ${cr('layoutMsPerSec', f0)} |`);
    P(`| RecalcStyleDuration ms/s | ${cr('styleMsPerSec', f0)} |`);
    P(`| TaskDuration ms/s | ${cr('taskMsPerSec', f0)} |`);
    P();
    P(`| early / late half (ms/s, profiled) | ${ARMS.join(' | ')} |`);
    P(`|---|${ARMS.map(() => '---:').join('|')}|`);
    for (const k of ['layoutIfNeededIncl', 'buildFnsSelf', 'virtualizerItemIncl', 'react']) {
        P(`| ${k} | ${ARMS.map((a) => { const h = summary.conditions[`${a}/${region}`].halves[k]; return `${f0(h[0])} / ${f0(h[1])}`; }).join(' | ')} |`);
    }
    P();
}
for (const region of REGIONS) {
    P(`### Top self-time functions, baseline / ${region} (mean ms/s)`);
    P();
    for (const t of summary.conditions[`baseline/${region}`].topFunctions.slice(0, 20)) P(`- ${t.msPerSec} \`${t.fn}\``);
    P();
}
fs.writeFileSync(out.replace(/\.json$/, '.tables.md'), lines.join('\n'));
console.log(lines.join('\n'));
