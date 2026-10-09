# LSD Mono — porting gap report

Next steps: [next-steps.md](next-steps.md)

**Scope:** features still to port from legacy [lsd-core](https://github.com/lsd-consulting/lsd-core) (`com.lsd.core`) into greenfield `modules/lsd-mono-core` (`io.lsdconsulting.lsd.mono.core`) and its `report/` UI.

**Inspected (local tree, through the UX checks, 2026-10-03):** legacy domain / `LsdContext` / report pipeline / builders / properties; mono capture, report writer, JSON models, JUnit Jupiter 6 extension; report types, SVG renderer, chrome.

Legacy is **inspiration and migration API only** — not the product path. Generating PlantUML as the product renderer is explicitly **out**.

---

## 1. Goal

Replace the PlantUML → SVG → Handlebars HTML pipeline with a **modern web stack** (report: Vite + TypeScript + custom SVG) that is responsive, keyboard-friendly, and can handle **very large diagrams** without chopping them into PlantUML pages.

Keep a **migration-friendly capture API** (familiar `LsdContext` shapes) under Mono artifact names (`lsd-mono-core`, `lsd-mono-*`).

Treat **quality tests as first-class**: golden `ReportJson` contracts first, unit tests for domain/layout rules, browser smoke later — not golden PlantUML/SVG blobs.

---

## 2. Already ported (verified against current code)

These are **implemented**, not stubs, unless noted.

| Area | Evidence |
|------|----------|
| Participants (name/id/alias/colour + types ACTOR, PARTICIPANT, DATABASE, QUEUE, ENTITY, BOUNDARY) | `modules/lsd-mono-core/.../domain/Participant.kt`; auto-register on capture in `LsdContext.bind` / `resolve` |
| Facts | `addFact` → `FactJson` in report |
| Messages: SYNCHRONOUS, SYNCHRONOUS_RESPONSE, ASYNCHRONOUS, LOST, BI_DIRECTIONAL, SHORT_INBOUND, SHORT_OUTBOUND (+ colour, data, durationMs) | `domain/SequenceEvent.kt` `MessageType`; JSON `MessageEventJson` — short types + distinct LOST/BI SVG **landed 2026-10-03** |
| Note over / left / right | `Note` + `NotePlacement` + DSL `noteOver` / `noteLeft` / `noteRight` — **landed 2026-10-03** |
| Delay + spacer | `Delay` / `Spacer` + DSL `delay` / `spacer` — **landed 2026-10-03** |
| Logical dividers | `Divider` / `logicalDivider` |
| Lifeline activate / deactivate | `Lifeline` + DSL `LifelineAction.lifeline`. Activation bars are pinned to the opening and closing message rows (those keyword events have no row height). **Landed 2026-10-03.** |
| Kotlin capture DSL (`"A" messages "B" withLabel …`) | `capture/CaptureDsl.kt` |
| Scenario / report / index / clear / clearScenarioEvents | `LsdContext.kt` |
| `ReportJson` + `window.__LSD_REPORT__` injection into shell | `report/ReportWriter.renderShell`; locked by `CaptureToJsonTest` |
| Minimal listing HTML + `*-report.json` (per report, `<title>-<hash>` names, atomic writes) | `ReportWriter.writeReport` |
| report chrome: sticky topbar + sticky sidebar, search (title/description/facts), status chips, dark/light/high-contrast themes, keyboard (`/ j k Enter d ? Esc` plus diagram message navigation), side inspector with lazy payloads + copy, minimap, message deep links, and reduced-motion support | `report/src/main.ts`, `ui/theme.ts`, `styles/app.css` |
| Custom SVG sequence (participants, activations, notes, dividers, message hits) | `report/src/lib/sequence-diagram.ts` |
| JUnit Jupiter 6 extension + `@LsdPostTestProcessing` | `LsdExtension.kt` — success / fail / disabled / aborted / nested / post-processing; failures are `error` JSON (`headline`, `message`, `stack`), not overlay HTML. Locked by `LsdExtensionOutcomesTest`. |
| Cucumber 8 plugin | `modules/lsd-mono-cucumber-8`, `LsdCucumberPlugin`. Completes a scenario per Cucumber scenario. The description is the Given/When/Then lines. The report highlights Given, When, Then, and And in the Description card. Logging and HTTP interceptors are still not in the tree. |
| Popup HTML helper (legacy-shaped `:target` overlay markup) | `report/PopupContent.kt` — **no longer used by the JUnit extension**. Left as a migration shim only. |
| Properties: output dir, deterministic ids, hide stacktrace, metrics gate (default **on**), label max width (+ legacy key fallbacks) | `properties/LsdProperties.kt`, `ReportOptions.kt` |
| Duration insights (bottleneck tree or slowest messages) + label truncation | `report/Bottlenecks.kt`; shell `ui/insights.ts` + `truncateLabel`. **Landed 2026-10-03.** Not PlantUML timings. |
| Component graph from captured messages | In the report page. The **Component diagram** button in each scenario's diagram toolbar draws it in the inspector, in the browser, from messages already in the sequence report (issue #4). The JVM flag, `components.json`, and `components-report.html` stay removed. Not PlantUML. |
| Diagram zoom, fit, hide columns, in-diagram find | report toolbar on the sequence diagram. Out / Fit / In, ctrl or meta + wheel, fit-to-width (clamped). Hide/show is in-memory per diagram: the column goes, messages and anchored notes that need it are omitted, other columns reflow. Find highlights message labels and notes with a `[match]` cue and a live count. **Landed 2026-10-03.** Not colour-only. Virtualisation and the sticky header stay. |

---

## 3. Missing features (by area)

Each item: legacy behaviour → why it matters → suggested greenfield shape → priority → locking test.

### 3.1 Capture / events not yet mirrored

#### P0 — Scenario sections / “pages” without PlantUML `newpage` — **landed 2026-10-03**

| | |
|--|--|
| **Legacy** | `Newpage` + nested `PageTitle` in `domain/SequenceEvent.kt`; `List.groupedByPages()` in `diagram/SequenceDiagramGenerator.kt` splits the event stream; also chunks by `maxEventsPerDiagram` (default 50 via `lsd.core.diagram.sequence.maxEventsPerDiagram`). Activations are **dropped** when a split would occur. |
| **Shipped** | `Section` (`kind: "section"`, `title`) via `LsdContext.section(title)` and capture DSL `section(title)`. report draws a title row and a jump list. One continuous diagram — no extra SVGs. Activations are **not** closed at the boundary. |
| **Still open** | Optional soft warn on huge event counts. Legacy `PageTitle` as a separate event is not ported (the section title covers it). |
| **Test** | `SectionCaptureTest` — two sections, activate before and deactivate after. |

#### P0 — Large-diagram UX (virtualisation / windowing) — **landed 2026-10-03** (zoom/fit landed in slice 7)

| | |
|--|--|
| **Legacy** | Caps events per diagram (`ReportOptions.maxEventsPerDiagram`) and splits — a workaround for PlantUML SVG size / browser pain. |
| **Shipped** | `report/src/lib/layout.ts` lays out rows in CSS pixels. `virtualRowRange` paints only the scroll window plus overscan. Sticky participant header sits inside the diagram scrollport so names stay visible. Full event list stays in JSON. |
| **Still open** | Density modes. Zoom and fit landed in the diagram UX slice; horizontal scroll is the pan. |
| **Test** | `layout.test.ts` (`npm test` in `report`) — scrollTop + viewport → row range, including sticky-header inset and overscan. |

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
| **Greenfield** | Either map to `PARTICIPANT` with a visual variant icon, or add optional types to the report union if migration demand appears. Prefer **not** inventing PlantUML stereotypes. |
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

#### P0 — Multi-scenario report UX and status rollup — **landed 2026-10-03**

| | |
|--|--|
| **Legacy** | Multiple `completeScenario` → one HTML report with contents menu when `scenarios.size > 1`; overall status from worst of ERROR > FAILURE > SUCCESS (`LsdContext.determineOverallStatus`). |
| **Mono** | Same multi-scenario JSON model + report sidebar; overall status uses the `success` / `warn` / `error` vocabulary across listing and index. |
| **Shipped** | JSON contract and the three-scenario success/warn/error rollup are locked by `MultiScenarioStatusGoldenTest` and `multi-scenario-status.json`. |
| **Test** | Golden JSON asserts per-scenario status and report-level rollup. |


#### P0 — Message payload / popup UX in the **product** shell

| | |
|--|--|
| **Legacy** | Message labels are PlantUML links to `#id` overlays; `DataHolder` list feeds popup content; `PopupContent.popupHyperlink` for arbitrary HTML (e.g. stacktraces). `javascript` partial loads `custom.js` for scroll/open helpers. |
| **Mono today** | Message `data` opens the report side inspector. **JUnit failures landed 2026-10-03** as scenario `error: { headline, message, stack }` — plain-text `description`, no `:target` overlay. report shows the message as escaped text and opens the stack in the inspector (`Show stack trace`). `PopupContent` remains unused by the extension. |
| **Still open** | Pretty-print / size limits for message payloads (P1). Browser check that the inspector copy button works. |
| **Priority** | **P1** for payload polish. The JUnit structured-failure slice is **done**. |
| **Test** | `LsdExtensionOutcomesTest` (TempDir, deterministic ids) asserts failed/aborted JSON has `headline` / `message` / `stack` and no `overlay`. `scenario-summary.test.ts` locks escaped message HTML and that the stack is not inlined. |

#### P1 — Facts panel parity

| | |
|--|--|
| **Legacy** | Facts card in Handlebars `html-report.hbs` when non-empty. |
| **Mono** | Facts in JSON + report “Key facts” card + searchable. Listing HTML also lists facts. |
| **Gap** | Empty facts still render an empty card in the report shell; minor polish. Ensure HTML-in-fact values are escaped consistently (listing escapes; shell uses `escapeHtml` on facts). |
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
| **Greenfield** | Either a tiny report “index” mode (list of reports) or keep minimal HTML but align naming/status styling; print absolute `file://` path like legacy. |
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

#### P1 — Component / architecture view (non-PlantUML) — **in-page view shipped**

| | |
|--|--|
| **Legacy** | Per-scenario component SVG via PlantUML (`ComponentDiagramGenerator`) + combined `completeComponentsReport` over `combinedEvents`. Filters message types to SYNCHRONOUS / ASYNCHRONOUS / BI_DIRECTIONAL / LOST; distinct edges by from→to. |
| **Shipped** | A **Component diagram** button in each scenario's diagram toolbar. On click, `report/src/lib/component-graph.ts` builds the graph from that scenario's messages (same type filter as legacy, duplicate from→to pairs folded with a count and the first label), and `component-diagram.ts` draws it in the inspector with the participant header shapes, callers above callees. Nothing is computed on the JVM, and there is no separate file. Issue #4. |
| **Test** | `component-graph.test.ts`, `component-diagram.test.ts`, the inspector and toolbar vitest cases, and an axe pass with the diagram open in `checks/ux.spec.ts`. |

---

### 3.4 UX gaps that remain

The large-diagram UX baseline is shipped: sticky participant header, scenario and in-diagram search, dark/light/high-contrast themes, keyboard message navigation, 24-pixel message hit targets, real `aria-posinset` / `aria-setsize`, side inspector with lazy payloads, minimap and `#msg=` links, zoom/fit, participant toggles, reduced motion, and axe/theme/Fit checks. These are not open tasks.

| Area | Remaining work | Priority |
|------|----------------|----------|
| Large diagrams | Density modes; the virtual window SVG is rebuilt on scroll rather than recycling nodes. | P2 |
| Message payloads | Pretty-print / size limits for payloads; browser check that the inspector copy button works. | P1 |
| Metrics navigation | Focus highlight when an insight target is outside the virtual window beyond a scroll. | P1 |

**Themes and accessibility.** Dark, light, and high contrast persist in `report/src/ui/theme.ts`. Status, message types, and coloured activation use text, border, hatch, or shape cues in addition to colour. Print CSS forces a light page and paints every row so virtualisation does not clip printed output.

### 3.5 Integrations beyond JUnit smoke

#### P0 — JUnit extension depth + structured failures — **landed 2026-10-03**

| | |
|--|--|
| **Legacy** | Companion junit module drives capture; core provides context + popups. |
| **Shipped** | `ScenarioError` / scenario JSON `error` (`headline`, `message`, `stack`). Descriptions are plain text (`Test passed` / `Test failed` / `Test aborted` / `Test disabled: …`). Disabled maps to `warn` with no `error` object. Aborted maps to `warn` **with** `error`. report renders the message as text and the stack via the side inspector. |
| **Still open** | Hide-stacktrace covered by the property but not a dedicated test. No browser click-through of “Show stack trace”. |
| **Test** | `LsdExtensionOutcomesTest`: success, failed, disabled, aborted, nested class, `@LsdPostTestProcessing` captures `post-processing`. |

#### P1 — Listener / interceptor migration path

| | |
|--|--|
| **Legacy** | Ecosystem (interceptors, cucumber, etc.) calls `LsdContext.capture` / builders. |
| **Mono** | `lsd-mono-cucumber-8` is shipped. Logging and HTTP interceptor modules are still open. |
| **Greenfield** | Document capture contract; later `lsd-mono-*` integrations depend on `lsd-mono-core` only. |
| **Priority** | **P1** (docs + contract); modules themselves later |
| **Test** | Contract suite: DSL + `capture(vararg SequenceEvent)` golden. |

---

### 3.6 Explicitly OUT

| Item | Reason |
|------|--------|
| PlantUML as product renderer (`adapter/puml/*`, `plantuml-mit`, Handlebars UML templates) | Replaced by report SVG / future graph SVG |
| `includeFiles` sprite includes | PlantUML-specific |
| `lsd.core.diagram.theme` / `puml-theme.hbs` | PlantUML skinparam |
| Golden approvals of full HTML+PlantUML SVG bytes | Shift to **ReportJson** (+ optional screenshot smoke) |
| Shipping CONTROL/COLLECTIONS solely to match PlantUML keywords | Only if UI needs a distinct icon |

---

## 4. Completed slices (history)

The following slices are complete and remain here as migration history rather than open work:

1. JSON contract freeze and multi-scenario/status goldens.
2. Sections, continuous large-diagram virtualisation, and sticky participant header.
3. JUnit structured failures and extension outcome coverage.
4. Remaining sequence event kinds: notes, delay, spacer, short arrows, LOST, and BI_DIRECTIONAL.
5. Metrics insights, properties, and label truncation.
6. Component graph file generation was built, then removed. The in-page view replaced it (issue #4).
7. Diagram UX: zoom, fit, participant toggles, in-diagram find, keyboard navigation, inspector, minimap, deep links, reduced motion, and accessibility checks.
8. Lifeline colour, timestamps, print, high contrast, clickable arrows, and browser performance results.

Open implementation work is tracked in `docs/internal/next-steps.md` and the **Still open** rows above.

---

## 5. Test strategy

### Golden JSON (primary regression lock)

- Deterministic ids (`lsd.mono.ids.deterministic=true`) + TempDir output (pattern already in `CaptureToJsonTest`).
- Approve / assert **structural** `ReportJson` (or scrubbed pretty JSON files under `src/test/resources/golden/`), not HTML shells.
- Cases: happy path, multi-scenario status mix, each event kind as it lands, large N (count only / hash), failure attachment shape.
- Prefer ApprovalTests on JSON (legacy used ApprovalTests on HTML under `src/test/java/.../approval/` in [lsd-core](https://github.com/lsd-consulting/lsd-core)) — same tool, better artifact.

### Unit (Kotlin + TS)

- **Kotlin:** participant id slug/collision (`resolve` / `uniqueId`); status rollup; section splitting; metrics tree (`BottleneckInsightsTest` — isolated duration order and the metrics property gate); property resolution; JSON escaping so payloads cannot break `</script>` (already asserted in `CaptureToJsonTest`). JUnit outcomes (`LsdExtensionOutcomesTest`) lock structured `error` fields and that overlay markup is absent. `ActivateColourAndTimestampsTest` locks optional activate colour in JSON and out-of-order `createdAt` sorting.
- **TypeScript:** `layout.test.ts` locks `virtualRowRange`, `eventRowHeight` (delay/spacer), `sortEventsByCreatedAt`, and activation-span colour. `diagram-view.test.ts` locks fit scale, zoom steps, unscaled scroll, remaining columns, and which rows match a query. `sequence-diagram.test.ts` locks LOST X / BI dual heads / short geometry / note placement / label truncation, column reflow, omitted hidden messages, the `[match]` cue, and `activationBarSvg` (hatch when coloured, plain bar otherwise). `theme.test.ts` locks the dark → light → contrast cycle. `insights.test.ts` locks rank text (not colour-only) and ellipsis. `scenario-summary.test.ts` locks escaped failure text. Run `npm test` in `report` (vitest).

### Browser / UI (later, selective)

- Browser checks still needed: inspector copy button, JUnit “Show stack trace”.
- The large-diagram performance comparison is complete; results are in `docs/perf-results.md`.
- Not every PR — nightly or labeled jobs.

### What not to golden

- Full single-file HTML (binary-ish, brittle).
- Pixel SVGs as the only signal (layout DTOs + selective screenshots instead).
- Anything requiring PlantUML on the CI classpath.

---

## 6. Quick reference — key paths

| Role | Path |
|------|------|
| Legacy context | [lsd-core `LsdContext.kt`](https://github.com/lsd-consulting/lsd-core/blob/main/src/main/kotlin/com/lsd/core/LsdContext.kt) |
| Legacy events | [lsd-core `SequenceEvent.kt`](https://github.com/lsd-consulting/lsd-core/blob/main/src/main/kotlin/com/lsd/core/domain/SequenceEvent.kt) |
| Legacy participants | [lsd-core `Participant.kt`](https://github.com/lsd-consulting/lsd-core/blob/main/src/main/kotlin/com/lsd/core/domain/Participant.kt) |
| Legacy sequence gen / pages | [lsd-core `SequenceDiagramGenerator.kt`](https://github.com/lsd-consulting/lsd-core/blob/main/src/main/kotlin/com/lsd/core/diagram/SequenceDiagramGenerator.kt) |
| Legacy component gen | [lsd-core `ComponentDiagramGenerator.kt`](https://github.com/lsd-consulting/lsd-core/blob/main/src/main/kotlin/com/lsd/core/diagram/ComponentDiagramGenerator.kt) |
| Legacy PlantUML markup | [lsd-core `SequenceDiagramMarkup.kt`](https://github.com/lsd-consulting/lsd-core/blob/main/src/main/kotlin/com/lsd/core/adapter/puml/SequenceDiagramMarkup.kt) |
| Legacy metrics | [lsd-core `Metrics.kt`](https://github.com/lsd-consulting/lsd-core/blob/main/src/main/kotlin/com/lsd/core/report/model/Metrics.kt) |
| Legacy HTML report | [lsd-core `html-report.hbs`](https://github.com/lsd-consulting/lsd-core/blob/main/src/main/resources/templates/html-report.hbs) |
| Mono context | `modules/lsd-mono-core/src/main/kotlin/.../LsdContext.kt` |
| Mono events | `modules/lsd-mono-core/src/main/kotlin/.../domain/SequenceEvent.kt` |
| Mono writer | `modules/lsd-mono-core/src/main/kotlin/.../report/ReportWriter.kt` |
| Report types / UI / SVG | `modules/lsd-mono-core/report/src/{types.ts,main.ts,lib/sequence-diagram.ts}` |
| JUnit extension | `modules/lsd-mono-junit-jupiter/src/main/kotlin/.../LsdExtension.kt` |
| Cucumber plugin | `modules/lsd-mono-cucumber-8/src/main/kotlin/.../LsdCucumberPlugin.kt` |

---

*This tracks the tree as of 3 Oct 2026, including cucumber-8.*
