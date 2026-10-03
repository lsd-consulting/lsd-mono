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

## Rerun — arrow payloads and click (3 Oct 2026, 17:17 BST)

Same machine (Apple M3 Max, macOS 26.6.2), same headless Chromium **140.0.7339.16** (Playwright 1.55.0), viewport 1440×900. Script: [`docs/perf/measure.mjs`](perf/measure.mjs). Mono HTML regenerated by [`docs/perf/generate-mono.mjs`](perf/generate-mono.mjs) into the current report shell. Legacy HTML is the previous fixture, remeasured only so the harness still has a side-by-side.

This is **not** a replacement of the baseline above. That run had no per-arrow payload. This one does.

### What changed in the fixture

Every mono message carries a popup payload of **2,770 bytes** of JSON: `method`, `path`, `status`, `headers` (including a long trace id), and a `body` with 12 line items. Marker string `arrow-payload`. 100 / 500 / 2000 messages, so the 2000-event page holds about **5.5 MB** of backing data (HTML **9.9 MB**, was 452 KB). The note `needle-100` / `needle-500` / `needle-2000` is unchanged. After first interactive, search, and zoom, the script scrolls to message **1** and to the mid message (**50 / 250 / 1000**), clicks that arrow's button, and waits until `#dialog-pre` contains that message's `orderId`.

### Mono, old vs new

| | Baseline (no payload) | This run (2.8 KB × N, plus two arrow clicks) |
|--|----------------------|-----------------------------------------------|
| 2000 first interactive | 112 ms | **183 ms** |
| 2000 JS heap after load | 2.5 MB (2,513,904) | **9.6 MB (9,635,680)** |
| 2000 DOM nodes after load | 276 | **274** |
| 2000 click → popup | not measured | **35 ms** first (`place order`, id 1) and **35 ms** mid (`ok`, id 1000) |
| 2000 heap / DOM with popup open | — | **11.7 MB (11,677,520)** / **318** nodes |
| 2000 long tasks | none | none during scroll; none after the clicks |
| 500 first interactive | 114 ms | 113 ms |
| 500 heap / DOM | 2,902,124 / 276 | 4,267,124 / 274 |
| 500 click → popup | — | 35 ms (id 1), 37 ms (id 250); popup heap 4,665,208; DOM 319 |
| 100 first interactive | 205 ms | 118 ms |
| 100 heap / DOM | 2,816,572 / 276 | 3,151,244 / 274 |
| 100 click → popup | — | 34 ms (id 1), 35 ms (id 50); popup DOM 313 |

Search and zoom still pass (2000: find 33 ms, zoom 35 ms, `needle-2000` shows `[match]`). Frame p95 stays 16.7 ms. The DOM does not grow with the event count; the extra nodes after the click are the open dialog. The heap does grow, by roughly the parsed payloads (about +7 MB at 2000 versus the 2.5 MB baseline) and a bit more once the popup string is built.

### Full table (this pass)

| Date | Machine | Chrome | Size | Side | First interactive ms | FCP ms | p95 frame ms | Longest frame ms | Heap after load | Heap after scroll | Search ms | Zoom ms | Popup first ms | Popup mid ms | Heap after popup | DOM after load | DOM after popup | Pass/fail | Note |
|------|---------|--------|------|------|----------------------|--------|--------------|-------------------|-----------------|-------------------|-----------|---------|----------------|--------------|------------------|----------------|-----------------|-----------|------|
| 2026-10-03 | M3 Max | Chromium 140.0.7339.16 | 100 | mono | 118 | 140 | 16.7 | 16.8 | 3,151,244 | 2,973,776 | 33 | 37 | 34 | 35 | 2,675,064 | 274 | 313 | pass | ids 1 and 50; 0 long tasks |
| 2026-10-03 | M3 Max | Chromium 140.0.7339.16 | 100 | legacy-split-50 | 25 | 120 | 16.7 | 16.8 | 13,012,864 | 9,489,608 | — | — | — | — | — | 1,378 | — | pass | unchanged fixture; 1 long task, 69 ms |
| 2026-10-03 | M3 Max | Chromium 140.0.7339.16 | 100 | legacy-one-svg | 28 | 72 | 16.7 | 16.8 | 13,005,880 | 9,488,504 | — | — | — | — | — | 1,342 | — | pass | unchanged fixture; 1 long task, 68 ms |
| 2026-10-03 | M3 Max | Chromium 140.0.7339.16 | 500 | mono | 113 | 136 | 16.7 | 16.8 | 4,267,124 | 3,698,172 | 32 | 29 | 35 | 37 | 4,665,208 | 274 | 319 | pass | ids 1 and 250; 0 long tasks |
| 2026-10-03 | M3 Max | Chromium 140.0.7339.16 | 500 | legacy-split-50 | 40 | 96 | 16.8 | 16.8 | 23,661,628 | 9,551,556 | — | — | — | — | — | 6,098 | — | pass | unchanged fixture; 1 long task, 114 ms |
| 2026-10-03 | M3 Max | Chromium 140.0.7339.16 | 500 | legacy-one-svg | 43 | 112 | 16.7 | 16.8 | 20,564,736 | 9,503,752 | — | — | — | — | — | 5,742 | — | pass | unchanged fixture; 1 long task, 113 ms |
| 2026-10-03 | M3 Max | Chromium 140.0.7339.16 | 2000 | mono | 183 | 184 | 16.7 | 16.8 | 9,635,680 | 10,556,012 | 33 | 35 | 35 | 35 | 11,677,520 | 274 | 318 | pass | ids 1 and 1000; header, zoom, `[match]` fine; 0 long tasks |
| 2026-10-03 | M3 Max | Chromium 140.0.7339.16 | 2000 | legacy-split-50 | 484 | 168 | 16.8 | 16.8 | 53,734,824 | 9,999,676 | — | — | — | — | — | 23,798 | — | n/a | unchanged fixture; 3 long tasks, max 276 ms |
| 2026-10-03 | M3 Max | Chromium 140.0.7339.16 | 2000 | legacy-one-svg | 454 | 164 | 16.8 | 16.8 | 44,862,064 | 9,881,080 | — | — | — | — | — | 22,242 | — | pass | unchanged fixture; 3 long tasks, max 255 ms |

### Verdict of this rerun

Mono at 2000 events is still usable with the backing data in memory. First interactive moved from **112 ms to 183 ms**, and the heap from **2.5 MB to 9.6 MB** (11.7 MB with the popup open). The DOM stayed flat at **274** nodes (baseline 276) and **318** once the dialog is open. Opening an arrow is about **35 ms** for both the top message and message 1000. No long tasks on the mono pages. Legacy numbers are in the same band as the baseline; those files were not rebuilt.

## Wide participants (3 Oct 2026, 20:11 BST)

This is a **separate run** from the 4-participant tables above. It does not replace them.

Same machine (Apple M3 Max, macOS, headless Chromium **140.0.7339.16**, Playwright 1.55.0), viewport 1440×900. The diagram's own scrollport is 963×611 inside that viewport (sidebar and the stage cap). Scripts: [`docs/perf/generate-wide.mjs`](perf/generate-wide.mjs) and [`docs/perf/measure-wide.mjs`](perf/measure-wide.mjs). HTML opened with `file://` from `docs/perf-samples/` (gitignored).

### What this is next to

The 4-participant, 2000-event rerun above is the baseline for "lots of messages": first interactive **183 ms**, JS heap **9.6 MB (9,635,680)** with the payloads **inlined** in the HTML, DOM **274**. After payloads were split out of the HTML, that same 4-participant page on disk is **454,967 bytes** (~455 KB) plus a sibling `mono-2000-payloads.js` (5,643,568 bytes). That lazy page was not remeasured in the browser for this section. The wide run below is the lazy shape from the start: method, path, and status stay on the message, and the rest of the JSON loads when the inspector opens.

### Fixture

Participants cycle through actor, database, queue, component, entity, and boundary, so the header shapes are in the measurement. Names are short (`User 01`, `Orders 02`, `Queue 03`, …). Messages hop across the columns, and every 25th message spans the first participant to the last. The first message is a one-column hop on the left, so Fit has a top label near the origin. Each message has the same ~2.7 KB popup body as the earlier payload fixture (`arrow-payload`, `orderId`). No search and no zoom-button timing. One click, on message 1, after Fit. JSON is already expanded when the inspector opens. That click is included in the times below.

| Participants | Messages | HTML | Sibling payloads |
|--------------|----------|------|------------------|
| 20 | 400 | 160,806 bytes | 1,112,471 bytes |
| 50 | 400 | 162,247 bytes | 1,112,531 bytes |
| 100 | 400 | 165,078 bytes | 1,113,011 bytes |
| 100 | 2000 | 471,608 bytes | 5,619,888 bytes |

Logical diagram width is 2,804 / 7,004 / 14,004 px (140 px column gap). At 100% zoom the scrollport's horizontal overflow is 1,841 / 6,041 / 13,041 px.

### Browser (after the scrollport fix below)

First interactive is wall time from `goto` (`waitUntil: commit`) until `.seq-sticky-header` is visible. The sweep is 2 s of `requestAnimationFrame`, moving vertical and horizontal scroll together. Heap is CDP `JSHeapUsedSize`. DOM counts are `getElementsByTagName('*').length`. Header nodes are elements inside `.seq-sticky-header` only. Those grow with the participant count. Message rows stay virtualised: 100 participants is 1,101 nodes at both 400 and 2,000 messages.

| Participants | Messages | First interactive ms | FCP ms | p95 frame ms | Longest frame ms | Heap after load | Heap after scroll | Heap after popup | DOM | Header nodes | Popup ms | Long tasks |
|--------------|----------|----------------------|--------|--------------|-------------------|-----------------|-------------------|------------------|-----|--------------|----------|------------|
| 20 | 400 | 112 | 136 | 16.8 | 16.8 | 2,684,412 | 2,179,872 | 5,122,800 | 435 | 109 | 66 | 0 |
| 50 | 400 | 95 | 116 | 16.8 | 16.8 | 2,749,808 | 2,464,652 | 5,685,772 | 685 | 269 | 66 | 0 |
| 100 | 400 | 100 | 120 | 16.8 | 16.8 | 3,157,360 | 2,855,036 | 4,638,824 | 1,101 | 535 | 66 | 0 |
| 100 | 2000 | 104 | 124 | 16.8 | 16.8 | 4,626,280 | 5,723,108 | 12,258,316 | 1,101 | 535 | 89 | 0 |

Popup DOM is 7 nodes higher (442 / 692 / 1,108 / 1,108). The 100×2000 popup heap (12.3 MB) is the sibling payload script being parsed on that click. The other three clicks also load their ~1.1 MB sibling. Heap moves around with GC. It is not a DOM-size signal.

Horizontal scroll works on all four. `.seq-scroll` is `overflow: auto`. Setting `scrollLeft` to the maximum lands on it (1,841 / 6,041 / 13,041). The last participant label is then inside the scrollport and the first label is off the left edge, so the sticky header moves with the horizontal scroll rather than staying painted at the left. During the vertical sweep the header stays stuck to the top of the scrollport. No label bounding boxes overlap at 100% zoom (0 overlaps at 20, 50, and 100). Shapes in the 100-participant header: 17 actor, 17 database, 17 queue, 17 component, 16 entity, 16 boundary.

Fit, after the zoom animation settles (`scrollTop` 0):

| Participants | Fit zoom | Top label in the scrollport | Label size | Horizontal overflow left after Fit |
|--------------|----------|------------------------------|------------|-------------------------------------|
| 20 | 34% | yes (`hop`, message 1) | 7×5 px | 0 (scroll width equals the 963 px client width) |
| 50 | 25% (the floor) | yes | 5×4 px | 788 px |
| 100 | 25% (the floor) | yes | 5×4 px | 2,538 px |

The visible word is `hop`. The DOM text is `hophop` because the SVG `<title>` repeats it. 50 and 100 participants do not fit the width: zoom stops at 25%, so Fit still leaves a horizontal scrollbar. The top label is on screen, but only a few pixels tall. That is the clamp, not a clip of the label box.

The show/hide buttons wrap. Their block is 96 px tall at 20 participants, 232 px at 50, and 436 px at 100. At 100 participants the diagram header's document position is about y=954, which is below this 900 px viewport until the page itself is scrolled. The buttons do not overflow horizontally (953 px scroll width in a 953 px row). Labels in the header do not collide.

### What was broken, and the small fix

The first pass, before the CSS change, still scrolled horizontally, and the header labels did not overlap. Vertical scrolling did not. `.seq-stage` was capped at 612 px, but its auto row sized to the drawing, so `.seq-scroll` grew to the content. On the 100×2000 page that was client height **104,149** equal to the scroll height, **15,482** DOM nodes (every row painted), **22** frames in the 2 s sweep, p95 **150 ms**, **20** long tasks up to **148 ms**, first interactive **245 ms**. The page scroll height stayed about 1,700 px, so the drawing below the stage could not be reached.

The change is only the stage row: `grid-template-rows: minmax(0, min(68vh, 640px))` and `overflow: hidden`, with the print rule turning that clip off. Remeasured numbers are the table above. Scrollport client height is **611** px on every case. 100 participants is **1,101** nodes at both 400 and 2,000 messages, frame p95 is **16.8 ms**, and there were no long tasks.

### Samples (local, gitignored)

- `/Users/nicholasmcdowall/Developer/lsd-mono/docs/perf-samples/mono-p20-m400-diagram.html`
- `/Users/nicholasmcdowall/Developer/lsd-mono/docs/perf-samples/mono-p50-m400-diagram.html`
- `/Users/nicholasmcdowall/Developer/lsd-mono/docs/perf-samples/mono-p100-m400-diagram.html`
- `/Users/nicholasmcdowall/Developer/lsd-mono/docs/perf-samples/mono-p100-m2000-diagram.html`

Each has a sibling `*-payloads.js` in the same directory.
