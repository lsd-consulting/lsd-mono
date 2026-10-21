package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.domain.MessageType
import io.lsdconsulting.lsd.mono.core.domain.NoteSide
import io.lsdconsulting.lsd.mono.core.domain.Participant
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType
import io.lsdconsulting.lsd.mono.core.domain.ScenarioError
import io.lsdconsulting.lsd.mono.core.domain.Status
import io.lsdconsulting.lsd.mono.core.testing.LsdTestConfig
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.io.path.extension
import kotlin.io.path.invariantSeparatorsPathString
import kotlin.io.path.isRegularFile
import kotlin.io.path.name
import kotlin.io.path.readText
import kotlin.io.path.relativeTo
import kotlin.io.path.walk

/**
 * The shared test reports (`modules/lsd-mono-report-schema/conformance`) from the producer's side:
 * lsd-mono-core writes each report the corpus says it writes, and the result follows the schema
 * and matches the corpus file. Every other corpus report is checked against the schema here too,
 * so the Kotlin validator and the report UI's agree on what is valid. The golden tests
 * (MultiScenarioStatusGoldenTest, TimingTreeGoldenTest, PayloadScriptGoldenTest) write the rest.
 */
@LsdTestConfig(deterministicIds = true)
class ConformanceTest {
    @TempDir
    lateinit var tempDir: Path

    @BeforeEach
    fun produce() = Conformance.produce()

    @Test
    fun `minimal - one empty scenario`() =
        produced("reports/minimal.json") {
            completeScenario("Minimal")
            completeReport("Minimal")
        }

    @Test
    fun `no timing - a structural sketch with every arrow and row`() =
        produced("reports/no-timing.json") {
            addParticipants(
                Participant("Customer", type = ParticipantType.ACTOR),
                Participant("Shop", type = ParticipantType.BOUNDARY),
                Participant("Orders DB", type = ParticipantType.DATABASE),
                Participant("Order events", type = ParticipantType.QUEUE),
            )
            section("Place the order")
            inbound("Shop", "webhook")
            message("Customer", "Shop", "POST /orders", mapOf("method" to "POST", "path" to "/orders", "body" to mapOf("sku" to "HAT-3")))
            activate("Shop")
            message("Shop", "Orders DB", "insert order")
            response("Orders DB", "Shop", "1 row")
            async("Shop", "Order events", "order.placed", mapOf("orderId" to "ord-1"))
            note("idempotent by orderId", on = "Shop")
            deactivate("Shop")
            response("Shop", "Customer", "201 Created", mapOf("status" to 201))
            divider("Later")
            delay("next day")
            message("Shop", "Customer", "never arrives", MessageType.LOST)
            outbound("Shop", "audit log")
            note("at the edge", on = null, side = NoteSide.RIGHT)
            completeScenario("Order placed, no timings", "<mark>Given</mark> a cart <mark>When</mark> the customer orders")
            completeReport("No timing")
        }

    @Test
    fun `no components - facts and structural rows but no participants`() =
        produced("reports/no-components.json") {
            addFact("ticket", "LSD-1")
            addFact("environment", "staging")
            section("Setup")
            divider("Nothing was called")
            delay("waited for a timeout")
            spacer(24)
            completeScenario("Nothing to draw", "A scenario that captured no messages", Status.WARN)
            completeReport("No components")
        }

    @Test
    fun `long names - names, labels, titles and values longer than the page`() =
        produced("reports/long-names.json") {
            val long = "VeryLongServiceNameThatKeepsGoingWithoutAnySpacesToBreakAt".repeat(2)
            addParticipants(
                Participant("Customer facing checkout experience orchestration service (EU West, blue deployment)", id = "checkout"),
                Participant(long, id = "long", displayName = "$long display"),
                Participant("Db", id = "db", type = ParticipantType.DATABASE, displayName = "The primary relational database cluster for orders and payments"),
            )
            addFact("A fact key that is far longer than any key column was designed for", "x".repeat(400))
            addFact("url", "https://example.com/" + "segment/".repeat(40) + "?query=" + "q".repeat(120))
            message("checkout", "long", "GET /v1/" + "very-long-path-segment/".repeat(12) + "items?expand=everything")
            response("long", "checkout", "200 " + "OK ".repeat(80).trim())
            message("long", "db", "SELECT " + (1..60).joinToString(", ") { "column_$it" } + " FROM orders")
            response("db", "long", "60 rows")
            note("A note with a very long text that goes on and on ".repeat(8).trim(), on = "long")
            completeScenario(
                "Given a scenario title that is much longer than the header has room for, " +
                    "When it is shown in the list and in the header, Then it wraps or is cut without hiding the rest of the page " +
                    "(" + "and then some ".repeat(10).trim() + ")",
                "A description that is long as well. ".repeat(20).trim(),
            )
            completeReport("Long names " + "and a long report title ".repeat(6).trim())
        }

    @Test
    fun `unicode and right to left - scripts, emoji, combining marks and mixed direction`() =
        produced("reports/unicode-rtl.json") {
            addParticipants(
                Participant("خدمة الطلبات", id = "orders"),
                Participant("שירות תשלומים", id = "payments"),
                Participant("注文サービス", id = "jp", type = ParticipantType.DATABASE),
                Participant("Café", id = "cafe", displayName = "Cafe\u0301 \uD83D\uDC69\u200D\uD83D\uDC69\u200D\uD83D\uDC67 \uD83C\uDDEC\uD83C\uDDE7"),
            )
            addFact("العميل", "أحمد ٤٢")
            addFact("mixed", "Order \u202B#42 مدفوع\u202C paid")
            message("cafe", "orders", "اطلب ٣ قطع", mapOf("المنتج" to "قبعة", "الكمية" to 3))
            message("orders", "payments", "חיוב ₪120.50")
            response("payments", "orders", "אושר \u2705")
            message("orders", "jp", "在庫を確認する")
            response("jp", "orders", "OK 在庫あり")
            note("ملاحظة: الدفع مؤكد", on = "orders")
            response("orders", "cafe", "تم ✓ — Zoë naïve Ångström हिन्दी ไทย")
            completeScenario("طلب ناجح — הזמנה הצליחה — 注文成功", "يتحقق من الاتجاه من اليمين إلى اليسار")
            completeReport("Unicode والعربية")
        }

    @Test
    fun `escaping - markup, script ends and line separators in every free text field`() =
        produced("reports/escaping.json") {
            addParticipants(
                Participant(h("participant a"), id = "a", type = ParticipantType.ACTOR),
                Participant(h("participant b"), id = "b", displayName = h("display b")),
            )
            addFact(h("fact key"), h("fact value"))
            section(h("section"))
            message(
                "a",
                "b",
                h("label"),
                mapOf("method" to h("method"), "path" to h("path"), "status" to h("status"), "body" to mapOf("html" to h("body"))),
            )
            note(h("note"), on = "a")
            divider(h("divider"))
            delay(h("delay"))
            response("b", "a", h("response"), "plain body </script><script>alert(3)</script>")
            completeScenario(
                h("scenario"),
                "<mark>Given</mark> ${h("description")} <p onclick=\"x\">p</p><img src=y onerror=alert(4)>",
                Status.ERROR,
                ScenarioError(h("headline"), h("message"), h("stack")),
            )
            completeReport(h("report"))
        }

    @Test
    fun `a large report follows the schema`() {
        val lsd = LsdContext()
        val names = (1..100).map { "service-$it" }
        repeat(400) { i ->
            val from = names[i % names.size]
            val to = names[(i * 7 + 1) % names.size]
            if (i % 4 == 3) lsd.response(to, from, "reply $i") else lsd.message(from, to, "call $i", mapOf("n" to i))
        }
        lsd.completeScenario("100 participants, 400 messages")
        val json = lsd.completeReport("Large").reportJson.readText()
        assertEquals(emptyList<String>(), Conformance.errors(Conformance.REPORT_SCHEMA, json))
    }

    @Test
    fun `every corpus report is valid or invalid as the manifest says`() {
        Conformance.fixtures.filter { it.schema != null && it.file.endsWith(".json") }.forEach { fixture ->
            val errors = Conformance.errors(fixture.schema!!, Conformance.read(fixture.file))
            if (fixture.valid) {
                assertEquals(emptyList<String>(), errors, fixture.file)
            } else {
                assertTrue(errors.isNotEmpty(), "${fixture.file} is meant to be rejected")
            }
        }
    }

    @Test
    fun `the manifest lists every corpus file, and lsd-mono-core writes the ones it says it does`() {
        val files =
            Conformance.DIR
                .walk()
                .filter { it.isRegularFile() && it.name != "README.md" && it.name != "manifest.json" && it.extension != "mts" }
                .map { it.relativeTo(Conformance.DIR).invariantSeparatorsPathString }
                .toSortedSet()
        assertEquals(files, Conformance.fixtures.map { it.file }.toSortedSet())
        assertEquals(
            PRODUCED.toSortedSet(),
            Conformance.fixtures
                .filter { it.source == "lsd-mono-core" }
                .map { it.file }
                .toSortedSet(),
        )
    }

    /** Runs [write] on a fresh context and checks the report it writes against the corpus file [file]. */
    private fun produced(
        file: String,
        write: LsdContext.() -> ReportFiles,
    ) = Conformance.assertProduced(file, LsdContext().write().reportJson.readText())

    private companion object {
        const val ATTACK = """"'><img src=x onerror=alert(1) data-pwned=1></script><!--<svg onload=alert(2)>"""

        /** [tag], to find the text by, then markup, a script end, a comment and the two JSON-legal line separators. */
        fun h(tag: String) = "$tag$ATTACK\u2028\u2029"

        /** The corpus files lsd-mono-core writes: this class's and the golden tests'. */
        val PRODUCED =
            listOf(
                "reports/minimal.json",
                "reports/no-timing.json",
                "reports/no-components.json",
                "reports/long-names.json",
                "reports/unicode-rtl.json",
                "reports/escaping.json",
                "reports/multi-scenario-status.json",
                "reports/timing-tree.json",
                "indexes/status-mix.json",
                "payloads/payload-script.js",
            )
    }
}
