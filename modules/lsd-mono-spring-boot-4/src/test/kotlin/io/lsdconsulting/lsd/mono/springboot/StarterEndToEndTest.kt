package io.lsdconsulting.lsd.mono.springboot

import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.testing.LsdTestConfig
import io.lsdconsulting.lsd.mono.core.testing.ReportJson
import io.lsdconsulting.lsd.mono.core.testing.ScenarioJson
import io.lsdconsulting.lsd.mono.report.model.testing.ReportSchemas
import io.lsdconsulting.lsd.mono.springboot.fixture.ExtensionShopFixture
import io.lsdconsulting.lsd.mono.springboot.fixture.KafkaBatchListenerFixture
import io.lsdconsulting.lsd.mono.springboot.fixture.KafkaShopFixture
import io.lsdconsulting.lsd.mono.springboot.fixture.OwnKafkaBatchListenerFixture
import io.lsdconsulting.lsd.mono.springboot.fixture.OwnKafkaShopFixture
import io.lsdconsulting.lsd.mono.springboot.fixture.ShopFixture
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

    private val skusInBatch = listOf("lamp-01", "desk-02", "chair-03")

    @Test
    fun `each record a batch listener on Boot's factory takes is its own consume, paired with its publish`() {
        val summary = execute(KafkaBatchListenerFixture::class.java)

        assertEquals(1, summary.testsSucceededCount.toInt(), summary.failures.joinToString { it.exception.toString() })
        val batch =
            ReportJson
                .read(
                    tempDir.listDirectoryEntries("*-report.json").single(),
                ).scenario("kafka batch listener fixture: dispatches three orders in one batch")
        assertEquals("success", batch.status, batch.json)
        assertPairedConsumes(batch)
        // The listener's one call for the whole batch is the app's, after the batch's consumes.
        val save = batch.labels.single { it.startsWith("saveAll(") }
        assertEquals("shop", batch.message(save)["from"], batch.json)
        assertTrue(batch.labels.indexOf(save) > batch.labels.indexOf("consume \"chair-03\""), "${batch.labels}")
        // Its span's parent is the batch's last consume (chair-03), not the first or the middle one.
        val consumeSpans = skusInBatch.associateWith { batch.message("consume \"$it\"").obj("trace")?.get("spanId") }
        assertEquals(3, consumeSpans.values.toSet().size, "each consume has its own span: ${batch.json}")
        assertEquals(consumeSpans["chair-03"], batch.message(save).obj("trace")?.get("parentSpanId"), batch.json)
    }

    @Test
    fun `a batch listener on a factory the app builds itself takes payloads and is drawn the same way`() {
        val summary = execute(OwnKafkaBatchListenerFixture::class.java)

        assertEquals(1, summary.testsSucceededCount.toInt(), summary.failures.joinToString { it.exception.toString() })
        val batch =
            ReportJson
                .read(tempDir.listDirectoryEntries("*-report.json").single())
                .scenario("own kafka batch listener fixture: dispatches three orders in one batch")
        assertEquals("success", batch.status, batch.json)
        assertPairedConsumes(batch)
        assertEquals("shop", batch.message("count()")["from"], batch.json)
    }

    /** Three publishes from the test, then three consumes from the topic to the shop, each caused by its own publish (`lsd-publish-id`). */
    private fun assertPairedConsumes(batch: ScenarioJson) {
        val skus = listOf("lamp-01", "desk-02", "chair-03")
        assertEquals(
            skus.map { "publish \"$it\"" } + skus.map { "consume \"$it\"" },
            batch.labels.filter { it.startsWith("publish") || it.startsWith("consume") },
            batch.json,
        )
        for (sku in skus) {
            val publish = batch.message("publish \"$sku\"")
            val consume = batch.message("consume \"$sku\"")
            assertEquals("orders-placed", consume["from"], batch.json)
            assertEquals("shop", consume["to"], batch.json)
            assertEquals(publish["callId"], consume["causedBy"], batch.json)
            assertTrue(consume.source.contains(sku), "the payload is captured: ${consume.source}")
        }
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
