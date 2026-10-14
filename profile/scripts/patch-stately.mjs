// Usage: node scripts/patch-stately.mjs <baseline|fix>
// `fix` approximates the fix proposed in adobe/react-spectrum#10706: after layoutIfNeeded rebuilds the collection
// for a newly requested rect, mark the result valid the same way update() does (validRect = requestedRect).
import fs from 'node:fs';
import path from 'node:path';

const mode = process.argv[2];
if (!['baseline', 'fix'].includes(mode)) throw new Error('mode must be baseline|fix');
const file = path.resolve('node_modules/react-stately/dist/private/layout/ListLayout.mjs');
const orig = `${file}.orig`;
if (!fs.existsSync(orig)) fs.copyFileSync(file, orig);
let src = fs.readFileSync(orig, 'utf8');
if (mode === 'fix') {
    const before = `            this.requestedRect = this.requestedRect.union(rect);
            this.rootNodes = this.buildCollection();
        }`;
    if (!src.includes(before)) throw new Error('layoutIfNeeded anchor not found');
    src = src.replace(
        before,
        `            this.requestedRect = this.requestedRect.union(rect);
            this.rootNodes = this.buildCollection();
            this.validRect = this.requestedRect.copy();
        }`,
    );
}
fs.writeFileSync(file, src);
console.log(`ListLayout.mjs: ${mode}`);
