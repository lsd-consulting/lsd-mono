package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.domain.MessageType
import io.lsdconsulting.lsd.mono.core.domain.NoteSide
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.PARTICIPANT
import io.lsdconsulting.lsd.mono.core.domain.Status
import io.lsdconsulting.lsd.mono.core.report.ReportWriter
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.io.path.readText

/**
 * Locks remaining P1 sequence event kinds in ReportJson:
 * note left/right, delay, spacer, short inbound/outbound, LOST, BI_DIRECTIONAL.
 * Short arrows must not invent a "?" participant.
 */
class RemainingSequenceEventKindsTest {
    @TempDir
    lateinit var tempDir: Path

    @BeforeEach
    fun deterministicOutput() {
        System.setProperty("lsd.mono.report.outputDir", tempDir.toString())
        System.setProperty("lsd.mono.ids.deterministic", "true")
    }

    @Test
    fun `note placement delay spacer short lost and bi serialise without fake participants`() {
        val lsd = LsdContext()
        lsd.addParticipants(
            PARTICIPANT.called("Api", id = "api"),
            PARTICIPANT.called("Db", id = "db"),
        )
        lsd.capture { note("over card", on = "api") }
        lsd.capture { note("left of api", on = "api", side = NoteSide.LEFT) }
        lsd.capture { note("right edge", side = NoteSide.RIGHT) }
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

        val json = tempDir.resolve(ReportWriter.reportFileStem("Event kinds") + "-report.json").readText()

        assertTrue(json.contains("\"placement\": \"over\""))
        assertTrue(json.contains("\"placement\": \"left\""))
        assertTrue(json.contains("\"placement\": \"right\""))
        assertTrue(json.contains("\"text\": \"over card\""))
        assertTrue(json.contains("\"text\": \"left of api\""))
        assertTrue(json.contains("\"text\": \"right edge\""))
        assertTrue(json.contains("\"kind\": \"delay\""))
        assertTrue(json.contains("\"label\": \"retry window\""))
        assertTrue(json.contains("\"kind\": \"spacer\""))
        assertTrue(json.contains("\"heightPx\": 48"))
        assertTrue(json.contains("\"type\": \"SHORT_INBOUND\""))
        assertTrue(json.contains("\"type\": \"SHORT_OUTBOUND\""))
        assertTrue(json.contains("\"type\": \"LOST\""))
        assertTrue(json.contains("\"type\": \"BI_DIRECTIONAL\""))
        assertTrue(json.contains("\"from\": \"\","))
        assertTrue(json.contains("\"to\": \"\","))

        // Unanchored right note: object has placement right and no over field before the next kind.
        val rightIdx = json.indexOf("\"text\": \"right edge\"")
        assertTrue(rightIdx >= 0)
        val rightSlice = json.substring(rightIdx, (rightIdx + 120).coerceAtMost(json.length))
        assertTrue(rightSlice.contains("\"placement\": \"right\""))
        assertFalse(rightSlice.contains("\"over\""), "unanchored right note must omit over near its text")

        assertFalse(json.contains("\"name\": \"?\""))
        assertFalse(json.contains("\"id\": \"?\""))

        val eventsStart = json.indexOf("\"events\": [")
        assertTrue(eventsStart >= 0)
        val eventsEnd = json.indexOf(']', json.indexOf('[', eventsStart))
        val eventsBlock = json.substring(eventsStart, eventsEnd + 1)
        val ordered =
            Regex("\"kind\": \"([^\"]+)\"").findAll(eventsBlock).map { it.groupValues[1] }.toList()
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
            ordered,
        )

        assertEquals(2, Regex("\"type\": \"SHORT_INBOUND\"").findAll(json).count())
        assertEquals(2, Regex("\"type\": \"SHORT_OUTBOUND\"").findAll(json).count())
        assertEquals(1, Regex("\"type\": \"LOST\"").findAll(json).count())
        assertEquals(1, Regex("\"type\": \"BI_DIRECTIONAL\"").findAll(json).count())

        val participantsStart = json.indexOf("\"participants\": [")
        val participantsEnd = json.indexOf(']', json.indexOf('[', participantsStart))
        val participantIds =
            Regex("\"id\": \"([^\"]+)\"")
                .findAll(json.substring(participantsStart, participantsEnd + 1))
                .map { it.groupValues[1] }
                .toSet()
        assertEquals(setOf("api", "db"), participantIds)
    }
}
