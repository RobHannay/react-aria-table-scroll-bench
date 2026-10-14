// Usage: node scripts/patch-react-aria.mjs <baseline|memo|compiled> [--count]
// Restores the published react-aria VirtualizerItem dist files from a pristine backup, then (for `memo`)
// applies the exact change from adobe/react-spectrum#10748: wrap VirtualizerItem in React.memo with
// areVirtualizerItemPropsEqual. `--count` additionally increments globalThis.__viRenders on every
// VirtualizerItem render (used only for the render-count sanity builds, never for timing builds).
// `compiled` (ESM .mjs only, which is what Vite resolves) runs the published VirtualizerItem through
// babel-plugin-react-compiler, i.e. what VirtualizerItem would ship as if react-aria adopted React Compiler.
import { transformSync } from '@babel/core';
import fs from 'node:fs';
import path from 'node:path';

const [mode, flag] = process.argv.slice(2);
if (!['baseline', 'memo', 'compiled'].includes(mode)) throw new Error('mode must be baseline|memo|compiled');
const count = flag === '--count';
const dir = path.resolve('node_modules/react-aria/dist/private/virtualizer');
const EXPORT = 'export$6796df8ba7398521';

const COMPARATOR = `function areVirtualizerItemPropsEqual(prev, next) {
    return !next.layoutInfo.estimatedSize && prev.layoutInfo === next.layoutInfo && prev.parent === next.parent && prev.virtualizer === next.virtualizer && prev.children === next.children && prev.style === next.style && prev.className === next.className && prev.shouldObserveItemSize === next.shouldObserveItemSize;
}`;

for (const ext of ['mjs', 'js', 'cjs']) {
    const file = path.join(dir, `VirtualizerItem.${ext}`);
    const orig = `${file}.orig`;
    if (!fs.existsSync(orig)) fs.copyFileSync(file, orig);
    let src = fs.readFileSync(orig, 'utf8');

    const fnRe = new RegExp(`function (\\$[0-9a-f]+\\$${EXPORT.replace('$', '\\$')})\\(props\\) \\{`);
    const m = src.match(fnRe);
    if (!m) throw new Error(`VirtualizerItem function not found in ${file}`);
    const name = m[1];

    const compiling = mode === 'compiled' && ext === 'mjs';
    if (count && !compiling) {
        src = src.replace(fnRe, (s) => `${s}\n    globalThis.__viRenders = (globalThis.__viRenders || 0) + 1;`);
    }

    if (mode === 'memo') {
        // Find the React default import binding used for createElement in this file.
        const reactRef =
            ext === 'cjs'
                ? src.match(/\(0, \(\$parcel\$interopDefault\((\$[\w$]+)\)\)\)\.createElement/)[1]
                : src.match(/import (\$[\w$]+), \{[^}]*\} from "react";/)[1];
        const memoExpr = ext === 'cjs' ? `$parcel$interopDefault(${reactRef}).memo` : `${reactRef}.memo`;
        src = src.replace(fnRe, (s) => s.replace(`function ${name}(`, `function ${name}$inner(`));
        // Insert the memo wrapper right before the module-level cache declaration that follows the component.
        const anchor = src.indexOf('$var$cache = new WeakMap();');
        const lineStart = src.lastIndexOf('\n', anchor) + 1;
        src =
            src.slice(0, lineStart) +
            `${COMPARATOR}\nconst ${name} = /*#__PURE__*/ ${memoExpr}(${name}$inner, areVirtualizerItemPropsEqual);\n` +
            src.slice(lineStart);
        if (ext === 'cjs') {
            // $parcel$export getters reference the binding lazily, so const is fine. Nothing else to do.
        }
    }
    if (compiling) {
        // Compile the upstream TS source of VirtualizerItem (react-spectrum main before #10748, saved as
        // scripts/VirtualizerItem.upstream.tsx) with React Compiler, then point its imports at the dist modules.
        const events = [];
        src = transformSync(fs.readFileSync(new URL('./VirtualizerItem.upstream.tsx', import.meta.url), 'utf8'), {
            filename: 'VirtualizerItem.tsx',
            babelrc: false,
            configFile: false,
            presets: [['@babel/preset-typescript', { onlyRemoveTypeImports: false }]],
            parserOpts: { plugins: ['jsx', 'typescript'] },
            plugins: [
                ['babel-plugin-react-compiler', { target: '19', sources: () => true, panicThreshold: 'all_errors', logger: { logEvent: (_f, e) => events.push(e) } }],
                ['@babel/plugin-transform-react-jsx', { runtime: 'automatic' }],
            ],
        }).code
            .replace("from '../i18n/I18nProvider'", "from '../i18n/I18nProvider.mjs'")
            .replace("from './useVirtualizerItem'", "from './useVirtualizerItem.mjs'");
        const ok = events.find((e) => e.kind === 'CompileSuccess' && e.fnName === 'VirtualizerItem');
        if (!ok) throw new Error(`compiler did not compile VirtualizerItem: ${JSON.stringify(events)}`);
        // Counter injected after compilation so the compiler does not reject the global mutation.
        if (count) src = src.replace(/function VirtualizerItem\(props\) \{/, (s) => `${s}\n  globalThis.__viRenders = (globalThis.__viRenders || 0) + 1;`);
        console.log(`mjs: compiled with React Compiler (memoSlots=${ok.memoSlots}, memoBlocks=${ok.memoBlocks})`);
    }
    fs.writeFileSync(file, src);
    console.log(`${ext}: ${mode}${count ? '+count' : ''} (${name})`);
}
