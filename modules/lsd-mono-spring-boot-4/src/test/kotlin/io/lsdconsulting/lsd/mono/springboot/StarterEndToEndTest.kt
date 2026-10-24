package io.lsdconsulting.lsd.mono.springboot

import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.testing.LsdTestConfig
import io.lsdconsulting.lsd.mono.core.testing.ReportJson
import io.lsdconsulting.lsd.mono.report.model.testing.ReportSchemas
import io.lsdconsulting.lsd.mono.springboot.fixture.ExtensionShopFixture
import io.lsdconsulting.lsd.mono.springboot.fixture.KafkaShopFixture
import io.lsdconsulting.lsd.mono.springboot.fixture.OwnKafkaShopFixture
import io.lsdconsulting.lsd.mono.springboot.fixture.ShopFixture
import io.lsdconsulting.lsd.mono.springboot.fixture.WebFluxConcurrentOrdersFixture
import io.lsdconsulting.lsd.mono.springboot.fixture.WebFluxShopFixture
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.junit.platform.engine.discovery.DiscoverySelectors.selectClass
import org.junit.platform.launcher.core.LauncherDiscoveryRequestBuilder
import org.junit.platform.launcher.core.LauncherFactory
import org.junit.platform.launcher.listeners.SummaryGeneratingListener
import java.nio.file.Path
import kotlin.io.path.exists
import kotlin.io.path.listDirectoryEntries

/**
 * Runs plain `@SpringBootTest` classes through the Jupiter engine, with the starter on the
 * classpath and nothing else, and reads the reports they leave behind.
 */
@LsdTestConfig(deterministicIds = true)
class StarterEndToEndTest {
    @TempDir
    lateinit var tempDir: Path

    @BeforeEach
    @AfterEach
    fun clear() {
        LsdContext.instance.clear()
    }

    @Test
    fun `a plain SpringBootTest writes one scenario per test method`() {
        val summary = execute(ShopFixture::class.java)

        assertEquals(1, summary.testsSucceededCount.toInt())
        assertEquals(1, summary.testsFailedCount.toInt())
        val report = ReportJson.read(tempDir.listDirectoryEntries("*-report.json").single())
        assertEquals("junit", report.options["source"])
        // Literal titles: the expected text must not come from the code that makes it (#75).
        assertEquals(listOf("shop fixture: fails after placing an order", "shop fixture: places an order").sorted(), report.titles.sorted())
        assertTrue(tempDir.resolve("index.html").exists())
    }

    @Test
    fun `inbound MVC and outbound RestClient and RestTemplate calls are drawn`() {
        execute(ShopFixture::class.java)

        val placed = ReportJson.read(tempDir.listDirectoryEntries("*-report.json").single()).scenario("shop fixture: places an order")
        assertEquals("success", placed.status, placed.json)
        val names = placed.participants.map { it["name"] }
        for (label in listOf("POST /orders/lamp-01", "GET /stock/lamp-01", "POST /quotes")) {
            assertTrue(label in placed.labels, "$label in ${placed.labels}")
        }
        for (name in listOf("Client", "Shop", "Pricing", "Inventory")) {
            assertTrue(name in names, "$name in $names")
        }
        // Request, then the stock and price calls, then the reply: order is the app's, not the stubs'.
        assertEquals("POST /orders/lamp-01", placed.labels.first(), placed.json)
    }

    @Test
    fun `Spring Data repository calls are drawn with what went in and came out`() {
        execute(ShopFixture::class.java)

        val placed = ReportJson.read(tempDir.listDirectoryEntries("*-report.json").single()).scenario("shop fixture: places an order")
        val save = "save(PlacedOrder(id=order-1, sku=lamp-01, quantity=2))"
        assertTrue(save in placed.labels, "$save in ${placed.labels}")
        val repository = placed.participants.single { it["name"] == "OrderRepository" }
        assertEquals("database", repository["type"].toString().lowercase(), placed.json)
        assertEquals("shop", placed.message(save)["from"], placed.json)
    }

    @Test
    fun `KafkaTemplate sends and KafkaListener consumes are drawn through the topic`() {
        val summary = execute(KafkaShopFixture::class.java)

        assertEquals(1, summary.testsSucceededCount.toInt(), summary.failures.joinToString { it.exception.toString() })
        val announced = ReportJson.read(tempDir.listDirectoryEntries("*-report.json").single()).scenario("kafka shop fixture: announces an order")
        assertEquals("success", announced.status, announced.json)
        val topic = announced.participants.single { it["name"] == "orders.placed" }
        assertEquals("queue", topic["type"].toString().lowercase(), announced.json)
        assertTrue("publish \"lamp-01\"" in announced.labels, "${announced.labels}")
        assertTrue("consume \"lamp-01\"" in announced.labels, "${announced.labels}")
        // The listener's own repository call is the app's, not the test's.
        assertEquals("shop", announced.message("findById(\"order-1\")")["from"], announced.json)
        assertTrue(announced.json.contains("lamp-01") && announced.json.contains("orderId"), "the payload is captured: ${announced.json}")
    }

    @Test
    fun `a KafkaTemplate and listener factory the app builds itself are drawn too`() {
        val summary = execute(OwnKafkaShopFixture::class.java)

        assertEquals(1, summary.testsSucceededCount.toInt(), summary.failures.joinToString { it.exception.toString() })
        val announced =
            ReportJson.read(tempDir.listDirectoryEntries("*-report.json").single()).scenario("own kafka shop fixture: announces an order")
        assertEquals("success", announced.status, announced.json)
        assertEquals("shop", announced.message("publish \"lamp-01\"")["from"], announced.json)
        assertEquals("orders-placed", announced.message("consume \"lamp-01\"")["from"], announced.json)
        // The listener's call is the app's: the consumer on its own factory still marks what it handles.
        assertEquals("shop", announced.message("findById(\"order-1\")")["from"], announced.json)
    }

    @Test
    fun `inbound WebFlux requests and outbound WebClient calls are drawn`() {
        val summary = execute(WebFluxShopFixture::class.java)

        assertEquals(2, summary.testsSucceededCount.toInt(), summary.failures.joinToString { it.exception.toString() })
        val report = ReportJson.read(tempDir.listDirectoryEntries("*-report.json").single())
        val placed = report.scenario("web flux shop fixture: places an order")
        assertEquals("success", placed.status, placed.json)
        // The request, the price (Boot's builder), the stock (a WebClient the app built) after the hops, the reply.
        assertEquals(
            listOf("POST /orders/lamp-01", "POST /quotes", "200 OK", "GET /stock/lamp-01", "200 OK", "201 Created"),
            placed.labels,
            placed.json,
        )
        val inbound = placed.message("POST /orders/lamp-01")
        assertEquals("client", inbound["from"], placed.json)
        assertEquals("shop", inbound["to"], placed.json)
        assertEquals(
            2,
            inbound
                .obj("data")
                ?.obj("body")
                ?.get("quantity")
                .toString()
                .toDouble()
                .toInt(),
            inbound.source,
        )
        for ((label, to) in listOf("POST /quotes" to "pricing", "GET /stock/lamp-01" to "inventory")) {
            val call = placed.message(label)
            assertEquals("shop", call["from"], placed.json)
            assertEquals(to, call["to"], placed.json)
            assertEquals(inbound["id"], call["parentId"], "$label nests under the request it serves: ${placed.json}")
            assertEquals(inbound["callId"], call.obj("trace")?.get("parentSpanId"), placed.json)
        }
        assertEquals(
            "lamp-01",
            placed
                .message("POST /quotes")
                .obj("data")
                ?.obj("body")
                ?.string("sku"),
            placed.json,
        )
        val quote = placed.messages.single { it["from"] == "pricing" }
        assertEquals(
            49.0,
            quote
                .obj("data")
                ?.obj("body")
                ?.get("total")
                .toString()
                .toDouble(),
            quote.source,
        )

        val tracked = report.scenario("web flux shop fixture: tracks an order nobody knows")
        assertEquals(listOf("GET /orders/order-404/tracking", "GET /parcels/order-404", "404 Not Found", "404 Not Found"), tracked.labels, tracked.json)
        val replies = tracked.messages.filter { it["label"] == "404 Not Found" }
        assertEquals(listOf("tracking", "shop"), replies.map { it["from"] }, tracked.json)
        assertEquals(listOf("404", "404"), replies.map { it["status"].toString() }, tracked.json)
        assertEquals(listOf("unknown parcel", "no such order"), replies.map { it.obj("data")?.obj("body")?.string("error") }, tracked.json)
    }

    @Test
    fun `a failing test is an error scenario with its reason`() {
        execute(ShopFixture::class.java)

        val failed = ReportJson.read(tempDir.listDirectoryEntries("*-report.json").single()).scenario("shop fixture: fails after placing an order")
        assertEquals("error", failed.status, failed.json)
        assertTrue(failed.error.toString().contains("expected to fail"), failed.json)
        assertTrue("POST /quotes" in failed.labels, "what ran before the failure is still drawn")
    }

    @Test
    fun `what the starter writes follows the report schema`() {
        execute(ShopFixture::class.java)

        assertTrue(ReportSchemas.assertOutputValid(tempDir) >= 3, "the report JSON, its page and its data script")
    }

    @Test
    fun `a class using LsdExtension is left to the extension on Boot's JUnit`() {
        val summary = execute(ExtensionShopFixture::class.java)

        assertEquals(1, summary.testsSucceededCount.toInt(), summary.failures.joinToString { it.exception.toString() })
        val reports = tempDir.listDirectoryEntries("*-report.json")
        assertEquals(1, reports.size, "the extension's report only, not a second one from the starter: $reports")
        val report = ReportJson.read(reports.single())
        assertEquals(1, report.scenarios.size, report.text)
        // The extension titles the report with the class's display name; the starter would humanise it.
        assertEquals("ExtensionShopFixture", report.root.string("title"), report.text)
    }

    @Test
    fun `two WebFlux requests served at once each keep their calls across scheduler hops`() {
        val summary = execute(WebFluxConcurrentOrdersFixture::class.java)

        assertEquals(1, summary.testsSucceededCount.toInt(), summary.failures.joinToString { it.exception.toString() })
        val both = ReportJson
            .read(
                tempDir.listDirectoryEntries("*-report.json").single(),
            ).scenario("web flux concurrent orders fixture: places two orders at once")
        assertEquals("success", both.status, both.json)
        // Slow pricing on one thread: the second order is in flight while the first hops schedulers,
        // so a call nests under its own request only if the request rides in the Reactor context.
        val quotes = both.messages.filter { it["label"] == "POST /quotes" }
        assertEquals(2, quotes.size, both.json)
        for (sku in listOf("lamp-01", "desk-02")) {
            val inbound = both.message("POST /orders/$sku")
            val price = quotes.single { it.obj("data")?.obj("body")?.string("sku") == sku }
            val stock = both.message("GET /stock/$sku")
            for ((label, call) in listOf("POST /quotes ($sku)" to price, "GET /stock/$sku" to stock)) {
                assertEquals("shop", call["from"], both.json)
                assertEquals(inbound["id"], call["parentId"], "$label nests under its own request: ${both.json}")
                assertEquals(inbound["callId"], call.obj("trace")?.get("parentSpanId"), both.json)
            }
        }
    }

    private fun execute(klass: Class<*>): org.junit.platform.launcher.listeners.TestExecutionSummary {
        val listener = SummaryGeneratingListener()
        val request =
            LauncherDiscoveryRequestBuilder
                .request()
                .selectors(selectClass(klass))
                .build()
        LauncherFactory.create().execute(request, listener)
        return listener.summary
    }
}
