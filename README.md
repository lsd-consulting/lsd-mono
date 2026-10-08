# LSD Mono

LSD Mono records a scenario as a sequence of messages and writes an interactive HTML report. [`lsd-mono-core`](modules/lsd-mono-core) is the capture API and the report UI.

[`lsd-mono-cucumber-8` README](modules/lsd-mono-cucumber-8/README.md) covers the Cucumber 8 plugin.

[`lsd-mono-junit-jupiter` README](modules/lsd-mono-junit-jupiter/README.md) covers the JUnit Jupiter 6 extension that completes a scenario for each test.

Origin is https://github.com/lsd-consulting/lsd-mono.git. `main` has been pushed there.

## Depend on it

From another project in this build:

```kotlin
dependencies {
    implementation(project(":modules:lsd-mono-core"))
    testImplementation(project(":modules:lsd-mono-junit-jupiter"))
    testImplementation(project(":modules:lsd-mono-cucumber-8"))
}
```

The artifacts are `io.lsdconsulting:lsd-mono-core`, `io.lsdconsulting:lsd-mono-junit-jupiter`, and `io.lsdconsulting:lsd-mono-cucumber-8`, version `0.0.1-SNAPSHOT`. They are not published. JDK 21. Cucumber support is major 8.

## Capture a scenario

```kotlin
import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.capture.messages
import io.lsdconsulting.lsd.mono.core.capture.withData
import io.lsdconsulting.lsd.mono.core.capture.withLabel
import io.lsdconsulting.lsd.mono.core.capture.withType
import io.lsdconsulting.lsd.mono.core.domain.MessageType
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.ACTOR
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.DATABASE
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.PARTICIPANT
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.QUEUE

val lsd = LsdContext()
lsd.addParticipants(
    ACTOR.called("Customer"),
    PARTICIPANT.called("Checkout"),
    DATABASE.called("Orders"),
    QUEUE.called("Order events"),
)
lsd.addFact("orderId", "ord-1001")
lsd.capture(
    "Customer" messages "Checkout" withLabel "POST /orders" withData mapOf(
        "method" to "POST",
        "path" to "/orders",
        "status" to 201,
        "body" to mapOf("sku" to "SOCK-1", "qty" to 2),
    ),
)
lsd.activate("Checkout")
lsd.capture("Checkout" messages "Orders" withLabel "insert order")
lsd.response("Orders", "Checkout", "row saved")
lsd.capture(
    "Checkout" messages "Order events" withLabel "order.placed" withType MessageType.ASYNCHRONOUS withData mapOf(
        "orderId" to "ord-1001",
        "sku" to "SOCK-1",
    ),
)
lsd.response("Checkout", "Customer", "201 Created")
lsd.deactivate("Checkout")
lsd.completeScenario("Place an order", "Customer checks out two pairs of socks.")
val listing = lsd.completeReport("Place an order")
lsd.createIndex()
```

`completeReport` writes under `build/reports/lsd` (set `lsd.mono.report.outputDir` to move it). Open `Place-an-order-diagram.html`. That file is the report. `Place-an-order-report.html` is only a short listing, and `createIndex()` adds `index.html` when you have written more than one.

Click an arrow to open its JSON. `method`, `path`, and `status` stay on the arrow. Any other fields load from `Place-an-order-payloads.js` when the panel opens.

The participant type is the header shape. `ACTOR` is a person, `DATABASE` a cylinder, `QUEUE` stacked plates. `ENTITY` is a circle and `BOUNDARY` a circle with a bar. Anything else, including `PARTICIPANT`, is a rounded box. Sync responses and async messages draw an arrow head at the destination.

## From a JUnit test

See the [JUnit Jupiter module README](modules/lsd-mono-junit-jupiter/README.md) for the extension setup and capture example. It completes each test scenario and writes the report after the class.

## From a Cucumber scenario

See the [Cucumber 8 module README](modules/lsd-mono-cucumber-8/README.md) for plugin registration, step definitions, and the capture example. It completes each scenario and writes the report after the feature.

## What the report looks like

The diagram for the scenario above. Customer, Orders, and Order events use their types. The response and the async publish show the direction.

![Place an order, with participant shapes and arrow heads](docs/readme/diagram.png)

Clicking `POST /orders` opens the payload.

![Inspector open on the order JSON](docs/readme/inspector.png)

Zoom until the diagram scrolls.

![Zooming into the diagram and scrolling it](docs/readme/zoom.gif)

Each scenario also has a **Component diagram** button. The [lsd-mono-core README](modules/lsd-mono-core/README.md#component-diagram) shows it opening.

Regenerate those three files from the current UI:

```bash
./gradlew :modules:lsd-mono-core:readmeSamples
```

The task captures the scenario with `LsdContext`, then screenshots the packaged shell with headless Chromium. It uses Node 22 from nvm when that is installed, and it does not change the default Node alias. It is not part of `build` or `check`.

## Build

```bash
./gradlew build
```

JDK 21. `:modules:lsd-mono-core:build` runs the Vite shell build (`npm ci`, then `npm run build:single`) and vitest is on `check`. Those tasks also prepend Node 22 and leave the default alias alone.

```
modules/lsd-mono-core/            lsd-mono-core, report UI in report/
modules/lsd-mono-junit-jupiter/   JUnit Jupiter 6 extension
modules/lsd-mono-cucumber-8/      Cucumber 8 plugin
build-logic/                      convention plugins (lsd.kotlin-jvm)
```

Legacy behaviour for comparison is upstream at [lsd-core](https://github.com/lsd-consulting/lsd-core). It is not in this tree.
