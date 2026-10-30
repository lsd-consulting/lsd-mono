package io.github.lsdconsulting.lsd.mono.report.model

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import kotlin.reflect.KFunction
import kotlin.reflect.full.memberProperties
import kotlin.reflect.full.primaryConstructor
import kotlin.reflect.jvm.isAccessible

class ReportModelTest {
    @Test
    fun `a report needs only what the schema requires, and the rest has the page's defaults`() {
        val report = ReportJson
            .builder(
                title = "Orders",
                generatedAt = "2026-10-21T08:00:00Z",
                generator = GeneratorJson("my-adapter", "1.0"),
                status = StatusJson.SUCCESS,
            ).build()
        assertEquals(
            ReportOptionsJson
                .builder()
                .metricsEnabled(true)
                .labelMaxChars(200)
                .usagePing(true)
                .source("api")
                .build(),
            report.options,
        )
        assertEquals(emptyList<ScenarioJson>(), report.scenarios)
        val scenario = ScenarioJson.builder(id = "s1", title = "Place an order", status = StatusJson.SUCCESS).build()
        assertEquals("", scenario.description)
        assertEquals(emptyList<EventJson>(), scenario.events)
        assertNull(scenario.accuracy, "the page works the timing out")
        assertNull(scenario.sources)
        assertEquals("participant", ParticipantJson.builder("a", "A").build().type)
        assertEquals(NotePlacementJson.OVER, NoteEventJson.builder("n1", "hello").build().placement)
        assertEquals(TraceJson("t", null, null), TraceJson("t"), "a trace needs only its trace id")
    }

    @Test
    fun `every event has an id and an optional start`() {
        val events: List<EventJson> =
            listOf(
                MessageEventJson
                    .builder(
                        id = "m1",
                        from = "a",
                        to = "b",
                        label = "hi",
                        type = KnownMessageType.SYNCHRONOUS,
                    ).startedAt("2026-10-21T08:00:00Z")
                    .build(),
                NoteEventJson.builder("n1", "note").build(),
                DelayEventJson.builder("d1").build(),
                SpacerEventJson.builder("sp1").build(),
                DividerEventJson.builder("dv1", "then").build(),
                SectionEventJson.builder("se1", "Checkout").build(),
                LifelineEventJson.builder(LifelineKindJson.ACTIVATE, "l1", "a").build(),
            )
        assertEquals(listOf("m1", "n1", "d1", "sp1", "dv1", "se1", "l1"), events.map { it.id })
        assertEquals(listOf("2026-10-21T08:00:00Z"), events.mapNotNull { it.startedAt })
    }

    @Test
    fun `each value equals its own copy and no other, and prints its set fields`() {
        for ((full, bare) in pairs()) {
            val copy = rebuild(full)
            assertEquals(full, copy, "${full.javaClass.simpleName}'s toBuilder keeps every field")
            assertEquals(full.hashCode(), copy.hashCode())
            assertNotEquals(full, bare, "${full.javaClass.simpleName} differs from one with fewer fields")
            assertFalse(full.equals("not a model value"))
            val name = full.javaClass.simpleName
            assertTrue(full.toString().startsWith("$name("), full.toString())
            assertFalse(bare.toString().contains("=null"), "unset fields are not printed: $bare")
        }
    }

    /*
     * Each wide class names its fields four times: the constructor, the Builder, toBuilder() and
     * the fields() behind equals, hashCode and toString (#149). These go field by field over the
     * constructor, so a field added there but missed in one of the others fails here.
     */

    @Test
    fun `every field is set in the full value of each class, so a new field cannot go untested`() {
        for ((full, _) in pairs()) {
            for ((field, value) in fieldsOf(full)) {
                val where = "${full.javaClass.simpleName}.$field: set it in pairs()"
                assertNotNull(value, where)
                if (value is Collection<*>) assertFalse(value.isEmpty(), where)
                if (value is Map<*, *>) assertFalse(value.isEmpty(), where)
            }
        }
    }

    @Test
    fun `toBuilder keeps every field, whatever equals compares`() {
        for ((full, _) in pairs()) {
            val copy = fieldsOf(rebuild(full))
            for ((field, value) in fieldsOf(full)) {
                assertEquals(value, copy[field], "${full.javaClass.simpleName}.toBuilder() keeps $field")
            }
        }
    }

    @Test
    fun `values that differ in any one field are not equal, and each set field is printed`() {
        for ((full, bare) in pairs()) {
            val name = full.javaClass.simpleName
            val fields = fieldsOf(full)
            val bareFields = fieldsOf(bare)
            for ((field, value) in fields) {
                val changed = construct(full, fields + (field to otherThan(value, bareFields[field], "$name.$field")))
                assertNotEquals(full, changed, "$name.equals compares $field")
                assertTrue(full.toString().contains("$field="), "$name.toString() prints $field: $full")
            }
        }
    }

    /** The value's fields as its constructor takes them, by name. */
    private fun fieldsOf(value: Any): Map<String, Any?> {
        val klass = value::class
        val properties = klass.memberProperties.associateBy { it.name }
        return constructorOf(value).parameters.associate { parameter ->
            val property = properties.getValue(parameter.name!!)
            parameter.name!! to property.getter.call(value)
        }
    }

    private fun constructorOf(value: Any): KFunction<Any> {
        @Suppress("UNCHECKED_CAST")
        val constructor = value::class.primaryConstructor as KFunction<Any>
        constructor.isAccessible = true
        return constructor
    }

    private fun construct(
        like: Any,
        fields: Map<String, Any?>,
    ): Any {
        val constructor = constructorOf(like)
        return constructor.callBy(constructor.parameters.associateWith { fields[it.name] })
    }

    /** A value of the same kind as [value] but not equal to it: the bare one's when that differs. */
    private fun otherThan(
        value: Any?,
        bare: Any?,
        where: String,
    ): Any? =
        when {
            bare != value -> bare
            value is String -> "$value-changed"
            value is Enum<*> -> value.javaClass.enumConstants.first { it != value }
            value is Long -> value + 1
            value is Int -> value + 1
            value is Double -> value + 1
            value is Boolean -> !value
            value is GeneratorJson -> value.copy(name = value.name + "-changed")
            else -> error("$where: give pairs() a bare value that differs, or teach otherThan ${value?.javaClass}")
        }

    @Test
    fun `a builder copies the lists it is given, and its values do not change after build`() {
        val facts = mutableListOf(FactJson("a", "1"))
        val builder = ScenarioJson.builder("s1", "One", StatusJson.SUCCESS).facts(facts)
        val built = builder.build()
        facts += FactJson("b", "2")
        builder.fact("c", "3")
        assertEquals(listOf(FactJson("a", "1")), built.facts)
        assertEquals(listOf(FactJson("a", "1"), FactJson("c", "3")), builder.build().facts)
    }

    @Test
    fun `attributes are set one at a time or all at once, never with an empty key`() {
        val message =
            MessageEventJson
                .builder("m1", "a", "b", "GET /orders", KnownMessageType.SYNCHRONOUS)
                .attribute("http.request.method", "GET")
                .attribute("http.response.status_code", 200)
                .attribute("lsd.bytes", 12L)
                .attribute("lsd.ratio", 0.5)
                .attribute("lsd.cached", true)
                .attribute("lsd.tags", AttributeValueJson.ofStrings(listOf("a")))
                .attribute("http.request.method", "POST")
                .build()
        assertEquals(
            listOf("http.request.method", "http.response.status_code", "lsd.bytes", "lsd.ratio", "lsd.cached", "lsd.tags"),
            message.attributes.keys.toList(),
            "in the order first set",
        )
        assertEquals(AttributeValueJson.of("POST"), message.attributes["http.request.method"], "a key set again keeps the last value")
        assertEquals(200L, message.attributes.getValue("http.response.status_code").value)
        val builder = MessageEventJson.builder("m2", "a", "b", "x", KnownMessageType.SYNCHRONOUS)
        assertThrows(IllegalArgumentException::class.java) { builder.attribute("", "x") }
        assertThrows(IllegalArgumentException::class.java) { builder.attributes(mapOf("" to AttributeValueJson.of(1))) }
        assertEquals(mapOf("k" to AttributeValueJson.of(1)), builder.attributes(mapOf("k" to AttributeValueJson.of(1))).build().attributes)
    }

    @Test
    fun `attribute values are OpenTelemetry's kinds, and never NaN or infinite`() {
        assertEquals("x", AttributeValueJson.of("x").value)
        assertEquals(true, AttributeValueJson.of(true).value)
        assertEquals(1.5, AttributeValueJson.of(1.5).value)
        assertEquals(listOf(true), AttributeValueJson.ofBooleans(listOf(true)).value)
        assertEquals(listOf(1L), AttributeValueJson.ofLongs(listOf(1L)).value)
        assertEquals(listOf(0.5), AttributeValueJson.ofDoubles(listOf(0.5)).value)
        assertNotEquals(AttributeValueJson.of(1L), AttributeValueJson.of(1.0), "a whole number is not a double")
        assertEquals("AttributeValueJson(x)", AttributeValueJson.of("x").toString())
        assertThrows(IllegalArgumentException::class.java) { AttributeValueJson.of(Double.NaN) }
        assertThrows(IllegalArgumentException::class.java) { AttributeValueJson.ofDoubles(listOf(Double.NEGATIVE_INFINITY)) }
    }

    @Test
    fun `a participant's attributes are optional, kept in order, and keyed by non-empty names`() {
        val bare = ParticipantJson.builder("orders", "Orders").build()
        assertEquals(emptyMap<String, AttributeValueJson>(), bare.attributes)
        val participant =
            ParticipantJson
                .builder("orders", "Orders")
                .attribute("service.name", "orders")
                .attribute("lsd.external", false)
                .attribute("lsd.instances", 3)
                .attribute("lsd.since", 2026L)
                .attribute("lsd.load", 0.5)
                .attribute("lsd.regions", AttributeValueJson.ofStrings(listOf("eu-west-2")))
                .attribute("service.name", "orders-v2")
                .build()
        assertEquals(listOf("service.name", "lsd.external", "lsd.instances", "lsd.since", "lsd.load", "lsd.regions"), participant.attributes.keys.toList())
        assertEquals(AttributeValueJson.of("orders-v2"), participant.attributes["service.name"], "a key set again is replaced")
        assertEquals(AttributeValueJson.of(3L), participant.attributes["lsd.instances"])
        assertEquals(participant, participant.toBuilder().build())
        assertEquals(
            mapOf("peer.service" to AttributeValueJson.of("payments")),
            participant
                .toBuilder()
                .attributes(mapOf("peer.service" to AttributeValueJson.of("payments")))
                .build()
                .attributes,
        )
        assertNotEquals(bare, participant)
        assertThrows(IllegalArgumentException::class.java) { ParticipantJson.builder("a", "A").attribute("", "x") }
        assertThrows(IllegalArgumentException::class.java) { ParticipantJson.builder("a", "A").attributes(mapOf("" to AttributeValueJson.of(1))) }
        assertThrows(IllegalArgumentException::class.java) {
            MessageEventJson.builder("m", "a", "b", "m", KnownMessageType.SYNCHRONOUS).attributes(mapOf("" to AttributeValueJson.of(1)))
        }
        assertEquals(true, participant.toString().contains("attributes={service.name=AttributeValueJson(orders-v2)"), participant.toString())
    }

    @Test
    fun `the schema version is a runtime value`() {
        assertEquals(true, Regex("""\d+\.\d+\.\d+""").matches(ReportSchema.VERSION))
        val field = ReportSchema::class.java.getField("VERSION")
        assertEquals(ReportSchema.VERSION, field.get(null))
    }

    /** Each wide class with every field set, beside one with only what it needs. */
    private fun pairs(): List<Pair<Any, Any>> {
        val trace = TraceJson("4bf92f3577b34da6a3ce929d0e0e4736", "00f067aa0ba902b7", "53995c3f42cd8ad8")
        val message =
            MessageEventJson
                .builder("m1", "a", "b", "POST /orders", KnownMessageType.SYNCHRONOUS)
                .color("red")
                .durationMs(1.5)
                .data(DataValueJson.from(mapOf("method" to "POST")))
                .startedAt("2026-10-21T08:00:00Z")
                .seq(1)
                .callId("c1")
                .replyTo("c0")
                .causedBy("m0")
                .trace(trace)
                .source("api")
                .capturedAt("2026-10-21T08:00:00.001Z")
                .status("201")
                .timing(KnownTimingSource.MEASURED)
                .pairing(KnownPairingSource.CALL_ID)
                .order(KnownOrderSource.SEQUENCE)
                .parentId("m0")
                .attribute("http.route", "/orders")
                .origin(KnownMessageOrigin.IMPORTED)
                .build()
        val participant = ParticipantJson
            .builder("a", "A")
            .type(KnownParticipantType.ACTOR)
            .displayName("Ay")
            .color("blue")
            .attribute("service.name", "a")
            .build()
        val error = ScenarioErrorJson.builder("AssertionError", "expected 2").stack("at Test.kt:1").build()
        val scenario =
            ScenarioJson
                .builder("s1", "One", StatusJson.ERROR)
                .description("Given")
                .fact("k", "v")
                .metric("Messages", "1")
                .participant(participant)
                .event(message)
                .error(error)
                .accuracy(AccuracyJson.MEASURED)
                .measuredRatio(1.0)
                .pairedRatio(1.0)
                .sources(listOf("local"))
                .wallClockMs(2.0)
                .clockOrdering(ClockOrderingJson.SAME_SOURCE)
                .clockOrderedCount(0)
                .warning(WarningJson.builder(KnownWarningKind.SKEW, "skew").build())
                .reorderedByClock(listOf("m1"))
                .pairAccuracy(listOf(PairAccuracyJson.builder("a", "b", AccuracyJson.MEASURED).build()))
                .build()
        val options = ReportOptionsJson
            .builder()
            .metricsEnabled(false)
            .labelMaxChars(80)
            .usagePing(false)
            .source(KnownReportSource.JUNIT)
            .build()
        val report = ReportJson
            .builder("Orders", "2026-10-21T08:00:00Z", GeneratorJson("test", "1.0"), StatusJson.ERROR)
            .options(options)
            .scenario(scenario)
            .build()
        return listOf(
            report to ReportJson.builder("Orders", "2026-10-21T08:00:00Z", GeneratorJson("test", "1.0"), StatusJson.ERROR).build(),
            options to ReportOptionsJson.builder().build(),
            scenario to ScenarioJson.builder("s1", "One", StatusJson.ERROR).build(),
            error to ScenarioErrorJson.builder("AssertionError", "expected 2").build(),
            participant to ParticipantJson.builder("a", "A").build(),
            message to MessageEventJson.builder("m1", "a", "b", "POST /orders", KnownMessageType.SYNCHRONOUS).build(),
            NoteEventJson
                .builder("n1", "note")
                .over("a")
                .placement(NotePlacementJson.LEFT)
                .startedAt("2026-10-21T08:00:00Z")
                .build() to
                NoteEventJson.builder("n1", "note").build(),
            DelayEventJson
                .builder("d1")
                .label("later")
                .startedAt("2026-10-21T08:00:00Z")
                .build() to DelayEventJson.builder("d1").build(),
            SpacerEventJson
                .builder("sp1")
                .heightPx(40)
                .startedAt("2026-10-21T08:00:00Z")
                .build() to SpacerEventJson.builder("sp1").build(),
            DividerEventJson.builder("dv1", "then").startedAt("2026-10-21T08:00:00Z").build() to DividerEventJson.builder("dv1", "then").build(),
            SectionEventJson.builder("se1", "Pay").startedAt("2026-10-21T08:00:00Z").build() to SectionEventJson.builder("se1", "Pay").build(),
            LifelineEventJson
                .builder(LifelineKindJson.ACTIVATE, "l1", "a")
                .color("green")
                .startedAt("2026-10-21T08:00:00Z")
                .build() to
                LifelineEventJson.builder(LifelineKindJson.ACTIVATE, "l1", "a").build(),
        )
    }

    private fun rebuild(value: Any): Any =
        when (value) {
            is ReportJson -> value.toBuilder().build()
            is ReportOptionsJson -> value.toBuilder().build()
            is ScenarioJson -> value.toBuilder().build()
            is ScenarioErrorJson -> value.toBuilder().build()
            is ParticipantJson -> value.toBuilder().build()
            is MessageEventJson -> value.toBuilder().build()
            is NoteEventJson -> value.toBuilder().build()
            is DelayEventJson -> value.toBuilder().build()
            is SpacerEventJson -> value.toBuilder().build()
            is DividerEventJson -> value.toBuilder().build()
            is SectionEventJson -> value.toBuilder().build()
            is LifelineEventJson -> value.toBuilder().build()
            else -> error("no builder for $value")
        }
}
