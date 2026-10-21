package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.domain.Status
import io.lsdconsulting.lsd.mono.core.report.ReportWriter
import io.lsdconsulting.lsd.mono.core.testing.LsdTestConfig
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.math.BigDecimal
import java.nio.file.Path
import kotlin.io.path.readText

/**
 * The `-payloads.js` the writer leaves next to a report, with payloads that are easy to get
 * wrong: markup characters, U+2028 and U+2029, emoji and other non-ASCII text, a lone surrogate
 * (written as U+FFFD), plain-string bodies, doubles and BigDecimals. The report UI's vitest
 * (`report/src/lib/payload-script-golden.test.ts`) runs this file in a fake window, reads each
 * payload through `lazyPayloads` and compares the values, so the browser is shown to read what
 * the core writes (#63).
 */
@LsdTestConfig(deterministicIds = true)
class PayloadScriptGoldenTest {
    @TempDir
    lateinit var tempDir: Path

    @Test
    fun `payload script with awkward payloads`() {
        val lsd = LsdContext()
        lsd.async(
            "web",
            "api",
            "markup",
            mapOf(
                "html" to "</script><!-- <b>a & b</b> -->",
                "separators" to "line\u2028para\u2029end",
                "quote" to "say \"hi\" \\ back\\slash\ttab\nnewline",
            ),
        )
        lsd.async(
            "web",
            "api",
            "text",
            mapOf(
                "emoji" to "socks \uD83E\uDDE6 and \uD83D\uDC4D\uD83C\uDFFD",
                "accents" to "Zoë, Ångström, naïve café",
                "scripts" to "東京 Москва القاهرة",
                "lone" to "before \uD800 after",
                "loneLow" to "x\uDC00y",
            ),
        )
        lsd.async("web", "api", "plain string", "just a body <with> & \u2028 in it")
        lsd.async("web", "api", "plain non-ASCII", "日本語 \uD83E\uDDE6")
        lsd.async(
            "web",
            "api",
            "numbers",
            mapOf(
                "double" to 0.1,
                "whole" to 2.0,
                "tiny" to 1.0E-7,
                "huge" to 1.5E300,
                "negative" to -42.25,
                "decimal" to BigDecimal("19.99"),
                "trailingZeros" to BigDecimal("1.10"),
                "wide" to BigDecimal("12345678901234567890.123456789"),
                "long" to 9007199254740993L,
                "nested" to listOf(1, 2.5, BigDecimal("3.000"), mapOf("deep" to listOf(true, null))),
            ),
        )
        lsd.completeScenario("awkward payloads", status = Status.SUCCESS)

        lsd.completeReport("Payload script")
        val script = tempDir.resolve(ReportWriter.reportFileStem("Payload script") + "-payloads.js").readText()
        Conformance.assertMatches("payloads/payload-script.js", script)
    }
}
