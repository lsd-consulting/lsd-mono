# The report UI

The tour in the root README clicks around a small shop report: four scenarios with every status, six participants, payloads, and durations. [`FeatureTourSample.kt`](../modules/lsd-mono-jvm/src/readme/kotlin/io/github/lsdconsulting/lsd/mono/jvm/readme/FeatureTourSample.kt) captures it. The [lsd-mono-jvm README](../modules/lsd-mono-jvm/README.md#component-diagram) covers the **Components** view.

The report shows one scenario at a time, chosen from the sidebar, and the choice is kept in the URL. Each scenario has:

- the sequence diagram, fitted to its panel, with zoom steps (− and +), the % readout to go back to the default view, an Overview of the whole width, [find](#find-in-the-diagram) and participant hiding. A diagram taller than the screen extends the page and scrolls with it; the toolbar and the participant header stay at the top while you scroll;
- a **Sequence | Components** switch over each diagram, for the scenario's component diagram;
- a side panel for an arrow's JSON (payloads load when the panel opens; secret-looking keys are redacted when captured), a component link's messages, and timing and metrics;
- a timing summary (wall-clock, calls, slowest call, accuracy) with swim lanes and a waterfall, when the scenario has timing.

The theme follows the operating system (dark, light, or more contrast) until you choose one from the theme menu in the top bar, or step through them with `d`.

## Find in the diagram

Find, in the diagram's toolbar, matches arrow labels, notes and message payloads as you type, ignoring case. Enter / Shift+Enter (or F3, Cmd/Ctrl+G, or the ↑ ↓ buttons) step through the matches, wrapping, and the count says where you are: “2 of 11, 3 in payloads”.

- A label match is banded on the label; a payload match bands the arrow's `{}` marker, so you can tell them apart without colour. The arrow's button says “search match in payload” to screen readers.
- A payload is searched as the side panel shows it: indented JSON, keys and values, so `"qty": 2` and header names match too. The payloads load the first time you use Find, from the same file the side panel uses, and a large report is searched in short slices so typing never waits.
- Opening a matching arrow marks every match in its JSON, the first one current and on screen, with its own count and ↑ ↓. Stepping through Find moves an open side panel to the current match; it does not open a closed one.
- The `{}` button at the end of the field (its name is *Payloads*) turns payloads out of Find and back in, for when they match too much. Pressed, it is boxed; off, it is struck through.
