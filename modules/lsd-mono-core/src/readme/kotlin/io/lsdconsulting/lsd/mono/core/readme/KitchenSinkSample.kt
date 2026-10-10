package io.lsdconsulting.lsd.mono.core.readme

import io.lsdconsulting.lsd.mono.core.CaptureBlock
import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.domain.MessageType.BI_DIRECTIONAL
import io.lsdconsulting.lsd.mono.core.domain.MessageType.LOST
import io.lsdconsulting.lsd.mono.core.domain.NoteSide
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.ACTOR
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.BOUNDARY
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.DATABASE
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.ENTITY
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.PARTICIPANT
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.QUEUE
import io.lsdconsulting.lsd.mono.core.domain.ScenarioError
import io.lsdconsulting.lsd.mono.core.domain.Status
import java.time.Instant

/**
 * Kitchen-sink report: an online shop order flow that uses every diagram
 * feature, so layout problems are easy to eyeball. Regenerate with
 * `./gradlew :modules:lsd-mono-core:kitchenSinkSample`, which builds the Pages site
 * (`build/pages/kitchen-sink.html` and its payload script). The Pages workflow publishes it.
 *
 * Four scenarios (happy path, payment declined, out of stock, async
 * fulfilment) across 14 lifelines cover: all six participant shapes, the
 * participant filter and minimap, sync, async, bi-directional, lost and
 * response arrows, short arrows to and from the diagram edge, self-calls,
 * nested and overlapping activations on late lifelines, a lifeline that first
 * appears mid-scenario, an activation left open, short and wrapping notes
 * (over, left, right, diagram edge), sections, a logical divider, delays,
 * spacers, facts, Given/When/Then descriptions, payloads, message, participant
 * and activation colours, durations, out-of-order capture sorted by
 * timestamp, and success, failure and error statuses with structured errors.
 *
 * Some display names are deliberately long, one per shape, so the
 * header shows names that widen their shape, wrap onto two lines, or are cut
 * with an ellipsis (full name on hover).
 */
fun main() {
    val lsd = LsdContext()
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

    happyPath(lsd)
    paymentDeclined(lsd)
    outOfStock(lsd)
    asyncFulfilment(lsd)

    val files = lsd.completeReport("kitchen-sink")
    lsd.createIndex()
    println(files.diagramHtml)
}

private fun CaptureBlock.placeOrderRequest(orderId: String) {
    "Customer" calls "Web UI" label "click Place order"
    activate("Web UI")
    "Web UI" calls "API Gateway" label "POST /orders" took 412 data mapOf(
        "method" to "POST",
        "path" to "/orders",
        "headers" to mapOf("x-request-id" to "req-$orderId", "content-type" to "application/json"),
        "body" to mapOf("basketId" to "bsk-9", "currency" to "GBP"),
    )
    activate("API Gateway")
    "API Gateway" calls "API Gateway" label "check JWT"
    "API Gateway" calls "Order Service" label "createOrder" data mapOf("orderId" to orderId)
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

        "Order Service" calls "Basket" label "load basket" took 18
        activate("Basket")
        "Basket" calls "Basket" label "merge duplicate lines"
        "Basket" repliesTo "Order Service" label "2 items" data mapOf("lines" to listOf("SOCK-1", "HAT-3"))
        deactivate("Basket")

        // Nested activation opened by a self-call, spanning a wrapping note.
        "Order Service" calls "Order Service" label "apply promo SOCKS10"
        activate("Order Service", colour = "#f59e0b")
        note(
            "Promotions stack in priority order. A long note like this one wraps onto several lines inside the card.",
            on = "Order Service",
            side = NoteSide.RIGHT,
        )
        "Order Service" calls "Order Service" label "round to pence"
        deactivate("Order Service")

        "Order Service" calls "Inventory Service" label "reserve stock" took 95
        activate("Inventory Service")
        "Inventory Service" calls "Orders DB" label "upsert reservation" took 33
        "Orders DB" repliesTo "Inventory Service" label "1 row"
        note("short note", on = "Orders DB")
        "Inventory Service" repliesTo "Order Service" label "reserved"
        deactivate("Inventory Service")

        section("When the customer pays by card")
        "Order Service" calls "Payment Service" label "authorise £42.00" took 640 data mapOf(
            "method" to "POST",
            "path" to "/payments/authorise",
            "status" to 200,
            "body" to mapOf("amount" to 4200, "card" to "**** 4242"),
        )
        activate("Payment Service")
        "Payment Service" calls "Fraud Check" label "score transaction"
        activate("Fraud Check")
        delay("fraud model warm-up")
        "Fraud Check" repliesTo "Payment Service" label "score 0.02"
        deactivate("Fraud Check")
        // Nested bars on the 10th lifeline.
        message("Payment Service", "Payment Provider", "3-D Secure challenge", BI_DIRECTIONAL)
        activate("Payment Provider")
        "Payment Provider" calls "Payment Provider" label "issuer approves"
        activate("Payment Provider")
        "Payment Provider" calls "Payment Provider" label "capture funds" colour "#dc2626"
        deactivate("Payment Provider")
        "Payment Provider" repliesTo "Payment Service" label "auth code A1B2"
        deactivate("Payment Provider")
        "Payment Service" repliesTo "Order Service" label "authorised" took 12
        deactivate("Payment Service")

        // Overlapping (not nested) bars opened by async messages.
        "Order Service" sends "Kafka order-events" label "order.placed" data mapOf(
            "orderId" to "ord-2001",
            "items" to 2,
        )
        activate("Kafka order-events")
        "Kafka order-events" sends "Notification Service" label "consume order.placed"
        activate("Notification Service", colour = "#0891b2")
        deactivate("Kafka order-events")
        "Notification Service" calls "Email" label "render confirmation"
        spacer(60)
        outbound("Notification Service", "SMTP relay")
        deactivate("Notification Service")
        message("Order Service", "Kafka order-events", "audit.ping", LOST)
        divider("checkout complete")

        section("Then the order is confirmed")
        // Warehouse is first referenced here, halfway down the scenario.
        "Order Service" calls "Warehouse" label "book pick slot" colour "#ea580c"
        activate("Warehouse")
        "Warehouse" repliesTo "Order Service" label "slot 14:00"
        deactivate("Warehouse")
        "Order Service" repliesTo "API Gateway" label "order confirmed"
        deactivate("Order Service")
        "API Gateway" repliesTo "Web UI" label "201 Created" data mapOf(
            "status" to 201,
            "body" to mapOf("orderId" to "ord-2001", "eta" to "2026-10-10"),
        )
        deactivate("API Gateway")
        "Web UI" repliesTo "Customer" label "show confirmation"
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

/** Captured out of order (as interceptors on different threads would); createdAt restores the sequence. */
private fun paymentDeclined(lsd: LsdContext) {
    val t0 = Instant.parse("2026-10-08T09:00:00Z")

    fun at(seconds: Long) = t0.plusSeconds(seconds)
    lsd.addFact("orderId", "ord-2002")
    lsd.addFact("card", "**** 0002")
    lsd.response("Payment Service", "Order Service", "402 declined", at = at(7))
    lsd.message("Order Service", "Payment Service", "authorise £42.00", at = at(1))
    lsd.message("Payment Service", "Payment Provider", "authorise", mapOf("amount" to 4200, "card" to "**** 0002"), at = at(4))
    lsd.message("Payment Service", "Fraud Check", "score transaction", at = at(2))
    lsd.response("Fraud Check", "Payment Service", "score 0.41", at = at(3))
    lsd.response("Payment Provider", "Payment Service", "do_not_honour", mapOf("code" to "05", "reason" to "do_not_honour"), at = at(6))
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
        status = Status.WARN,
        error =
            ScenarioError(
                headline = "AssertionFailedError",
                message = "expected: <CONFIRMED> but was: <PAYMENT_DECLINED>",
                stack =
                    """
                    org.opentest4j.AssertionFailedError: expected: <CONFIRMED> but was: <PAYMENT_DECLINED>
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
        "Order Service" calls "Inventory Service" label "reserve stock"
        activate("Inventory Service")
        "Inventory Service" calls "Orders DB" label "select stock for update"
        "Orders DB" repliesTo "Inventory Service" label "HAT-3: 0 left"
        "Inventory Service" calls "Inventory Service" label "check backorder policy"
        note("Backorders are disabled for hats.", on = "Inventory Service", side = NoteSide.LEFT)
        "Inventory Service" repliesTo "Order Service" label "409 out of stock" data mapOf("sku" to "HAT-3", "available" to 0)
        deactivate("Inventory Service")
        "Order Service" sends "Kafka order-events" label "order.rejected"
        "Order Service" repliesTo "API Gateway" label "409 Conflict"
        deactivate("Order Service")
        "API Gateway" repliesTo "Web UI" label "409 Conflict"
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
        "Warehouse" calls "Warehouse" label "pick and pack"
        delay("2 hours")
        "Warehouse" sends "Kafka order-events" label "order.shipped"
        deactivate("Warehouse")
        "Kafka order-events" sends "Notification Service" label "consume order.shipped"
        activate("Notification Service")
        "Notification Service" calls "Email" label "send 'on its way'"
        delay("courier webhook")
        inbound("Order Service", "POST /webhooks/courier")
        activate("Order Service")
        "Order Service" calls "Orders DB" label "mark delivered"
    }
    lsd.completeScenario(
        "Async fulfilment",
        "Given an order has been paid\nWhen the warehouse ships it\nThen the customer is told it is on its way\nAnd the delivery webhook is recorded",
        status = Status.ERROR,
        error =
            ScenarioError(
                headline = "ConditionTimeoutException",
                message = "Orders DB never acknowledged 'mark delivered' within 30 s",
                stack =
                    "org.awaitility.core.ConditionTimeoutException: Condition was not fulfilled within 30 seconds.\n" +
                        "\tat com.example.shop.FulfilmentTest.deliveryIsRecorded(FulfilmentTest.kt:61)",
            ),
    )
}
