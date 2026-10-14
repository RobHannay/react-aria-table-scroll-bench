#!/bin/bash
# Unminified, production-mode (NODE_ENV=production) builds for CPU profiling, one file per module.
#   baseline   published react-aria / react-stately
#   memo       + VirtualizerItem memo (adobe/react-spectrum#10748)
#   fix        + validRect advanced in ListLayout.layoutIfNeeded (approximation of the #10706 fix)
#   memo-fix   both
set -e
cd "$(dirname "$0")"
b() { # arm aria-mode stately-mode
  node scripts/patch-react-aria.mjs "$2" >/dev/null
  node scripts/patch-stately.mjs "$3" >/dev/null
  NODE_ENV=production ARM_OUT="builds/$1" npx vite build --logLevel warn
}
rm -rf builds
b baseline baseline baseline
b memo memo baseline
b fix baseline fix
b memo-fix memo fix
node scripts/patch-react-aria.mjs baseline >/dev/null
node scripts/patch-stately.mjs baseline >/dev/null
for a in memo fix memo-fix; do echo "### baseline vs $a"; diff -r builds/baseline builds/$a; done
echo "### dev-mode React present?"; grep -rl "react-dom-client.development\|jsxDEV" builds/baseline || echo none
