package io.lsdconsulting.lsd.mono.report.model

import io.lsdconsulting.lsd.mono.report.model.testing.ReportSchemas
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper

/** The model's enums and known values against the schema's lists, so the two cannot drift. */
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
            )
        for ((def, values) in known) {
            assertEquals(enumOf(defs().get(def)), values.toSet(), def)
            assertEquals(values.size, values.toSet().size, "$def has no repeats")
        }
        val knownDefs = defs().propertyNames().filter { it.startsWith("Known") }.toSet()
        assertEquals(knownDefs, known.keys, "every Known* list in the schema has its constants")
    }

    private fun defs() = JsonMapper().readTree(ReportSchemas.read("lsd-report.schema.json")).get("\$defs")

    private fun enumOf(node: JsonNode): Set<String> = node
        .get("enum")
        .values()
        .map { it.asString() }
        .toSet()
}
