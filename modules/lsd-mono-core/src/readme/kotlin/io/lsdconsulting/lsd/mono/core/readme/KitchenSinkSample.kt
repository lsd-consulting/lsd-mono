package io.lsdconsulting.lsd.mono.core.readme

import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.capture.lifeline
import io.lsdconsulting.lsd.mono.core.capture.logicalDivider
import io.lsdconsulting.lsd.mono.core.capture.messages
import io.lsdconsulting.lsd.mono.core.capture.withColour
import io.lsdconsulting.lsd.mono.core.capture.withData
import io.lsdconsulting.lsd.mono.core.capture.withDurationMs
import io.lsdconsulting.lsd.mono.core.capture.withLabel
import io.lsdconsulting.lsd.mono.core.capture.withType
import io.lsdconsulting.lsd.mono.core.domain.LifelineAction.ACTIVATE
import io.lsdconsulting.lsd.mono.core.domain.LifelineAction.DEACTIVATE
import io.lsdconsulting.lsd.mono.core.domain.Message
import io.lsdconsulting.lsd.mono.core.domain.MessageType.ASYNCHRONOUS
import io.lsdconsulting.lsd.mono.core.domain.MessageType.BI_DIRECTIONAL
import io.lsdconsulting.lsd.mono.core.domain.MessageType.LOST
import io.lsdconsulting.lsd.mono.core.domain.MessageType.SYNCHRONOUS
import io.lsdconsulting.lsd.mono.core.domain.MessageType.SYNCHRONOUS_RESPONSE
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
 * Some display names (aliases) are deliberately long, one per shape, so the
 * header shows names that widen their shape, wrap onto two lines, or are cut
 * with an ellipsis (full name on hover).
 */
fun main() {
    val lsd = LsdContext()
    lsd.addParticipants(
        ACTOR.called("Customer", alias = "Signed-in Customer (mobile app)"),
        BOUNDARY.called("Web UI"),
        BOUNDARY.called("API Gateway", alias = "Public API Gateway (rate limited)"),
        PARTICIPANT.called("Order Service", colour = "#2563eb"),
        ENTITY.called("Basket", alias = "Shopping Basket Aggregate"),
        PARTICIPANT.called("Inventory Service"),
        DATABASE.called("Orders DB", alias = "Orders DB (PostgreSQL primary)"),
        PARTICIPANT.called("Payment Service", colour = "#16a34a"),
        PARTICIPANT.called("Fraud Check"),
        PARTICIPANT.called("Payment Provider", alias = "Payment Provider (ext)"),
        QUEUE.called("Kafka order-events", id = "kafka", alias = "Kafka topic order-events.v2"),
        PARTICIPANT.called(
            "Notification Service",
            alias = "Customer Notification Preferences and Delivery Orchestration Service",
        ),
        ENTITY.called("Email"),
        PARTICIPANT.called("Warehouse", colour = "#ea580c"),
    )

    happyPath(lsd)
    paymentDeclined(lsd)
    outOfStock(lsd)
    asyncFulfilment(lsd)

    val listing = lsd.completeReport("kitchen-sink")
    lsd.createIndex()
    println(listing)
}

private fun placeOrderRequest(lsd: LsdContext, orderId: String) {
    lsd.capture("Customer" messages "Web UI" withLabel "click Place order")
    lsd.activate("Web UI")
    lsd.capture(
        "Web UI" messages "API Gateway" withLabel "POST /orders" withDurationMs 412 withData mapOf(
            "method" to "POST",
            "path" to "/orders",
            "headers" to mapOf("x-request-id" to "req-$orderId", "content-type" to "application/json"),
            "body" to mapOf("basketId" to "bsk-9", "currency" to "GBP"),
        ),
    )
    lsd.activate("API Gateway")
    lsd.capture("API Gateway" messages "API Gateway" withLabel "check JWT")
    lsd.capture("API Gateway" messages "Order Service" withLabel "createOrder" withData mapOf("orderId" to orderId))
    lsd.activate("Order Service", colour = "#c026d3")
}

private fun happyPath(lsd: LsdContext) {
    lsd.addFact("orderId", "ord-2001")
    lsd.addFact("customer", "cust-42")
    lsd.addFact("region", "eu-west-2")
    lsd.addFact("3-D Secure")

    lsd.section("Given a basket with two items")
    lsd.shortInbound("API Gateway", "health probe")
    placeOrderRequest(lsd, "ord-2001")

    lsd.capture("Order Service" messages "Basket" withLabel "load basket" withDurationMs 18)
    lsd.activate("Basket")
    lsd.capture("Basket" messages "Basket" withLabel "merge duplicate lines")
    lsd.response("Basket", "Order Service", "2 items", data = mapOf("lines" to listOf("SOCK-1", "HAT-3")))
    lsd.deactivate("Basket")

    // Nested activation opened by a self-call, spanning a wrapping note.
    lsd.capture("Order Service" messages "Order Service" withLabel "apply promo SOCKS10")
    lsd.activate("Order Service", colour = "#f59e0b")
    lsd.noteRight(
        "Promotions stack in priority order. A long note like this one wraps onto several lines inside the card.",
        of = "Order Service",
    )
    lsd.capture("Order Service" messages "Order Service" withLabel "round to pence")
    lsd.deactivate("Order Service")

    lsd.capture("Order Service" messages "Inventory Service" withLabel "reserve stock" withDurationMs 95)
    lsd.activate("Inventory Service")
    lsd.capture("Inventory Service" messages "Orders DB" withLabel "upsert reservation" withDurationMs 33)
    lsd.response("Orders DB", "Inventory Service", "1 row")
    lsd.note("short note", over = "Orders DB")
    lsd.response("Inventory Service", "Order Service", "reserved")
    lsd.deactivate("Inventory Service")

    lsd.section("When the customer pays by card")
    lsd.capture(
        "Order Service" messages "Payment Service" withLabel "authorise £42.00" withDurationMs 640 withData mapOf(
            "method" to "POST",
            "path" to "/payments/authorise",
            "status" to 200,
            "body" to mapOf("amount" to 4200, "card" to "**** 4242"),
        ),
    )
    lsd.activate("Payment Service")
    lsd.capture("Payment Service" messages "Fraud Check" withLabel "score transaction")
    lsd.activate("Fraud Check")
    lsd.delay("fraud model warm-up")
    lsd.response("Fraud Check", "Payment Service", "score 0.02")
    lsd.deactivate("Fraud Check")
    // Nested bars on the 10th lifeline.
    lsd.capture("Payment Service" messages "Payment Provider" withLabel "3-D Secure challenge" withType BI_DIRECTIONAL)
    lsd.activate("Payment Provider")
    lsd.capture("Payment Provider" messages "Payment Provider" withLabel "issuer approves")
    lsd.activate("Payment Provider")
    lsd.capture("Payment Provider" messages "Payment Provider" withLabel "capture funds" withColour "#dc2626")
    lsd.deactivate("Payment Provider")
    lsd.response("Payment Provider", "Payment Service", "auth code A1B2")
    lsd.deactivate("Payment Provider")
    lsd.response("Payment Service", "Order Service", "authorised", durationMs = 12)
    lsd.deactivate("Payment Service")

    // Overlapping (not nested) bars opened by async messages.
    lsd.capture(
        "Order Service" messages "Kafka order-events" withLabel "order.placed" withType ASYNCHRONOUS withData mapOf(
            "orderId" to "ord-2001",
            "items" to 2,
        ),
    )
    lsd.activate("Kafka order-events")
    lsd.capture("Kafka order-events" messages "Notification Service" withLabel "consume order.placed" withType ASYNCHRONOUS)
    lsd.activate("Notification Service", colour = "#0891b2")
    lsd.deactivate("Kafka order-events")
    lsd.capture("Notification Service" messages "Email" withLabel "render confirmation")
    lsd.spacer(60)
    lsd.shortOutbound("Notification Service", "SMTP relay")
    lsd.deactivate("Notification Service")
    lsd.capture("Order Service" messages "Kafka order-events" withLabel "audit.ping" withType LOST)
    lsd.capture(logicalDivider("checkout complete"))

    lsd.section("Then the order is confirmed")
    // Warehouse is first referenced here, halfway down the scenario.
    lsd.capture("Order Service" messages "Warehouse" withLabel "book pick slot" withColour "#ea580c")
    lsd.activate("Warehouse")
    lsd.response("Warehouse", "Order Service", "slot 14:00")
    lsd.deactivate("Warehouse")
    lsd.response("Order Service", "API Gateway", "order confirmed")
    lsd.deactivate("Order Service")
    lsd.response(
        "API Gateway",
        "Web UI",
        "201 Created",
        data = mapOf("status" to 201, "body" to mapOf("orderId" to "ord-2001", "eta" to "2026-10-10")),
    )
    lsd.deactivate("API Gateway")
    lsd.response("Web UI", "Customer", "show confirmation")
    lsd.deactivate("Web UI")
    lsd.noteLeft("Edge note on the left of the diagram.")
    lsd.noteLeft("Left of Customer", of = "Customer")
    lsd.noteRight("Edge note on the right that is long enough to wrap onto a second and third line.")

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
    lsd.capture(
        Message(id = "", from = "Payment Service", to = "Order Service", label = "402 declined", type = SYNCHRONOUS_RESPONSE, createdAt = at(7)),
        Message(id = "", from = "Order Service", to = "Payment Service", label = "authorise £42.00", type = SYNCHRONOUS, createdAt = at(1)),
        Message(
            id = "",
            from = "Payment Service",
            to = "Payment Provider",
            label = "authorise",
            data = mapOf("amount" to 4200, "card" to "**** 0002"),
            createdAt = at(4),
        ),
        Message(id = "", from = "Payment Service", to = "Fraud Check", label = "score transaction", createdAt = at(2)),
        Message(id = "", from = "Fraud Check", to = "Payment Service", label = "score 0.41", type = SYNCHRONOUS_RESPONSE, createdAt = at(3)),
        Message(
            id = "",
            from = "Payment Provider",
            to = "Payment Service",
            label = "do_not_honour",
            type = SYNCHRONOUS_RESPONSE,
            data = mapOf("code" to "05", "reason" to "do_not_honour"),
            createdAt = at(6),
        ),
    )
    lsd.capture(
        (ACTIVATE lifeline "Payment Service").createdAt(at(1)),
        (ACTIVATE lifeline "Fraud Check").createdAt(at(2)),
        (DEACTIVATE lifeline "Fraud Check").createdAt(at(3)),
        (ACTIVATE lifeline "Payment Provider" withColour "#dc2626").createdAt(at(4)),
        (DEACTIVATE lifeline "Payment Provider").createdAt(at(6)),
        (DEACTIVATE lifeline "Payment Service").createdAt(at(7)),
    )
    lsd.completeScenario(
        "Payment declined (captured out of order)",
        """
        Given a card the issuer will decline
        When the customer pays
        Then the order is confirmed
        """.trimIndent(),
        status = Status.FAILURE,
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
    placeOrderRequest(lsd, "ord-2003")
    lsd.capture("Order Service" messages "Inventory Service" withLabel "reserve stock")
    lsd.activate("Inventory Service")
    lsd.capture("Inventory Service" messages "Orders DB" withLabel "select stock for update")
    lsd.response("Orders DB", "Inventory Service", "HAT-3: 0 left")
    lsd.capture("Inventory Service" messages "Inventory Service" withLabel "check backorder policy")
    lsd.noteLeft("Backorders are disabled for hats.", of = "Inventory Service")
    lsd.response("Inventory Service", "Order Service", "409 out of stock", data = mapOf("sku" to "HAT-3", "available" to 0))
    lsd.deactivate("Inventory Service")
    lsd.capture("Order Service" messages "Kafka order-events" withLabel "order.rejected" withType ASYNCHRONOUS)
    lsd.response("Order Service", "API Gateway", "409 Conflict")
    lsd.deactivate("Order Service")
    lsd.response("API Gateway", "Web UI", "409 Conflict")
    lsd.deactivate("API Gateway")
    lsd.response("Web UI", "Customer", "show 'out of stock'")
    lsd.deactivate("Web UI")
    lsd.completeScenario(
        "Out of stock",
        "Given HAT-3 has no stock\nWhen the customer places an order\nThen the order is rejected\nAnd no payment is taken",
    )
}

private fun asyncFulfilment(lsd: LsdContext) {
    lsd.addFact("orderId", "ord-2001")
    lsd.addFact("courier", "Parcelly")
    lsd.capture(
        "Kafka order-events" messages "Warehouse" withLabel "consume order.paid" withType ASYNCHRONOUS withData mapOf(
            "orderId" to "ord-2001",
            "lines" to 2,
        ),
    )
    lsd.activate("Warehouse")
    lsd.capture("Warehouse" messages "Warehouse" withLabel "pick and pack")
    lsd.delay("2 hours")
    lsd.capture("Warehouse" messages "Kafka order-events" withLabel "order.shipped" withType ASYNCHRONOUS)
    lsd.deactivate("Warehouse")
    lsd.capture("Kafka order-events" messages "Notification Service" withLabel "consume order.shipped" withType ASYNCHRONOUS)
    lsd.activate("Notification Service")
    lsd.capture("Notification Service" messages "Email" withLabel "send 'on its way'")
    lsd.delay("courier webhook")
    lsd.shortInbound("Order Service", "POST /webhooks/courier")
    lsd.activate("Order Service")
    lsd.capture("Order Service" messages "Orders DB" withLabel "mark delivered")
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
