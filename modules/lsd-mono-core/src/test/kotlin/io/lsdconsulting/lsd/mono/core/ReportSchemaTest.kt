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
import io.lsdconsulting.lsd.mono.core.testing.LsdTestConfig
import io.lsdconsulting.lsd.mono.report.html.testing.ReportFileNames
import io.lsdconsulting.lsd.mono.report.model.KnownMessageOrigin
import io.lsdconsulting.lsd.mono.report.model.KnownReportSource
import io.lsdconsulting.lsd.mono.report.model.ReportSchema
import io.lsdconsulting.lsd.mono.report.model.testing.ReportSchemas
import io.lsdconsulting.lsd.mono.report.model.testing.ReportSchemas.Document
import io.lsdconsulting.lsd.mono.report.model.testing.ReportSchemas.between
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
        val stem = ReportFileNames.stem(TITLE)

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
        assertEquals(4, ReportSchemas.assertOutputValid(tempDir), "the JSON, page, data script and index")
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
            "an attribute value is a string, boolean, number or a list of one" to edit(json) {
                event(this).putObject("attributes").putObject("http.request").put("method", "GET")
            },
            "an attribute key is not empty" to edit(json) { event(this).putObject("attributes").put("", "x") },
            "a participant's attribute value is a string, boolean, number or a list of one" to edit(json) {
                participant(this).putObject("attributes").putObject("service").put("name", "orders")
            },
            "a participant's attribute key is not empty" to edit(json) { participant(this).putObject("attributes").put("", "x") },
        )
        rejected.forEach { (rule, edited) -> assertTrue(errors(report, edited).isNotEmpty(), rule) }
        val accepted = mapOf(
            "unknown fields" to edit(json) {
                put("fromANewerMinor", true)
                scenario(this).put("fromANewerMinor", true)
                participant(this).put("fromANewerMinor", true)
                event(this).put("fromANewerMinor", true)
            },
            "OpenTelemetry trace ids, attributes and an origin" to edit(json) {
                val message = event(this)
                message
                    .putObject("trace")
                    .put("traceId", "4bf92f3577b34da6a3ce929d0e0e4736")
                    .put("spanId", "00f067aa0ba902b7")
                    .put("parentSpanId", "53995c3f42cd8ad8")
                message
                    .putObject("attributes")
                    .put("http.route", "/orders")
                    .put("http.response.status_code", 200)
                    .put("lsd.retried", false)
                    .putArray("lsd.tags")
                    .add("a")
                message.put("origin", "imported")
            },
            "a participant's attributes" to edit(json) {
                participant(this)
                    .putObject("attributes")
                    .put("service.name", "orders")
                    .put("lsd.instances", 3)
                    .put("lsd.external", false)
                    .putArray("lsd.regions")
                    .add("eu-west-2")
            },
            "a B3 64-bit trace id" to edit(json) { event(this).putObject("trace").put("traceId", "a3ce929d0e0e4736") },
            "an unknown origin" to edit(json) { event(this).put("origin", "replayed") },
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
        val defs = MAPPER.readTree(ReportSchemas.read(REPORT_FILE)).get("\$defs")
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
            "KnownReportSource" to KnownReportSource.ALL,
            // lsd-mono-core writes no origin (absent is captured); a producer that imports writes the rest.
            "KnownMessageOrigin" to KnownMessageOrigin.ALL,
        )
        val enums = defs.properties().filter { (_, node) -> node.has("enum") }.map { it.key }
        assertEquals(enums.sorted(), writer.keys.sorted(), "every enum in \$defs is checked against the writer's values")
        writer.forEach { (def, values) ->
            val node = defs.get(def) ?: error("the schema has no \$defs/$def")
            val listed = node.get("enum").let { e -> (0 until e.size()).map { e.get(it).asString() } }
            assertEquals(values.sorted(), listed.sorted(), "\$defs/$def lists the writer's values, no more and no fewer")
        }
    }

    /**
     * The schema leaves the type-like enums open (a `Known*` list or any string), so a newer
     * producer's values fit, and a typo fits too. lsd-mono's own writer is held to the known lists:
     * everything it writes follows a copy of the schema with each open enum closed to its list.
     */
    @Test
    fun `the writer writes only the values the schema knows`() {
        val lsd = LsdContext()
        everything(lsd)
        lsd.completeReport(TITLE)
        val json = tempDir.resolve("${ReportFileNames.stem(TITLE)}-report.json").readText()
        assertEquals(emptyList<String>(), strictErrors(json), "the writer's report follows the closed schema")

        val typo = edit(json) { participant(this).put("type", "QUEU") }
        assertValid(report, typo, "the open schema takes an unknown participant type")
        assertTrue(strictErrors(typo).isNotEmpty(), "the closed schema rejects it")
    }

    @Test
    fun `the writer's schema version is the schema files'`() {
        listOf(REPORT_FILE, INDEX_FILE).forEach { file ->
            assertTrue(
                ReportSchemas.read(file).contains("\"\$id\": \"${idOf(file)}\""),
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

    private val report = Document.REPORT
    private val index = Document.INDEX

    private fun errors(
        document: Document,
        json: String,
    ) = ReportSchemas.errors(document, json)

    private fun assertValid(
        document: Document,
        json: String,
        what: String,
    ) = ReportSchemas.assertValid(document, json, what)

    /** [json] after [change], which edits its parsed root object. */
    private fun edit(
        json: String,
        change: ObjectNode.() -> Unit,
    ): String = (MAPPER.readTree(json) as ObjectNode).apply(change).toString()

    private fun scenario(root: JsonNode) = root.get("scenarios").get(0) as ObjectNode

    private fun participant(root: JsonNode) = scenario(root).get("participants").get(0) as ObjectNode

    private fun event(root: JsonNode) = scenario(root).get("events").get(0) as ObjectNode

    /** [json]'s errors against the report schema with every open enum closed to its `Known*` list. */
    private fun strictErrors(json: String): List<String> =
        STRICT.validate(json, InputFormat.JSON).map { "${it.instanceLocation}: ${it.message}" }

    private companion object {
        const val TITLE = "Schema"
        const val REPORT_FILE = "lsd-report.schema.json"
        const val INDEX_FILE = "lsd-index.schema.json"
        val MAPPER: JsonMapper = JsonMapper.builder().build()
        const val STRICT_ID = "https://lsd-consulting.github.io/lsd-mono/schema/test/lsd-report.closed.schema.json"

        /** The report schema with each `anyOf: [Known*, string]` replaced by its `Known*` list. */
        val STRICT: Schema by lazy {
            val root = MAPPER.readTree(ReportSchemas.read(REPORT_FILE)) as ObjectNode
            val defs = root.get("\$defs") as ObjectNode
            val open =
                defs.properties().mapNotNull { (name, node) ->
                    node
                        .get("anyOf")
                        ?.firstOrNull { it.has("\$ref") && it.get("\$ref").asString().contains("/Known") }
                        ?.let { name to it.get("\$ref").asString() }
                }
            assertTrue(open.size >= 7, "the open enums found: $open")
            open.forEach { (name, known) -> defs.set(name, MAPPER.createObjectNode().put("\$ref", known)) }
            root.put("\$id", STRICT_ID)
            SchemaRegistry
                .withDefaultDialect(SpecificationVersion.DRAFT_2020_12) { builder ->
                    builder
                        .schemaRegistryConfig(SchemaRegistryConfig.builder().formatAssertionsEnabled(true).build())
                        .schemas(mapOf(STRICT_ID to root.toString()))
                }.getSchema(SchemaLocation.of(STRICT_ID))
        }

        fun idOf(file: String) = "https://lsd-consulting.github.io/lsd-mono/schema/${ReportSchema.VERSION}/$file"

        /** Enum values the [everything] report must reach, so the test covers what it says. */
        val ENUM_VALUES =
            ParticipantType.entries.map { it.name } +
                MessageType.entries.map { it.name } +
                listOf("success", "warn", "error", "over", "left", "right", "activate", "deactivate") +
                listOf("message", "note", "divider", "section", "delay", "spacer")
    }
}
