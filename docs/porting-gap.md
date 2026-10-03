# LSD Mono — porting gap report

**Scope:** features still to port from legacy `modules/lsd-core` (`com.lsd.core`) into greenfield `integrations/lsd-mono-core` (`io.lsdconsulting.lsd.mono.core`) and its `report-next/` UI.

**Inspected (local tree, slices through P1 diagram UX, 2026-10-03):** legacy domain / `LsdContext` / report pipeline / builders / properties; mono capture, report writer, JSON models, JUnit Jupiter 6 extension; report-next types, SVG renderer, chrome.

Legacy is **inspiration and migration API only** — not the product path. Generating PlantUML as the product renderer is explicitly **out**.

---

## 1. Goal

Replace the PlantUML → SVG → Handlebars HTML pipeline with a **modern web stack** (report-next: Vite + TypeScript + custom SVG) that is responsive, keyboard-friendly, and can handle **very large diagrams** without chopping them into PlantUML pages.

Keep a **migration-friendly capture API** (familiar `LsdContext` shapes) under Mono artifact names (`lsd-mono-core`, `lsd-mono-*`).

Treat **quality tests as first-class**: golden `ReportJson` contracts first, unit tests for domain/layout rules, browser smoke later — not golden PlantUML/SVG blobs.

---

## 2. Already ported (verified against current code)

These are **implemented**, not stubs, unless noted.

| Area | Evidence |
|------|----------|
| Participants (name/id/alias/colour + types ACTOR, PARTICIPANT, DATABASE, QUEUE, ENTITY, BOUNDARY) | `integrations/lsd-mono-core/.../domain/Participant.kt`; auto-register on capture in `LsdContext.bind` / `resolve` |
| Facts | `addFact` → `FactJson` in report |
| Messages: SYNCHRONOUS, SYNCHRONOUS_RESPONSE, ASYNCHRONOUS, LOST, BI_DIRECTIONAL, SHORT_INBOUND, SHORT_OUTBOUND (+ colour, data, durationMs) | `domain/SequenceEvent.kt` `MessageType`; JSON `MessageEventJson` — short types + distinct LOST/BI SVG **landed 2026-10-03** |
| Note over / left / right | `Note` + `NotePlacement` + DSL `noteOver` / `noteLeft` / `noteRight` — **landed 2026-10-03** |
| Delay + spacer | `Delay` / `Spacer` + DSL `delay` / `spacer` — **landed 2026-10-03** |
| Logical dividers | `Divider` / `logicalDivider` |
| Lifeline activate / deactivate | `Lifeline` + DSL `LifelineAction.lifeline` |
| Kotlin capture DSL (`"A" messages "B" withLabel …`) | `capture/CaptureDsl.kt` |
| Scenario / report / index / clear / clearScenarioEvents | `LsdContext.kt` |
| `ReportJson` + `window.__LSD_REPORT__` injection into shell | `report/ReportWriter.renderShell`; locked by `CaptureToJsonTest` |
| Minimal listing HTML + `report.json` / `*-report.json` | `ReportWriter.writeReport` |
| report-next chrome: sticky topbar + sticky sidebar, search (title/description/facts), status chips, dark/light theme, keyboard (`/ j k Enter d ? Esc`), message `<dialog>` + copy | `report-next/src/main.ts`, `ui/theme.ts`, `styles/app.css` |
| Custom SVG sequence (participants, activations, notes, dividers, message hits) | `report-next/src/lib/sequence-diagram.ts` |
| JUnit Jupiter 6 extension + `@LsdPostTestProcessing` | `LsdExtension.kt` — success / fail / disabled / aborted / nested / post-processing; failures are `error` JSON (`headline`, `message`, `stack`), not overlay HTML. Locked by `LsdExtensionOutcomesTest`. |
| Popup HTML helper (legacy-shaped `:target` overlay markup) | `report/PopupContent.kt` — **no longer used by the JUnit extension**. Left as a migration shim only. |
| Properties: output dir, deterministic ids, hide stacktrace, metrics gate (default **on**), label max width (+ legacy key fallbacks) | `properties/LsdProperties.kt`, `ReportOptions.kt` |
| Duration insights (bottleneck tree or slowest messages) + label truncation | `report/Bottlenecks.kt`; shell `ui/insights.ts` + `truncateLabel`. **Landed 2026-10-03.** Not PlantUML timings. |
| Component graph from captured messages | `report/ComponentGraph.kt`. Opt-in `lsd.mono.components.enabled` (default **false**). Per-scenario `components` on report JSON, combined `components.json` + labelled SVG. **Landed 2026-10-03.** Not PlantUML. |
| Diagram zoom, fit, hide columns, in-diagram find | report-next toolbar on the sequence diagram. Out / Fit / In, ctrl or meta + wheel, fit-to-width (clamped). Hide/show is in-memory per diagram: the column goes, messages and anchored notes that need it are omitted, other columns reflow. Find highlights message labels and notes with a `[match]` cue and a live count. **Landed 2026-10-03.** Not colour-only. Virtualisation and the sticky header stay. |

**Stubs / thin surfaces (do not treat as done):**

- Module README still says injection is deferred; code + `CaptureToJsonTest` show injection **works** — README is stale. Component reports are no longer a stub.

---

## 3. Missing features (by area)

Each item: legacy behaviour → why it matters → suggested greenfield shape → priority → locking test.

### 3.1 Capture / events not yet mirrored

#### P0 — Scenario sections / “pages” without PlantUML `newpage` — **landed 2026-10-03**

| | |
|--|--|
| **Legacy** | `Newpage` + nested `PageTitle` in `domain/SequenceEvent.kt`; `List.groupedByPages()` in `diagram/SequenceDiagramGenerator.kt` splits the event stream; also chunks by `maxEventsPerDiagram` (default 50 via `lsd.core.diagram.sequence.maxEventsPerDiagram`). Activations are **dropped** when a split would occur. |
| **Shipped** | `Section` (`kind: "section"`, `title`) via `LsdContext.section(title)` and capture DSL `section(title)`. report-next draws a title row and a jump list. One continuous diagram — no extra SVGs. Activations are **not** closed at the boundary. |
| **Still open** | Optional soft warn on huge event counts. Legacy `PageTitle` as a separate event is not ported (the section title covers it). |
| **Test** | `SectionCaptureTest` — two sections, activate before and deactivate after. |

#### P0 — Large-diagram UX (virtualisation / windowing) — **landed 2026-10-03** (zoom/fit landed in slice 7)

| | |
|--|--|
| **Legacy** | Caps events per diagram (`ReportOptions.maxEventsPerDiagram`) and splits — a workaround for PlantUML SVG size / browser pain. |
| **Shipped** | `report-next/src/lib/layout.ts` lays out rows in CSS pixels. `virtualRowRange` paints only the scroll window plus overscan. Sticky participant header sits inside the diagram scrollport so names stay visible. Full event list stays in JSON. |
| **Still open** | Density modes. Browser FPS check with N≥500. Zoom and fit landed in the diagram UX slice; horizontal scroll is the pan. |
| **Test** | `layout.test.ts` (`npm test` in `report-next`) — scrollTop + viewport → row range, including sticky-header inset and overscan. |

#### P1 — Note left / note right — **landed 2026-10-03**

| | |
|--|--|
| **Legacy** | `NoteLeft` / `NoteRight` (± optional `ofParticipant`) → PlantUML `note left` / `note right`. |
| **Shipped** | Single `Note` with `placement: over \| left \| right` and optional `over` anchor. DSL `noteOver` / `noteLeft` / `noteRight`; `LsdContext.noteLeft` / `noteRight`. SVG offsets left/right of the lifeline (or diagram centre when unanchored) and adds a placement text cue (not colour-only). |
| **Test** | `RemainingSequenceEventKindsTest`; `sequence-diagram.test.ts` (`noteLayout` / placement attrs). |

#### P1 — Time delay & vertical space — **landed 2026-10-03**

| | |
|--|--|
| **Legacy** | `TimeDelay` / `VerticalSpace`. |
| **Shipped** | `Delay` (`kind: "delay"`, optional label) and `Spacer` (`kind: "spacer"`, optional `heightPx`). Ellipsis / tick SVG rows. Row heights via `eventRowHeight` (spacer clamped 12–240). |
| **Test** | `RemainingSequenceEventKindsTest`; `layout.test.ts` (`eventRowHeight`). |

#### P1 — Short inbound / outbound arrows — **landed 2026-10-03**

| | |
|--|--|
| **Legacy** | `SHORT_INBOUND` / `SHORT_OUTBOUND` as `?->` / `->?`. |
| **Shipped** | Message types + DSL `shortInbound` / `shortOutbound`. Phantom end is an empty `from`/`to` string — **no** `?` participant. SVG stub toward the diagram edge (`shortMessageEndpoints`) with `[in]` / `[out]` text cues. |
| **Test** | `RemainingSequenceEventKindsTest`; `sequence-diagram.test.ts` (geometry + fragments). |

#### P1 — Distinct LOST / BI_DIRECTIONAL rendering — **landed 2026-10-03**

| | |
|--|--|
| **Legacy** | Lost (`->x`) and bi-directional (`<->`) arrows. |
| **Shipped** | `messageArrowSpec` + markers in `sequence-diagram.ts`: LOST = X tip + `[lost]` cue; BI = dual filled heads + `↔` cue. Colour is never the only cue. |
| **Test** | `sequence-diagram.test.ts` (marker paths, marker-start/end, type cues). |

#### P2 — Lifeline activate colour — **landed 2026-10-03**

| | |
|--|--|
| **Legacy** | `Lifeline.colour` colours PlantUML `activate … #colour`. |
| **Shipped** | Optional `colour` on activate (`LsdContext.activate(participant, colour)` and `ACTIVATE lifeline "api" withColour "#c026d3"`). Omitted from JSON when absent, so the default bar is unchanged. The SVG bar uses that colour and, when set, a hatch plus the label `coloured activation` (not colour-only). Deactivate ignores colour. |
| **Test** | `ActivateColourAndTimestampsTest` (JSON). `activationBarSvg` in `sequence-diagram.test.ts`. `activationSpans` colour in `layout.test.ts`. |

#### P2 — Participant types CONTROL / COLLECTIONS

| | |
|--|--|
| **Legacy** | `ParticipantType.CONTROL`, `COLLECTIONS` (`domain/Participant.kt`); used in component + sequence PlantUML participant keywords. Explicitly omitted in mono `Participant.kt` comments. |
| **Why** | Rare; approval sample uses `CONTROL.called("Cat")`. |
| **Greenfield** | Either map to `PARTICIPANT` with a visual variant icon, or add optional types to the report-next union if migration demand appears. Prefer **not** inventing PlantUML stereotypes. |
| **Priority** | **P2** |
| **Test** | Golden participant `type` if added; otherwise migration guide only. |

#### P2 — Event timestamps / stable sort — **landed 2026-10-03**

| | |
|--|--|
| **Legacy** | Every `SequenceEvent` has `created: Instant`; generator sorts by it. |
| **Shipped** | Optional `createdAt` (`Instant` in Kotlin, ISO-8601 string in JSON). `orderByCreatedAt` runs in `completeScenario` before the scenario is stored, and `layoutRows` sorts again before painting. No timestamps → capture order. Timed events sort ascending; untimed events stay in capture order after the timed ones. |
| **Test** | `ActivateColourAndTimestampsTest` (out-of-order capture ends up sorted in JSON). `sortEventsByCreatedAt` in `layout.test.ts`. |

#### OUT — `includeFiles` / PlantUML sprite includes

| | |
|--|--|
| **Legacy** | `LsdContext.includeFiles` → `!include` lines in sequence UML (`SequenceDiagramGenerator`). Approval test pulls Font Awesome sprites. |
| **Why** | Pure PlantUML theming / sprites. |
| **Greenfield** | **Do not port.** Optional later: first-party icon set or custom participant icon URLs in JSON — not PlantUML includes. |
| **Priority** | **OUT** |
| **Test** | n/a |

---

### 3.2 Report generation parity

#### P0 — Multi-scenario report UX already works; harden contract + status rollup tests

| | |
|--|--|
| **Legacy** | Multiple `completeScenario` → one HTML report with contents menu when `scenarios.size > 1`; overall status from worst of ERROR > FAILURE > SUCCESS (`LsdContext.determineOverallStatus`). |
| **Mono today** | Same multi-scenario JSON model + report-next sidebar; overall status CSS on listing/index. Covered partially by capture tests, not a dedicated multi-status golden. |
| **Greenfield** | Keep JSON as source of truth; ensure index + listing + shell all share status vocabulary (`success` / `warn` / `error`). |
| **Priority** | **P0** (tests + contract polish) |
| **Test** | Golden JSON: 3 scenarios (success/warn/error); assert rollup and filter chips counts. |

#### P0 — Message payload / popup UX in the **product** shell

| | |
|--|--|
| **Legacy** | Message labels are PlantUML links to `#id` overlays; `DataHolder` list feeds popup content; `PopupContent.popupHyperlink` for arbitrary HTML (e.g. stacktraces). `javascript` partial loads `custom.js` for scroll/open helpers. |
| **Mono today** | Message `data` opens report-next `<dialog>` (good). **JUnit failures landed 2026-10-03** as scenario `error: { headline, message, stack }` — plain-text `description`, no `:target` overlay. report-next shows the message as escaped text and opens the stack in the existing dialog (`Show stack trace`). `PopupContent` remains unused by the extension. |
| **Still open** | Pretty-print / size limits for message payloads (P1). Browser check that the dialog copy button works. |
| **Priority** | **P1** for payload polish. The JUnit structured-failure slice is **done**. |
| **Test** | `LsdExtensionOutcomesTest` (TempDir, deterministic ids) asserts failed/aborted JSON has `headline` / `message` / `stack` and no `overlay`. `scenario-summary.test.ts` locks escaped message HTML and that the stack is not inlined. |

#### P1 — Facts panel parity

| | |
|--|--|
| **Legacy** | Facts card in Handlebars `html-report.hbs` when non-empty. |
| **Mono** | Facts in JSON + report-next “Key facts” card + searchable. Listing HTML also lists facts. |
| **Gap** | Empty facts still render an empty card in the spike; minor polish. Ensure HTML-in-fact values are escaped consistently (listing escapes; shell uses `escapeHtml` on facts). |
| **Priority** | **P1** |
| **Test** | Golden facts; unit escape; UI: hide empty facts card. |

#### P1 — Metrics parity (bottleneck tree) — **landed 2026-10-03**

| | |
|--|--|
| **Legacy** | Optional `Metrics` (`report/model/Metrics.kt`): diagram generation timings + message count + **top bottlenecks** tree from request/response durations (`createTree`). Gated by `lsd.core.metrics.enabled` / `ReportOptions.metricsEnabled`. |
| **Shipped** | Message count + summed `durationMs`, plus ranked `insights[]`. If any `SYNCHRONOUS_RESPONSE` exists, rank call-tree nodes by isolated duration (`kind: "bottleneck"`); otherwise the slowest messages (`kind: "slowest"`, max 5). No PlantUML generation timings. Gate `lsd.mono.metrics.enabled` defaults **on** (legacy `lsd.core.metrics.enabled` fallback) so the previous always-on counts stay. Off → `metrics: []` and no `insights`. UI list shows rank + kind text (not colour alone) and a `show` button that scrolls to the message. |
| **Still open** | Deeper “focus” highlight when the row is outside the virtual window beyond a scroll. |
| **Test** | `BottleneckInsightsTest` (ordering, property gate, structural JSON). `insights.test.ts` (rank text, truncation). |

#### P1 — Index / multi-report polish

| | |
|--|--|
| **Legacy** | Writes `lsd-index.html` via Handlebars (`HtmlIndexWriter` / `html-index.hbs`) with branded chrome. |
| **Mono** | Plain `index.html` table. Functional but not the product shell. |
| **Greenfield** | Either a tiny report-next “index” mode (list of reports) or keep minimal HTML but align naming/status styling; print absolute `file://` path like legacy. |
| **Priority** | **P1** |
| **Test** | Unit: index lists all `ReportFile`s after two `completeReport`s. |

#### P1 — `ReportOptions` / label truncation — **landed 2026-10-03** (in-memory `renderReport` still open)

| | |
|--|--|
| **Legacy** | `renderReport(title, options)` returns HTML string; `ReportOptions(devMode, metricsEnabled, maxEventsPerDiagram)`; properties also include `DIAGRAM_THEME`, `LABEL_MAX_WIDTH`, `DEV_MODE`, etc. |
| **Shipped** | `ReportOptions(metricsEnabled, labelMaxWidth)` from `lsd.mono.metrics.enabled` (default true) and `lsd.mono.label.maxWidth` (default 200; legacy keys fall back). Written on the report as `options`. Full event labels stay in JSON; metric summaries abbreviate, and the SVG truncates with a `<title>` of the full label. **No** `DIAGRAM_THEME`. **No** `maxEventsPerDiagram` split. |
| **Still open** | In-memory `renderReport` returning HTML without writing files. `devMode` stays out (single-file shell). |
| **Test** | `BottleneckInsightsTest` locks `labelMaxWidth` and abbreviated metric text with a full event label. `sequence-diagram.test.ts` locks SVG truncation. `multi-scenario-status.json` includes default `options`. |

#### P2 — Dev mode asset inlining

| | |
|--|--|
| **Legacy** | `devMode` inlines local JS vs CDN (`templates/partials/javascript.hbs`). |
| **Mono** | Self-contained single HTML shell — largely solves offline. |
| **Greenfield** | Keep single-file as default; optional multi-file dist for debugging. |
| **Priority** | **P2** |
| **Test** | Build check that packaged shell contains `__LSD_REPORT__` hook. |

---

### 3.3 Component diagrams

#### P1 — Component / architecture view (non-PlantUML) — **landed 2026-10-03**

| | |
|--|--|
| **Legacy** | Per-scenario component SVG via PlantUML (`ComponentDiagramGenerator`) + combined `completeComponentsReport` over `combinedEvents`. Filters message types to SYNCHRONOUS / ASYNCHRONOUS / BI_DIRECTIONAL / LOST; distinct edges by from→to. |
| **Shipped** | `report/ComponentGraph.kt`. Nodes are participants on an included edge. Same from→to collapses to one edge with a `count` and the distinct types in first-seen order. **Excluded:** `SYNCHRONOUS_RESPONSE` (return arrow, not a dependency) and `SHORT_INBOUND` / `SHORT_OUTBOUND` (phantom diagram edge). Opt-in `lsd.mono.components.enabled` (default false): each scenario JSON gets `components`, and `completeComponentsReport` writes `components.json` plus `components-report.html`. The SVG labels every edge (`sync`, `async`, `lost`, `bi`, plus count) and uses a marker shape (filled, open, cross, both-ways, or diamond when mixed). Stroke colour is shared. Not PlantUML. Zoom/pan is not part of this slice. |
| **Still open** | Rendering the graph inside the report-next shell (the sequence shell ignores the extra JSON field). UI smoke later. |
| **Test** | `ComponentGraphTest` (collapse + count, lost kept, response and short arrows dropped, combined union, property gate, SVG label/marker). `LsdExtensionOutcomesTest` writes the real graph when enabled. |

---

### 3.4 UX the spike still lacks for large diagrams

| Capability | report-next **has** | Still **needed** | Priority |
|------------|---------------------|------------------|----------|
| Sticky topbar / sidebar | Yes (`position: sticky` in `app.css`) | Sticky **participant header** inside the diagram scrollport — **landed 2026-10-03** | done |
| Search | Scenarios + facts, plus in-diagram label/note find (`[match]` text, underline, live count) — **landed 2026-10-03** | Scenario search stays separate | done |
| Themes | Dark/light + high contrast, persisted (`ui/theme.ts`, key `lsd-report-next-theme`). Print stylesheet forces a light page and hides search, filters, theme, zoom, and section jumps. **Landed 2026-10-03** | — | done |
| Keyboard | `/ j k Enter d ? Esc` | Diagram-local nav (next message with data) | P1 |
| Message detail | `<dialog>` + copy | Structured pretty-print for XML/JSON; size limits | P1 |
| Virtualisation | **Yes** — `virtualRowRange` + overscan (`layout.ts`) | Recycle DOM nodes (today the window SVG is rebuilt on scroll) | done (rebuild is enough for now) |
| Zoom / fit | Out / Fit / In, ctrl or meta + wheel, fit-to-width. Horizontal scroll is the pan. **Landed 2026-10-03** | Minimap, density modes | done (minimap still out) |
| Hide / focus participants | **Yes** — in-memory show/hide. Hidden state is the words `shown` / `hidden` plus `aria-pressed`, not colour alone. **Landed 2026-10-03** | Focus-only mode | done |
| Section / page nav | **Yes** — in-diagram jump list scrolls to the section row | — | done |

**Themes.** Dark, light, and high contrast persist in `report-next/src/ui/theme.ts` (`localStorage` key `lsd-report-next-theme`, values `dark` | `light` | `contrast`, `prefers-color-scheme` fallback, `data-theme` on the document). Cycle with the theme button or `d`: dark → light → high contrast → dark. The button text is `HC` in high contrast and its accessible name states the theme. Print CSS (`@media print` in `app.css`) forces a light background and hides interactive chrome. **Landed 2026-10-03.**

**Accessibility.** Do not rely on colour alone for status (`success` / `warn` / `error`), message types, or theme. High contrast pairs status words with border style (solid / dashed / double) and histogram patterns. A coloured activation bar adds a hatch and the words `coloured activation`.

---

### 3.5 Integrations beyond JUnit smoke

#### P0 — JUnit extension depth + structured failures — **landed 2026-10-03**

| | |
|--|--|
| **Legacy** | Companion junit module drives capture; core provides context + popups. |
| **Shipped** | `ScenarioError` / scenario JSON `error` (`headline`, `message`, `stack`). Descriptions are plain text (`Test passed` / `Test failed` / `Test aborted` / `Test disabled: …`). Disabled maps to `warn` with no `error` object. Aborted maps to `warn` **with** `error`. report-next renders the message as text and the stack via the message dialog. Combined component graph is opt-in (`lsd.mono.components.enabled`, default false) and is a real graph when enabled (**landed 2026-10-03**). |
| **Still open** | Hide-stacktrace covered by the property but not a dedicated test. No browser click-through of “Show stack trace”. |
| **Test** | `LsdExtensionOutcomesTest`: success, failed, disabled, aborted, nested class, `@LsdPostTestProcessing` captures `post-processing`, components file absent unless enabled. When enabled, the file is an SVG graph (`sync, lost x3`), not the old placeholder. |

#### P1 — Listener / interceptor migration path

| | |
|--|--|
| **Legacy** | Ecosystem (interceptors, cucumber, etc.) calls `LsdContext.capture` / builders. |
| **Mono** | Same entry points under new packages; no Mono-named interceptor modules yet. |
| **Greenfield** | Document capture contract; later `lsd-mono-*` integrations depend on `lsd-mono-core` only. |
| **Priority** | **P1** (docs + contract); modules themselves later |
| **Test** | Contract suite: DSL + `capture(vararg SequenceEvent)` golden. |

---

### 3.6 Explicitly OUT

| Item | Reason |
|------|--------|
| PlantUML as product renderer (`adapter/puml/*`, `plantuml-mit`, Handlebars UML templates) | Replaced by report-next SVG / future graph SVG |
| `includeFiles` sprite includes | PlantUML-specific |
| `lsd.core.diagram.theme` / `puml-theme.hbs` | PlantUML skinparam |
| Golden approvals of full HTML+PlantUML SVG bytes | Shift to **ReportJson** (+ optional screenshot smoke) |
| Shipping CONTROL/COLLECTIONS solely to match PlantUML keywords | Only if UI needs a distinct icon |

---

## 4. Suggested port order (slices)

1. **P0 — JSON contract freeze + multi-scenario / status goldens**  
   Lock `ReportJson` as the migration boundary; fix stale README claims.  
   Slice 1 landed 2026-10-03: golden `multi-scenario-status.json` locks per-scenario `success` / `warn` / `error` and report-level rollup `error`.

2. **P0 — Sections + large-diagram virtualisation + sticky participant header**  
   Replace `newpage` / `maxEventsPerDiagram` splits with continuous, scrollable UX.  
   Slice 2 landed 2026-10-03: `kind: "section"` (`LsdContext.section` / DSL `section`), jump list, one diagram, activations kept across sections, `virtualRowRange` + sticky participant header. Zoom/pan stays P1. Colour-blind cues are tracked next to the theme note and were not part of this slice.

3. **P0 — JUnit structured failures + richer extension tests**  
   Slice 3 landed 2026-10-03: scenario `error` (`headline`, `message`, `stack`), plain-text descriptions, extension outcomes test (success / fail / disabled / aborted / nested / post-processing), components report opt-in via `lsd.mono.components.enabled` (default off). The graph itself landed in slice 6.

4. **P1 — Remaining sequence event kinds** — **landed 2026-10-03**: note left/right, delay, spacer, short arrows, LOST X / BI dual heads (shape + label cues). Zoom stayed later.

5. **P1 — Metrics insights + ReportOptions/properties**; label truncation. **Landed 2026-10-03.** `lsd.mono.metrics.enabled` defaults on. `options.labelMaxWidth` (default 200). Insights are `bottleneck` or `slowest` (max 5). No diagram theme, no max-events split, no zoom. Component graph is slice 6.

6. **P1 — Component graph** from messages (combined + per-scenario) in SVG. **Landed 2026-10-03.** `lsd.mono.components.enabled` (default false). Edge rule matches legacy types; responses and short arrows are excluded; duplicates collapse to one edge with `count`. `components.json` + labelled SVG. Not inside the sequence shell. No zoom/pan.


7. **P1 — Diagram UX polish** — **landed 2026-10-03.** Zoom (Out / Fit / In and ctrl or meta + wheel), fit-to-width, hide/show participant columns (page memory only; a message or anchored note that needs a hidden column is omitted and the other columns reflow), in-diagram find for message labels and notes (`[match]` text plus underline, live count that names hits on a hidden column). Not colour-only. The sticky participant header and virtual rows stay; scroll offsets are divided by the zoom scale before the row window is chosen. Scenario search is unchanged.

8. **P2 — lifeline colour, timestamps, print, high contrast** — **landed 2026-10-03.** Optional activate `colour` (hatch + `coloured activation` when set; default bar unchanged). Optional `createdAt` sorted before JSON and layout. Print CSS is a light page and hides search, filters, the theme button, zoom, and section jumps; `beforeprint` paints every row so the virtual window is not a clipped page. High contrast is the third persisted theme (`contrast`). Status is a word plus a border style, not hue alone.

**Still later**

- Browser performance budget (scroll 500+ events).
- Gradle-wired Vite build (the single-file shell is still copied by hand).
- Interceptor modules (`lsd-mono-*` integrations beyond the JUnit extension).

---

## 5. Test strategy

### Golden JSON (primary regression lock)

- Deterministic ids (`lsd.mono.ids.deterministic=true`) + TempDir output (pattern already in `CaptureToJsonTest`).
- Approve / assert **structural** `ReportJson` (or scrubbed pretty JSON files under `src/test/resources/golden/`), not HTML shells.
- Cases: happy path, multi-scenario status mix, each event kind as it lands, large N (count only / hash), failure attachment shape.
- Prefer ApprovalTests on JSON (legacy used ApprovalTests on HTML in `modules/lsd-core/src/test/java/.../approval/`) — same tool, better artifact.

### Unit (Kotlin + TS)

- **Kotlin:** participant id slug/collision (`resolve` / `uniqueId`); status rollup; section splitting; component graph builder (`ComponentGraphTest` — nodes, counted edges, response exclusion, combined union, SVG type label); metrics tree (`BottleneckInsightsTest` — isolated duration order and the metrics property gate); property resolution; JSON escaping so payloads cannot break `</script>` (already asserted in `CaptureToJsonTest`). JUnit outcomes (`LsdExtensionOutcomesTest`) lock structured `error` fields and that overlay markup is absent. `ActivateColourAndTimestampsTest` locks optional activate colour in JSON and out-of-order `createdAt` sorting.
- **TypeScript:** `layout.test.ts` locks `virtualRowRange`, `eventRowHeight` (delay/spacer), `sortEventsByCreatedAt`, and activation-span colour. `diagram-view.test.ts` locks fit scale, zoom steps, unscaled scroll, remaining columns, and which rows match a query. `sequence-diagram.test.ts` locks LOST X / BI dual heads / short geometry / note placement / label truncation, column reflow, omitted hidden messages, the `[match]` cue, and `activationBarSvg` (hatch when coloured, plain bar otherwise). `theme.test.ts` locks the dark → light → contrast cycle. `insights.test.ts` locks rank text (not colour-only) and ellipsis. `scenario-summary.test.ts` locks escaped failure text. Run `npm test` in `report-next` (vitest).

### Browser / UI (later, selective)

- Playwright/Puppeteer smoke on injected shell: open dialog, theme toggle, search filter, keyboard j/k.
- Performance budget: scroll 500+ events with virtualisation enabled.
- Not every PR — nightly or labeled jobs.

### What not to golden

- Full single-file HTML (binary-ish, brittle).
- Pixel SVGs as the only signal (layout DTOs + selective screenshots instead).
- Anything requiring PlantUML on the CI classpath.

---

## 6. Quick reference — key paths

| Role | Path |
|------|------|
| Legacy context | `modules/lsd-core/src/main/kotlin/com/lsd/core/LsdContext.kt` |
| Legacy events | `modules/lsd-core/src/main/kotlin/com/lsd/core/domain/SequenceEvent.kt` |
| Legacy participants | `modules/lsd-core/src/main/kotlin/com/lsd/core/domain/Participant.kt` |
| Legacy sequence gen / pages | `modules/lsd-core/src/main/kotlin/com/lsd/core/diagram/SequenceDiagramGenerator.kt` |
| Legacy component gen | `modules/lsd-core/src/main/kotlin/com/lsd/core/diagram/ComponentDiagramGenerator.kt` |
| Legacy PlantUML markup | `modules/lsd-core/src/main/kotlin/com/lsd/core/adapter/puml/SequenceDiagramMarkup.kt` |
| Legacy metrics | `modules/lsd-core/src/main/kotlin/com/lsd/core/report/model/Metrics.kt` |
| Legacy HTML report | `modules/lsd-core/src/main/resources/templates/html-report.hbs` |
| Mono context | `integrations/lsd-mono-core/src/main/kotlin/.../LsdContext.kt` |
| Mono events | `integrations/lsd-mono-core/src/main/kotlin/.../domain/SequenceEvent.kt` |
| Mono writer | `integrations/lsd-mono-core/src/main/kotlin/.../report/ReportWriter.kt` |
| Report-next types / UI / SVG | `integrations/lsd-mono-core/report-next/src/{types.ts,main.ts,lib/sequence-diagram.ts}` |
| JUnit extension | `integrations/lsd-mono-junit-jupiter/src/main/kotlin/.../LsdExtension.kt` |

---

*Generated from the local mono tree for greenfield planning. Update this doc as slices land.*
