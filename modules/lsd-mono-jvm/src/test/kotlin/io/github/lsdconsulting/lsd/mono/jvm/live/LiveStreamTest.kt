package io.github.lsdconsulting.lsd.mono.jvm.live

import io.github.lsdconsulting.lsd.mono.jvm.InternalLsdApi
import io.github.lsdconsulting.lsd.mono.jvm.LsdContext
import io.github.lsdconsulting.lsd.mono.jvm.Timing
import io.github.lsdconsulting.lsd.mono.jvm.domain.MessageType
import io.github.lsdconsulting.lsd.mono.jvm.domain.ParticipantType
import io.github.lsdconsulting.lsd.mono.jvm.domain.ScenarioError
import io.github.lsdconsulting.lsd.mono.jvm.domain.Status
import io.github.lsdconsulting.lsd.mono.jvm.properties.LsdProperties
import io.github.lsdconsulting.lsd.mono.jvm.testing.LsdTestConfig
import io.github.lsdconsulting.lsd.mono.report.model.testing.Json
import io.github.lsdconsulting.lsd.mono.report.model.testing.JsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.Instant
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * A scenario titled when it begins is streamed as it runs: its start and each settled event
 * reach LSD Studio before it completes, and the whole stream still says what the report file says.
 */
@OptIn(InternalLsdApi::class, io.github.lsdconsulting.lsd.mono.jvm.ExperimentalLsdStudioApi::class)
@LsdTestConfig
class LiveStreamTest {
    private val contract = LiveCaptureTest()

    @Test
    fun `a run titled as it goes streams the checkout fixture, each event before its scenario completes`() {
        val frames =
            TestStudio().use { studio ->
                val lsd = context(studio)
                lsd.reportTitle("checkout", "Checkout service tests")

                val pays = lsd.beginScenario("checkout")
                lsd.scenarioTitle(pays, "A customer pays for their basket")
                lsd.addParticipants(ParticipantType.ACTOR.called("customer"))
                val pay = lsd.call("customer", "checkout", "POST /checkout", timing = Timing.tookMs(42.5))
                lsd.call("checkout", "payments", "POST /payments", timing = Timing.tookMs(30.25)).reply("201")
                pay.reply("200")
                awaitFrames(studio) { types(it).count { t -> t == "event" } == 4 }
                assertEquals(listOf("hello", "scenario.start", "event", "event", "event", "event"), types(studio.frames))
                lsd.completeScenario("A customer pays for their basket", status = Status.SUCCESS)

                val declined = lsd.beginScenario("checkout")
                lsd.scenarioTitle(declined, "A declined card fails the checkout")
                lsd.addParticipants(ParticipantType.ACTOR.called("customer"))
                lsd.call("customer", "checkout", "POST /checkout", timing = Timing.tookMs(12.0)).reply("402")
                awaitFrames(studio) { types(it).count { t -> t == "event" } == 6 }
                lsd.completeScenario(
                    "A declined card fails the checkout",
                    status = Status.ERROR,
                    error = ScenarioError.of("Payment declined", "Expected 200 but was 402", null),
                )
                lsd.completeReport("Checkout service tests", "checkout")
                assertTrue(studio.awaitClosed(), "the stream ends")
                studio.frames.toList()
            }
        frames.forEach(contract::assertValidFrame)
        val expected = contract.project(contract.fixture("checkout"))
        val actual =
            contract.project(frames).mapIndexed { i, frame ->
                // participants are optional in v0: where the fixture leaves them out, so does the comparison.
                if (expected.getOrNull(i)?.let { it["type"] == "scenario.start" && it["participants"] == null } == true) {
                    frame + ("participants" to null)
                } else {
                    frame
                }
            }
        assertEquals(expected, actual)
    }

    @Test
    fun `a call is held back until it is answered, and so is what follows it`() {
        TestStudio().use { studio ->
            val lsd = context(studio)
            val scenario = lsd.beginScenario("held")
            lsd.scenarioTitle(scenario, "Held")
            val call = lsd.call("A", "B", "GET /slow")
            lsd.message("A", "C", "queued", type = MessageType.ASYNCHRONOUS)
            awaitFrames(studio) { types(it).contains("hello") }
            Thread.sleep(300)
            assertEquals(listOf("hello"), types(studio.frames))
            call.reply("200")
            awaitFrames(studio) { types(it).count { t -> t == "event" } == 3 }
            val labels = events(studio.frames).map { it.string("label") }
            assertEquals(listOf("GET /slow", "queued", "200"), labels)
            lsd.completeScenario("Held")
            lsd.completeReport("Held", "held")
            assertTrue(studio.awaitClosed())
            assertEquals(listOf("hello", "scenario.start", "event", "event", "event", "scenario.end", "report.done"), types(studio.frames))
        }
    }

    @Test
    fun `events the clock orders again on completion are all sent once, with a sender error saying the view differs`() {
        TestStudio().use { studio ->
            val lsd = context(studio)
            val scenario = lsd.beginScenario("clock")
            lsd.scenarioTitle(scenario, "Clock")
            val t = Instant.parse("2026-11-01T11:00:00Z")
            val clocked = { at: Instant -> Timing(startedAt = at, orderByStartedAt = true) }
            lsd.message("A", "B", "second", type = MessageType.ASYNCHRONOUS, timing = clocked(t.plusMillis(10)))
            awaitFrames(studio) { types(it).contains("event") }
            lsd.message("A", "B", "first", type = MessageType.ASYNCHRONOUS, timing = clocked(t))
            lsd.completeScenario("Clock")
            val files = lsd.completeReport("Clock", "clock")
            assertTrue(studio.awaitClosed())
            studio.frames.forEach(contract::assertValidFrame)
            assertEquals(listOf("second", "first"), events(studio.frames).map { it.string("label") })
            val written = (Json.parse(files.reportJson.toFile().readText()) as JsonObject).objects("scenarios").single().objects("events")
            assertEquals(listOf("first", "second"), written.map { it.string("label") })
            val error = studio.frames.map { Json.parse(it) as JsonObject }.single { it.string("type") == "error" }
            assertEquals(LiveFrames.DIFFERS, error.string("message"))
            assertEquals(listOf("hello", "scenario.start", "event", "event", "error", "scenario.end", "report.done"), types(studio.frames))
        }
    }

    @Test
    fun `once what was sent no longer matches the mapping, nothing more is sent until the scenario completes`() {
        TestStudio().use { studio ->
            val lsd = context(studio)
            val scenario = lsd.beginScenario("diverged")
            lsd.scenarioTitle(scenario, "Diverged")
            val t = Instant.parse("2026-11-01T11:00:00Z")
            val clocked = { at: Instant -> Timing(startedAt = at, orderByStartedAt = true) }
            lsd.message("A", "B", "second", type = MessageType.ASYNCHRONOUS, timing = clocked(t.plusMillis(10)))
            awaitFrames(studio) { events(it).size == 1 }
            // "first" sorts before "second", which was already sent: the mapping has diverged.
            lsd.message("A", "B", "first", type = MessageType.ASYNCHRONOUS, timing = clocked(t))
            lsd.message("A", "B", "third", type = MessageType.ASYNCHRONOUS, timing = clocked(t.plusMillis(20)))
            // A second scenario on the same stream: its event is sent on the same worker, after the
            // flushes the first scenario's captures queued, so once it arrives they have all run.
            Thread {
                val marker = lsd.beginScenario("diverged")
                lsd.scenarioTitle(marker, "Marker")
                lsd.message("C", "D", "marker", type = MessageType.ASYNCHRONOUS)
                marker.complete("Marker")
            }.apply { start() }.join(10_000)
            awaitFrames(studio) { events(it).any { e -> e.string("label") == "marker" } }
            lsd.message("A", "B", "fourth", type = MessageType.ASYNCHRONOUS, timing = clocked(t.plusMillis(30)))
            assertEquals(listOf("second", "marker"), events(studio.frames).map { it.string("label") })
            scenario.complete("Diverged")
            lsd.completeReport("Diverged", "diverged")
            assertTrue(studio.awaitClosed())
            studio.frames.forEach(contract::assertValidFrame)
            assertEquals(1, events(studio.frames).count { it.string("label") == "second" })
            assertEquals(listOf("second", "marker", "first", "third", "fourth"), events(studio.frames).map { it.string("label") })
        }
    }

    @Test
    fun `a title that changes after the start is reported as a difference`() {
        TestStudio().use { studio ->
            val lsd = context(studio)
            val scenario = lsd.beginScenario("renamed")
            lsd.scenarioTitle(scenario, "Before")
            lsd.message("A", "B", "hi", type = MessageType.ASYNCHRONOUS)
            awaitFrames(studio) { types(it).contains("event") }
            lsd.completeScenario("After")
            lsd.completeReport("Renamed", "renamed")
            assertTrue(studio.awaitClosed())
            assertTrue(types(studio.frames).contains("error"))
        }
    }

    @Test
    fun `a scenario that agrees with what was sent gets no sender error, a participant named after the start included`() {
        TestStudio().use { studio ->
            val lsd = context(studio)
            val scenario = lsd.beginScenario("agrees")
            lsd.scenarioTitle(scenario, "Agrees")
            lsd.message("A", "B", "one", type = MessageType.ASYNCHRONOUS)
            awaitFrames(studio) { types(it).contains("event") }
            // C first appears after the start: LSD Studio adds it by its id, which v0 cannot avoid, so it is no error.
            lsd.message("B", "C", "two", type = MessageType.ASYNCHRONOUS)
            lsd.completeScenario("Agrees")
            lsd.completeReport("Agrees", "agrees")
            assertTrue(studio.awaitClosed())
            assertEquals(listOf("hello", "scenario.start", "event", "event", "scenario.end", "report.done"), types(studio.frames))
        }
    }

    @Test
    fun `a discarded scenario ends as skipped, saying the report file leaves it out`() {
        TestStudio().use { studio ->
            val lsd = context(studio)
            val scenario = lsd.beginScenario("discarded")
            lsd.scenarioTitle(scenario, "Discarded")
            lsd.message("A", "B", "hi", type = MessageType.ASYNCHRONOUS)
            awaitFrames(studio) { types(it).contains("event") }
            scenario.discard()
            lsd.completeReport("Discarded", "discarded")
            assertTrue(studio.awaitClosed())
            studio.frames.forEach(contract::assertValidFrame)
            val end = studio.frames.map { Json.parse(it) as JsonObject }.single { it.string("type") == "scenario.end" }
            assertEquals("skipped", end.string("status"))
        }
    }

    @Test
    fun `scenarios running in parallel each keep their own events, in order`() {
        TestStudio().use { studio ->
            val lsd = context(studio)
            val ready = CountDownLatch(2)
            val threads =
                listOf("left", "right").map { name ->
                    Thread {
                        val scenario = lsd.beginScenario("parallel", key = name)
                        lsd.scenarioTitle(scenario, name)
                        ready.countDown()
                        ready.await(5, TimeUnit.SECONDS)
                        repeat(20) { i -> lsd.call(name, "server", "$name $i").reply("ok $i") }
                        scenario.complete(name, null, Status.SUCCESS)
                    }.apply { start() }
                }
            threads.forEach { it.join(10_000) }
            lsd.completeReport("Parallel", "parallel")
            assertTrue(studio.awaitClosed())
            val frames = studio.frames.map { Json.parse(it) as JsonObject }
            val titles = frames.filter { it.string("type") == "scenario.start" }.associate { it.string("scenarioId") to it.string("title") }
            listOf("left", "right").forEach { name ->
                val id = titles.entries.single { it.value == name }.key
                val labels = frames
                    .filter {
                        it.string(
                            "type",
                        ) == "event" && it.string("scenarioId") == id
                    }.map { checkNotNull(it.obj("event")).string("label") }
                assertEquals((0 until 20).flatMap { listOf("$name $it", "ok $it") }, labels)
            }
            assertTrue(frames.none { it.string("type") == "error" })
        }
    }

    private fun context(studio: TestStudio): LsdContext {
        System.setProperty(LsdProperties.STUDIO_URL, studio.url)
        return LsdContext()
    }

    private fun types(frames: List<String>): List<String?> = frames.map { (Json.parse(it) as JsonObject).string("type") }

    private fun events(frames: List<String>): List<JsonObject> =
        frames.map { Json.parse(it) as JsonObject }.filter { it.string("type") == "event" }.map { checkNotNull(it.obj("event")) }

    private fun awaitFrames(
        studio: TestStudio,
        seconds: Long = 5,
        done: (List<String>) -> Boolean,
    ) {
        val until = System.nanoTime() + TimeUnit.SECONDS.toNanos(seconds)
        while (!done(studio.frames.toList())) {
            check(System.nanoTime() < until) { "LSD Studio did not get the frames in time: ${types(studio.frames)}" }
            Thread.sleep(10)
        }
    }
}
