package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.domain.Message
import io.lsdconsulting.lsd.mono.core.domain.Participant
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.BOUNDARY
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.DATABASE
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.PARTICIPANT
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.QUEUE
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CyclicBarrier
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import kotlin.io.path.readText
import kotlin.random.Random

/**
 * A scenario's participants come from its own declarations and those made outside any
 * scenario, never from another scenario's (#61). Before, all scenarios shared one registry, so
 * with tests running in parallel a test could draw another test's participant (its name and
 * shape) depending on which declared first.
 */
class ScenarioParticipantsTest {
    @TempDir
    lateinit var tempDir: Path

    @BeforeEach
    fun pointReportsAtTempDir() {
        System.setProperty("lsd.mono.report.outputDir", tempDir.toString())
        System.setProperty("lsd.mono.ids.deterministic", "true")
    }

    @AfterEach
    fun restore() {
        System.setProperty("lsd.mono.report.outputDir", "build/reports/lsd-mono")
        System.clearProperty("lsd.mono.ids.deterministic")
    }

    /** Three tests: two declare the same id with different participants, one declares nothing. */
    private val tests: Map<String, (LsdContext, LsdScenario) -> Unit> =
        linkedMapOf(
            "orders-db" to { lsd, scenario ->
                lsd.addParticipants(Participant("Orders DB", id = "orders", type = DATABASE))
                scenario.message("Client", "orders", "save order")
            },
            "order-service" to { lsd, scenario ->
                lsd.addParticipants(Participant("Order Service", id = "orders", type = BOUNDARY))
                scenario.message("Client", "orders", "place order")
            },
            "undeclared" to { _, scenario -> scenario.message("Client", "Orders DB", "query") },
        )

    @Test
    fun `parallel scenarios draw the same participants as each does alone`() {
        val alone = tests.keys.associateWith { run(listOf(it)).getValue(it) }
        assertEquals("save order: client Client PARTICIPANT -> orders Orders DB DATABASE", alone["orders-db"])
        assertEquals("place order: client Client PARTICIPANT -> orders Order Service BOUNDARY", alone["order-service"])
        assertEquals("query: client Client PARTICIPANT -> orders-db Orders DB PARTICIPANT", alone["undeclared"])
        repeat(200) { iteration ->
            assertEquals(alone, run(tests.keys.toList(), parallel = true), "iteration $iteration")
        }
    }

    @Test
    fun `a scenario's declarations do not reach the next scenario`() {
        val lsd = LsdContext()
        val first = lsd.beginScenario(reportKey = "first")
        lsd.addParticipants(Participant("Orders", type = DATABASE))
        first.message("Client", "Orders", "insert")
        first.complete("first")
        val second = lsd.beginScenario(reportKey = "second")
        second.message("Client", "Orders", "lookup")
        second.complete("second")

        assertEquals("insert: client Client PARTICIPANT -> orders Orders DATABASE", diagram(lsd, "first"))
        assertEquals("lookup: client Client PARTICIPANT -> orders Orders PARTICIPANT", diagram(lsd, "second"))
    }

    @Test
    fun `declarations made outside any scenario reach every scenario, which can override them`() {
        val lsd = LsdContext()
        lsd.addParticipants(Participant("Orders", type = DATABASE), Participant("Events", type = QUEUE))
        val plain = lsd.beginScenario(reportKey = "plain")
        plain.message("Orders", "Events", "published")
        plain.complete("plain")
        val own = lsd.beginScenario(reportKey = "own")
        lsd.addParticipants(Participant("Order store", id = "orders", type = BOUNDARY))
        own.message("orders", "Events", "published")
        own.complete("own")

        assertEquals("published: orders Orders DATABASE -> events Events QUEUE", diagram(lsd, "plain"))
        assertEquals("published: orders Order store BOUNDARY -> events Events QUEUE", diagram(lsd, "own"))
    }

    @Test
    fun `participants from both registries keep the order they were registered in`() {
        val order = AtomicLong()
        val shared = ParticipantRegistry(order)
        val own = ParticipantRegistry(order)
        shared.declare(listOf(Participant("Gateway")))
        own.declare(listOf(Participant("Orders", type = DATABASE)))
        shared.declare(listOf(Participant("Events", type = QUEUE)))
        val created = own.resolve("Gateway Two", shared)
        val events =
            listOf("events", "orders", created.id, "gateway").map { Message(id = "", from = it, to = it, label = "") }

        assertEquals(listOf("Gateway", "Orders", "Events", "Gateway Two"), own.usedBy(events, shared).map { it.name })
        assertEquals(PARTICIPANT, own.resolve("Gateway", shared).type)
        assertEquals("gateway-two", created.id)
    }

    @Test
    fun `ids created in a scenario avoid shared ids, and its own declarations number as before`() {
        val order = AtomicLong()
        val shared = ParticipantRegistry(order)
        val own = ParticipantRegistry(order)
        shared.declare(listOf(Participant("Orders DB", id = "orders", type = DATABASE)))

        assertEquals("orders-2", own.resolve("orders!", shared).id)
        val other = ParticipantRegistry(order)
        other.declare(listOf(Participant("Orders", id = "orders"), Participant("Orders again", id = "orders")))
        assertEquals("orders", other.resolve("orders", shared).id)
        assertEquals("Orders", other.resolve("orders", shared).name)
        assertEquals("orders-2", other.resolve("Orders again", shared).id)
    }

    /** Each test of [names] in its own scenario and report; each report's messages, rendered. */
    private fun run(
        names: List<String>,
        parallel: Boolean = false,
    ): Map<String, String> {
        val lsd = LsdContext()
        val barrier = CyclicBarrier(names.size)
        val rendered = ConcurrentHashMap<String, String>()

        fun runTest(name: String) {
            val scenario = lsd.beginScenario(reportKey = name)
            if (parallel) {
                barrier.await(10, TimeUnit.SECONDS)
                Thread.sleep(Random.nextLong(0, 3))
            }
            tests.getValue(name)(lsd, scenario)
            scenario.complete(name)
            rendered[name] = diagram(lsd, name)
        }
        if (parallel) {
            names.map { Thread { runTest(it) }.apply { start() } }.forEach { it.join() }
        } else {
            names.forEach(::runTest)
        }
        assertEquals(names.toSet(), rendered.keys, "a test failed on its thread")
        return rendered
    }

    /** The report for [reportKey]'s messages as `label: from-id name TYPE -> to-id name TYPE`. */
    private fun diagram(
        lsd: LsdContext,
        reportKey: String,
    ): String {
        val json = lsd.completeReport("Participants $reportKey", reportKey).reportJson.readText()
        val participants =
            Regex(""""id": "([^"]+)",\s*"name": "([^"]+)",\s*"type": "([^"]+)"""")
                .findAll(json)
                .associate { it.groupValues[1] to "${it.groupValues[1]} ${it.groupValues[2]} ${it.groupValues[3]}" }
        return Regex(""""from": "([^"]*)",\s*"to": "([^"]*)",[\s\S]*?"label": "([^"]*)"""")
            .findAll(json)
            .joinToString("; ") { "${it.groupValues[3]}: ${participants[it.groupValues[1]]} -> ${participants[it.groupValues[2]]}" }
    }
}
