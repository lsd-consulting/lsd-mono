package io.lsdconsulting.lsd.mono.core

import com.networknt.schema.InputFormat
import com.networknt.schema.Schema
import com.networknt.schema.SchemaLocation
import com.networknt.schema.SchemaRegistry
import com.networknt.schema.SchemaRegistryConfig
import com.networknt.schema.SpecificationVersion
import io.lsdconsulting.lsd.mono.core.domain.MessageType
import io.lsdconsulting.lsd.mono.core.domain.NoteSide
import io.lsdconsulting.lsd.mono.core.domain.Participant
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType
import io.lsdconsulting.lsd.mono.core.domain.ScenarioError
import io.lsdconsulting.lsd.mono.core.domain.Status
import io.lsdconsulting.lsd.mono.core.domain.WarningKind
import io.lsdconsulting.lsd.mono.core.model.ReportSchema
import io.lsdconsulting.lsd.mono.core.model.ReportSource
import io.lsdconsulting.lsd.mono.core.report.ReportWriter
import io.lsdconsulting.lsd.mono.core.testing.LsdTestConfig
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import tools.jackson.databind.node.ArrayNode
import tools.jackson.databind.node.ObjectNode
import java.nio.file.Path
import java.time.Duration
import java.time.Instant
import kotlin.io.path.readText

/**
 * Real output against the report JSON Schema in `modules/lsd-mono-report-schema`: a report that
 * uses every event kind, participant type and timing field; the same report as the diagram page
 * and its data script carry it, with payloads moved to the sidecar; and the index manifest.
 */
@LsdTestConfig(deterministicIds = true)
class ReportSchemaTest {
    @TempDir
    lateinit var tempDir: Path

    @Test
    fun `every kind of report output follows the schema`() {
        val lsd = LsdContext()
        everything(lsd)
        lsd.completeReport(TITLE)
        lsd.createIndex()
        val stem = ReportWriter.reportFileStem(TITLE)

        val json = tempDir.resolve("$stem-report.json").readText()
        assertValid(report, json, "$stem-report.json")
        ENUM_VALUES.forEach { value -> assertTrue(json.contains("\"$value\""), "the report uses $value") }

        val diagram = tempDir.resolve("$stem-diagram.html").readText()
        val shellCopy = between(diagram, "window.__LSD_REPORT__=", ";</script>")
        assertTrue(shellCopy.contains("\"payloadId\""), "the diagram page's copy defers a payload")
        assertValid(report, shellCopy, "window.__LSD_REPORT__")

        val data = tempDir.resolve("$stem-report.js").readText()
        assertValid(report, between(data, "{report:", ",payloadsSrc:"), "$stem-report.js")

        val index = tempDir.resolve("index.html").readText()
        assertValid(this.index, between(index, "window.__LSD_INDEX__=", ";</script>"), "index.html")
    }

    @Test
    fun `the schema is not a formality`() {
        val json = LsdContext()
            .apply {
                addParticipants(Participant("Api", id = "api"))
                inbound("api", "webhook")
                completeScenario("one")
            }.completeReport("Bare")
            .reportJson
            .readText()
        assertValid(report, json, "a bare report")
        val rejected = mapOf(
            "schemaVersion is required" to edit(json) { remove("schemaVersion") },
            "status is a closed enum" to edit(json) { put("status", "passed") },
            "times are date-times" to edit(json) { put("generatedAt", "yesterday") },
            "ids are not empty" to edit(json) { scenario(this).put("id", "") },
            "participant names are not empty" to edit(json) { participant(this).put("name", "") },
            "a known event kind keeps its shape" to edit(json) { event(this).remove("from") },
        )
        rejected.forEach { (rule, edited) -> assertTrue(errors(report, edited).isNotEmpty(), rule) }
        val accepted = mapOf(
            "unknown fields" to edit(json) {
                put("fromANewerMinor", true)
                scenario(this).put("fromANewerMinor", true)
                participant(this).put("fromANewerMinor", true)
                event(this).put("fromANewerMinor", true)
            },
            "a time with an offset" to edit(json) { put("generatedAt", "2026-01-01T13:00:00+01:00") },
            "an unknown value of an open enum" to edit(json) {
                participant(this).put("type", "ROBOT")
                event(this).put("type", "BROADCAST")
                (get("options") as ObjectNode).put("source", "spock")
            },
            "an event of an unknown kind" to edit(json) {
                (scenario(this).get("events") as ArrayNode)
                    .addObject()
                    .put("kind", "hologram")
                    .put("id", "h-1")
            },
            "no options or timing summary" to edit(json) {
                remove("options")
                scenario(this).remove(listOf("accuracy", "sources", "clockOrdering", "clockOrdered"))
            },
        )
        accepted.forEach { (rule, edited) -> assertValid(report, edited, rule) }
    }

    @Test
    fun `the schema's enums are the writer's`() {
        val defs = MAPPER.readTree(SCHEMA_DIR.resolve(REPORT_FILE).readText()).get("\$defs")
        val writer = mapOf(
            "Status" to Status.entries.map { it.name.lowercase() },
            "KnownParticipantType" to ParticipantType.entries.map { it.name },
            "KnownMessageType" to MessageType.entries.map { it.name },
            "NotePlacement" to NoteSide.entries.map { it.name.lowercase() },
            "KnownTimingSource" to TimingSource.entries.map { it.name },
            "KnownPairingSource" to PairingSource.entries.map { it.name },
            "Accuracy" to Accuracy.entries.map { it.name },
            "ClockOrdering" to ClockOrdering.entries.map { it.name },
            "KnownOrderSource" to OrderSource.entries.map { it.name },
            "KnownWarningKind" to WarningKind.entries.map { it.name },
            "KnownReportSource" to ReportSource.ALL,
        )
        val enums = defs.properties().filter { (_, node) -> node.has("enum") }.map { it.key }
        assertEquals(enums.sorted(), writer.keys.sorted(), "every enum in \$defs is checked against the writer's values")
        writer.forEach { (def, values) ->
            val node = defs.get(def) ?: error("the schema has no \$defs/$def")
            val listed = node.get("enum").let { e -> (0 until e.size()).map { e.get(it).asString() } }
            assertEquals(values.sorted(), listed.sorted(), "\$defs/$def lists the writer's values, no more and no fewer")
        }
    }

    @Test
    fun `the writer's schema version is the schema files'`() {
        listOf(REPORT_FILE, INDEX_FILE).forEach { file ->
            assertTrue(
                SCHEMA_DIR.resolve(file).readText().contains("\"\$id\": \"${idOf(file)}\""),
                "$file has \$id ${idOf(file)}: raise ReportSchema.VERSION and the \$ids together",
            )
        }
    }

    /** One scenario of each outcome, between them using every event kind and field the JSON has. */
    private fun everything(lsd: LsdContext) {
        val t0 = Instant.parse("2026-01-01T12:00:00Z")
        lsd.addParticipants(
            Participant("Customer", id = "customer", type = ParticipantType.ACTOR, displayName = "Shopper"),
            Participant("Api", id = "api", type = ParticipantType.BOUNDARY, colour = "#2563eb"),
            Participant("Orders", id = "orders", type = ParticipantType.PARTICIPANT),
            Participant("Orders DB", id = "db", type = ParticipantType.DATABASE),
            Participant("Events", id = "bus", type = ParticipantType.QUEUE),
            Participant("Order", id = "order", type = ParticipantType.ENTITY),
        )
        lsd.addFact("orderId", "ord-1")
        lsd.section("Place the order", t0)
        lsd.activate("api", "#c026d3", t0)
        val call =
            lsd.call(
                "customer",
                "api",
                "POST /orders",
                mapOf("method" to "POST", "path" to "/orders", "body" to mapOf("sku" to "HAT-3")),
                timing = Timing.at(t0.plusMillis(1)),
                trace = Trace("t1", "s1"),
            )
        lsd
            .call("api", "db", "insert", timing = Timing.of(t0.plusMillis(2), Duration.ofNanos(1_250_000)), trace = Trace("t1", "s2", "s1"))
            .reply("1 row", data = mapOf("rows" to 1))
        call.reply("201", data = mapOf("status" to 201, "body" to mapOf("id" to "ord-1")), timing = Timing.tookMs(9.5))
        lsd.deactivate("api", t0.plusMillis(12))
        val published = lsd.async("orders", "bus", "order.placed", timing = Timing.at(t0.plusMillis(20)).withSource("orders"))
        lsd.async("bus", "order", "consume", timing = Timing.at(t0.plusMillis(15)).withSource("billing"), causedBy = published)
        lsd.message("api", "db", "drop", MessageType.LOST)
        lsd.message("api", "orders", "sync", MessageType.BI_DIRECTIONAL)
        lsd.inbound("api", "webhook")
        lsd.outbound("api", "emit")
        lsd.response("db", "api", "late reply")
        lsd.note("over", "api")
        lsd.note("left", "api", side = NoteSide.LEFT)
        lsd.note("right edge", null, side = NoteSide.RIGHT)
        lsd.divider("then")
        lsd.delay("retry window")
        lsd.spacer(48)
        lsd.completeScenario("everything", "Given an order\nWhen it is placed\nThen it is stored", Status.SUCCESS)
        lsd.completeScenario("skipped", "not run", Status.WARN)
        lsd.completeScenario("failed", "boom", Status.ERROR, ScenarioError("Failed", "expected 1 but was 2", "at Test.kt:1"))
    }

    // Formats are annotations by default in 2020-12: assert them, so a time must be a date-time.
    private val registry =
        SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_2020_12) { builder ->
            builder
                .schemaRegistryConfig(SchemaRegistryConfig.builder().formatAssertionsEnabled(true).build())
                .schemas(listOf(REPORT_FILE, INDEX_FILE).associate { idOf(it) to SCHEMA_DIR.resolve(it).readText() })
        }
    private val report: Schema = registry.getSchema(SchemaLocation.of(idOf(REPORT_FILE)))
    private val index: Schema = registry.getSchema(SchemaLocation.of(idOf(INDEX_FILE)))

    private fun errors(schema: Schema, json: String) = schema.validate(json, InputFormat.JSON)

    private fun assertValid(schema: Schema, json: String, what: String) =
        assertEquals(emptyList<String>(), errors(schema, json).map { "${it.instanceLocation}: ${it.message}" }, what)

    /** [json] after [change], which edits its parsed root object. */
    private fun edit(
        json: String,
        change: ObjectNode.() -> Unit,
    ): String = (MAPPER.readTree(json) as ObjectNode).apply(change).toString()

    private fun scenario(root: JsonNode) = root.get("scenarios").get(0) as ObjectNode

    private fun participant(root: JsonNode) = scenario(root).get("participants").get(0) as ObjectNode

    private fun event(root: JsonNode) = scenario(root).get("events").get(0) as ObjectNode

    /** The text in [text] between [start] and the next [end]. */
    private fun between(text: String, start: String, end: String): String {
        val from = text.indexOf(start).also { assertTrue(it >= 0, "no $start") } + start.length
        return text.substring(from, text.indexOf(end, from).also { assertTrue(it >= 0, "no $end after $start") })
    }

    private companion object {
        const val TITLE = "Schema"
        const val REPORT_FILE = "lsd-report.schema.json"
        const val INDEX_FILE = "lsd-index.schema.json"
        val SCHEMA_DIR: Path = Path.of("../lsd-mono-report-schema")
        val MAPPER: JsonMapper = JsonMapper.builder().build()

        fun idOf(file: String) = "https://lsd-consulting.github.io/lsd-mono/schema/${ReportSchema.VERSION}/$file"

        /** Enum values the [everything] report must reach, so the test covers what it says. */
        val ENUM_VALUES =
            ParticipantType.entries.map { it.name } +
                MessageType.entries.map { it.name } +
                listOf("success", "warn", "error", "over", "left", "right", "activate", "deactivate") +
                listOf("message", "note", "divider", "section", "delay", "spacer")
    }
}
