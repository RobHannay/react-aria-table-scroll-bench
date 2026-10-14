// What would React Compiler do if react-aria / RAC were compiled with it? Compiles the upstream TS source of
// VirtualizerItem (pre-#10748) and RAC's Virtualizer with babel-plugin-react-compiler and reports, per function,
// whether it compiled and which values it memoized. Output written to verify/compiled-src-*.js.
import fs from 'node:fs';
import { transformSync } from '@babel/core';

for (const f of ['VirtualizerItem.tsx', 'Virtualizer.tsx']) {
    const events = [];
    const src = fs.readFileSync(`verify/src-in/${f}`, 'utf8');
    const res = transformSync(src, {
        filename: `/x/${f}`,
        babelrc: false,
        configFile: false,
        presets: ['@babel/preset-typescript'],
        parserOpts: { plugins: ['jsx', 'typescript'] },
        plugins: [['babel-plugin-react-compiler', { target: '19', sources: () => true, panicThreshold: 'none', logger: { logEvent: (_f, e) => events.push(e) } }]],
    });
    fs.writeFileSync(`verify/compiled-src-${f.replace('.tsx', '.js')}`, res.code);
    console.log(`## ${f}`);
    for (const e of events) {
        const d = e.detail?.options ?? e.detail ?? {};
        console.log(`  ${e.kind} ${e.fnName ?? ''} line ${e.fnLoc?.start?.line}${e.memoSlots != null ? ` memoSlots=${e.memoSlots} memoBlocks=${e.memoBlocks}` : ''}${d.reason ? ` :: ${d.reason.slice(0, 140)} (line ${d.loc?.start?.line})` : ''}`);
    }
}
