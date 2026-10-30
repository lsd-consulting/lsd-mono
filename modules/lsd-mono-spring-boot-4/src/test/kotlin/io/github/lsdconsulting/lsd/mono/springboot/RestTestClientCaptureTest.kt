package io.github.lsdconsulting.lsd.mono.springboot

import io.github.lsdconsulting.lsd.mono.jvm.LsdContext
import io.github.lsdconsulting.lsd.mono.jvm.LsdScenario
import io.github.lsdconsulting.lsd.mono.jvm.testing.LsdTestConfig
import io.github.lsdconsulting.lsd.mono.jvm.testing.ReportJson
import io.github.lsdconsulting.lsd.mono.springboot.fixture.RestTestClientMockMvcFixture
import io.github.lsdconsulting.lsd.mono.springboot.fixture.RestTestClientNoFiltersFixture
import io.github.lsdconsulting.lsd.mono.springboot.fixture.RestTestClientNoMockMvcFixture
import io.github.lsdconsulting.lsd.mono.springboot.fixture.RestTestClientServerFixture
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.io.TempDir
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.Arguments
import org.junit.jupiter.params.provider.MethodSource
import org.junit.platform.engine.discovery.DiscoverySelectors.selectClass
import org.junit.platform.launcher.core.LauncherDiscoveryRequestBuilder
import org.junit.platform.launcher.core.LauncherFactory
import org.junit.platform.launcher.listeners.SummaryGeneratingListener
import java.nio.file.Path
import kotlin.io.path.listDirectoryEntries

/**
 * Every way a test reaches the app through `RestTestClient` or `TestRestTemplate` is drawn once,
 * `Client → Shop` and the reply, in the test's own scenario: alone, and with another test's
 * scenario running alongside (as with parallel tests), where the server can no longer fall back
 * to the only scenario running.
 */
@LsdTestConfig(deterministicIds = true)
class RestTestClientCaptureTest {
    @TempDir
    lateinit var tempDir: Path

    @BeforeEach
    @AfterEach
    fun clear() = LsdContext.instance.clear()

    @ParameterizedTest(name = "{0}, another scenario running: {1}")
    @MethodSource("fixtures")
    fun `each request is drawn once in its own test's scenario`(
        fixture: Class<*>,
        parallel: Boolean,
    ) {
        val other = if (parallel) otherTest() else null
        val listener = SummaryGeneratingListener()
        try {
            LauncherFactory.create().execute(LauncherDiscoveryRequestBuilder.request().selectors(selectClass(fixture)).build(), listener)
        } finally {
            other?.let(SpringScenarios::finished)
        }
        val summary = listener.summary
        assertEquals(0L, summary.testsFailedCount, summary.failures.joinToString { it.exception.toString() })

        val report = ReportJson.read(tempDir.listDirectoryEntries("*-report.json").single())
        assertEquals(summary.testsSucceededCount.toInt(), report.scenarios.size)
        for (scenario in report.scenarios) {
            val drawn = scenario.messages.map { "${it["from"]}->${it["to"]}: ${it["label"]}" }
            val path = scenario.messages.firstOrNull()?.get("label")
            assertEquals(listOf("client->shop: $path", "shop->client: 200 OK"), drawn, "${scenario.title}: ${scenario.json}")
        }
    }

    /** Another test's scenario, running on no thread of this one's. */
    private fun otherTest(): LsdScenario =
        LsdContext.instance.beginScenario(reportKey = "other", key = "other", bindCurrentThread = false).also {
            SpringScenarios.started(it, null)
        }

    companion object {
        @JvmStatic
        fun fixtures(): List<Arguments> =
            listOf(
                RestTestClientServerFixture::class.java,
                RestTestClientMockMvcFixture::class.java,
                RestTestClientNoFiltersFixture::class.java,
                RestTestClientNoMockMvcFixture::class.java,
            ).flatMap { fixture -> listOf(false, true).map { Arguments.of(fixture, it) } }
    }
}
