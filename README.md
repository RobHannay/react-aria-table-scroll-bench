# react-aria Table scroll benchmark

Harness behind [adobe/react-spectrum#10748](https://github.com/adobe/react-spectrum/pull/10748) (memoize
`VirtualizerItem`), also covering [#10706](https://github.com/adobe/react-spectrum/issues/10706) (`TableLayout`
rebuilds while scrolling into new rows).

The app is a plain React Aria Components `Table`: 2000 rows x 15 columns, fixed 40px rows, react-aria-components
1.22.1, React 19.3 production build. Playwright drives Chrome headless with 4x CPU throttling and scrolls the table.

Each "arm" is the same app built against a patched copy of the published packages:

| arm | change |
|---|---|
| `baseline` | published packages as-is |
| `memo` | `VirtualizerItem` wrapped in `memo` with a props comparator, as in #10748 |
| `fix` | `this.validRect = this.requestedRect.copy()` after `layoutIfNeeded` rebuilds, a local approximation of the #10706 fix |
| `memo-fix` | both |

The patch scripts rewrite files in `node_modules` before each build and restore them afterwards. The verify scripts
diff the builds to check the arms differ only in the patched files.

## Requirements

Node 22+, and Google Chrome installed (Playwright uses `channel: 'chrome'`).

## CPU profiles: where the frame time goes (`profile/`)

This is the one behind the table in the PR thread.

```sh
cd profile
npm install
./build.sh                       # unminified production builds of all four arms, then diffs them
node scripts/verify.mjs          # optional: content diff between arms with hashes stripped
node run-profile.mjs --arms baseline,memo,fix,memo-fix --runs 6 --region fresh,revisited --out ../results/profile-raw.json
node analyze-profile.mjs ../results/profile-raw.json ../results/profile-summary.json
```

- `--region fresh` scrolls into rows `TableLayout` has never laid out. `revisited` scrolls over rows that were already
  laid out during warm-up.
- Each run is done twice, once with the CDP sampling profiler (100us) and once without, for clean frame timings.

[`results/PROFILE.md`](results/PROFILE.md) has the setup, bucketing and results from my run (Apple M4 Max, Chrome 155).

## Frame timing benchmark (repo root)

The earlier, broader benchmark: minified builds, more runs, frame times only. It also has a React Compiler arm.

```sh
npm install
./scripts/build-arms.sh
./scripts/verify-arms.sh
node scripts/run.mjs --arms baseline,memo,compiled-vi --runs 20 --cells realistic --sizing fixed --cpu 4,6 --pattern wheel,raf --region fresh,revisited --out results/reduced.json
node scripts/analyze.mjs results/reduced.json baseline memo
```

## Caveats

Emulated CPU throttling, headless Chrome, one table design with fixed row heights, and the `fix` arm is my
approximation of the proposed #10706 fix, not an actual PR.
