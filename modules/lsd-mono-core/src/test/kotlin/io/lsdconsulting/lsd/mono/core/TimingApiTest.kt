package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.domain.Message
import io.lsdconsulting.lsd.mono.core.domain.MessageType
import io.lsdconsulting.lsd.mono.core.domain.Note
import io.lsdconsulting.lsd.mono.core.domain.PairAccuracy
import io.lsdconsulting.lsd.mono.core.domain.SequenceEvent
import io.lsdconsulting.lsd.mono.core.domain.Status
import io.lsdconsulting.lsd.mono.core.domain.WarningKind
import io.lsdconsulting.lsd.mono.core.domain.orderAndAnalyse
import io.lsdconsulting.lsd.mono.core.properties.LsdProperties
import io.lsdconsulting.lsd.mono.core.report.ReportWriter
import io.lsdconsulting.lsd.mono.core.testing.LsdTestConfig
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import java.time.Duration
import java.time.Instant
import kotlin.io.path.readText

/** The timing API, slice 1: accuracy, pairing, clock ordering with structural guards, JSON. */
@LsdTestConfig(deterministicIds = true)
class TimingApiTest {
    @TempDir
    lateinit var tempDir: Path

    private val t0 = Instant.parse("2026-10-14T12:00:00Z")

    private fun t(ms: Long) = t0.plusMillis(ms)

    private var next = 0

    private fun msg(
        label: String,
        from: String = "A",
        to: String = "B",
        type: MessageType = MessageType.SYNCHRONOUS,
        at: Instant? = null,
        ms: Double? = null,
        source: String? = null,
        callRef: CallRef? = null,
        replyTo: CallRef? = null,
        causedBy: CallRef? = null,
        trace: Trace? = null,
        hint: Boolean? = null,
    ) = Message(
        id = "e${++next}",
        from = from,
        to = to,
        label = label,
        type = type,
        startedAt = at,
        durationMs = ms,
        source = source,
        callRef = callRef,
        replyTo = replyTo,
        causedBy = causedBy,
        trace = trace,
        orderHint = hint,
        seq = next.toLong(),
    )

    private fun labels(events: List<SequenceEvent>) = events.map { (it as? Message)?.label ?: (it as Note).text }

    @Test
    fun `pairing a long scenario of nested guessed and traced calls stays linear`() {
        val events = mutableListOf<SequenceEvent>()
        repeat(5_000) { k ->
            events += msg("call $k", from = "A", to = "B", at = t(k * 10L))
            events += msg("inner $k", from = "B", to = "C", trace = Trace("t$k", "s$k"))
            events += msg("inner reply $k", from = "C", to = "B", type = MessageType.SYNCHRONOUS_RESPONSE, trace = Trace("t$k", "s$k"))
        }
        repeat(5_000) { k -> events += msg("reply $k", from = "B", to = "A", type = MessageType.SYNCHRONOUS_RESPONSE) }
        val started = System.nanoTime()
        val (_, timing) = orderAndAnalyse(events, ClockOrdering.SAME_SOURCE)
        assertTrue(Duration.ofNanos(System.nanoTime() - started) < Duration.ofSeconds(2))
        assertTrue(timing.warnings.map { it.text }.none { it.startsWith("reply without call") })
        assertEquals("TRACE", timing.perEvent[events[1].id]?.pairing?.name)
        assertEquals("GUESSED", timing.perEvent[events[0].id]?.pairing?.name)
    }

    @Test
    fun `no timing at all is a structure-only sketch in capture order`() {
        val events = listOf(msg("call"), msg("reply", "B", "A", MessageType.SYNCHRONOUS_RESPONSE), msg("event", type = MessageType.ASYNCHRONOUS))
        val (ordered, timing) = orderAndAnalyse(events, ClockOrdering.SAME_SOURCE)
        assertEquals(events, ordered)
        assertEquals(Accuracy.STRUCTURE_ONLY, timing.accuracy)
        assertEquals(PairingSource.GUESSED, timing.perEvent["e1"]?.pairing)
        assertEquals(0.0, timing.pairingCoverage)
        assertEquals(0, timing.clockOrdered)
        assertTrue(timing.perEvent.values.all { it.order == OrderSource.SEQUENCE && it.timing == TimingSource.NONE })
    }

    @Test
    fun `timestamps only give TIMESTAMPED and a single-source wall clock`() {
        val (_, timing) = orderAndAnalyse(listOf(msg("a", at = t(0)), msg("b", at = t(250))), ClockOrdering.OFF)
        assertEquals(Accuracy.TIMESTAMPED, timing.accuracy)
        assertEquals(250.0, timing.wallClockMs)
        assertEquals(listOf("local"), timing.sources)
    }

    @Test
    fun `a measured call paired by call id is TRACED, by guess only MEASURED`() {
        val ref = CallRef("c1")
        val exact =
            listOf(
                msg("call", callRef = ref),
                msg("reply", "B", "A", MessageType.SYNCHRONOUS_RESPONSE, ms = 12.5, replyTo = ref),
            )
        val (_, traced) = orderAndAnalyse(exact, ClockOrdering.SAME_SOURCE)
        assertEquals(Accuracy.TRACED, traced.accuracy)
        assertEquals(TimingSource.MEASURED, traced.perEvent["e1"]?.timing)
        assertEquals(PairingSource.CALL_ID, traced.perEvent["e2"]?.pairing)
        assertEquals(OrderSource.STRUCTURE, traced.perEvent["e1"]?.order)
        assertEquals(1.0, traced.measuredCoverage)

        val guessed = listOf(msg("call"), msg("reply", "B", "A", MessageType.SYNCHRONOUS_RESPONSE, ms = 12.5))
        assertEquals(Accuracy.MEASURED, orderAndAnalyse(guessed, ClockOrdering.SAME_SOURCE).second.accuracy)
    }

    @Test
    fun `span ids pair a reply with its call across interleaving`() {
        val events =
            listOf(
                msg("first", trace = Trace("t", "s1"), ms = 4.0),
                msg("second", trace = Trace("t", "s2"), ms = 3.0),
                msg("reply to first", "B", "A", MessageType.SYNCHRONOUS_RESPONSE, trace = Trace("t", "s1")),
                msg("reply to second", "B", "A", MessageType.SYNCHRONOUS_RESPONSE, trace = Trace("t", "s2")),
            )
        val (_, timing) = orderAndAnalyse(events, ClockOrdering.SAME_SOURCE)
        assertEquals(PairingSource.TRACE, timing.perEvent["e3"]?.pairing)
        assertEquals(Accuracy.TRACED, timing.accuracy)
    }

    @Test
    fun `same-source clock ordering moves timed unmeasured events into timed slots only`() {
        val events =
            listOf(
                msg("late", at = t(300), type = MessageType.ASYNCHRONOUS),
                msg("untimed", type = MessageType.ASYNCHRONOUS),
                msg("early", at = t(100), type = MessageType.ASYNCHRONOUS),
                msg("measured", at = t(0), ms = 5.0),
            )
        val (ordered, timing) = orderAndAnalyse(events, ClockOrdering.SAME_SOURCE)
        assertEquals(listOf("early", "untimed", "late", "measured"), labels(ordered))
        assertEquals(2, timing.clockOrdered)
        assertEquals(OrderSource.CLOCK, timing.perEvent["e1"]?.order)
        assertEquals(OrderSource.SEQUENCE, timing.perEvent["e2"]?.order)
        assertEquals(listOf("1 -> 3", "3 -> 1").sorted(), timing.reorderedByClock.sorted())
        // Clock order never raises accuracy.
        assertEquals(Accuracy.MEASURED, timing.accuracy)
        assertEquals(TimingSource.TIMESTAMPED, timing.perEvent["e1"]?.timing)
    }

    @Test
    fun `equal timestamps tie-break on capture order`() {
        val events =
            listOf(
                msg("b", at = t(5), type = MessageType.ASYNCHRONOUS),
                msg("a", at = t(1), type = MessageType.ASYNCHRONOUS),
                msg("c", at = t(5), type = MessageType.ASYNCHRONOUS),
            )
        assertEquals(listOf("a", "b", "c"), labels(orderAndAnalyse(events, ClockOrdering.SAME_SOURCE).first))
    }

    @Test
    fun `different sources are not compared unless ALL_SOURCES`() {
        val events =
            listOf(
                msg("orders", at = t(200), source = "orders", type = MessageType.ASYNCHRONOUS),
                msg("billing", at = t(100), source = "billing", type = MessageType.ASYNCHRONOUS),
            )
        assertEquals(listOf("orders", "billing"), labels(orderAndAnalyse(events, ClockOrdering.SAME_SOURCE).first))
        assertEquals(listOf("billing", "orders"), labels(orderAndAnalyse(events, ClockOrdering.ALL_SOURCES).first))
        val (_, timing) = orderAndAnalyse(events, ClockOrdering.ALL_SOURCES)
        assertNull(timing.wallClockMs, "wall clock is single-source only")
        assertEquals(listOf("orders", "billing"), timing.sources)
    }

    @Test
    fun `three sources, SAME_SOURCE sorts within each and ALL_SOURCES across all of them`() {
        val events =
            listOf(
                msg("orders late", at = t(30), source = "orders", type = MessageType.ASYNCHRONOUS),
                msg("billing", at = t(10), source = "billing", type = MessageType.ASYNCHRONOUS),
                msg("stock", at = t(20), source = "stock", type = MessageType.ASYNCHRONOUS),
                msg("orders early", at = t(25), source = "orders", type = MessageType.ASYNCHRONOUS),
            )
        assertEquals(
            listOf("orders early", "billing", "stock", "orders late"),
            labels(orderAndAnalyse(events, ClockOrdering.SAME_SOURCE).first),
            "orders keeps its two slots; the other sources stay where they were captured",
        )
        val (ordered, timing) = orderAndAnalyse(events, ClockOrdering.ALL_SOURCES)
        assertEquals(listOf("billing", "stock", "orders early", "orders late"), labels(ordered))
        assertEquals(setOf("orders", "billing", "stock"), timing.sources.toSet())
        assertEquals(emptyList<String>(), timing.warnings.map { it.text })
        assertNull(timing.wallClockMs, "wall clock is single-source only")
        assertEquals(
            listOf("orders late", "billing", "stock", "orders early"),
            labels(orderAndAnalyse(events, ClockOrdering.OFF).first),
            "OFF keeps capture order",
        )
    }

    @Test
    fun `ALL_SOURCES falls back to each source when two clocks disagree with the structure`() {
        val p = CallRef("p")
        val events =
            listOf(
                msg("late", at = t(20), source = "orders", type = MessageType.ASYNCHRONOUS),
                msg("publish", at = t(10), source = "orders", type = MessageType.ASYNCHRONOUS, callRef = p),
                msg("other", at = t(8), source = "billing", type = MessageType.ASYNCHRONOUS),
                msg("consume", at = t(5), source = "billing", type = MessageType.ASYNCHRONOUS, causedBy = p),
            )
        val (ordered, timing) = orderAndAnalyse(events, ClockOrdering.ALL_SOURCES)
        assertEquals(listOf("publish", "late", "consume", "other"), labels(ordered))
        assertEquals(
            listOf("skew: clocks of billing and orders disagree with the structure, so their events keep their captured interleaving"),
            timing.warnings.map { it.text },
        )
    }

    @Test
    fun `three sources where one pair disagrees, only that pair is kept apart`() {
        val p = CallRef("p")
        val events =
            listOf(
                msg("stock late", at = t(40), source = "stock", type = MessageType.ASYNCHRONOUS),
                msg("publish", at = t(10), source = "orders", type = MessageType.ASYNCHRONOUS, callRef = p),
                msg("consume", at = t(5), source = "billing", type = MessageType.ASYNCHRONOUS, causedBy = p),
                msg("stock early", at = t(7), source = "stock", type = MessageType.ASYNCHRONOUS),
                msg("billing later", at = t(20), source = "billing", type = MessageType.ASYNCHRONOUS),
            )
        val (ordered, timing) = orderAndAnalyse(events, ClockOrdering.ALL_SOURCES)
        assertEquals(
            listOf("stock early", "publish", "consume", "billing later", "stock late"),
            labels(ordered),
            "orders and billing keep their captured interleaving; stock is still clock-ordered against both",
        )
        assertEquals(
            listOf("skew: clocks of billing and orders disagree with the structure, so their events keep their captured interleaving"),
            timing.warnings.map { it.text },
            "only the pair that disagrees is named",
        )
    }

    @Test
    fun `ALL_SOURCES never breaks structure, on random scenarios`() {
        val rng = kotlin.random.Random(51)
        val sources = listOf("orders", "billing", "stock")
        var keptApart = 0
        repeat(400) { case ->
            val events = mutableListOf<Message>()
            val open = ArrayDeque<CallRef>()
            val published = mutableListOf<CallRef>()
            var refs = 0

            fun at() = if (rng.nextInt(5) == 0) null else t(rng.nextLong(0, 50))

            fun src() = sources[rng.nextInt(sources.size)]

            fun reply(ref: CallRef) =
                msg("reply", from = "B", to = "A", type = MessageType.SYNCHRONOUS_RESPONSE, at = at(), source = src(), replyTo = ref)

            fun async(
                label: String,
                callRef: CallRef? = null,
                causedBy: CallRef? = null,
            ) = msg(label, type = MessageType.ASYNCHRONOUS, at = at(), source = src(), callRef = callRef, causedBy = causedBy)
            repeat(10) {
                when (rng.nextInt(5)) {
                    0 ->
                        if (open.size < 2) {
                            val ref = CallRef("c${refs++}").also(open::addLast)
                            events += msg("call", at = at(), source = src(), callRef = ref)
                        }
                    1 -> open.removeLastOrNull()?.let { events += reply(it) }
                    2 -> events += async("publish", callRef = CallRef("p${refs++}").also(published::add))
                    3 -> published.randomOrNull(rng)?.let { events += async("consume", causedBy = it) }
                    else -> events += async("event")
                }
            }
            while (open.isNotEmpty()) events += reply(open.removeLast())
            val (ordered, timing) = orderAndAnalyse(events, ClockOrdering.ALL_SOURCES)
            val pos = ordered.withIndex().associate { (i, e) -> e.id to i }
            val replyOfCall = timing.replyOf.entries.associate { (reply, call) -> call to reply }
            // Explicit links always hold, and the tree the report draws matches the order it lists.
            assertTrue(
                io.lsdconsulting.lsd.mono.core.domain
                    .linksHold(ordered),
                "case $case: $ordered",
            )
            timing.parentOf.forEach { (child, parent) ->
                assertTrue(pos.getValue(child) > pos.getValue(parent), "case $case: $child after its call $parent")
                replyOfCall[parent]?.let { assertTrue(pos.getValue(child) < pos.getValue(it), "case $case: $child before the reply $it") }
            }
            timing.replyOf.forEach { (reply, call) -> assertTrue(pos.getValue(reply) > pos.getValue(call), "case $case: $reply after $call") }
            if (timing.warnings.any { it.text.startsWith("skew: clocks of") }) keptApart++
        }
        assertTrue(keptApart > 0, "some cases keep a source pair apart")
    }

    @Test
    fun `ALL_SOURCES keeps capture order when a break has no source pair to blame`() {
        val p = CallRef("p")
        val events =
            listOf(
                msg("publish", at = t(10), source = "orders", type = MessageType.ASYNCHRONOUS, callRef = p),
                msg("consume", at = t(5), source = "orders", type = MessageType.ASYNCHRONOUS, causedBy = p),
                msg("billing", at = t(1), source = "billing", type = MessageType.ASYNCHRONOUS),
            )
        val (ordered, timing) = orderAndAnalyse(events, ClockOrdering.ALL_SOURCES)
        assertEquals(listOf("publish", "consume", "billing"), labels(ordered), "structure wins")
        assertEquals(listOf(WarningKind.SKEW), timing.warnings.map { it.kind })
        assertTrue(
            timing.warnings
                .single()
                .text
                .startsWith("skew: clock order ignored for 3 events"),
            timing.warnings.toString(),
        )
    }

    @Test
    fun `accuracy per participant pair, given when the pairs differ`() {
        val c = CallRef("c")
        val events =
            listOf(
                msg("call", callRef = c, ms = 12.0),
                msg("reply", from = "B", to = "A", type = MessageType.SYNCHRONOUS_RESPONSE, replyTo = c),
                msg("event", from = "B", to = "C", type = MessageType.ASYNCHRONOUS, at = t(5)),
                msg("guess", from = "C", to = "D"),
                msg("guess reply", from = "D", to = "C", type = MessageType.SYNCHRONOUS_RESPONSE),
            )
        val (_, timing) = orderAndAnalyse(events, ClockOrdering.SAME_SOURCE)
        assertEquals(Accuracy.MEASURED, timing.accuracy)
        assertEquals(
            listOf(
                PairAccuracy("A", "B", Accuracy.TRACED),
                PairAccuracy("B", "C", Accuracy.TIMESTAMPED),
                PairAccuracy("C", "D", Accuracy.STRUCTURE_ONLY),
            ),
            timing.pairAccuracy,
        )
        val same = orderAndAnalyse(events.take(2), ClockOrdering.SAME_SOURCE).second
        assertEquals(emptyList<PairAccuracy>(), same.pairAccuracy, "one pair, nothing to compare")
    }

    @Test
    fun `pair accuracy is written to the report json`() {
        val lsd = LsdContext()
        lsd.call("web", "api", "GET", timing = Timing.tookMs(5.0)).reply("ok")
        lsd.message("api", "bus", "event")
        lsd.completeScenario("pairs", status = Status.SUCCESS)
        val json = report(lsd, "Pairs")
        assertTrue(json.contains("\"pairAccuracy\""), json)
        val compact = json.replace(Regex("\\s"), "")
        assertTrue(compact.contains("{\"from\":\"api\",\"to\":\"bus\",\"accuracy\":\"STRUCTURE_ONLY\"}"), json)
    }

    @Test
    fun `two calls with the same span are a warning`() {
        val events =
            listOf(
                msg("first", trace = Trace("t", "s")),
                msg("second", trace = Trace("t", "s")),
                msg("r2", from = "B", to = "A", type = MessageType.SYNCHRONOUS_RESPONSE, trace = Trace("t", "s")),
                msg("r1", from = "B", to = "A", type = MessageType.SYNCHRONOUS_RESPONSE, trace = Trace("t", "s")),
                msg("other trace", trace = Trace("u", "s")),
            )
        val (_, timing) = orderAndAnalyse(events, ClockOrdering.SAME_SOURCE)
        assertEquals(
            listOf("duplicate span: 'first' and 'second' share span s in trace t; their replies pair with the latest open one"),
            timing.warnings.map { it.text },
        )
    }

    @Test
    fun `OFF keeps capture order, and hints opt in or out`() {
        val events = listOf(msg("b", at = t(5), type = MessageType.ASYNCHRONOUS), msg("a", at = t(1), type = MessageType.ASYNCHRONOUS))
        assertEquals(listOf("b", "a"), labels(orderAndAnalyse(events, ClockOrdering.OFF).first))
        val hinted =
            listOf(msg("b", at = t(5), hint = true, type = MessageType.ASYNCHRONOUS), msg("a", at = t(1), hint = true, type = MessageType.ASYNCHRONOUS))
        assertEquals(listOf("a", "b"), labels(orderAndAnalyse(hinted, ClockOrdering.OFF).first))
        val optedOut = listOf(msg("b", at = t(5), hint = false, type = MessageType.ASYNCHRONOUS), msg("a", at = t(1), type = MessageType.ASYNCHRONOUS))
        assertEquals(listOf("b", "a"), labels(orderAndAnalyse(optedOut, ClockOrdering.SAME_SOURCE).first))
    }

    @Test
    fun `a reply is never clocked before its call`() {
        val ref = CallRef("c")
        val events =
            listOf(
                msg("call", at = t(500), callRef = ref),
                msg("reply", "B", "A", MessageType.SYNCHRONOUS_RESPONSE, at = t(100), replyTo = ref),
            )
        val (ordered, timing) = orderAndAnalyse(events, ClockOrdering.SAME_SOURCE)
        assertEquals(listOf("call", "reply"), labels(ordered))
        assertEquals(0, timing.clockOrdered)
        assertTrue(timing.warnings.map { it.text }.any { it.startsWith("skew") }, timing.warnings.toString())
    }

    @Test
    fun `a consume is never clocked before its publish`() {
        val pub = CallRef("p")
        val events =
            listOf(
                msg("publish", "orders", "kafka", MessageType.ASYNCHRONOUS, at = t(500), callRef = pub),
                msg("consume", "kafka", "billing", MessageType.ASYNCHRONOUS, at = t(100), causedBy = pub),
            )
        val (ordered, timing) = orderAndAnalyse(events, ClockOrdering.SAME_SOURCE)
        assertEquals(listOf("publish", "consume"), labels(ordered))
        assertTrue(timing.warnings.map { it.text }.any { it.startsWith("skew") })
    }

    @Test
    fun `a child is never clocked out of its parent call, and siblings sort inside it`() {
        val parent = CallRef("parent")
        val events =
            listOf(
                msg("before", at = t(900), type = MessageType.ASYNCHRONOUS),
                msg("parent", "A", "B", callRef = parent, ms = 50.0),
                msg("child 2", "B", "C", MessageType.ASYNCHRONOUS, at = t(20)),
                msg("child 1", "B", "C", MessageType.ASYNCHRONOUS, at = t(10)),
                msg("reply", "B", "A", MessageType.SYNCHRONOUS_RESPONSE, replyTo = parent),
                msg("after", at = t(1), type = MessageType.ASYNCHRONOUS),
            )
        val (ordered, _) = orderAndAnalyse(events, ClockOrdering.SAME_SOURCE)
        // child 1 and 2 swap inside the call; before/after swap at top level, never into the call.
        assertEquals(listOf("after", "parent", "child 1", "child 2", "reply", "before"), labels(ordered))
    }

    @Test
    fun `scrambled capture with replies before calls is rebuilt from the clock`() {
        val events =
            listOf(
                msg("reply", "B", "A", MessageType.SYNCHRONOUS_RESPONSE, at = t(30)),
                msg("call", "A", "B", at = t(10)),
                msg("inner", "B", "C", MessageType.ASYNCHRONOUS, at = t(20)),
            )
        val (ordered, timing) = orderAndAnalyse(events, ClockOrdering.SAME_SOURCE)
        assertEquals(listOf("call", "inner", "reply"), labels(ordered))
        assertEquals(PairingSource.GUESSED, timing.perEvent["e1"]?.pairing)
        assertEquals(3, timing.clockOrdered)
        assertTrue(timing.warnings.isEmpty(), timing.warnings.toString())
        // Off: capture order is kept as is.
        assertEquals(listOf("reply", "call", "inner"), labels(orderAndAnalyse(events, ClockOrdering.OFF).first))
    }

    @Test
    fun `call and reply measure a fractional duration and mark it measured`() {
        val lsd = LsdContext()
        val call = lsd.call("Web", "Api", "GET /x", trace = Trace("t1", "s1"))
        assertTrue(call.callId.isNotEmpty())
        Thread.sleep(2)
        call.reply("200")
        lsd.completeScenario("measured", status = Status.SUCCESS)
        val json = report(lsd, "Measured")
        assertTrue(json.contains("\"accuracy\": \"TRACED\""), json)
        assertTrue(json.contains("\"timing\": \"MEASURED\""), json)
        assertTrue(json.contains("\"pairing\": \"CALL_ID\""), json)
        assertTrue(json.contains("\"replyTo\": \"${call.callId}\""), json)
        assertTrue(json.contains("\"traceId\": \"t1\""), json)
        assertTrue(Regex("\"durationMs\": \\d+\\.\\d+").containsMatchIn(json), json)
        assertTrue(json.contains("\"clockOrdering\": \"SAME_SOURCE\""), json)
        assertFalse(json.contains("capturedAt"), "reproducible reports leave capturedAt out")
    }

    @Test
    fun `a timed call and reply with no duration is DERIVED, not measured`() {
        val lsd = LsdContext()
        lsd.call("A", "B", "x", timing = Timing.at(t(0))).reply("ok", timing = Timing.at(t(40)))
        lsd.completeScenario("derived", status = Status.SUCCESS)
        val json = report(lsd, "Derived")
        assertTrue(json.contains("\"timing\": \"DERIVED\""), json)
        assertTrue(json.contains("\"accuracy\": \"TIMESTAMPED\""), json)
        assertTrue(json.contains("\"durationMs\": 40"), json)
    }

    @Test
    fun `explicit timing and publish-consume links reach the JSON`() {
        val lsd = LsdContext()
        lsd.call("api", "payments", "authorise", timing = Timing.of(t(0), Duration.ofNanos(652_250_000))).reply("ok")
        val published = lsd.async("orders", "kafka", "order.placed", timing = Timing.at(t(10)).withSource("orders"))
        lsd.async("kafka", "billing", "consume", timing = Timing.at(t(5)).withSource("orders"), causedBy = published)
        lsd.completeScenario("linked", status = Status.SUCCESS)
        val json = report(lsd, "Linked")
        assertTrue(json.contains("\"durationMs\": 652.25"), json)
        assertTrue(json.contains("\"causedBy\": \"${published.callId}\""), json)
        assertTrue(json.contains("\"source\": \"orders\""), json)
        val publish = json.indexOf("order.placed")
        assertTrue(publish in 0 until json.indexOf("\"label\": \"consume\""), "consume stays after its publish")
    }

    @Test
    fun `the call carries its reply's duration and the paired reply carries none`() {
        val lsd = LsdContext()
        lsd.accept(Interaction(InteractionKind.REQUEST, "orders", "payments", "POST /pay", interactionId = "c1"))
        lsd.accept(Interaction(InteractionKind.RESPONSE, "payments", "orders", "201", replyTo = "c1", durationMs = 30.5))
        lsd.accept(Interaction(InteractionKind.PUBLISH, "orders", "kafka", "paid", durationMs = 2.0))
        lsd.completeScenario("moved", status = Status.SUCCESS)
        val json = report(lsd, "Moved")
        val events = Regex("\\{[^{}]*\"label\": \"([^\"]+)\"[^{}]*\\}").findAll(json).associate { it.groupValues[1] to it.value }
        assertTrue(events.getValue("POST /pay").contains("\"durationMs\": 30.5"), json)
        assertFalse(events.getValue("201").contains("durationMs"), json)
        assertTrue(events.getValue("paid").contains("\"durationMs\": 2"), "an unpaired message keeps its own")
    }

    @Test
    fun `parentSpanId nests a call under its own parent when concurrent calls interleave`() {
        val lsd = LsdContext()
        val a = lsd.call("api", "orders", "A", timing = Timing.tookMs(300.0), trace = Trace("t", "a"))
        val b = lsd.call("api", "stock", "B", timing = Timing.tookMs(50.0), trace = Trace("t", "b"))
        lsd
            .call("orders", "db", "child of A", timing = Timing.tookMs(100.0), trace = Trace("t", "c", parentSpanId = "a"))
            .reply("rows")
        a.reply("ok")
        b.reply("ok")
        lsd.completeScenario("spans", status = Status.SUCCESS)
        val json = report(lsd, "Spans")
        assertFalse(json.contains("LONGER_THAN_PARENT"), "the child is inside A (300 ms), not B (50 ms): $json")
    }

    @Test
    fun `without parentSpanId the innermost open call is the parent`() {
        val lsd = LsdContext()
        val a = lsd.call("api", "orders", "A", timing = Timing.tookMs(300.0))
        val b = lsd.call("api", "stock", "B", timing = Timing.tookMs(50.0))
        lsd.call("orders", "db", "child", timing = Timing.tookMs(100.0)).reply("rows")
        a.reply("ok")
        b.reply("ok")
        lsd.completeScenario("stack", status = Status.SUCCESS)
        assertTrue(
            report(lsd, "Stack").replace(Regex("\\s+"), " ").contains(
                """"kind": "LONGER_THAN_PARENT", "message": "'child' took 100 ms, more than 'B'""",
            ),
        )
    }

    @Test
    fun `a call that took longer than the call it runs inside is a warning`() {
        val lsd = LsdContext()
        val outer = lsd.call("web", "api", "POST /orders", timing = Timing.tookMs(100.0))
        lsd.call("api", "payments", "authorise", timing = Timing.tookMs(250.5)).reply("ok")
        lsd.call("api", "db", "insert", timing = Timing.tookMs(20.0)).reply("1 row")
        outer.reply("201")
        lsd.completeScenario("longer", status = Status.SUCCESS)
        val json = report(lsd, "Longer")
        assertTrue(
            json.contains("\"message\": \"'authorise' took 250.5 ms, more than 'POST /orders' (100 ms) that it runs inside\""),
            json,
        )
        assertFalse(json.contains("'insert' took"), "a shorter child is fine")
    }

    @Test
    fun `interaction headers become the payload's headers, beside the body, and are redacted`() {
        val lsd = LsdContext()
        val headers = mapOf("content-type" to "application/json", "Authorization" to "Bearer secret")
        lsd.accept(Interaction(InteractionKind.REQUEST, "web", "api", "POST /orders", data = mapOf("id" to 7), headers = headers))
        lsd.accept(Interaction(InteractionKind.PUBLISH, "api", "kafka", "order.placed", headers = mapOf("lsd-scenario" to "abc")))
        lsd.accept(Interaction(InteractionKind.MESSAGE, "api", "db", "plain", data = "body only"))
        lsd.completeScenario("headers", status = Status.SUCCESS)
        val json = report(lsd, "Headers")
        assertTrue(json.contains("\"content-type\": \"application/json\""), json)
        assertTrue(json.contains("\"body\": {"), json)
        assertFalse(json.contains("Bearer secret"), "authorization is redacted")
        assertTrue(json.contains("\"lsd-scenario\": \"abc\""), json)
        assertTrue(json.contains("\"data\": \"body only\""), "no headers: the body as before")
    }

    @Test
    fun `ingested lsd-distributed style data is guessed and tops out at MEASURED`() {
        val lsd = LsdContext()
        lsd.accept(Interaction(InteractionKind.REQUEST, "orders", "payments", "POST /pay", trace = Trace("tid"), source = "orders", startedAt = t(0)))
        lsd.accept(
            Interaction(InteractionKind.RESPONSE, "payments", "orders", "200", trace = Trace("tid"), source = "orders", startedAt = t(30), durationMs = 30.0),
        )
        lsd.accept(Interaction(InteractionKind.PUBLISH, "orders", "kafka", "paid", durationMs = 0.0))
        lsd.completeScenario("distributed", status = Status.SUCCESS)
        val json = report(lsd, "Distributed")
        assertTrue(json.contains("\"pairing\": \"GUESSED\""), json)
        assertTrue(json.contains("\"accuracy\": \"MEASURED\""), json)
        assertTrue(json.contains("\"pairingCoverage\": 0"), json)
    }

    @Test
    fun `configure sets the clock ordering, and null falls back to the config key`() {
        val lsd = LsdContext()
        assertEquals(ClockOrdering.SAME_SOURCE, lsd.timingConfig.effectiveOrderByStartedAt())
        System.setProperty(LsdProperties.TIMING_ORDER_BY_STARTED_AT, "all")
        assertEquals(ClockOrdering.ALL_SOURCES, lsd.timingConfig.effectiveOrderByStartedAt())
        lsd.configure { it.orderByStartedAt(ClockOrdering.OFF) }
        assertEquals(ClockOrdering.OFF, lsd.timingConfig.orderByStartedAt())
        lsd.message("A", "B", "late", timing = Timing.at(t(50)))
        lsd.message("A", "B", "early", timing = Timing.at(t(0)))
        lsd.completeScenario("off", status = Status.SUCCESS)
        val json = report(lsd, "Configured")
        assertTrue(json.contains("\"clockOrdering\": \"OFF\""), json)
        assertTrue(json.indexOf("\"late\"") < json.indexOf("\"early\""), "OFF keeps capture order")
        lsd.configure { it.orderByStartedAt(null) }
        assertNull(lsd.timingConfig.orderByStartedAt())
        assertEquals(ClockOrdering.ALL_SOURCES, lsd.timingConfig.effectiveOrderByStartedAt())
    }

    @Test
    fun `config key picks the clock ordering, default same source`() {
        assertEquals(ClockOrdering.SAME_SOURCE, LsdProperties.clockOrdering())
        mapOf(
            "false" to ClockOrdering.OFF,
            "source" to ClockOrdering.SAME_SOURCE,
            "true" to ClockOrdering.SAME_SOURCE,
            "all" to ClockOrdering.ALL_SOURCES,
            "junk" to ClockOrdering.SAME_SOURCE,
        ).forEach { (raw, mode) ->
            System.setProperty(LsdProperties.TIMING_ORDER_BY_STARTED_AT, raw)
            assertEquals(mode, LsdProperties.clockOrdering(), raw)
        }
    }

    @Test
    fun `timing factories keep fractional milliseconds and reject negatives`() {
        assertEquals(1.5, Timing.took(Duration.ofNanos(1_500_000)).durationMs)
        assertEquals(true, Timing.none().withOrderByStartedAt(true).orderByStartedAt)
        assertThrows<IllegalArgumentException> { Timing.tookMs(-1.0) }
    }

    private fun report(lsd: LsdContext, title: String): String {
        lsd.completeReport(title)
        return tempDir.resolve(ReportWriter.reportFileStem(title) + "-report.json").readText()
    }
}
