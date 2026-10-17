package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.domain.MessageType
import io.lsdconsulting.lsd.mono.core.domain.Status
import io.lsdconsulting.lsd.mono.core.report.ReportWriter
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import java.time.Instant
import kotlin.io.path.Path
import kotlin.io.path.createDirectories
import kotlin.io.path.readText
import kotlin.io.path.writeText

/**
 * The call tree the library works out (`parentId`, `replyOf`, event order) for span nesting,
 * duplicate spans and the `ALL_SOURCES` fallback for a source pair that disagrees, locked as a golden. The report UI's
 * vitest (`report/src/lib/timing-tree.test.ts`) reads the same file, so the Timing view is shown
 * to follow the library's tree rather than work out its own.
 */
class TimingTreeGoldenTest {
    @TempDir
    lateinit var tempDir: Path

    @BeforeEach
    fun deterministicOutput() {
        System.setProperty("lsd.mono.report.outputDir", tempDir.toString())
        System.setProperty("lsd.mono.ids.deterministic", "true")
    }

    @AfterEach
    fun clear() {
        System.clearProperty("lsd.mono.report.outputDir")
        System.clearProperty("lsd.mono.ids.deterministic")
    }

    @Test
    fun `span nesting, duplicate spans and the ALL_SOURCES fallback`() {
        val lsd = LsdContext().configure { it.orderByStartedAt(ClockOrdering.ALL_SOURCES) }
        val sync = MessageType.SYNCHRONOUS

        // Concurrent calls captured interleaved: the child names A as its parent span.
        lsd.message("api", "orders", "A", type = sync, timing = Timing.tookMs(300.0), trace = Trace("t", "a"))
        lsd.message("api", "stock", "B", type = sync, timing = Timing.tookMs(50.0), trace = Trace("t", "b"))
        lsd.message("orders", "db", "child of A", type = sync, timing = Timing.tookMs(100.0), trace = Trace("t", "c", "a"))
        lsd.response("db", "orders", "rows", trace = Trace("t", "c"))
        lsd.response("orders", "api", "A ok", trace = Trace("t", "a"))
        lsd.response("stock", "api", "B ok", trace = Trace("t", "b"))
        lsd.completeScenario("span nesting", status = Status.SUCCESS)

        // Two calls share a span: each reply pairs with the latest open one.
        lsd.message("web", "api", "first", type = sync, timing = Timing.tookMs(40.0), trace = Trace("u", "s"))
        lsd.message("web", "api", "second", type = sync, timing = Timing.tookMs(10.0), trace = Trace("u", "s"))
        lsd.response("api", "web", "reply 2", trace = Trace("u", "s"))
        lsd.response("api", "web", "reply 1", trace = Trace("u", "s"))
        lsd.completeScenario("duplicate span", status = Status.SUCCESS)

        // Billing's clock is behind: clock order across sources would put the consume first.
        lsd.async("orders", "bus", "late", timing = Timing(startedAt = t(20), source = "orders"))
        val publish = lsd.async("orders", "bus", "publish", timing = Timing(startedAt = t(10), source = "orders"))
        lsd.async("bus", "billing", "other", timing = Timing(startedAt = t(8), source = "billing"))
        lsd.async("bus", "billing", "consume", timing = Timing(startedAt = t(5), source = "billing"), causedBy = publish)
        lsd.completeScenario("all sources fallback", status = Status.SUCCESS)

        lsd.completeReport("Timing tree")
        val json = tempDir.resolve(ReportWriter.reportFileStem("Timing tree") + "-report.json").readText()
        val scrubbed =
            json
                .replace(Regex(""""generatedAt": "[^"]*""""), """"generatedAt": "SCRUBBED"""")
                .replace(Regex(""""generator": "[^"]*""""), """"generator": "SCRUBBED"""")
        val golden = javaClass.getResource("/golden/timing-tree.json")?.readText()
        if (golden != scrubbed) {
            val actual = Path("build/golden-actual/timing-tree.json")
            actual.parent.createDirectories()
            actual.writeText(scrubbed)
        }
        assertEquals(golden, scrubbed, "copy build/golden-actual/timing-tree.json to src/test/resources/golden/ when the change is intended")
    }

    private fun t(ms: Long): Instant = Instant.parse("2026-01-01T00:00:00Z").plusMillis(ms)
}
