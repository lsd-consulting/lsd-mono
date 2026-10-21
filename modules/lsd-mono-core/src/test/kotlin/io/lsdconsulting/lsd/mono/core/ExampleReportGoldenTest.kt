package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.readme.EXAMPLE_SCENARIOS
import io.lsdconsulting.lsd.mono.core.readme.exampleParticipants
import io.lsdconsulting.lsd.mono.core.testing.LsdTestConfig
import org.junit.jupiter.api.Test
import kotlin.io.path.readText

/**
 * The shared test report `reports/example-report.json` is the first four scenarios of the example
 * report (KitchenSinkSample), which the zoom, Metrics and help checks open. Written here from
 * those scenarios and compared byte for byte, so it follows the example report and the writer.
 */
@LsdTestConfig(deterministicIds = true)
class ExampleReportGoldenTest {
    @Test
    fun `the example report's first four scenarios are the shared example report`() {
        Conformance.produce()
        val lsd = LsdContext()
        exampleParticipants(lsd)
        EXAMPLE_SCENARIOS.take(4).forEach { it(lsd) }
        Conformance.assertProduced("reports/example-report.json", lsd.completeReport("Example report").reportJson.readText())
    }
}
