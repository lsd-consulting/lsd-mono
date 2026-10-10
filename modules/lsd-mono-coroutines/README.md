# lsd-mono-coroutines

`lsd-mono-coroutines` keeps an LSD scenario bound while a Kotlin coroutine moves between threads. Without it, a capture made after the coroutine resumes on another dispatcher thread goes to the wrong scenario, or to none. It depends on first-party [`lsd-mono-core`](../lsd-mono-core) and on `kotlinx-coroutines-core`. Core itself has no coroutines dependency.

## Depend on it

From another project in this repo:

```kotlin
testImplementation(project(":modules:lsd-mono-coroutines"))
```

That pulls in `lsd-mono-core` and `kotlinx-coroutines-core`. The module is built against kotlinx.coroutines 1: the version catalog holds the exact version, and the build fails if anything resolves to another major. A 2.x release would get its own module.

## The problem

`LsdScenario.bind()`, `beginScenario` and `LsdContext.scenario { }` bind a **thread**. A coroutine does not stay on one thread: when it suspends and resumes on `Dispatchers.Default` or `Dispatchers.IO`, the thread it lands on is not bound to anything.

```kotlin
scenario.bind().use {
    runBlocking {
        withContext(Dispatchers.IO) {
            lsd.message("Orders", "Db", "insert")   // not this scenario
        }
    }
}
```

With several scenarios running, that capture cannot be attributed. It is logged as a warning and kept out of all of them (see [Threads and parallel tests](../lsd-mono-core/README.md#threads-and-parallel-tests)).

## Keep the scenario with the coroutine

`withLsdScenario(scenario) { }` binds the scenario to whichever thread the coroutine is running on, and puts each thread back as it found it when the coroutine suspends or ends:

```kotlin
import io.lsdconsulting.lsd.mono.coroutines.withLsdScenario

val lsd = LsdContext.instance
val scenario = lsd.beginScenario(reportKey = "orders", bindCurrentThread = false)
try {
    withLsdScenario(scenario) {
        lsd.capture { "Customer" calls "Orders" label "POST /orders" }
        val saved = async(Dispatchers.IO) {
            lsd.message("Orders", "Db", "insert order")       // lands in `scenario`
            repository.save(order)
        }
        withContext(Dispatchers.Default) {
            lsd.message("Orders", "Pricing", "price order")   // so does this
        }
        saved.await()
        lsd.capture { "Orders" repliesTo "Customer" label "201 Created" }
    }
    scenario.complete("Place an order")
} catch (e: Throwable) {
    scenario.complete("Place an order", status = Status.ERROR, error = ScenarioError.of("Failed", e))
    throw e
}
lsd.completeReport("Orders", reportKey = "orders")
```

It returns what the block returns. To put the scenario in a coroutine context yourself, use `scenario.asContextElement()`, which is a `ThreadContextElement`:

```kotlin
launch(scenario.asContextElement() + Dispatchers.IO) { lsd.message("Orders", "Db", "insert") }
withContext(scenario.asContextElement()) { … }
```

What to expect:

- **Child coroutines inherit it.** `launch { }` and `async { }` inside the block capture into the same scenario, on whatever dispatcher they use.
- **It nests.** A `withLsdScenario` for another scenario shadows the outer one until it ends, then the outer one is current again.
- **It cleans up.** The thread bindings are restored whether the block returns, throws or is cancelled, and a pool thread never stays bound to a scenario that has finished.
- **It does not complete the scenario.** Call `scenario.complete(...)` yourself, as above. `LsdContext.scenario { }` takes a block that cannot suspend, so for suspending work begin the scenario and complete it as in the example.

## In a JUnit test

Take the test's own scenario as a parameter (see the [JUnit module README](../lsd-mono-junit-jupiter/README.md#take-the-scenario-as-a-parameter)) and bind it for the coroutine. The extension still completes the scenario:

```kotlin
@ExtendWith(LsdExtension::class)
class PlaceOrderTest {
    @Test
    fun `places an order`(scenario: LsdScenario) {
        runBlocking {
            withLsdScenario(scenario) {
                withContext(Dispatchers.IO) { LsdContext.instance.message("Orders", "Db", "insert") }
            }
        }
    }
}
```

## Limits

- It covers code that runs inside the coroutine. Code on threads the coroutine did not start, such as an embedded HTTP server's threads, is still unbound. Use `LsdContext.wrap`, or carry the scenario in a header with `LsdHeaders.SCENARIO`, as the core README describes.
- It is Kotlin only. Java code, and the other modules, are unchanged.
- Capturing through the `LsdScenario` reference (`scenario.message(...)`) never depends on the thread, so it works in a coroutine with or without this module.

## Build

```bash
./gradlew :modules:lsd-mono-coroutines:build
```

JDK 21. The tests run coroutines across `Dispatchers.Default` and `Dispatchers.IO`, and keep two scenarios running so a capture cannot reach the right one by accident.
