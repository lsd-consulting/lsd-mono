# Large-diagram browser check

Measured **3 Oct 2026, 16:33 BST** on an Apple M3 Max, macOS 26.6.2, headless Chromium **140.0.7339.16** (Playwright 1.55.0). Viewport 1440×900. One cold-ish context per page. Script: [`docs/perf/measure.mjs`](perf/measure.mjs). HTML opened with `file://` from `docs/perf-samples/` (gitignored; paths below).

This is the run after `load`, with the legacy CDN scripts (`d3`, highlight.js) already cached. An earlier pass is only a caveat, not this table.

## Fixture

Same cycle on both sides, four participants (`Client`, `Api`, `Payments`, `Database`):

1. `Client` → `Api` sync, `place order`
2. `Api` → `Payments` sync, `charge`, **15 ms** duration
3. `Payments` → `Database` sync, `insert`
4. `Database` → `Payments` sync response, `ok`

25 / 125 / 500 cycles = **100 / 500 / 2000** messages, plus one note over `Api`: `needle-100`, `needle-500`, `needle-2000`. No `newpage` and no mono section. Legacy `completeReport` also renders the component diagram (the extra, smaller SVG in each file). Mono components stayed off. Virtualisation is the normal shell path.

Legacy overrides for this run: `devMode=false`, label width 200, metrics on. Split uses cap **50** (the default). One-SVG uses cap **10000**.

## Generation (not the browser table)

| Side | Events | Generate | HTML | SVGs |
|------|--------|----------|------|------|
| mono | 100 | 33 ms | 82 KB | shell |
| mono | 500 | 12 ms | 160 KB | shell |
| mono | 2000 | 22 ms | 452 KB | shell |
| legacy-split-50 | 100 | 32 ms | 123 KB | 3 |
| legacy-split-50 | 500 | 154 ms | 566 KB | 11 |
| legacy-split-50 | 2000 | 964 ms | 2.2 MB | 41 |
| legacy-one-svg | 100 | 39 ms | 120 KB | 2 |
| legacy-one-svg | 500 | 72 ms | 541 KB | 2 |
| legacy-one-svg | 2000 | 998 ms | 2.1 MB | 2 |

The 2000-event single SVG is real PlantUML: `height:58778px`, no syntax error. PlantUML did not time out.

## Browser

First interactive is wall time from `goto` (`waitUntil: commit`) until the diagram is visible: mono `.seq-sticky-header`, legacy `section.sequence svg`. Scroll is a 2 s `requestAnimationFrame` sweep of the mono `.seq-scroll` or the legacy page. Frame times are those rAF deltas (~121 frames, so about 60 Hz). Heap is CDP `JSHeapUsedSize` (V8, not the DOM). Search and zoom are mono only. DOM node counts are `getElementsByTagName('*').length` after load.

| Date | Machine | Chrome | Size | Side | First interactive ms | FCP ms | p95 frame ms | Longest frame ms | Heap after load | Heap after scroll | Search ms | Zoom ms | Pass/fail | Note |
|------|---------|--------|------|------|----------------------|--------|--------------|-------------------|-----------------|-------------------|-----------|---------|-----------|------|
| 2026-10-03 | M3 Max | Chromium 140.0.7339.16 | 100 | mono | 205 | 148 | 16.8 | 16.8 | 2,816,572 | 2,110,624 | 43 | 49 | pass | 276 DOM nodes; `[match]` shown |
| 2026-10-03 | M3 Max | Chromium 140.0.7339.16 | 100 | legacy-split-50 | 24 | 108 | 16.8 | 16.8 | 12,993,760 | 9,488,968 | — | — | pass | 1,378 nodes; 1 long task, 69 ms |
| 2026-10-03 | M3 Max | Chromium 140.0.7339.16 | 100 | legacy-one-svg | 28 | 104 | 16.7 | 16.8 | 13,031,496 | 9,488,504 | — | — | pass | 1,342 nodes; 1 long task, 70 ms |
| 2026-10-03 | M3 Max | Chromium 140.0.7339.16 | 500 | mono | 114 | 132 | 16.7 | 16.8 | 2,902,124 | 2,450,088 | 34 | 47 | pass | 276 DOM nodes; `[match]` shown |
| 2026-10-03 | M3 Max | Chromium 140.0.7339.16 | 500 | legacy-split-50 | 39 | 112 | 16.8 | 16.8 | 22,122,892 | 9,552,300 | — | — | pass | 6,098 nodes; 1 long task, 114 ms |
| 2026-10-03 | M3 Max | Chromium 140.0.7339.16 | 500 | legacy-one-svg | 42 | 124 | 16.7 | 16.8 | 20,558,720 | 9,503,500 | — | — | pass | 5,742 nodes; 1 long task, 112 ms |
| 2026-10-03 | M3 Max | Chromium 140.0.7339.16 | 2000 | mono | 112 | 128 | 16.7 | 16.8 | 2,513,904 | 2,412,344 | 6 | 33 | pass | 276 DOM nodes; header, zoom, `[match]` all fine |
| 2026-10-03 | M3 Max | Chromium 140.0.7339.16 | 2000 | legacy-split-50 | 470 | 164 | 16.7 | 16.8 | 53,884,820 | 10,000,084 | — | — | n/a | 23,798 nodes; 41 SVGs; 3 long tasks, max 267 ms. Not the win condition |
| 2026-10-03 | M3 Max | Chromium 140.0.7339.16 | 2000 | legacy-one-svg | 450 | 156 | 16.7 | 16.8 | 44,541,856 | 9,880,996 | — | — | pass | 22,242 nodes; SVG 58,778 px tall; 3 long tasks, max 254 ms. No multi-second freeze |

## Verdict

Mono stays usable at 2000 events: the participant header is on screen in about 112 ms, scroll frames stay on a 16.8 ms vsync, zoom is 33 ms, find is 6 ms, and `needle-2000` shows `[match]`. The DOM stays at 276 nodes at 100, 500, and 2000 because only the visible rows are painted. The single legacy SVG does **not** fall over on this machine: PlantUML finished in 998 ms, the first sequence SVG was visible in 450 ms, and the scripted scroll did not freeze. It is a much heavier page (22,242 nodes, about 44 MB of JS heap after load, a 58,778 px SVG, and long tasks up to 254 ms). Headless `scrollTop` on an M3 Max is a weak test of raster jank, so this run does not show the failure mode the pass bar expected; it does show mono doing the same scenario with a flat DOM and no long tasks.

## Caveats

- Headless Chromium, one published run, not a manual Performance trace. Frame p95 near 16.7 ms means the sweep kept up with vsync; it does not mean a real drag on a slower laptop would feel the same.
- Legacy HTML pulls `d3` and highlight.js from jsDelivr. The first pass, before that cache was warm, recorded one 3,374 ms frame on `legacy-split-50` at 100 events and did not repeat it. That pass also saw the 2000-event single SVG’s sequence element at 92 ms, before `load`. The table above is the second pass, sampled after `load`.
- `JSHeapUsedSize` drops after the scroll on the legacy pages (GC). It is not GPU or DOM memory. Node count is the better size signal.
- Split-at-50 can paint quickly because each SVG is small. At 2000 events that is 40 sequence diagrams plus the component SVG, with activations removed. That is a different product, not a win over mono.

## Samples (local, gitignored)

Open these in a browser:

- `/Users/nicholasmcdowall/Developer/lsd-mono/docs/perf-samples/mono-100-diagram.html`
- `/Users/nicholasmcdowall/Developer/lsd-mono/docs/perf-samples/mono-500-diagram.html`
- `/Users/nicholasmcdowall/Developer/lsd-mono/docs/perf-samples/mono-2000-diagram.html`
- `/Users/nicholasmcdowall/Developer/lsd-mono/docs/perf-samples/legacy-split-50-100.html`
- `/Users/nicholasmcdowall/Developer/lsd-mono/docs/perf-samples/legacy-split-50-500.html`
- `/Users/nicholasmcdowall/Developer/lsd-mono/docs/perf-samples/legacy-split-50-2000.html`
- `/Users/nicholasmcdowall/Developer/lsd-mono/docs/perf-samples/legacy-one-svg-100.html`
- `/Users/nicholasmcdowall/Developer/lsd-mono/docs/perf-samples/legacy-one-svg-500.html`
- `/Users/nicholasmcdowall/Developer/lsd-mono/docs/perf-samples/legacy-one-svg-2000.html`
