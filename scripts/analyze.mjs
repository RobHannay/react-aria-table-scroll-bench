// node scripts/analyze.mjs results/main.json [armA=baseline] [armB=memo]
// Per condition and metric: per-arm median, difference of medians (B - A) with a bootstrap 95% CI, two-sided
// Mann-Whitney U p-value (normal approximation, tie-corrected) and a Benjamini-Hochberg q across all tests.
import fs from 'node:fs';

const [file, A = 'baseline', B = 'memo'] = process.argv.slice(2);
const { meta, results } = JSON.parse(fs.readFileSync(file, 'utf8'));

const NOMINAL = 1000 / 60;
const q = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const metrics = {
    'frame p95 ms': (r) => q([...r.intervals].sort((a, b) => a - b), 0.95),
    'frame p99 ms': (r) => q([...r.intervals].sort((a, b) => a - b), 0.99),
    'dropped %': (r) => (100 * r.intervals.filter((x) => x > 1.5 * NOMINAL).length) / r.intervals.length,
    '>=2 dropped %': (r) => (100 * r.intervals.filter((x) => x > 2.5 * NOMINAL).length) / r.intervals.length,
    'frames': (r) => r.frames,
    'LoAF count': (r) => r.loafCount,
    'LoAF total ms': (r) => r.loafTotalMs,
    'LoAF blocking ms': (r) => r.loafBlockingMs,
    'script ms/s': (r) => r.scriptMsPerSec,
    'task ms/s': (r) => r.taskMsPerSec,
    'layout+style ms/s': (r) => r.layoutMsPerSec + r.styleMsPerSec,
    'blank frame %': (r) => r.blankFramePct,
    // Wheel ticks are dispatched with an awaited CDP call, so a busy renderer stretches the scroll: elapsed is the
    // time to deliver and handle the same 188 ticks (for raf it is fixed at ~3.1 s).
    'scroll elapsed ms': (r) => r.elapsedMs,
    'script ms total': (r) => (r.scriptMsPerSec * r.elapsedMs) / 1000,
};

function rng(seed) {
    return () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 2 ** 32;
    };
}
function bootstrapDiff(a, b, reps = 4000) {
    const rand = rng(12345);
    const pick = (xs) => Array.from(xs, () => xs[Math.floor(rand() * xs.length)]);
    const d = [];
    for (let i = 0; i < reps; i++) d.push(median(pick(b)) - median(pick(a)));
    d.sort((x, y) => x - y);
    return [d[Math.floor(0.025 * reps)], d[Math.floor(0.975 * reps)]];
}
function mannWhitney(a, b) {
    const all = [...a.map((v) => [v, 0]), ...b.map((v) => [v, 1])].sort((x, y) => x[0] - y[0]);
    const ranks = new Array(all.length);
    let tieTerm = 0;
    for (let i = 0; i < all.length; ) {
        let j = i;
        while (j + 1 < all.length && all[j + 1][0] === all[i][0]) j++;
        const r = (i + j) / 2 + 1;
        for (let k = i; k <= j; k++) ranks[k] = r;
        const t = j - i + 1;
        tieTerm += t ** 3 - t;
        i = j + 1;
    }
    const n1 = a.length;
    const n2 = b.length;
    const R1 = all.reduce((s, [, g], i) => s + (g === 0 ? ranks[i] : 0), 0);
    const U1 = R1 - (n1 * (n1 + 1)) / 2;
    const mu = (n1 * n2) / 2;
    const n = n1 + n2;
    const sigma = Math.sqrt(((n1 * n2) / 12) * (n + 1 - tieTerm / (n * (n - 1))));
    if (sigma === 0) return 1;
    const z = (Math.abs(U1 - mu) - 0.5) / sigma;
    return Math.min(1, 2 * (1 - phi(Math.max(0, z))));
}
function phi(z) {
    // Abramowitz-Stegun 7.1.26 erf approximation
    const t = 1 / (1 + 0.3275911 * (z / Math.SQRT2));
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
    return 0.5 * (1 + y);
}

const key = (r) => `${r.cells}|${r.sizing}|${r.cpu}x|${r.pattern}|${r.region}`;
const groups = new Map();
for (const r of results) {
    if (r.arm !== A && r.arm !== B) continue;
    if (!groups.has(key(r))) groups.set(key(r), { [A]: [], [B]: [] });
    groups.get(key(r))[r.arm].push(r);
}
const rows = [];
for (const [cond, g] of groups) {
    for (const [name, fn] of Object.entries(metrics)) {
        const a = g[A].map(fn);
        const b = g[B].map(fn);
        if (!a.length || !b.length) continue;
        const ma = median(a);
        const mb = median(b);
        rows.push({ cond, metric: name, n: [a.length, b.length], [A]: ma, [B]: mb, diff: mb - ma, ci: bootstrapDiff(a, b), p: mannWhitney(a, b) });
    }
}
// Benjamini-Hochberg across all tests
const sorted = [...rows].sort((x, y) => x.p - y.p);
let prev = 1;
for (let i = sorted.length - 1; i >= 0; i--) {
    prev = Math.min(prev, (sorted[i].p * sorted.length) / (i + 1));
    sorted[i].q = prev;
}
const fmt = (x) => (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2));
const out = file.replace(/\.json$/, `.${A}-vs-${B}.summary.json`);
fs.writeFileSync(out, JSON.stringify({ meta, A, B, rows }, null, 1));

const show = (process.env.METRICS ?? 'frame p95 ms,frame p99 ms,dropped %,>=2 dropped %,LoAF total ms,script ms/s,script ms total,layout+style ms/s,scroll elapsed ms').split(',');
console.log(`${file}: ${A} vs ${B}; Chrome ${meta.chrome}; ${results.length} runs; diff = ${B} - ${A} (median), [95% bootstrap CI], MWU p, BH q`);
for (const cond of groups.keys()) {
    console.log(`\n### ${cond}  (n=${groups.get(cond)[A].length}/${groups.get(cond)[B].length})`);
    for (const r of rows.filter((x) => x.cond === cond && show.includes(x.metric))) {
        const flag = r.q < 0.05 ? ' *' : '';
        console.log(`  ${r.metric.padEnd(18)} ${fmt(r[A]).padStart(7)} -> ${fmt(r[B]).padStart(7)}  diff ${fmt(r.diff).padStart(7)} [${fmt(r.ci[0])}, ${fmt(r.ci[1])}]  p=${r.p.toFixed(3)} q=${r.q.toFixed(3)}${flag}`);
    }
}
console.log(`\nwrote ${out}`);
