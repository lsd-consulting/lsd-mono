package io.github.lsdconsulting.lsd.mono.jvm

import io.github.lsdconsulting.lsd.mono.jvm.domain.MessageType
import io.github.lsdconsulting.lsd.mono.jvm.domain.NoteSide
import io.github.lsdconsulting.lsd.mono.jvm.domain.ParticipantType.PARTICIPANT
import io.github.lsdconsulting.lsd.mono.jvm.domain.Status
import io.github.lsdconsulting.lsd.mono.jvm.testing.LsdTestConfig
import io.github.lsdconsulting.lsd.mono.jvm.testing.ReportJson
import io.github.lsdconsulting.lsd.mono.report.html.testing.ReportFileNames
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path

/**
 * Locks remaining P1 sequence event kinds in ReportJson:
 * note left/right, delay, spacer, short inbound/outbound, LOST, BI_DIRECTIONAL.
 * Short arrows must not invent a "?" participant.
 */
@LsdTestConfig(deterministicIds = true)
class RemainingSequenceEventKindsTest {
    @TempDir
    lateinit var tempDir: Path

    @Test
    fun `note placement delay spacer short lost and bi serialise without fake participants`() {
        val lsd = LsdContext()
        lsd.addParticipants(
            PARTICIPANT.called("Api", id = "api"),
            PARTICIPANT.called("Db", id = "db"),
        )
        lsd.capture { note("over card", on = "api") }
        lsd.capture { note("left of api", on = "api", side = NoteSide.LEFT) }
        lsd.capture { note("right edge", on = null, side = NoteSide.RIGHT) }
        lsd.note("ctx left", "api", side = NoteSide.LEFT)
        lsd.note("ctx right", "db", side = NoteSide.RIGHT)
        lsd.capture { delay("retry window") }
        lsd.delay()
        lsd.capture { spacer(48) }
        lsd.spacer()
        lsd.capture { inbound("api", "found") }
        lsd.capture { outbound("api", "emit") }
        lsd.inbound("db", "wake")
        lsd.outbound("db", "ack")
        lsd.capture { message("api", "db", "drop", MessageType.LOST) }
        lsd.capture { message("api", "db", "pair", MessageType.BI_DIRECTIONAL) }
        lsd.completeScenario("event kinds", "P1 remaining", Status.SUCCESS)
        lsd.completeReport("Event kinds")

        val scenario = ReportJson.single(tempDir, ReportFileNames.stem("Event kinds") + "-report.json").scenario("event kinds")

        assertEquals(
            listOf(
                "note",
                "note",
                "note",
                "note",
                "note",
                "delay",
                "delay",
                "spacer",
                "spacer",
                "message",
                "message",
                "message",
                "message",
                "message",
                "message",
            ),
            scenario.events.map { it["kind"] },
        )

        // Each note with its own placement and anchor (#109: not a value found anywhere in the file).
        val notes = scenario.eventsOf("note").associateBy { it["text"] }
        assertEquals("over", notes.getValue("over card")["placement"])
        assertEquals("api", notes.getValue("over card")["over"])
        assertEquals("left", notes.getValue("left of api")["placement"])
        assertEquals("api", notes.getValue("left of api")["over"])
        val right = notes.getValue("right edge")
        assertEquals("right", right["placement"])
        assertFalse(right.containsKey("over"), "unanchored right note must omit over: $right")

        val delays = scenario.eventsOf("delay")
        assertEquals("retry window", delays.first()["label"])
        assertEquals(48.0, scenario.eventsOf("spacer").first()["heightPx"])

        val types = scenario.messages.map { it["type"] }
        assertEquals(2, types.count { it == "SHORT_INBOUND" })
        assertEquals(2, types.count { it == "SHORT_OUTBOUND" })
        assertEquals(1, types.count { it == "LOST" })
        assertEquals(1, types.count { it == "BI_DIRECTIONAL" })
        // A short arrow has an empty end, not an invented participant.
        assertEquals(listOf("", "api"), scenario.message("found").let { listOf(it["from"], it["to"]) })
        assertEquals(listOf("api", ""), scenario.message("emit").let { listOf(it["from"], it["to"]) })
        assertEquals(listOf("drop", "pair"), scenario.messages.filter { it["type"] in setOf("LOST", "BI_DIRECTIONAL") }.map { it["label"] })

        // No "?" participant, and only the two that were added.
        assertEquals(setOf("api", "db"), scenario.participants.map { it["id"] }.toSet())
        assertTrue(scenario.participants.none { it["name"] == "?" || it["id"] == "?" }, scenario.participants.toString())
    }
}
