# lsd-mono-cucumber-8

`lsd-mono-cucumber-8` is the Cucumber 8 plugin for [lsd-mono-core](../lsd-mono-core) that turns each scenario into a living sequence diagram. You still capture the interactions yourself with `LsdContext` inside your steps. The plugin records pass, fail, or warning when the scenario ends, and writes the report when the feature finishes. It depends on first-party `lsd-mono-core`, not the old published `lsd-core`, and there is no PlantUML on this path. It is pinned to Cucumber 8: the catalog holds the exact version (`8.0.4`) and the build fails if anything resolves to another major. A newer Cucumber major gets its own module.

## Depend on it

From another project in this repo:

```kotlin
dependencies {
    testImplementation(project(":modules:lsd-mono-cucumber-8"))
    testImplementation("io.cucumber:cucumber-java8:8.0.4")
    testImplementation("io.cucumber:cucumber-junit-platform-engine:8.0.4")
}
```

`lsd-mono-cucumber-8` brings in `lsd-mono-core` and `io.cucumber:cucumber-plugin`. You still need a Cucumber 8 runtime and a step-definition library. `cucumber-java8` and `cucumber-junit-platform-engine` are the pair this module is tested with. Stay on Cucumber 8. This build rejects 7.x and 9+.

## Register the plugin

`src/test/resources/junit-platform.properties`:

```properties
cucumber.plugin=io.lsdconsulting.lsd.mono.cucumber.LsdCucumberPlugin
cucumber.glue=com.example.steps
cucumber.publish.enabled=false
```

The class is `io.lsdconsulting.lsd.mono.cucumber.LsdCucumberPlugin`. It implements Cucumber's `ConcurrentEventListener`.

Parallel execution is supported (`cucumber.execution.parallel.enabled=true`, or `--threads` on the CLI). Each scenario gets its own buffer, bound to the thread that runs its steps, so `LsdContext.instance` in a step lands in that scenario, and each feature gets its own report. Work a step hands to another thread needs `LsdContext.instance.wrap(task)`. A capture from a thread that is not bound to a scenario goes to the running scenario when there is only one; with several running it is logged as a warning and kept out of all of them.

## Capture from a step

Do **not** call `completeScenario` or `completeReport` yourself. The plugin does that when the scenario and the feature finish.

```kotlin
import io.cucumber.java8.En
import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.ACTOR
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.DATABASE
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.PARTICIPANT
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.QUEUE

class PlaceOrderSteps : En {
    init {
        val lsd = LsdContext.instance

        Given("a customer is ready to check out") {
            lsd.addParticipants(
                ACTOR.called("Customer"),
                PARTICIPANT.called("Checkout"),
                DATABASE.called("Orders"),
                QUEUE.called("Order events"),
            )
            lsd.addFact("orderId", "ord-1001")
        }

        When("the customer places an order for socks") {
            lsd.capture {
                "Customer" calls "Checkout" label "POST /orders" data mapOf(
                    "method" to "POST",
                    "path" to "/orders",
                    "status" to 201,
                    "body" to mapOf("sku" to "SOCK-1", "qty" to 2),
                )
                activate("Checkout")
                "Checkout" calls "Orders" label "insert order"
                "Orders" repliesTo "Checkout" label "row saved"
                "Checkout" sends "Order events" label "order.placed" data mapOf(
                    "orderId" to "ord-1001",
                    "sku" to "SOCK-1",
                )
            }
        }

        Then("the order is stored and confirmed") {
            lsd.capture {
                "Checkout" repliesTo "Customer" label "201 Created"
                deactivate("Checkout")
            }
        }
    }
}
```

```gherkin
Feature: Place an order

  Scenario: places an order
    Given a customer is ready to check out
    When the customer places an order for socks
    Then the order is stored and confirmed
```

A passed scenario is stored as a success. The scenario title is the Cucumber scenario name (`places an order`). A scenario outline example is suffixed ` #1`, ` #2`, and so on, numbered by the row's position in the feature file across all its `Examples` tables, so the numbers do not depend on run order. The description is the step lines as plain text. A failed scenario is stored with status error and a structured error (headline, message, stack). Anything that is not passed and not failed (skipped, pending, undefined) is a warning.

Set `lsd.mono.cucumber.splitBySteps=true` to insert a section at each step (every property is listed in the [core README](../lsd-mono-core/README.md#properties)). That stays in the same diagram. It is not a new page.

## Where the report is written

After the run finishes, open:

```text
build/reports/lsd/place_order-<hash>-diagram.html
```

The file name comes from the feature file (`place_order.feature`), not from the `Feature:` title. `<hash>` is 8 hex characters from the feature's path, so two `place_order.feature` files in different folders get separate reports. That file is the report. `place_order-<hash>-report.html` is only a short listing. The plugin writes every feature's report when the run finishes, then `index.html`, which lists every report in the directory.

Override the directory with `lsd.mono.report.outputDir` (the legacy `lsd.core.report.outputDir` key is still honoured).

Click an arrow to open its JSON. `method`, `path`, and `status` stay on the arrow. Other fields load from the companion payloads file when the panel opens. Participant types set the header shape: `ACTOR`, `DATABASE`, `QUEUE`, and so on.

## What the report looks like

The diagram for the scenario above after a successful feature.

![place_order diagram with participant shapes](docs/readme/diagram.png)

Clicking `POST /orders` opens the payload.

![Inspector open on the order JSON](docs/readme/inspector.png)

Zoom until the diagram scrolls.

![Zooming into the diagram and scrolling it](docs/readme/zoom.gif)

Regenerate those three files from the current UI:

```bash
./gradlew :modules:lsd-mono-cucumber-8:readmeSamples
```

The task runs the feature through `LsdCucumberPlugin`, then screenshots the packaged shell with headless Chromium via the core report's `readme-samples.mjs`. It uses Node 22 from nvm when that is installed, and it does not change the default Node alias. It is not part of `build` or `check`.

## Build

```bash
./gradlew :modules:lsd-mono-cucumber-8:build
```

JDK 21. See the [root README](../../README.md) for the core capture API and the shared report UI.
