package io.github.lsdconsulting.lsd.mono.jvm.live

import com.networknt.schema.InputFormat
import com.networknt.schema.SchemaLocation
import com.networknt.schema.SchemaRegistry
import com.networknt.schema.SchemaRegistryConfig
import com.networknt.schema.SpecificationVersion
import io.github.lsdconsulting.lsd.mono.jvm.InternalLsdApi
import io.github.lsdconsulting.lsd.mono.jvm.LsdContext
import io.github.lsdconsulting.lsd.mono.jvm.Timing
import io.github.lsdconsulting.lsd.mono.jvm.domain.ParticipantType
import io.github.lsdconsulting.lsd.mono.jvm.domain.ScenarioError
import io.github.lsdconsulting.lsd.mono.jvm.domain.Status
import io.github.lsdconsulting.lsd.mono.jvm.properties.LsdProperties
import io.github.lsdconsulting.lsd.mono.jvm.testing.LsdTestConfig
import io.github.lsdconsulting.lsd.mono.report.model.testing.Json
import io.github.lsdconsulting.lsd.mono.report.model.testing.JsonObject
import io.github.lsdconsulting.lsd.mono.report.model.testing.ReportSchemas
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.net.InetAddress
import java.net.ServerSocket
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.readLines
import kotlin.io.path.readText

/**
 * The JVM sender against the live capture protocol's own contract, in lsd-mono-studio's
 * `protocol/`: every frame it sends follows `lsd-live.schema.json`, and a test run captured like
 * a fixture stream sends that stream (normalised: ids, timestamps and the sender aside).
 */
@OptIn(InternalLsdApi::class, io.github.lsdconsulting.lsd.mono.jvm.ExperimentalLsdStudioApi::class)
@LsdTestConfig
class LiveCaptureTest {
    @Test
    fun `a run captured like the checkout fixture streams the checkout fixture`() {
        val frames =
            TestStudio().use { studio ->
                System.setProperty(LsdProperties.STUDIO_URL, studio.url)
                val lsd = LsdContext()
                lsd.reportTitle("checkout", "Checkout service tests")

                lsd.beginScenario("checkout")
                lsd.addParticipants(ParticipantType.ACTOR.called("customer"))
                val pay = lsd.call("customer", "checkout", "POST /checkout", timing = Timing.tookMs(42.5))
                lsd.call("checkout", "payments", "POST /payments", timing = Timing.tookMs(30.25)).reply("201")
                pay.reply("200")
                lsd.completeScenario("A customer pays for their basket", status = Status.SUCCESS)

                lsd.beginScenario("checkout")
                lsd.addParticipants(ParticipantType.ACTOR.called("customer"))
                lsd.call("customer", "checkout", "POST /checkout", timing = Timing.tookMs(12.0)).reply("402")
                lsd.completeScenario(
                    "A declined card fails the checkout",
                    status = Status.ERROR,
                    error = ScenarioError.of("Payment declined", "Expected 200 but was 402", null),
                )
                lsd.completeReport("Checkout service tests", "checkout")
                assertTrue(studio.awaitClosed(), "the stream ends")
                studio.frames.toList()
            }
        frames.forEach(::assertValidFrame)
        val expected = project(fixture("checkout"))
        val actual =
            project(frames).mapIndexed { i, frame ->
                // participants are optional in v0: where the fixture leaves them out, so does the comparison.
                if (expected.getOrNull(i)?.let { it["type"] == "scenario.start" && it["participants"] == null } ==
                    true
                )
                    frame + ("participants" to null)
                else
                    frame
            }
        assertEquals(expected, actual)
        val hello = Json.parse(frames.first()) as JsonObject
        assertEquals("lsd-mono-jvm", hello.obj("sender")?.string("name"))
    }

    @Test
    fun `a report with no scenarios streams the minimal fixture`() {
        val frames =
            TestStudio().use { studio ->
                System.setProperty(LsdProperties.STUDIO_URL, studio.url)
                val lsd = LsdContext()
                lsd.beginScenario("empty").discard()
                lsd.completeReport("Empty", "empty")
                assertTrue(studio.awaitClosed(), "the stream ends")
                studio.frames.toList()
            }
        frames.forEach(::assertValidFrame)
        assertEquals(listOf("hello", "report.done"), frames.map { (Json.parse(it) as JsonObject).string("type") })
        assertEquals(project(fixture("minimal")).map { it - "title" }, project(frames).map { it - "title" })
    }

    @Test
    fun `the fixture streams marked valid follow the schema this test checks with`() {
        val manifest = Json.parse(PROTOCOL.resolve("fixtures/manifest.json").readText()) as JsonObject
        val valid = manifest.objects("streams").filter { it["valid"] == true }
        assertTrue(valid.isNotEmpty())
        valid.forEach { stream ->
            PROTOCOL
                .resolve("fixtures/${stream.string("file")}")
                .readLines()
                .filter(String::isNotBlank)
                .forEach(::assertValidFrame)
        }
    }

    @Test
    fun `off by default, nothing connects`() {
        TestStudio().use { studio ->
            val lsd = LsdContext()
            lsd.beginScenario("quiet")
            lsd.message("A", "B", "hi")
            lsd.completeScenario("quiet")
            lsd.completeReport("Quiet", "quiet")
            Thread.sleep(200)
            assertEquals(0, studio.connections.get())
        }
    }

    @Test
    fun `LSD Studio not running, the tests and the report go on, quickly`() {
        val port = ServerSocket(0, 1, InetAddress.getLoopbackAddress()).use { it.localPort }
        System.setProperty(LsdProperties.STUDIO_URL, "ws://127.0.0.1:$port/ws/captures")
        val lsd = LsdContext()
        val started = System.nanoTime()
        repeat(3) { i ->
            lsd.beginScenario("down")
            lsd.message("A", "B", "hi $i")
            lsd.completeScenario("down $i")
        }
        val files = lsd.completeReport("Down", "down")
        val ms = (System.nanoTime() - started) / 1_000_000
        assertTrue(Files.exists(files.reportJson), "the report file is written")
        assertTrue(ms < 3_000, "took ${ms}ms")
    }

    @Test
    fun `a refused protocol version is warned about, the stream stops and the report is written`() {
        TestStudio(refuseVersion = true).use { studio ->
            System.setProperty(LsdProperties.STUDIO_URL, studio.url)
            val lsd = LsdContext()
            lsd.beginScenario("refused")
            assertTrue(studio.awaitClosed(), "the server closes")
            lsd.message("A", "B", "hi")
            lsd.completeScenario("refused")
            val files = lsd.completeReport("Refused", "refused")
            assertTrue(Files.exists(files.reportJson))
            assertEquals(listOf("hello"), studio.frames.map { (Json.parse(it) as JsonObject).string("type") })
        }
    }

    @Test
    fun `not a WebSocket URL, the report is written`() {
        System.setProperty(LsdProperties.STUDIO_URL, "http://127.0.0.1:1/")
        val lsd = LsdContext()
        lsd.beginScenario("wrong")
        lsd.completeScenario("wrong")
        assertTrue(Files.exists(lsd.completeReport("Wrong", "wrong").reportJson))
    }

    private fun fixture(name: String): List<String> = PROTOCOL.resolve("fixtures/streams/$name.jsonl").readLines().filter(String::isNotBlank)

    private fun assertValidFrame(frame: String) {
        val errors = liveSchema.validate(frame, InputFormat.JSON).map { "${it.instanceLocation}: ${it.message}" }
        assertEquals(emptyList<String>(), errors, frame)
    }

    /**
     * What a stream says, without what may differ between senders: scenario and event ids become
     * their order, a reply's `replyTo` and a call id the index of the event they point at,
     * participants their names and types, and timestamps and the sender go. `timing: "none"` is
     * the same as no timing, and `pairing` is compared on replies, where it says how they were paired.
     */
    private fun project(stream: List<String>): List<Map<String, Any?>> {
        val frames = stream.map { Json.parse(it) as JsonObject }
        val scenarioIds = frames.mapNotNull { it.string("scenarioId") }.distinct()
        val events = frames.filter { it.string("type") == "event" }.groupBy({ it.string("scenarioId") }, { checkNotNull(it.obj("event")) })
        return frames.map { frame ->
            val sid = frame.string("scenarioId")
            val own = events[sid].orEmpty()
            when (frame.string("type")) {
                "hello" -> mapOf("type" to "hello", "protocol" to frame["protocol"], "version" to frame["version"], "title" to frame["title"])
                "scenario.start" ->
                    mapOf(
                        "type" to "scenario.start",
                        "scenario" to scenarioIds.indexOf(sid),
                        "title" to frame["title"],
                        "participants" to frame.objects("participants").map { it["name"] to it["type"] }.takeUnless { it.isEmpty() },
                    )
                "event" -> {
                    val event = checkNotNull(frame.obj("event"))
                    val names = frames.first { it.string("scenarioId") == sid && it.string("type") == "scenario.start" }.objects("participants").associate {
                        it["id"] to
                            it["name"]
                    }
                    mapOf(
                        "type" to "event",
                        "scenario" to scenarioIds.indexOf(sid),
                        "kind" to event["kind"],
                        "from" to (names[event["from"]] ?: event["from"]),
                        "to" to (names[event["to"]] ?: event["to"]),
                        "label" to event["label"],
                        "messageType" to event["type"],
                        "call" to event.string("callId")?.let { id -> own.indexOfFirst { it.string("callId") == id } },
                        "replyTo" to event.string("replyTo")?.let { id -> own.indexOfFirst { it.string("id") == id } },
                        "pairing" to event["pairing"].takeIf { event["replyTo"] != null },
                        "durationMs" to event["durationMs"],
                        "timing" to event["timing"].takeUnless { it == "none" },
                    )
                }
                "scenario.end" ->
                    mapOf(
                        "type" to "scenario.end",
                        "scenario" to scenarioIds.indexOf(sid),
                        "status" to frame["status"],
                        "error" to frame.obj("error")?.let { it["headline"] to it["message"] },
                    )
                else -> mapOf("type" to frame.string("type"))
            }
        }
    }

    private companion object {
        val PROTOCOL: Path = Path.of("../lsd-mono-studio/protocol")

        val liveSchema =
            PROTOCOL.resolve("lsd-live.schema.json").readText().let { text ->
                val id = checkNotNull((Json.parse(text) as JsonObject).string("\$id"))
                SchemaRegistry
                    .withDefaultDialect(SpecificationVersion.DRAFT_2020_12) { builder ->
                        builder
                            .schemaRegistryConfig(SchemaRegistryConfig.builder().formatAssertionsEnabled(true).build())
                            .schemas(
                                mapOf(
                                    id to text,
                                    ReportSchemas.ids.getValue(ReportSchemas.Document.REPORT) to ReportSchemas.text(ReportSchemas.Document.REPORT),
                                ),
                            )
                    }.getSchema(SchemaLocation.of(id))
            }
    }
}
