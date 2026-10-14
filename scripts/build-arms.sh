#!/bin/sh
# Builds every arm from the same source + lockfile (React production build, minified).
#   baseline     published react-aria as-is
#   memo         VirtualizerItem wrapped in memo(areVirtualizerItemPropsEqual), exactly as adobe/react-spectrum#10748
#   compiled-vi  VirtualizerItem compiled with React Compiler (what it would ship as if react-aria adopted the compiler)
#   app-compiler baseline react-aria, app source (src/) compiled with React Compiler
# *-count variants add a render counter (sanity checks only, never timed).
set -e
cd "$(dirname "$0")/.."
build() { # arm patchmode count(0|1) appCompiler(0|1)
  if [ "$3" = 1 ]; then node scripts/patch-react-aria.mjs "$2" --count; else node scripts/patch-react-aria.mjs "$2"; fi
  NODE_ENV=production ARM_OUT="builds/$1" COMPILER="$4" npx vite build --logLevel warn
}
rm -rf builds
build baseline baseline 0 0
build memo memo 0 0
build compiled-vi compiled 0 0
build baseline-count baseline 1 0
build memo-count memo 1 0
build compiled-vi-count compiled 1 0
build app-compiler-count baseline 1 1
node scripts/patch-react-aria.mjs baseline   # leave node_modules pristine
for a in builds/*; do
  v=$(ls $a/assets/vendor-*.js)
  printf "%-20s memo-comparator=%s render-counter=%s compiler-runtime(vendor)=%s useMemoCache-in-app=%s vendor=%sB\n" "$(basename $a)" \
    "$(grep -c 'next.layoutInfo.estimatedSize\|\.layoutInfo\.estimatedSize&&' $v)" "$(grep -c __viRenders $v)" \
    "$(grep -c 'useMemoCache' $v)" "$(grep -c 'react.memo_cache_sentinel' $a/assets/index-*.js)" "$(wc -c < $v | tr -d ' ')"
done
