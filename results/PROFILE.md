# Where the frame time goes: CPU profiles for adobe/react-spectrum#10748 (and #10706)

Answering nwidynski's "where is the frame time actually being spent?" with sampled CPU profiles.

## Setup

- Same scenario as the earlier benchmark: plain RAC `Table`, 2000 x 15 realistic cells, fixed row height (40px),
  react-aria-components 1.22.1, React 19.3 production build. Chrome 155 headless, 4x CPU throttle, `raf` pattern
  (scrollTop driven at 6000 px/s for 3s from y=3000). Apple M4 Max, load average 7 to 10 during the run.
- Builds: `profile/build.sh`. Vite production mode, `minify: false`, `preserveModules: true` so every profile frame
  carries its source module in its URL. `profile/scripts/verify.mjs` (hashes stripped) confirms the arms differ only in:
  - `baseline`: published packages
  - `memo`: `VirtualizerItem.js` only (the #10748 change)
  - `fix`: `ListLayout.js` only: `this.validRect = this.requestedRect.copy()` after `layoutIfNeeded` rebuilds,
    i.e. the fix proposed in #10706
  - `memo-fix`: both files
- Runs: `profile/run-profile.mjs`. 6 rounds; each round, for each region in random order, all 4 arms x
  {profiled, clean} in random order (96 runs, 12 per arm x region). Profiled runs use the CDP sampling profiler at
  100us for the scroll window only. Clean runs (no profiler) give frame timings and `Performance.getMetrics` deltas.
  Medians reported.
- Regions: `fresh` scrolls into rows TableLayout has never laid out; `revisited` scrolls over rows already laid out
  during warm-up.
- Bucketing (self time, by module URL): (a) react-dom/react/scheduler; (b) `VirtualizerItem` + `useVirtualizerItem`;
  (c1) `TableLayout`/`ListLayout`; (c2) stately `Virtualizer`, `Rect`, `LayoutInfo`, RAC `Virtualizer`; (d) app cells
  + RAC `Table`; (d2) other react-aria hooks; (e) GC; (f1) the anonymous scroll listener in `useSelectableCollection`
  (it reads `scrollTop` straight after ScrollView's `flushSync` render, so its self time is a forced synchronous style +
  layout); (f2) `(program)`, native browser work (style, layout, paint); (g) other. Inclusive time is also computed for
  everything under `layoutIfNeeded` and under the VirtualizerItem render.

## Headline: main-thread cost per frame (ms, profiled runs)

| | revisited baseline | revisited memo | fresh baseline | fresh memo | fresh #10706 fix | fresh fix + memo |
|---|---:|---:|---:|---:|---:|---:|
| React reconcile + commit | 7.7 | 4.7 | 10.3 | 10.7 | 8.5 | 6.1 |
| VirtualizerItem + hooks (self) | 0.8 | 0.1 | 1.1 | 1.0 | 0.5 | 0.2 |
| TableLayout rebuild (`layoutIfNeeded`, inclusive) | 0.0 | 0.0 | 5.9 | 5.6 | 2.0 | 1.9 |
| other JS + GC (react-aria hooks, cells, Virtualizer) | 3.3 | 2.5 | 5.7 | 5.6 | 4.4 | 3.6 |
| browser style/layout/paint (incl. forced layout) | 10.4 | 8.9 | 13.0 | 13.1 | 11.1 | 10.1 |
| **total main thread per frame** | **22.1** | **16.2** | **35.9** | **36.1** | **26.5** | **21.9** |
| VirtualizerItem renders per frame (437 mounted) | 436 | 42 | 430 | 414 | 432 | 92 |
| frames > 25ms (clean runs) | 19.6% | 1.4% | 78.8% | 80.6% | 42.6% | 9.9% |
| fps (clean runs) | 50 | 59 | 32 | 32 | 42 | 55 |

`revisited fix` and `revisited memo-fix` match `revisited baseline` and `revisited memo` (22.5 and 16.5 ms/frame,
19.8% and 2.2% long frames): #10706 does not apply there because the warm-up already grew `requestedRect` over the
whole scroll range, so `layoutIfNeeded` never rebuilds (0.0 ms under it).

Render counts come from separate counter builds (`profile/count.mjs`, `profile-render-counts.json`), not the timed ones.

## Findings

1. **Where the time goes without memo.** On each scroll update, ScrollView `flushSync`s a render and every mounted
   VirtualizerItem (~437: 29 rows x ~13 cells + header + row group) re-renders, even when its `layoutInfo`, `parent`
   and `children` are unchanged. The component function itself is cheap (0.8 ms/frame self, as nwidynski said),
   but React still has to reconcile and commit each one. That cost lands in react-dom: `propagateParentContextChanges`,
   `updateProperties`/`setValueForStyles` (a fresh `style` object per render, diffed against the DOM),
   `updateCallback`/`updateEffect`/`updateInsertionEffect` (the `useCallback`, `useEffectEvent` and dependency-less
   `useLayoutEffect` in `useVirtualizerItem`, which commits every render), `commitHookEffectListUnmount` and
   `createElement`. The children elements are reused, so the cells themselves bail out (cells are about 2% of busy time).
2. **What memo removes.** Revisited: React 7.7 -> 4.7 ms/frame, VirtualizerItem self 0.8 -> 0.1, total main thread
   22.1 -> 16.2 ms/frame (-27%), renders 436 -> 42 per frame. Frame time drops under the 25ms line (19.6% -> 1.4% long
   frames, 50 -> 59 fps), matching the earlier result (28.8% -> 2.5% in the minified run).
3. **#10706 in baseline, fresh region.** Time under `layoutIfNeeded` is 5.9 ms/frame (144 ms/s, 16% of busy time,
   `buildRow`/`buildCell`/`buildChild`/`isValid`/`getRenderedColumnWidth`), and it grows over the scroll:
   103 -> 184 ms/s from the first to the second half of the 3s window, with long frames 72% -> 87%. The fix cuts it to
   2.0 ms/frame (55 -> 79 ms/s; it still walks every row from the top through `isValid`, so a small growth remains).
4. **#10706 is why memo did nothing in the fresh region.** Every rebuild runs `buildRow` again for every row since the
   last `update()`, so every visible row and cell gets a new `layoutInfo` object every frame and the memo comparator
   can never match (414 of 437 items still render). With the #10706 fix, rows that are already laid out keep their
   `layoutInfo`, and memo skips 79% of renders even when scrolling into new rows (432 -> 92 per frame).
5. **The two are complementary, not alternatives.** Fresh: #10706 fix alone 42.6% long frames, memo alone 80.6%
   (no change), both 9.9%. Revisited (no #10706 work at all): memo alone takes long frames from 19.6% to 1.4%. So the
   memo win does not depend on #10706, and fixing #10706 does not make it moot; fixing #10706 is what lets memo help
   on the first scroll too.

Other things that show up (not acted on): the `useSelectableCollection` scroll listener forces a synchronous layout
right after the `flushSync` render (2.3 ms/frame); `BaseCollection.getItem` is high in the fresh region (rebuild path).

## Full bucket breakdown (ms per second of scrolling, % of busy)

Note: the main thread is ~85-90% busy in every arm, so ms/s mostly shows *mix*; savings show up as more frames.
The per-frame table above is the comparison to use.

### fresh

| bucket (ms per s of scrolling, profiled runs) | baseline | memo | fix | memo-fix |
|---|---:|---:|---:|---:|
| (a) React reconcile + commit (react-dom, react, scheduler) | 255 (28%) | 263 (29%) | 286 (32%) | 247 (28%) |
| (b) VirtualizerItem + useVirtualizerItem (self) | 28 (3%) | 25 (3%) | 19 (2%) | 9 (1%) |
| (c1) TableLayout/ListLayout (self) | 68 (8%) | 62 (7%) | 18 (2%) | 21 (2%) |
| (c2) Virtualizer, Rect/LayoutInfo, RAC Virtualizer (self) | 18 (2%) | 19 (2%) | 21 (2%) | 26 (3%) |
| (d) Row/cell components (app + RAC Table) | 44 (5%) | 44 (5%) | 27 (3%) | 27 (3%) |
| (d2) other react-aria hooks (press, focus, selection, collection) | 119 (13%) | 119 (13%) | 112 (13%) | 120 (13%) |
| (g) other JS | 11 (1%) | 11 (1%) | 12 (1%) | 13 (1%) |
| JS total (a+b+c+d+g) | 542 (60%) | 542 (61%) | 496 (55%) | 462 (52%) |
| (e) GC | 29 (3%) | 26 (3%) | 22 (2%) | 16 (2%) |
| (f1) forced layout in scroll listener (useSelectableCollection reads scrollTop) | 84 (9%) | 84 (9%) | 89 (10%) | 92 (10%) |
| (f2) (program): native browser work (style, layout, paint) | 245 (27%) | 242 (27%) | 288 (32%) | 320 (36%) |
| busy total (all but idle) | 898 | 895 | 894 | 890 |
| inclusive: under layoutIfNeeded | 144 | 141 | 67 | 79 |
| inclusive: VirtualizerItem render + hooks | 57 | 55 | 60 | 22 |
| inclusive: Virtualizer.render | 155 | 153 | 82 | 98 |

| clean runs (no profiler) | baseline | memo | fix | memo-fix |
|---|---:|---:|---:|---:|
| frames > 25ms (median %) | 78.8 | 80.6 | 42.6 | 9.9 |
| frames > 25ms, early / late half | 72.0 / 86.9 | 72.4 / 88.8 | 51.3 / 36.2 | 13.3 / 8.2 |
| mean frame ms (fps) | 31.0 (32) | 31.3 (32) | 23.8 (42) | 18.3 (55) |
| ScriptDuration ms/s | 627 | 621 | 571 | 512 |
| LayoutDuration ms/s | 76 | 76 | 78 | 80 |
| RecalcStyleDuration ms/s | 9 | 10 | 11 | 11 |
| TaskDuration ms/s | 975 | 989 | 971 | 967 |

| early / late half (ms/s, profiled) | baseline | memo | fix | memo-fix |
|---|---:|---:|---:|---:|
| layoutIfNeededIncl | 103 / 184 | 101 / 179 | 55 / 79 | 67 / 90 |
| buildFnsSelf | 27 / 50 | 21 / 46 | 9 / 20 | 11 / 23 |
| virtualizerItemIncl | 55 / 59 | 52 / 58 | 55 / 65 | 21 / 24 |
| react | 250 / 260 | 254 / 273 | 270 / 304 | 235 / 258 |

### revisited

| bucket (ms per s of scrolling, profiled runs) | baseline | memo | fix | memo-fix |
|---|---:|---:|---:|---:|
| (a) React reconcile + commit (react-dom, react, scheduler) | 293 (34%) | 243 (29%) | 268 (34%) | 223 (28%) |
| (b) VirtualizerItem + useVirtualizerItem (self) | 32 (4%) | 8 (1%) | 35 (4%) | 5 (1%) |
| (c1) TableLayout/ListLayout (self) | 2 (0%) | 3 (0%) | 2 (0%) | 3 (0%) |
| (c2) Virtualizer, Rect/LayoutInfo, RAC Virtualizer (self) | 22 (3%) | 26 (3%) | 22 (3%) | 25 (3%) |
| (d) Row/cell components (app + RAC Table) | 13 (2%) | 12 (1%) | 11 (1%) | 11 (1%) |
| (d2) other react-aria hooks (press, focus, selection, collection) | 65 (8%) | 62 (7%) | 61 (8%) | 60 (8%) |
| (g) other JS | 10 (1%) | 11 (1%) | 10 (1%) | 11 (1%) |
| JS total (a+b+c+d+g) | 435 (51%) | 366 (44%) | 409 (52%) | 338 (43%) |
| (e) GC | 14 (2%) | 13 (2%) | 15 (2%) | 14 (2%) |
| (f1) forced layout in scroll listener (useSelectableCollection reads scrollTop) | 89 (10%) | 92 (11%) | 80 (10%) | 85 (11%) |
| (f2) (program): native browser work (style, layout, paint) | 310 (36%) | 362 (43%) | 282 (36%) | 339 (43%) |
| busy total (all but idle) | 853 | 834 | 788 | 781 |
| inclusive: under layoutIfNeeded | 0 | 0 | 0 | 0 |
| inclusive: VirtualizerItem render + hooks | 65 | 11 | 66 | 10 |
| inclusive: Virtualizer.render | 16 | 21 | 16 | 21 |

| clean runs (no profiler) | baseline | memo | fix | memo-fix |
|---|---:|---:|---:|---:|
| frames > 25ms (median %) | 19.6 | 1.4 | 19.8 | 2.2 |
| frames > 25ms, early / late half | 21.4 / 18.0 | 1.6 / 1.6 | 23.7 / 17.5 | 4.4 / 0.0 |
| mean frame ms (fps) | 19.9 (50) | 16.9 (59) | 20.0 (50) | 17.0 (59) |
| ScriptDuration ms/s | 518 | 385 | 525 | 406 |
| LayoutDuration ms/s | 83 | 85 | 79 | 84 |
| RecalcStyleDuration ms/s | 11 | 13 | 11 | 13 |
| TaskDuration ms/s | 967 | 873 | 970 | 908 |

| early / late half (ms/s, profiled) | baseline | memo | fix | memo-fix |
|---|---:|---:|---:|---:|
| layoutIfNeededIncl | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| buildFnsSelf | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| virtualizerItemIncl | 60 / 70 | 10 / 12 | 52 / 79 | 8 / 11 |
| react | 252 / 332 | 210 / 273 | 210 / 326 | 180 / 266 |

## Top self-time functions, baseline

#### Top self-time functions, baseline / fresh (mean ms/s)

- 243.8 `::(program):-1`
- 84.4 `react-aria/dist/private/selection/useSelectableCollection::(anonymous):216`
- 44.8 `react-aria/dist/private/collections/BaseCollection::getItem:148`
- 31.7 `::(garbage collector):-1`
- 28 `react-dom/cjs/react-dom-client.production::propagateParentContextChanges:2282`
- 19.5 `react-dom/cjs/react-dom-client.production::updateProperties:10761`
- 19.2 `react-aria/dist/private/virtualizer/VirtualizerItem::$6c92e9e346cd7b1c$export$1481e64fbe01b8b3:24`
- 16.9 `react-dom/cjs/react-dom-client.production::updateCallback:3922`
- 16.6 `::(idle):-1`
- 16.3 `react/cjs/react.production::react_production.createElement:331`
- 16.3 `react-stately/dist/private/layout/TableLayout::buildRow:268`
- 14.6 `react-dom/cjs/react-dom-client.production::updateEffect:3876`
- 14.1 `react-stately/dist/private/layout/ListLayout::buildChild:183`
- 13.5 `react-dom/cjs/react-dom-client.production::setValueForStyles:1059`
- 12.6 `react-aria-components/dist/private/Table::(anonymous):174`
- 12.1 `react-stately/dist/private/layout/ListLayout::isValid:178`
- 10.6 `react-aria/dist/private/utils/mergeProps::$bbaa08b3cd72f041$export$9d1611c77c2fe928:4`
- 10.3 `react-aria-components/dist/private/Table::(anonymous):162`
- 10.1 `react-aria/dist/private/interactions/usePress::$d27d541f9569d26d$export$45712eceda6fad21:69`
- 9.9 `react-dom/cjs/react-dom-client.production::commitMutationEffectsOnFiber:7475`

#### Top self-time functions, baseline / revisited (mean ms/s)

- 311.1 `::(program):-1`
- 89.9 `react-aria/dist/private/selection/useSelectableCollection::(anonymous):216`
- 42.2 `react-dom/cjs/react-dom-client.production::propagateParentContextChanges:2282`
- 24.5 `react-aria/dist/private/virtualizer/VirtualizerItem::$6c92e9e346cd7b1c$export$6796df8ba7398521:3`
- 23.9 `react-dom/cjs/react-dom-client.production::updateProperties:10761`
- 23.4 `::(idle):-1`
- 17.5 `react-dom/cjs/react-dom-client.production::updateCallback:3922`
- 16.1 `react-dom/cjs/react-dom-client.production::setValueForStyles:1059`
- 15.4 `react-dom/cjs/react-dom-client.production::updateEffect:3876`
- 14.7 `react/cjs/react.production::react_production.createElement:331`
- 14.4 `::(garbage collector):-1`
- 11 `react-stately/dist/private/virtualizer/Virtualizer::updateSubviews:121`
- 10.8 `react-dom/cjs/react-dom-client.production::setProp:10236`
- 10.5 `react-dom/cjs/react-dom-client.production::commitMutationEffectsOnFiber:7475`
- 9.2 `react-dom/cjs/react-dom-client.production::setTextContent:1040`
- 8.7 `react-dom/cjs/react-dom-client.production::workLoopSync:8954`
- 8.6 `react-aria/dist/private/interactions/usePress::$d27d541f9569d26d$export$45712eceda6fad21:69`
- 8.4 `react-dom/cjs/react-dom-client.production::commitHookEffectListUnmount:6402`
- 8 `react-aria/dist/private/utils/mergeProps::$bbaa08b3cd72f041$export$9d1611c77c2fe928:4`
- 7.9 `react-dom/cjs/react-dom-client.production::updateInsertionEffect:3897`

## Caveats

- Emulated 4x CPU throttling, 60Hz headless Chrome, one table design, fixed row heights (no `estimatedSize`, which
  the memo comparator always re-renders).
- The sampling profiler adds overhead (profiled runs have more long frames than clean runs), so bucket numbers come
  from profiled runs and frame stats from clean runs. 6 profiled + 6 clean runs per arm x region; medians.
- The #10706 arm is a one-line local approximation of the fix proposed in the issue, not a reviewed upstream change.
- The `revisited` region has no #10706 cost by construction (layout already covers the range). In a real app,
  whether scrolling hits #10706 depends on how often `update()` runs (collection or size changes reset `validRect`).
- `(program)` is native work Chrome couldn't attribute to JS; style/layout/paint are not split out inside it.
  `LayoutDuration`/`RecalcStyleDuration` metrics are similar across arms (76-85 / 9-13 ms/s).

## Files

- `profile/` builds, harness (`run-profile.mjs`), analysis (`analyze-profile.mjs`), counters (`count.mjs`)
- `results/profile-raw.json` per-run data (reduced profiles, frames, metrics); `results/profile-summary.json`
  aggregated; `results/profile-per-frame.json` per-frame costs; `results/profile-render-counts.json`;
  `results/profile-cpuprofiles/*.cpuprofile` one raw profile per arm x region (open in Chrome DevTools)
