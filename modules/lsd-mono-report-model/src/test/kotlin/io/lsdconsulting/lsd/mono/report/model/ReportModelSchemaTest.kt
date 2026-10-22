package io.lsdconsulting.lsd.mono.report.model

import io.lsdconsulting.lsd.mono.report.model.testing.ReportSchemas
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import kotlin.reflect.KClass
import kotlin.reflect.full.primaryConstructor

/**
 * The model against the schema, so the two cannot drift: its enums and known values against the
 * schema's lists, and its classes' fields against the schema objects' properties.
 */
class ReportModelSchemaTest {
    @Test
    fun `each closed schema enum is a Kotlin enum with the schema's values`() {
        val closed =
            mapOf(
                "Status" to StatusJson.entries.map { it.json },
                "NotePlacement" to NotePlacementJson.entries.map { it.json },
                "Accuracy" to AccuracyJson.entries.map { it.json },
                "ClockOrdering" to ClockOrderingJson.entries.map { it.json },
            )
        for ((def, values) in closed) assertEquals(enumOf(defs().get(def)), values.toSet(), def)
        val lifelineKind = defs().get("ActivateEvent").get("properties").get("kind")
        assertEquals(enumOf(lifelineKind), LifelineKindJson.entries.map { it.json }.toSet(), "the lifeline event's kind")
    }

    @Test
    fun `each open schema value has its known values as constants`() {
        val known =
            mapOf(
                "KnownParticipantType" to KnownParticipantType.ALL,
                "KnownMessageType" to KnownMessageType.ALL,
                "KnownTimingSource" to KnownTimingSource.ALL,
                "KnownPairingSource" to KnownPairingSource.ALL,
                "KnownOrderSource" to KnownOrderSource.ALL,
                "KnownWarningKind" to KnownWarningKind.ALL,
                "KnownReportSource" to KnownReportSource.ALL,
                "KnownMessageOrigin" to KnownMessageOrigin.ALL,
            )
        for ((def, values) in known) {
            assertEquals(enumOf(defs().get(def)), values.toSet(), def)
            assertEquals(values.size, values.toSet().size, "$def has no repeats")
        }
        val knownDefs = defs().propertyNames().filter { it.startsWith("Known") }.toSet()
        assertEquals(knownDefs, known.keys, "every Known* list in the schema has its constants")
    }

    @Test
    fun `each model class has its schema object's properties, both ways`() {
        val schema = JsonMapper().readTree(ReportSchemas.read("lsd-report.schema.json"))
        for ((type, def) in OBJECTS) {
            val node = if (def == ROOT) schema else schema.get("\$defs").get(def)
            val properties = node.get("properties").propertyNames().toSet() - SCHEMA_ONLY[def].orEmpty()
            val parameters = type.primaryConstructor!!
                .parameters
                .map { RENAMED[type to it.name] ?: it.name!! }
                .toSet()
            assertEquals(properties.sorted(), parameters.sorted(), "${type.simpleName} against the schema's $def")
        }
    }

    @Test
    fun `every schema object and every event has a model class`() {
        val objects = defs().propertyNames().filter { defs().get(it).has("properties") }.toSet()
        assertEquals(objects - NO_CLASS, OBJECTS.values.toSet() - ROOT)
        assertTrue(OBJECTS.keys.containsAll(EventJson::class.sealedSubclasses), "every EventJson subclass is listed")
    }

    private fun defs() = JsonMapper().readTree(ReportSchemas.read("lsd-report.schema.json")).get("\$defs")

    private fun enumOf(node: JsonNode): Set<String> = node
        .get("enum")
        .values()
        .map { it.asString() }
        .toSet()

    private companion object {
        /** The schema's top-level object, which [ReportJson] is. */
        const val ROOT = "#"

        /** Each model class, with the schema object it writes. */
        val OBJECTS: Map<KClass<*>, String> =
            mapOf(
                ReportJson::class to ROOT,
                ReportOptionsJson::class to "ReportOptions",
                ScenarioJson::class to "Scenario",
                ScenarioErrorJson::class to "ScenarioError",
                FactJson::class to "Fact",
                MetricJson::class to "Metric",
                WarningJson::class to "TimingWarning",
                PairAccuracyJson::class to "PairAccuracy",
                ParticipantJson::class to "Participant",
                TraceJson::class to "Trace",
                MessageEventJson::class to "MessageEvent",
                NoteEventJson::class to "NoteEvent",
                DividerEventJson::class to "DividerEvent",
                SectionEventJson::class to "SectionEvent",
                DelayEventJson::class to "DelayEvent",
                SpacerEventJson::class to "SpacerEvent",
                LifelineEventJson::class to "ActivateEvent",
            )

        /**
         * A constructor parameter whose JSON name differs, as (class, parameter) to JSON name. There
         * are none: the model uses the schema's names, and core renames its own (a participant's
         * displayName is the model's alias) when it maps to the model. A model parameter named
         * otherwise must be listed here, with the writer writing it under the JSON name.
         */
        val RENAMED: Map<Pair<KClass<*>, String?>, String> = emptyMap()

        /** Properties the writer supplies rather than the model: the schema version and event kinds. */
        val SCHEMA_ONLY: Map<String, Set<String>> =
            mapOf(ROOT to setOf("schemaVersion")) +
                listOf("MessageEvent", "NoteEvent", "DividerEvent", "SectionEvent", "DelayEvent", "SpacerEvent").associateWith { setOf("kind") }

        /** Schema objects that no model class writes: a reader's catch-all for kinds it does not know. */
        val NO_CLASS = setOf("UnknownEvent")
    }
}
