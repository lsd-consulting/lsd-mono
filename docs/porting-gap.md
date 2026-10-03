# LSD Mono — porting gap report

**Scope:** features still to port from legacy `modules/lsd-core` (`com.lsd.core`) into greenfield `integrations/lsd-mono-core` (`io.lsdconsulting.lsd.mono.core`) and its `report-next/` UI.

**Inspected (local tree, slices through sections + virtualisation, 2026-10-03):** legacy domain / `LsdContext` / report pipeline / builders / properties; mono capture, report writer, JSON models, JUnit Jupiter 6 extension; report-next types, SVG renderer, chrome.

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
| Messages: SYNCHRONOUS, SYNCHRONOUS_RESPONSE, ASYNCHRONOUS, LOST, BI_DIRECTIONAL (+ colour, data, durationMs) | `domain/SequenceEvent.kt` `MessageType`; JSON `MessageEventJson` |
| Note **over** participant | `Note` + DSL `noteOver` |
| Logical dividers | `Divider` / `logicalDivider` |
| Lifeline activate / deactivate | `Lifeline` + DSL `LifelineAction.lifeline` |
| Kotlin capture DSL (`"A" messages "B" withLabel …`) | `capture/CaptureDsl.kt` |
| Scenario / report / index / clear / clearScenarioEvents | `LsdContext.kt` |
| `ReportJson` + `window.__LSD_REPORT__` injection into shell | `report/ReportWriter.renderShell`; locked by `CaptureToJsonTest` |
| Minimal listing HTML + `report.json` / `*-report.json` | `ReportWriter.writeReport` |
| report-next chrome: sticky topbar + sticky sidebar, search (title/description/facts), status chips, dark/light theme, keyboard (`/ j k Enter d ? Esc`), message `<dialog>` + copy | `report-next/src/main.ts`, `ui/theme.ts`, `styles/app.css` |
| Custom SVG sequence (participants, activations, notes, dividers, message hits) | `report-next/src/lib/sequence-diagram.ts` |
| JUnit Jupiter 6 extension + `@LsdPostTestProcessing` | `integrations/lsd-mono-junit-jupiter/.../LsdExtension.kt` (smoke test only) |
| Popup HTML helper (legacy-shaped `:target` overlay markup) | `report/PopupContent.kt` — used by JUnit failure descriptions |
| Properties: output dir, deterministic ids, hide stacktrace (+ legacy key fallbacks) | `properties/LsdProperties.kt` |

**Stubs / thin surfaces (do not treat as done):**

- `completeComponentsReport` → placeholder HTML only (`ReportWriter.writeComponentsStub`).
- Captured metrics are a **simple** message count + summed `durationMs`, not legacy bottleneck-tree metrics (`com.lsd.core.report.model.Metrics`).
- LOST / BI_DIRECTIONAL are in the **domain + JSON**, but the SVG renderer does **not** yet give them distinct arrow semantics (no lost-X / bi-arrow styling in `sequence-diagram.ts`).
- Module README still says injection is deferred; code + `CaptureToJsonTest` show injection **works** — README is stale.

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

#### P0 — Large-diagram UX (virtualisation / windowing) — **landed 2026-10-03** (zoom/pan still P1)

| | |
|--|--|
| **Legacy** | Caps events per diagram (`ReportOptions.maxEventsPerDiagram`) and splits — a workaround for PlantUML SVG size / browser pain. |
| **Shipped** | `report-next/src/lib/layout.ts` lays out rows in CSS pixels. `virtualRowRange` paints only the scroll window plus overscan. Sticky participant header sits inside the diagram scrollport so names stay visible. Full event list stays in JSON. |
| **Still open** | Zoom / pan / fit-width (P1). Density modes. Browser FPS check with N≥500. |
| **Test** | `layout.test.ts` (`npm test` in `report-next`) — scrollTop + viewport → row range, including sticky-header inset and overscan. |

#### P1 — Note left / note right

| | |
|--|--|
| **Legacy** | `NoteLeft` / `NoteRight` (± optional `ofParticipant`) → PlantUML `note left` / `note right` (`adapter/puml/SequenceDiagramMarkup.kt`). Mono only has `Note` over a participant. |
| **Why** | Common in approval fixtures and migration samples (`approval/LsdContextTest.java` uses left/right notes). |
| **Greenfield** | Extend note event: `placement: "over" \| "left" \| "right"` (+ optional anchor participant). SVG positions card relative to lifeline. |
| **Priority** | **P1** |
| **Test** | Golden JSON kinds; unit SVG layout fixtures for left/right/over. |

#### P1 — Time delay & vertical space

| | |
|--|--|
| **Legacy** | `TimeDelay` (`...label...`) and `VerticalSpace` (`\|\|\|` / sized) in `SequenceEvent.kt` / markup. |
| **Why** | Communicate wait / pacing without inventing fake messages. |
| **Greenfield** | `kind: "delay"` (optional label) and `kind: "spacer"` (optional heightPx). Lightweight SVG rows — not PlantUML ellipsis. |
| **Priority** | **P1** |
| **Test** | Golden JSON; unit row-height mapping. |

#### P1 — Short inbound / outbound arrows

| | |
|--|--|
| **Legacy** | `MessageType.SHORT_INBOUND` / `SHORT_OUTBOUND` render as `?->` / `->?` (`SequenceDiagramMarkup.kt`). Absent from mono `MessageType` and report-next `types.ts`. |
| **Why** | Models unknown peer / found-message style traffic in integration tests. |
| **Greenfield** | Add message types; SVG draws arrow from/to diagram edge (phantom column), not a fake participant. |
| **Priority** | **P1** |
| **Test** | Golden JSON types; unit SVG edge-message geometry. |

#### P1 — Distinct LOST / BI_DIRECTIONAL rendering

| | |
|--|--|
| **Legacy** | Lost (`->x`) and bi-directional (`<->`) arrows in PlantUML markup. |
| **Why** | Domain already accepts these types in mono; UI under-delivers. |
| **Greenfield** | Markers + stroke rules in `sequence-diagram.ts` (X tip / dual heads). |
| **Priority** | **P1** |
| **Test** | Unit snapshot of SVG fragment per type (or structured layout DTO). |

#### P2 — Lifeline activate colour

| | |
|--|--|
| **Legacy** | `Lifeline.colour` colours PlantUML `activate … #colour`. Mono `Lifeline` has no colour field. |
| **Why** | Occasional emphasis in diagrams. |
| **Greenfield** | Optional colour on activate events; SVG activation bar uses it. |
| **Priority** | **P2** |
| **Test** | Golden JSON + unit bar style. |

#### P2 — Participant types CONTROL / COLLECTIONS

| | |
|--|--|
| **Legacy** | `ParticipantType.CONTROL`, `COLLECTIONS` (`domain/Participant.kt`); used in component + sequence PlantUML participant keywords. Explicitly omitted in mono `Participant.kt` comments. |
| **Why** | Rare; approval sample uses `CONTROL.called("Cat")`. |
| **Greenfield** | Either map to `PARTICIPANT` with a visual variant icon, or add optional types to the report-next union if migration demand appears. Prefer **not** inventing PlantUML stereotypes. |
| **Priority** | **P2** |
| **Test** | Golden participant `type` if added; otherwise migration guide only. |

#### P2 — Event timestamps / stable sort

| | |
|--|--|
| **Legacy** | Every `SequenceEvent` has `created: Instant`; generator sorts by it. |
| **Why** | Out-of-order capture from async listeners. |
| **Greenfield** | Optional `createdAt` on events; sort before layout if present. |
| **Priority** | **P2** |
| **Test** | Unit sort order. |

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
| **Mono today** | Message `data` opens report-next `<dialog>` (good). JUnit still embeds **legacy overlay HTML** in scenario `description` via `PopupContent` — report-next renders description as HTML but **does not** ship overlay CSS/JS equivalent to legacy `custom.js`. Stacktrace “popups” may degrade to raw links. |
| **Greenfield** | Prefer structured failure info in JSON (e.g. `descriptionHtml` + `attachments[]` or `error: { message, stack }`) and render with report-next dialogs. Keep `PopupContent` only as a migration shim or drop once JUnit emits structured fields. |
| **Priority** | **P0** |
| **Test** | Golden JSON with message `data` + failure attachment; UI browser: dialog opens and copy works; extension unit: failed test produces structured error fields. |

#### P1 — Facts panel parity

| | |
|--|--|
| **Legacy** | Facts card in Handlebars `html-report.hbs` when non-empty. |
| **Mono** | Facts in JSON + report-next “Key facts” card + searchable. Listing HTML also lists facts. |
| **Gap** | Empty facts still render an empty card in the spike; minor polish. Ensure HTML-in-fact values are escaped consistently (listing escapes; shell uses `escapeHtml` on facts). |
| **Priority** | **P1** |
| **Test** | Golden facts; unit escape; UI: hide empty facts card. |

#### P1 — Metrics parity (bottleneck tree)

| | |
|--|--|
| **Legacy** | Optional `Metrics` (`report/model/Metrics.kt`): diagram generation timings + message count + **top bottlenecks** tree from request/response durations (`createTree`). Gated by `lsd.core.metrics.enabled` / `ReportOptions.metricsEnabled`. |
| **Mono** | Always emits simple metrics (message count, summed duration). No `ReportOptions`, no generation timings, no bottleneck tree. |
| **Greenfield** | Compute bottleneck insights in Kotlin from captured durations; emit as `metrics[]` and/or structured `insights` JSON. UI: details list with “show message” that focuses/scrolls to message id (no PlantUML). Gate with `lsd.mono.metrics.enabled`. |
| **Priority** | **P1** |
| **Test** | Unit tree / isolated duration (port logic from legacy tests); golden metrics keys. |

#### P1 — Index / multi-report polish

| | |
|--|--|
| **Legacy** | Writes `lsd-index.html` via Handlebars (`HtmlIndexWriter` / `html-index.hbs`) with branded chrome. |
| **Mono** | Plain `index.html` table. Functional but not the product shell. |
| **Greenfield** | Either a tiny report-next “index” mode (list of reports) or keep minimal HTML but align naming/status styling; print absolute `file://` path like legacy. |
| **Priority** | **P1** |
| **Test** | Unit: index lists all `ReportFile`s after two `completeReport`s. |

#### P1 — `renderReport` / `ReportOptions` / properties

| | |
|--|--|
| **Legacy** | `renderReport(title, options)` returns HTML string; `ReportOptions(devMode, metricsEnabled, maxEventsPerDiagram)`; properties also include `DIAGRAM_THEME`, `LABEL_MAX_WIDTH`, `DEV_MODE`, etc. (`properties/LsdProperties.kt`, `DefaultProperties.kt`). |
| **Mono** | File writers only; no options object; fewer properties. |
| **Greenfield** | `ReportOptions` for metrics toggle, label max width (SVG truncate), deterministic output for tests. `renderReport` optional for in-memory consumers. **Skip** `DIAGRAM_THEME` (PlantUML). `maxEventsPerDiagram` becomes virtualisation / section guidance, not a hard split. |
| **Priority** | **P1** |
| **Test** | Unit property resolution; golden truncated labels. |

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

#### P1 — Component / architecture view (non-PlantUML)

| | |
|--|--|
| **Legacy** | Per-scenario component SVG via PlantUML (`ComponentDiagramGenerator`) + combined `completeComponentsReport` over `combinedEvents`. Filters message types to SYNCHRONOUS / ASYNCHRONOUS / BI_DIRECTIONAL / LOST; distinct edges by from→to. |
| **Mono** | Stub HTML only. |
| **Greenfield** | Derive a graph from the same `ReportJson` messages (nodes = participants, edges = distinct from→to with types). Render with SVG or a small canvas/WebGL later — **not** PlantUML. Combined report = union of edges across scenarios completed so far. |
| **Priority** | **P1** |
| **Test** | Unit graph builder golden (nodes/edges JSON); UI smoke later. |

---

### 3.4 UX the spike still lacks for large diagrams

| Capability | report-next **has** | Still **needed** | Priority |
|------------|---------------------|------------------|----------|
| Sticky topbar / sidebar | Yes (`position: sticky` in `app.css`) | Sticky **participant header** inside the diagram scrollport — **landed 2026-10-03** | done |
| Search | Scenarios + facts | Optional in-diagram message/label search + highlight | P1 |
| Themes | Dark/light + persist (**already shipped**, `ui/theme.ts`) | High-contrast / print stylesheet only | P2 |
| Keyboard | `/ j k Enter d ? Esc` | Diagram-local nav (next message with data) | P1 |
| Message detail | `<dialog>` + copy | Structured pretty-print for XML/JSON; size limits | P1 |
| Virtualisation | **Yes** — `virtualRowRange` + overscan (`layout.ts`) | Recycle DOM nodes (today the window SVG is rebuilt on scroll) | done (rebuild is enough for now) |
| Zoom / pan | Horizontal overflow scroll only | Pinch/trackpad zoom, fit-to-width, minimap optional — **still P1**, not part of the sections slice | P1 |
| Hide / focus participants | **No** | Toggle columns for wide diagrams (legacy #79-class need) | P1 |
| Section / page nav | **Yes** — in-diagram jump list scrolls to the section row | — | done |

**Theme is not a gap.** Dark/light with persistence is **already shipped** in `report-next/src/ui/theme.ts` (`localStorage` key `lsd-report-next-theme`, `prefers-color-scheme` fallback, `data-theme` on the document). Do not rebuild it. **P2** is only a high-contrast / print stylesheet.

**Accessibility is a requirement to track (not implemented in the sections slice).** Check accessibility properly, especially colour blindness. Do not rely on colour alone for status (`success` / `warn` / `error`), message types, or light vs dark theme. Pair every colour with a non-colour cue (icon, pattern, or text label) and check contrast in both themes so red/green (and other) deficiencies stay readable. High-contrast / print remains the P2 stylesheet follow-up; this cue rule applies to the product UI as features land.

---

### 3.5 Integrations beyond JUnit smoke

#### P0 — JUnit extension depth + structured failures

| | |
|--|--|
| **Legacy** | Companion junit module (outside this submodule tree) drives capture; core provides context + popups. Mono extension already completes scenarios, writes report/index, calls components stub, supports `@LsdPostTestProcessing`. |
| **Gap** | Only smoke test (`LsdExtensionTest` one “ping”). Nested class handling exists but lightly tested. Failure descriptions use overlay HTML poorly suited to report-next. Components report always stubbed after every class. |
| **Greenfield** | Expand tests (success / fail / disabled / aborted / nested / post-processing capture). Emit structured error into scenario JSON. Make combined component report opt-in until real renderer exists. |
| **Priority** | **P0** |
| **Test** | Extension unit/integration tests with TempDir asserting JSON status + error fields. |

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
   Make the first integration trustworthy; stop relying on legacy overlay HTML in descriptions.

4. **P1 — Remaining sequence event kinds** (note left/right, delay, spacer, short arrows) + LOST/BI SVG semantics.

5. **P1 — Metrics insights + ReportOptions/properties**; label truncation.

6. **P1 — Component graph** from messages (combined + per-scenario) in SVG.

7. **P1 — Diagram UX polish** (zoom/fit, hide participants, in-diagram search).

8. **P2 — Nice-to-haves** (activate colour, timestamps, index brand, print CSS).

Wire **Gradle → Vite `build:single`** when the shell stops being a hand-copied artifact (supports regression of the packaged HTML).

---

## 5. Test strategy

### Golden JSON (primary regression lock)

- Deterministic ids (`lsd.mono.ids.deterministic=true`) + TempDir output (pattern already in `CaptureToJsonTest`).
- Approve / assert **structural** `ReportJson` (or scrubbed pretty JSON files under `src/test/resources/golden/`), not HTML shells.
- Cases: happy path, multi-scenario status mix, each event kind as it lands, large N (count only / hash), failure attachment shape.
- Prefer ApprovalTests on JSON (legacy used ApprovalTests on HTML in `modules/lsd-core/src/test/java/.../approval/`) — same tool, better artifact.

### Unit (Kotlin + TS)

- **Kotlin:** participant id slug/collision (`resolve` / `uniqueId`); status rollup; section splitting; component graph builder; metrics tree (port ideas from `MetricsTest`); property resolution; JSON escaping so payloads cannot break `</script>` (already asserted in `CaptureToJsonTest`).
- **TypeScript:** `report-next/src/lib/layout.test.ts` locks `virtualRowRange` (scrollTop + viewport, overscan, sticky header inset) and activation spans across a section. Run `npm test` in `report-next` (vitest). Marker choice for message types is still open.

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
