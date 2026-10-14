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

### Top self-time functions, baseline / fresh (mean ms/s)

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

### Top self-time functions, baseline / revisited (mean ms/s)

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
