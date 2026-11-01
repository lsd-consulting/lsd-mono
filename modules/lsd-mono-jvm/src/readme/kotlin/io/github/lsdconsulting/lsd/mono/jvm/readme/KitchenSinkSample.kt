package io.github.lsdconsulting.lsd.mono.jvm.readme

import io.github.lsdconsulting.lsd.mono.jvm.CaptureBlock
import io.github.lsdconsulting.lsd.mono.jvm.Interaction
import io.github.lsdconsulting.lsd.mono.jvm.InteractionKind
import io.github.lsdconsulting.lsd.mono.jvm.LsdContext
import io.github.lsdconsulting.lsd.mono.jvm.Timing
import io.github.lsdconsulting.lsd.mono.jvm.Trace
import io.github.lsdconsulting.lsd.mono.jvm.domain.MessageType.BI_DIRECTIONAL
import io.github.lsdconsulting.lsd.mono.jvm.domain.MessageType.LOST
import io.github.lsdconsulting.lsd.mono.jvm.domain.NoteSide
import io.github.lsdconsulting.lsd.mono.jvm.domain.ParticipantType.ACTOR
import io.github.lsdconsulting.lsd.mono.jvm.domain.ParticipantType.BOUNDARY
import io.github.lsdconsulting.lsd.mono.jvm.domain.ParticipantType.DATABASE
import io.github.lsdconsulting.lsd.mono.jvm.domain.ParticipantType.ENTITY
import io.github.lsdconsulting.lsd.mono.jvm.domain.ParticipantType.PARTICIPANT
import io.github.lsdconsulting.lsd.mono.jvm.domain.ParticipantType.QUEUE
import io.github.lsdconsulting.lsd.mono.jvm.domain.ScenarioError
import io.github.lsdconsulting.lsd.mono.jvm.domain.Status
import java.time.Instant

/**
 * The example report (a kitchen sink, hence the name): an online shop order flow that uses every
 * diagram feature, so layout problems are easy to eyeball. Regenerate with
 * `./gradlew :modules:lsd-mono-jvm:kitchenSinkSample`, which builds the Pages site
 * (`build/pages/example-report.html` and its payload script). The Pages workflow publishes it.
 *
 * Four scenarios (happy path, payment declined, out of stock, async
 * fulfilment) across 14 lifelines cover: all six participant shapes, the
 * participant filter, sync, async, bi-directional, lost and
 * response arrows, short arrows to and from the diagram edge, self-calls,
 * nested and overlapping activations on late lifelines, a lifeline that first
 * appears mid-scenario, an activation left open, short and wrapping notes
 * (over, left, right, diagram edge), sections, a logical divider, delays,
 * spacers, facts, Given/When/Then descriptions, payloads, message, participant
 * and activation colours, durations, out-of-order capture sorted by
 * timestamp, and success, failure and error statuses with structured errors.
 *
 * The first scenario shows the timing API: fractional measured durations, trace and span ids,
 * start times with the default same-source clock ordering (two events captured out of order
 * come back in time order, marked clock-ordered), a publish linked to its consume from another
 * service's clock, and an interaction ingested from another library.
 *
 * Some display names are deliberately long, one per shape, so the
 * header shows names that widen their shape, wrap onto two lines, or are cut
 * with an ellipsis (full name on hover).
 */
fun main() {
    val lsd = LsdContext.instance
    exampleParticipants(lsd)
    EXAMPLE_SCENARIOS.forEach { it(lsd) }

    val files = lsd.completeReport("Example report")
    lsd.createIndex()
    println(files.diagramHtml)
}

/**
 * The example report's scenarios, in order. The first four are also the shared test report
 * `reports/example-report.json`, which lsd-mono-jvm's ExampleReportGoldenTest writes and compares.
 */
val EXAMPLE_SCENARIOS: List<(LsdContext) -> Unit> =
    listOf(::timedCheckout, ::happyPath, ::paymentDeclined, ::outOfStock, ::asyncFulfilment)

/** The example report's 14 lifelines. */
fun exampleParticipants(lsd: LsdContext) {
    lsd.addParticipants(
        ACTOR.called("Customer", displayName = "Signed-in Customer (mobile app)"),
        BOUNDARY.called("Web UI"),
        BOUNDARY.called("API Gateway", displayName = "Public API Gateway (rate limited)"),
        PARTICIPANT.called("Order Service", colour = "#2563eb"),
        ENTITY.called("Basket", displayName = "Shopping Basket Aggregate"),
        PARTICIPANT.called("Inventory Service"),
        DATABASE.called("Orders DB", displayName = "Orders DB (PostgreSQL primary)"),
        PARTICIPANT.called("Payment Service", colour = "#16a34a"),
        PARTICIPANT.called("Fraud Check"),
        PARTICIPANT.called("Payment Provider", displayName = "Payment Provider (ext)"),
        QUEUE.called("Kafka order-events", id = "kafka", displayName = "Kafka topic order-events.v2"),
        PARTICIPANT.called(
            "Notification Service",
            displayName = "Customer Notification Preferences and Delivery Orchestration Service",
        ),
        ENTITY.called("Email"),
        PARTICIPANT.called("Warehouse", colour = "#ea580c"),
    )
}

private fun CaptureBlock.placeOrderRequest(orderId: String) {
    "Customer" calls "Web UI" label "click Place order" data uiEvent("click", "#place-order", "basketId" to "bsk-9")
    activate("Web UI")
    "Web UI" calls "API Gateway" label "POST /orders" took 412 data mapOf(
        "method" to "POST",
        "path" to "/orders",
        "headers" to mapOf("x-request-id" to "req-$orderId", "content-type" to "application/json"),
        "body" to mapOf("basketId" to "bsk-9", "currency" to "GBP"),
    )
    activate("API Gateway")
    "API Gateway" calls "API Gateway" label "check JWT" data
        mapOf("alg" to "RS256", "sub" to "cust-42", "scope" to "orders:write", "exp" to "2026-10-08T09:15:00Z")
    "API Gateway" calls "Order Service" label "createOrder" data
        req("POST", "/internal/orders", mapOf("orderId" to orderId, "basketId" to "bsk-9", "customerId" to "cust-42"))
    activate("Order Service", colour = "#c026d3")
}

private fun happyPath(lsd: LsdContext) {
    lsd.addFact("orderId", "ord-2001")
    lsd.addFact("customer", "cust-42")
    lsd.addFact("region", "eu-west-2")
    lsd.addFact("3-D Secure")

    lsd.capture {
        section("Given a basket with two items")
        inbound("API Gateway", "health probe")
        placeOrderRequest("ord-2001")

        "Order Service" calls "Basket" label "load basket" took 18 data req("GET", "/baskets/bsk-9")
        activate("Basket")
        "Basket" calls "Basket" label "merge duplicate lines" data mapOf("before" to 3, "after" to 2, "merged" to listOf("SOCK-1"))
        "Basket" repliesTo "Order Service" label "2 items" data mapOf("lines" to listOf("SOCK-1", "HAT-3"))
        deactivate("Basket")

        // Nested activation opened by a self-call, spanning a wrapping note.
        "Order Service" calls "Order Service" label "apply promo SOCKS10" data
            mapOf("code" to "SOCKS10", "discountPence" to 450, "appliesTo" to listOf("SOCK-1"))
        activate("Order Service", colour = "#f59e0b")
        note(
            "Promotions stack in priority order. A long note like this one wraps onto several lines inside the card.",
            on = "Order Service",
            side = NoteSide.RIGHT,
        )
        "Order Service" calls "Order Service" label "round to pence" data mapOf("subtotal" to 4650, "discount" to 450, "total" to 4200, "currency" to "GBP")
        deactivate("Order Service")

        "Order Service" calls "Inventory Service" label "reserve stock" took 95 data
            req(
                "POST",
                "/reservations",
                mapOf(
                    "orderId" to "ord-2001",
                    "lines" to listOf(mapOf("sku" to "SOCK-1", "qty" to 2), mapOf("sku" to "HAT-3", "qty" to 1)),
                ),
            )
        activate("Inventory Service")
        "Inventory Service" calls "Orders DB" label "upsert reservation" took 33 data
            sql(
                "INSERT INTO reservation (order_id, sku, qty) VALUES (?, ?, ?) ON CONFLICT (order_id, sku) DO UPDATE SET qty = EXCLUDED.qty",
                "ord-2001",
                "SOCK-1",
                2,
            )
        "Orders DB" repliesTo "Inventory Service" label "1 row" data mapOf("rowsAffected" to 1, "elapsedMs" to 4)
        note("short note", on = "Orders DB")
        "Inventory Service" repliesTo "Order Service" label "reserved" data res(201, mapOf("reservationId" to "rsv-77", "expiresAt" to "2026-10-08T09:20:00Z"))
        deactivate("Inventory Service")

        section("When the customer pays by card")
        "Order Service" calls "Payment Service" label "authorise £42.00" took 640 data mapOf(
            "method" to "POST",
            "path" to "/payments/authorise",
            "status" to 200,
            "body" to mapOf("amount" to 4200, "card" to "**** 4242"),
        )
        activate("Payment Service")
        "Payment Service" calls "Fraud Check" label "score transaction" data
            req("POST", "/score", mapOf("amount" to 4200, "currency" to "GBP", "ip" to "203.0.113.24", "deviceId" to "ios-5F2A"))
        activate("Fraud Check")
        delay("fraud model warm-up")
        "Fraud Check" repliesTo "Payment Service" label "score 0.02" data res(200, mapOf("score" to 0.02, "decision" to "ALLOW", "model" to "fraud-v7"))
        deactivate("Fraud Check")
        // Nested bars on the 10th lifeline.
        message(
            "Payment Service",
            "Payment Provider",
            "3-D Secure challenge",
            data = mapOf(
                "acsUrl" to "https://acs.example-bank.com/3ds2",
                "threeDSServerTransID" to "8a880dc0-d2d2-4067-bcb1-b08d1690b26e",
                "messageVersion" to "2.2.0",
            ),
            type = BI_DIRECTIONAL,
        )
        activate("Payment Provider")
        "Payment Provider" calls "Payment Provider" label "issuer approves"
        activate("Payment Provider")
        "Payment Provider" calls "Payment Provider" label "capture funds" colour "#dc2626"
        deactivate("Payment Provider")
        "Payment Provider" repliesTo "Payment Service" label "auth code A1B2" data
            res(200, mapOf("authCode" to "A1B2", "status" to "AUTHORISED", "pspReference" to "psp-883145"))
        deactivate("Payment Provider")
        "Payment Service" repliesTo "Order Service" label "authorised" took 12 data res(200, mapOf("paymentId" to "pay-501", "status" to "AUTHORISED"))
        deactivate("Payment Service")

        // Overlapping (not nested) bars opened by async messages.
        "Order Service" sends "Kafka order-events" label "order.placed" data mapOf(
            "orderId" to "ord-2001",
            "items" to 2,
        )
        activate("Kafka order-events")
        "Kafka order-events" sends "Notification Service" label "consume order.placed" data consumed("order.placed", "ord-2001", "notification-service", 1842)
        activate("Notification Service", colour = "#0891b2")
        deactivate("Kafka order-events")
        "Notification Service" calls "Email" label "render confirmation" data
            mapOf("template" to "order-confirmation", "locale" to "en-GB", "to" to "c***@example.com")
        spacer(60)
        outbound("Notification Service", "SMTP relay")
        deactivate("Notification Service")
        message("Order Service", "Kafka order-events", "audit.ping", LOST)
        divider("checkout complete")

        section("Then the order is confirmed")
        // Warehouse is first referenced here, halfway down the scenario.
        "Order Service" calls "Warehouse" label "book pick slot" colour "#ea580c" data
            req("POST", "/slots", mapOf("orderId" to "ord-2001", "date" to "2026-10-09"))
        activate("Warehouse")
        "Warehouse" repliesTo "Order Service" label "slot 14:00" data res(201, mapOf("slotId" to "slot-14", "start" to "14:00", "dock" to 3))
        deactivate("Warehouse")
        "Order Service" repliesTo "API Gateway" label "order confirmed" data res(201, mapOf("orderId" to "ord-2001", "status" to "CONFIRMED", "total" to 4200))
        deactivate("Order Service")
        "API Gateway" repliesTo "Web UI" label "201 Created" data mapOf(
            "status" to 201,
            "body" to mapOf("orderId" to "ord-2001", "eta" to "2026-10-10"),
        )
        deactivate("API Gateway")
        "Web UI" repliesTo "Customer" label "show confirmation" data mapOf("screen" to "OrderConfirmed", "orderId" to "ord-2001")
        deactivate("Web UI")
        note("Edge note on the left of the diagram.", on = null, side = NoteSide.LEFT)
        note("Left of Customer", on = "Customer", side = NoteSide.LEFT)
        note("Edge note on the right that is long enough to wrap onto a second and third line.", on = null, side = NoteSide.RIGHT)
    }

    lsd.completeScenario(
        "Happy path: card payment",
        """
        Given a basket with two items
        And the SOCKS10 promotion is live
        When the customer pays by card
        Then the order is confirmed
        And a confirmation email is sent
        """.trimIndent(),
    )
}

/** Captured out of order (as interceptors on different threads would); startedAt restores the sequence. */
private fun paymentDeclined(lsd: LsdContext) {
    val t0 = Instant.parse("2026-10-08T09:00:00Z")

    fun at(seconds: Long) = t0.plusSeconds(seconds)
    lsd.addFact("orderId", "ord-2002")
    lsd.addFact("card", "**** 0002")
    lsd.response(
        "Payment Service",
        "Order Service",
        "402 declined",
        problem(402, "Payment declined", "Issuer declined: do_not_honour"),
        timing = Timing.at(at(7)),
    )
    lsd.message(
        "Order Service",
        "Payment Service",
        "authorise £42.00",
        data = req("POST", "/payments/authorise", mapOf("amount" to 4200, "card" to "**** 0002")),
        timing = Timing.at(at(1)),
    )
    lsd.message("Payment Service", "Payment Provider", "authorise", data = mapOf("amount" to 4200, "card" to "**** 0002"), timing = Timing.at(at(4)))
    lsd.message("Payment Service", "Fraud Check", "score transaction", data = req("POST", "/score", mapOf("amount" to 4200)), timing = Timing.at(at(2)))
    lsd.response("Fraud Check", "Payment Service", "score 0.41", res(200, mapOf("score" to 0.41, "decision" to "REVIEW")), timing = Timing.at(at(3)))
    lsd.response("Payment Provider", "Payment Service", "do_not_honour", mapOf("code" to "05", "reason" to "do_not_honour"), timing = Timing.at(at(6)))
    lsd.activate("Payment Service", at = at(1))
    lsd.activate("Fraud Check", at = at(2))
    lsd.deactivate("Fraud Check", at = at(3))
    lsd.activate("Payment Provider", "#dc2626", at = at(4))
    lsd.deactivate("Payment Provider", at = at(6))
    lsd.deactivate("Payment Service", at = at(7))
    lsd.completeScenario(
        "Payment declined (captured out of order)",
        """
        Given a card the issuer will decline
        When the customer pays
        Then the order is confirmed
        """.trimIndent(),
        // Aborted as JUnit reports it: an assumption failed, so the test was aborted, not failed.
        status = Status.ABORTED,
        error =
            ScenarioError.of(
                headline = "Test aborted",
                message = "Assumption failed: the issuer sandbox declined the test card, so confirmation was not checked",
                stack =
                    """
                    org.opentest4j.TestAbortedException: Assumption failed: the issuer sandbox declined the test card, so confirmation was not checked
                    	at org.junit.jupiter.api.Assumptions.throwAssumptionFailed(Assumptions.java:340)
                    	at com.example.shop.PlaceOrderTest.paysByCard(PlaceOrderTest.kt:88)
                    	at java.base/java.lang.reflect.Method.invoke(Method.java:580)
                    """.trimIndent(),
            ),
    )
}

private fun outOfStock(lsd: LsdContext) {
    lsd.addFact("orderId", "ord-2003")
    lsd.addFact("sku", "HAT-3")
    lsd.capture {
        placeOrderRequest("ord-2003")
        "Order Service" calls "Inventory Service" label "reserve stock" data
            req("POST", "/reservations", mapOf("orderId" to "ord-2003", "lines" to listOf(mapOf("sku" to "HAT-3", "qty" to 1))))
        activate("Inventory Service")
        "Inventory Service" calls "Orders DB" label "select stock for update" data sql("SELECT sku, available FROM stock WHERE sku = ? FOR UPDATE", "HAT-3")
        "Orders DB" repliesTo "Inventory Service" label "HAT-3: 0 left" data mapOf("rows" to listOf(mapOf("sku" to "HAT-3", "available" to 0)))
        "Inventory Service" calls "Inventory Service" label "check backorder policy"
        note("Backorders are disabled for hats.", on = "Inventory Service", side = NoteSide.LEFT)
        "Inventory Service" repliesTo "Order Service" label "409 out of stock" data mapOf("sku" to "HAT-3", "available" to 0)
        deactivate("Inventory Service")
        "Order Service" sends "Kafka order-events" label "order.rejected" data
            event("order.rejected", "ord-2003", mapOf("reason" to "OUT_OF_STOCK", "sku" to "HAT-3"))
        "Order Service" repliesTo "API Gateway" label "409 Conflict" data problem(409, "Out of stock", "HAT-3 has no stock")
        deactivate("Order Service")
        "API Gateway" repliesTo "Web UI" label "409 Conflict" data problem(409, "Out of stock", "HAT-3 has no stock")
        deactivate("API Gateway")
        "Web UI" repliesTo "Customer" label "show 'out of stock'"
        deactivate("Web UI")
    }
    lsd.completeScenario(
        "Out of stock",
        "Given HAT-3 has no stock\nWhen the customer places an order\nThen the order is rejected\nAnd no payment is taken",
    )
}

private fun asyncFulfilment(lsd: LsdContext) {
    lsd.addFact("orderId", "ord-2001")
    lsd.addFact("courier", "Parcelly")
    lsd.capture {
        "Kafka order-events" sends "Warehouse" label "consume order.paid" data mapOf(
            "orderId" to "ord-2001",
            "lines" to 2,
        )
        activate("Warehouse")
        "Warehouse" calls "Warehouse" label "pick and pack" data mapOf("picker" to "WH-07", "boxes" to 1, "weightGrams" to 340)
        delay("2 hours")
        "Warehouse" sends "Kafka order-events" label "order.shipped" data
            event("order.shipped", "ord-2001", mapOf("courier" to "Parcelly", "tracking" to "PCL-99812-GB"))
        deactivate("Warehouse")
        "Kafka order-events" sends "Notification Service" label "consume order.shipped" data consumed("order.shipped", "ord-2001", "notification-service", 1907)
        activate("Notification Service")
        "Notification Service" calls "Email" label "send 'on its way'" data
            mapOf("template" to "order-shipped", "to" to "c***@example.com", "tracking" to "PCL-99812-GB")
        delay("courier webhook")
        inbound("Order Service", "POST /webhooks/courier")
        activate("Order Service")
        "Order Service" calls "Orders DB" label "mark delivered" data sql("UPDATE orders SET status = 'DELIVERED' WHERE id = ?", "ord-2001")
    }
    lsd.completeScenario(
        "Async fulfilment",
        "Given an order has been paid\nWhen the warehouse ships it\nThen the customer is told it is on its way\nAnd the delivery webhook is recorded",
        status = Status.ERROR,
        error =
            ScenarioError.of(
                headline = "ConditionTimeoutException",
                message = "Orders DB never acknowledged 'mark delivered' within 30 s",
                stack =
                    "org.awaitility.core.ConditionTimeoutException: Condition was not fulfilled within 30 seconds.\n" +
                        "\tat com.example.shop.FulfilmentTest.deliveryIsRecorded(FulfilmentTest.kt:61)",
            ),
    )
}

/** The timing API: measured, traced, clock-ordered and linked. Deterministic: every duration is given. */
private fun timedCheckout(lsd: LsdContext) {
    val t0 = Instant.parse("2026-10-14T09:00:00Z")

    fun at(ms: Long) = t0.plusMillis(ms)
    val trace = "4bf92f3577b34da6a3ce929d0e0e4736"
    lsd.addFact("traceId", trace)
    lsd.addFact("clock ordering", "same source (default)")

    lsd.section("Measured and traced")
    val checkout = lsd.call(
        "Web UI",
        "API Gateway",
        "POST /checkout",
        data = req("POST", "/checkout", mapOf("basketId" to "bsk-9")),
        timing = Timing.at(at(0)),
        trace = Trace(trace, "a1"),
    )
    val order =
        lsd.call("API Gateway", "Order Service", "create order", timing = Timing.at(at(3)), trace = Trace(trace, "b1", "a1"))
    val basket = lsd.call("Order Service", "Basket", "load basket", timing = Timing.at(at(6)), trace = Trace(trace, "c1", "b1"))
    basket.reply("2 lines", data = res(200, mapOf("lines" to listOf("SOCK-1", "HAT-3"))), timing = Timing.tookMs(17.625))
    val stock =
        lsd.call("Order Service", "Inventory Service", "reserve stock", timing = Timing.at(at(25)), trace = Trace(trace, "c2", "b1"))
    val db = lsd.call("Inventory Service", "Orders DB", "upsert reservation", timing = Timing.at(at(31)), trace = Trace(trace, "d1", "c2"))
    db.reply("1 row", data = mapOf("rowsAffected" to 1), timing = Timing.tookMs(32.75))
    stock.reply("reserved", data = res(201, mapOf("reservationId" to "rsv-80")), timing = Timing.tookMs(61.5))
    val pay =
        lsd.call("Order Service", "Payment Service", "authorise £42.00", timing = Timing.at(at(90)), trace = Trace(trace, "c3", "b1"))
    val fraud = lsd.call("Payment Service", "Fraud Check", "score", timing = Timing.at(at(96)), trace = Trace(trace, "e1", "c3"))
    fraud.reply("low risk", data = res(200, mapOf("score" to 0.03, "decision" to "ALLOW")), timing = Timing.tookMs(48.25))
    val provider =
        lsd.call("Payment Service", "Payment Provider", "POST /authorise", timing = Timing.at(at(150)), trace = Trace(trace, "e2", "c3"))
    provider.reply("approved", data = res(200, mapOf("authCode" to "Z9Y8", "status" to "AUTHORISED")), timing = Timing.tookMs(402.375))
    pay.reply("authorised", data = res(200, mapOf("paymentId" to "pay-600")), timing = Timing.tookMs(470.5))

    lsd.section("Captured out of order, put back by the clock")
    // An interceptor thread captured these late and in the wrong order. They have start times and
    // no measured duration, so same-source clock ordering swaps them back (order = CLOCK).
    lsd.async("Order Service", "Warehouse", "pick list", data = mapOf("orderId" to "ord-2100", "lines" to 2), timing = Timing.at(at(575)))
    val placed = lsd.async(
        "Order Service",
        "kafka",
        "order.placed",
        data = event("order.placed", "ord-2100", mapOf("total" to 4200)),
        timing = Timing.at(at(566)),
        trace = Trace(trace, "c4", "b1"),
    )
    order.reply("201 Created", data = res(201, mapOf("orderId" to "ord-2100", "status" to "CONFIRMED")), timing = Timing.tookMs(581.25))
    checkout.reply("201", data = res(201, mapOf("orderId" to "ord-2100")), timing = Timing.tookMs(586.0))

    lsd.section("Another service's clock")
    // The consume comes from the notification service's clock and is linked to its publish, so it is
    // never drawn before it, whatever its timestamp says.
    lsd.async(
        "kafka",
        "Notification Service",
        "consume order.placed",
        timing = Timing.at(at(560)).withSource("notification-service"),
        trace = Trace(trace, "f1", "c4"),
        causedBy = placed,
    )
    // Ingested from another library, which sends no ids: drawn, but not linked.
    lsd.ingest(
        Interaction(
            kind = InteractionKind.PUBLISH,
            label = "send receipt",
            from = "Notification Service",
            to = "Email",
            source = "notification-service",
            startedAt = at(640),
        ),
    )
    // The importer's status drives the Errors metric: the first send fails, the retry succeeds.
    // Its headers sit beside the body in the payload.
    lsd.ingest(
        Interaction(
            kind = InteractionKind.REQUEST,
            from = "Email",
            to = "SMTP Relay",
            label = "deliver receipt",
            interactionId = "smtp-1",
            data = mapOf("to" to "customer@example.test", "template" to "receipt"),
            headers = mapOf("content-type" to "message/rfc822", "x-request-id" to "smtp-1"),
        ),
    )
    lsd.ingest(
        Interaction(
            kind = InteractionKind.RESPONSE,
            from = "SMTP Relay",
            to = "Email",
            label = "421 try again later",
            status = "421",
            replyTo = "smtp-1",
        ),
    )
    lsd.ingest(
        Interaction(
            kind = InteractionKind.REQUEST,
            from = "Email",
            to = "SMTP Relay",
            label = "deliver receipt (retry)",
            interactionId = "smtp-2",
        ),
    )
    lsd.ingest(
        Interaction(
            kind = InteractionKind.RESPONSE,
            from = "SMTP Relay",
            to = "Email",
            label = "250 queued",
            status = "250",
            replyTo = "smtp-2",
        ),
    )
    lsd.completeScenario(
        "Timed checkout (timing API)",
        """
        Given every call is measured and carries trace and span ids
        When two events are captured out of order on the same clock
        Then they are put back in time order and marked clock-ordered
        And a consume on another service's clock stays after its publish
        And a failed relay status is counted in the Errors metric
        """.trimIndent(),
        Status.SUCCESS,
    )
}

/** An HTTP request payload, as an interceptor would record it. */
private fun req(method: String, path: String, body: Any? = null): Map<String, Any> =
    buildMap {
        put("method", method)
        put("path", path)
        put(
            "headers",
            mapOf(
                "content-type" to "application/json",
                "x-request-id" to "req-${path.hashCode().toUInt().toString(16)}",
                "traceparent" to "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
            ),
        )
        if (body != null) put("body", body)
    }

/** An HTTP response payload. */
private fun res(status: Int, body: Any): Map<String, Any> =
    mapOf("status" to status, "headers" to mapOf("content-type" to "application/json"), "body" to body)

/** An RFC 9457 problem response. */
private fun problem(status: Int, title: String, detail: String): Map<String, Any> =
    mapOf(
        "status" to status,
        "headers" to mapOf("content-type" to "application/problem+json"),
        "body" to
            mapOf(
                "type" to "https://shop.example.com/problems/${title.lowercase().replace(' ', '-')}",
                "title" to title,
                "status" to status,
                "detail" to detail,
            ),
    )

/** A Kafka record as published. */
private fun event(type: String, key: String, value: Any): Map<String, Any> =
    mapOf(
        "topic" to "order-events.v2",
        "key" to key,
        "headers" to mapOf("ce-type" to type, "ce-source" to "order-service", "ce-specversion" to "1.0"),
        "value" to value,
    )

/** A Kafka record as consumed. */
private fun consumed(type: String, key: String, group: String, offset: Int): Map<String, Any> =
    mapOf("topic" to "order-events.v2", "partition" to 3, "offset" to offset, "group" to group, "key" to key, "headers" to mapOf("ce-type" to type))

/** A SQL statement and its bind values. */
private fun sql(statement: String, vararg params: Any): Map<String, Any> = mapOf("sql" to statement, "params" to params.toList())

/** A UI event from the app. */
private fun uiEvent(type: String, target: String, vararg detail: Pair<String, Any>): Map<String, Any> =
    mapOf("type" to type, "target" to target, "detail" to mapOf(*detail))
