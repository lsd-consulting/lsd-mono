package io.lsdconsulting.lsd.mono.springboot

import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.testing.LsdTestConfig
import io.lsdconsulting.lsd.mono.core.testing.ReportJson
import io.lsdconsulting.lsd.mono.core.testing.ScenarioJson
import io.lsdconsulting.lsd.mono.report.model.testing.JsonObject
import io.lsdconsulting.lsd.mono.report.model.testing.ReportSchemas
import io.lsdconsulting.lsd.mono.springboot.fixture.AsyncShopFixture
import io.lsdconsulting.lsd.mono.springboot.fixture.ExtensionShopFixture
import io.lsdconsulting.lsd.mono.springboot.fixture.KafkaBatchListenerFixture
import io.lsdconsulting.lsd.mono.springboot.fixture.KafkaRecordListenerFixture
import io.lsdconsulting.lsd.mono.springboot.fixture.KafkaSendFailureFixture
import io.lsdconsulting.lsd.mono.springboot.fixture.KafkaShopFixture
import io.lsdconsulting.lsd.mono.springboot.fixture.MvcStreamsFixture
import io.lsdconsulting.lsd.mono.springboot.fixture.OwnClientsFixture
import io.lsdconsulting.lsd.mono.springboot.fixture.OwnKafkaBatchListenerFixture
import io.lsdconsulting.lsd.mono.springboot.fixture.OwnKafkaShopFixture
import io.lsdconsulting.lsd.mono.springboot.fixture.RestClientStreamsFixture
import io.lsdconsulting.lsd.mono.springboot.fixture.ShopFixture
import io.lsdconsulting.lsd.mono.springboot.fixture.WebFluxBookingsFixture
import io.lsdconsulting.lsd.mono.springboot.fixture.WebFluxConcurrentOrdersFixture
import io.lsdconsulting.lsd.mono.springboot.fixture.WebFluxShopFixture
import io.lsdconsulting.lsd.mono.springboot.fixture.WebFluxStreamsFixture
import io.lsdconsulting.lsd.mono.springboot.fixture.WebTestClientFixture
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
    fun `a send the producer rejects is drawn as an error reply to its publish`() {
        val summary = execute(KafkaSendFailureFixture::class.java)

        assertEquals(1, summary.testsSucceededCount.toInt(), summary.failures.joinToString { it.exception.toString() })
        val failed =
            ReportJson.read(tempDir.listDirectoryEntries("*-report.json").single()).scenario("kafka send failure fixture: cannot announce an order")
        val publish = failed.message("publish \"lamp-01\"")
        val failure = failed.message("RecordTooLargeException")
        assertEquals("error", failure["status"], failed.json)
        assertEquals(publish["to"], failure["from"], failed.json)
        assertEquals("shop", failure["to"], failed.json)
        assertTrue(failure.source.contains("max.request.size"), "the exception's message is kept: ${failure.source}")
        assertTrue("consume \"lamp-01\"" !in failed.labels, "nothing reached the topic: ${failed.labels}")
        // Counted as errors (the failed send and the 500 it caused), which the diagram also draws in red.
        assertEquals("2", failed.metric("Errors"), failed.json)
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

    @Test
    fun `work two requests hand to the app's own pool and to an Async method stays under each request`() {
        val summary = execute(AsyncShopFixture::class.java)

        assertEquals(1, summary.testsSucceededCount.toInt(), summary.failures.joinToString { it.exception.toString() })
        val both = ReportJson
            .read(
                tempDir.listDirectoryEntries("*-report.json").single(),
            ).scenario("async shop fixture: places two orders at once")
        assertEquals("success", both.status, both.json)
        // Both requests are being served when each hands its work over, so a pool thread finds the
        // right one only if the request travels with the task.
        val quotes = both.messages.filter { it["label"] == "POST /quotes" }
        assertEquals(2, quotes.size, both.json)
        for (sku in listOf("lamp-01", "desk-02")) {
            val inbound = both.message("POST /orders/$sku")
            val price = quotes.single { it.obj("data")?.obj("body")?.string("sku") == sku }
            val save = both.messages.single { it["label"].toString().startsWith("save(") && it.toString().contains("order-$sku") }
            for ((label, call) in listOf("POST /quotes ($sku)" to price, "save($sku)" to save)) {
                assertEquals("shop", call["from"], "$label is the app's: ${both.json}")
                assertEquals(inbound["callId"], call.obj("trace")?.get("parentSpanId"), "$label nests under its own request: ${both.json}")
            }
            assertTrue(price.toString().contains("acme"), "the app's own decorator still ran on its pool: $price")
        }
    }

    @Test
    fun `a repository call and a Kafka send two reactive requests make after a thread hop stay under each request`() {
        val summary = execute(WebFluxBookingsFixture::class.java)

        assertEquals(1, summary.testsSucceededCount.toInt(), summary.failures.joinToString { it.exception.toString() })
        val both = ReportJson
            .read(
                tempDir.listDirectoryEntries("*-report.json").single(),
            ).scenario("web flux bookings fixture: books two orders at once")
        assertEquals("success", both.status, both.json)
        for (sku in listOf("lamp-01", "desk-02")) {
            val inbound = both.message("POST /bookings/$sku")
            val save = both.messages.single { it["label"].toString().startsWith("save(") && it.toString().contains("order-$sku") }
            val publish = both.message("publish \"$sku\"")
            for ((label, call) in listOf("save($sku)" to save, "publish $sku" to publish)) {
                assertEquals("shop", call["from"], "$label is the app's: ${both.json}")
                assertEquals(inbound["callId"], call.obj("trace")?.get("parentSpanId"), "$label nests under its own request: ${both.json}")
            }
        }
    }

    @Test
    fun `each record a record listener takes in one poll parents its own calls, and the app's interceptor still runs`() {
        val summary = execute(KafkaRecordListenerFixture::class.java)

        assertEquals(1, summary.testsSucceededCount.toInt(), summary.failures.joinToString { it.exception.toString() })
        val poll =
            ReportJson
                .read(tempDir.listDirectoryEntries("*-report.json").single())
                .scenario("kafka record listener fixture: dispatches three orders each on its own")
        assertEquals("success", poll.status, poll.json)
        assertPairedConsumes(poll)
        skusInBatch.forEachIndexed { i, sku ->
            val consume = poll.message("consume \"$sku\"")
            assertEquals("${i + 1} of 3", consume.obj("data")?.obj("headers")?.string("kafka.poll"), consume.source)
            val save = poll.message(poll.labels.single { it.startsWith("save(PlacedOrder(id=order-$sku") })
            assertEquals("shop", save["from"], poll.json)
            assertEquals(consume.obj("trace")?.get("spanId"), save.obj("trace")?.get("parentSpanId"), poll.json)
        }
    }

    @Test
    fun `clients the app builds itself as beans, not from Boot's builders, are drawn`() {
        val summary = execute(OwnClientsFixture::class.java)

        assertEquals(1, summary.testsSucceededCount.toInt(), summary.failures.joinToString { it.exception.toString() })
        val placed =
            ReportJson
                .read(tempDir.listDirectoryEntries("*-report.json").single())
                .scenario("own clients fixture: places an order through clients it built itself")
        assertEquals(
            listOf(
                "POST /orders/lamp-01",
                "GET /stock/lamp-01",
                "200 OK",
                "POST /quotes",
                "200 OK",
                "GET /parcels/lamp-01",
                "404 Not Found",
                "201 Created",
            ),
            placed.labels,
            placed.json,
        )
        assertEquals("inventory", placed.message("GET /stock/lamp-01")["to"], placed.json)
        assertEquals("pricing", placed.message("POST /quotes")["to"], placed.json)
        assertEquals("tracking", placed.message("GET /parcels/lamp-01")["to"], placed.json)
    }

    @Test
    fun `MVC streams, uploads and error pages are drawn as what was sent`() {
        val summary = execute(MvcStreamsFixture::class.java)

        assertEquals(5, summary.testsSucceededCount.toInt(), summary.failures.joinToString { it.exception.toString() })
        val report = ReportJson.read(tempDir.listDirectoryEntries("*-report.json").single())
        assertStreamsAndErrors(report, "mvc streams fixture", upload = "uploads an orders documents")
        val upload = report.scenario("mvc streams fixture: uploads an orders documents")
        val received = upload.message("POST /orders/order-7/documents")
        val parts = received.body().objects("parts")
        assertEquals(listOf("invoice", "note"), parts.map { it["name"] }, received.source)
        assertEquals("invoice-7.pdf", parts.first()["filename"], received.source)
        val problem = report.scenario("mvc streams fixture: asks for an invoice not ready yet").message("409 Conflict")
        assertEquals("the invoice is not ready yet", problem.body()["detail"], problem.source)
        assertEquals(409.0, problem.body()["status"], problem.source)
    }

    @Test
    fun `WebFlux streams, uploads and error replies are drawn as what was sent`() {
        val summary = execute(WebFluxStreamsFixture::class.java)

        assertEquals(5, summary.testsSucceededCount.toInt(), summary.failures.joinToString { it.exception.toString() })
        val report = ReportJson.read(tempDir.listDirectoryEntries("*-report.json").single())
        assertStreamsAndErrors(report, "web flux streams fixture", upload = "files an invoice")
        val scans = report.scenario("web flux streams fixture: follows the couriers scans")
        val stream = scans.messages.single { it["from"] == "courier" }
        assertEquals("200 OK", stream["label"], scans.json)
        val scanned = stream.body()
        assertEquals(7.0, scanned["events"], stream.source)
        assertEquals(
            "depot-1",
            scanned
                .objects("first")
                .first()
                .obj("data")
                ?.get("depot"),
            stream.source,
        )
    }

    @Test
    fun `WebTestClient calls bound to the context are drawn in the test's scenario, with parts and Boot's error body`() {
        val summary = execute(WebTestClientFixture::class.java)

        assertEquals(4, summary.testsSucceededCount.toInt(), summary.failures.joinToString { it.exception.toString() })
        val report = ReportJson.read(tempDir.listDirectoryEntries("*-report.json").single())
        val placed = report.scenario("web test client fixture: places an order")
        assertEquals(listOf("POST /orders/lamp-01", "POST /quotes", "200 OK", "201 Created"), placed.labels, placed.json)
        assertEquals("client", placed.message("POST /orders/lamp-01")["from"], placed.json)
        assertEquals("pricing", placed.message("POST /quotes")["to"], placed.json)

        val documents = report.scenario("web test client fixture: takes an orders documents")
        val received = documents.message("POST /orders/order-7/documents")
        val parts = received.body().objects("parts")
        assertEquals(listOf("invoice", "note"), parts.map { it["name"] }, received.source)
        assertEquals("invoice-7.pdf", parts.first()["filename"], received.source)
        assertEquals(31.0, parts.first()["size"], received.source)
        assertTrue(!received.source.contains("%PDF"), "never the contents: ${received.source}")

        val label = report.scenario("web test client fixture: takes the returns label")
        val part = label
            .message("POST /returns/return-7/label")
            .body()
            .objects("parts")
            .single()
        assertEquals("return-7.png", part["filename"], label.json)
        assertEquals("image/png", part["contentType"], label.json)

        val missing = report.scenario("web test client fixture: looks up an order nobody knows")
        assertEquals(listOf("GET /orders/order-404", "404 Not Found"), missing.labels, missing.json)
        val body = missing.message("404 Not Found").body()
        assertEquals(404.0, body["status"], "Boot's error body, not the exception: ${missing.json}")
        assertTrue(body["path"] is String, "Boot's error body: ${missing.json}")
    }

    @Test
    fun `an event stream read through RestClient or RestTemplate is drawn as its events, and still streams`() {
        val summary = execute(RestClientStreamsFixture::class.java)

        assertEquals(2, summary.testsSucceededCount.toInt(), summary.failures.joinToString { it.exception.toString() })
        val report = ReportJson.read(tempDir.listDirectoryEntries("*-report.json").single())
        for (name in listOf("follows the couriers scans through the rest client", "reads the depots line by line through the rest template")) {
            val scenario = report.scenario("rest client streams fixture: $name")
            val stream = scenario.messages.single { it["from"] == "courier" }
            assertEquals("200 OK", stream["label"], scenario.json)
            val events = stream.body()
            assertEquals(7.0, events["events"], stream.source)
            assertEquals(true, events["truncated"], "seven events, five shown: ${stream.source}")
            val depots = events.objects("first").map { it.obj("data")?.get("depot") }
            assertEquals((1..5).map { "depot-$it" }, depots, stream.source)
            assertEquals("200 OK", scenario.labels.last(), "the app answers after the stream is drawn: ${scenario.json}")
        }
    }

    /** The body a message drew, as parsed JSON (empty when it drew none). */
    private fun JsonObject.body(): JsonObject = obj("data")?.obj("body") ?: JsonObject(emptyMap(), "{}")

    /** The progress stream as a count and its first events; the archive upload as its parts; error replies as the body sent. */
    private fun assertStreamsAndErrors(
        report: ReportJson,
        fixture: String,
        upload: String,
    ) {
        val progress = report.scenario("$fixture: streams an orders progress")
        val sent = progress.message("200 OK")
        val streamed = sent.body()
        assertEquals(7.0, streamed["events"], sent.source)
        assertEquals(true, streamed["truncated"], sent.source)
        val steps = streamed.objects("first").map { it.obj("data")?.get("step") }
        assertEquals(listOf(1.0, 2.0, 3.0, 4.0, 5.0), steps, "the first five events: ${sent.source}")

        val filed = report.scenario("$fixture: $upload")
        val archived = filed.message("POST /files")
        assertEquals("archive", archived["to"], filed.json)
        val invoice = archived.body().objects("parts").single { it["name"] == "invoice" }
        assertEquals("invoice-7.pdf", invoice["filename"], archived.source)
        assertEquals(31.0, invoice["size"], archived.source)
        assertTrue(!archived.source.contains("%PDF"), "never the contents: ${archived.source}")

        for ((scenario, status) in listOf(
            "looks up an order nobody knows" to "404 Not Found",
            "cancels an order that has shipped" to "500 Internal Server Error",
        )) {
            val failed = report.scenario("$fixture: $scenario")
            assertEquals(2, failed.labels.size, failed.json)
            val body = failed.message(status).body()
            assertEquals(status.take(3).toDouble(), body["status"], "Boot's error body: ${failed.json}")
            assertTrue(body["path"] is String, "Boot's error body: ${failed.json}")
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
