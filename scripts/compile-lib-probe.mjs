// Can React Compiler memoize the virtualizer render path if react-aria / RAC themselves were compiled?
// Opts the three components on that path into compilation with a "use memo" directive (their dist names
// are not PascalCase, so infer mode would skip them) and reports what the compiler does with each.
import fs from 'node:fs';
import { transformSync } from '@babel/core';

const targets = {
    'node_modules/react-aria-components/dist/private/Virtualizer.mjs': [
        ['$143fb904d86051ce$var$CollectionRoot', 'CollectionRoot'],
        ['$143fb904d86051ce$var$CollectionBranch', 'CollectionBranch'],
    ],
    'node_modules/react-aria/dist/private/virtualizer/VirtualizerItem.mjs.orig': [
        ['$6c92e9e346cd7b1c$export$6796df8ba7398521', 'VirtualizerItem'],
    ],
};
const out = {};
for (const [file, fns] of Object.entries(targets)) {
    let src = fs.readFileSync(file, 'utf8');
    for (const [name] of fns) {
        src = src.replace(new RegExp(`(function ${name.replace(/\$/g, '\\$')}\\([^)]*\\)\\s*\\{)`), '$1\n    "use memo";');
    }
    const events = [];
    const res = transformSync(src, {
        filename: file.replace('.orig', ''),
        babelrc: false,
        configFile: false,
        plugins: [['babel-plugin-react-compiler', { target: '19', compilationMode: 'annotation', sources: () => true, panicThreshold: 'none', logger: { logEvent: (f, e) => { events.push(e); console.error(JSON.stringify(e).slice(0, 400)); } } }]],
    });
    for (const [name, label] of fns) {
        const ev = events.filter((e) => e.fnName === name || (e.fnLoc && res.code.includes(name)) );
        out[label] = events.filter((e) => e.fnName === name).map((e) => ({ kind: e.kind, reason: e.detail?.reason ?? e.detail?.options?.reason ?? e.detail?.description, memoSlots: e.memoSlots, memoBlocks: e.memoBlocks }));
    }
    fs.writeFileSync(`verify/compiled-${file.split('/').pop().replace('.orig', '')}`, res.code);
}
console.log(JSON.stringify(out, null, 1));
