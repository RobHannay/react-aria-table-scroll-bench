// Content diff between arms with Rollup's content hashes stripped from file names and import specifiers.
import fs from 'node:fs';
import path from 'node:path';
const norm = (s) => s.replace(/-[A-Za-z0-9_-]{8}\.js/g, '.js');
const read = (arm) => {
    const out = new Map();
    const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else out.set(norm(path.relative(`builds/${arm}`, p)), norm(fs.readFileSync(p, 'utf8'))); } };
    walk(`builds/${arm}`);
    return out;
};
const base = read('baseline');
for (const arm of process.argv.slice(2)) {
    const other = read(arm);
    const changed = [...new Set([...base.keys(), ...other.keys()])].filter((k) => base.get(k) !== other.get(k));
    console.log(`${arm}: ${changed.length} file(s) differ from baseline: ${changed.join(', ')}`);
}
