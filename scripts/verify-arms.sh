#!/bin/sh
# Unminified builds of each arm, diffed, to prove (1) baseline vs memo differ only in VirtualizerItem and
# (2) the React Compiler leaves node_modules (react-aria) untouched.
set -e
cd "$(dirname "$0")/.."
b() { node scripts/patch-react-aria.mjs "$2" >/dev/null; MINIFY=0 NODE_ENV=production ARM_OUT="verify/$1" COMPILER="${3:-0}" npx vite build --logLevel warn; }
rm -rf verify
b baseline baseline; b memo memo; b compiler baseline 1
node scripts/patch-react-aria.mjs baseline >/dev/null
v() { cat verify/$1/assets/vendor-*.js; }
i() { cat verify/$1/assets/index-*.js; }
echo "### vendor: baseline vs memo"; diff <(v baseline) <(v memo) || true
echo "### vendor: baseline vs compiler"; diff <(v baseline) <(v compiler) || true
echo "### app: baseline vs memo (expect identical)"; diff <(i baseline) <(i memo) && echo identical
echo "### app: compiler output uses memo cache:"; grep -c 'react.memo_cache_sentinel' verify/compiler/assets/index-*.js
