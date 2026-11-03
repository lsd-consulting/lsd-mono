package io.github.lsdconsulting.lsd.mono.jvm.live

import io.github.lsdconsulting.lsd.mono.jvm.domain.Scenario
import io.github.lsdconsulting.lsd.mono.jvm.report.ReportJsonMapper
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.net.ServerSocket
import java.time.Duration
import java.util.concurrent.atomic.AtomicInteger

/** A scenario sent as it runs is let go of on every way out, so nothing keeps its events alive. */
class LiveRunningTest {
    private val ids = AtomicInteger()

    private fun capture(url: String) =
        LiveCapture(
            LiveFrames(ReportJsonMapper { "id${ids.incrementAndGet()}" }),
            url = { url },
            connector = JdkLiveConnector(Duration.ofSeconds(30)),
            flushTimeout = Duration.ofSeconds(30),
            warn = {},
        )

    private val nothingYet: (String) -> Scenario? = { null }

    @Test
    fun `a discarded scenario is let go of`() {
        TestStudio().use { studio ->
            val live = capture(studio.url)
            val scenario = Any()
            live.started("a", scenario, "Discarded", nothingYet)
            assertEquals(1, live.runningCount)
            live.discarded(scenario)
            assertEquals(0, live.runningCount)
            live.written("a")
        }
    }

    @Test
    fun `a scenario that never completes is let go of when its report is written`() {
        TestStudio().use { studio ->
            val live = capture(studio.url)
            live.started("a", Any(), "Never completes", nothingYet)
            live.started("b", Any(), "Another report's", nothingYet)
            live.written("a")
            assertEquals(1, live.runningCount)
            live.written("b")
            assertEquals(0, live.runningCount)
        }
    }

    @Test
    fun `a scenario whose stream stops is let go of`() {
        val closedPort = ServerSocket(0).use { it.localPort }
        val live = capture("ws://127.0.0.1:$closedPort/ws/captures")
        live.started("a", Any(), "Unreachable", nothingYet)
        val deadline = System.nanoTime() + 30_000_000_000
        while (live.runningCount > 0 && System.nanoTime() < deadline) Thread.sleep(10)
        assertEquals(0, live.runningCount)
    }
}
