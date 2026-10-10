package io.lsdconsulting.lsd.mono.core.readme

import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.capture.messages
import io.lsdconsulting.lsd.mono.core.capture.withData
import io.lsdconsulting.lsd.mono.core.capture.withDurationMs
import io.lsdconsulting.lsd.mono.core.capture.withLabel
import io.lsdconsulting.lsd.mono.core.capture.withType
import io.lsdconsulting.lsd.mono.core.domain.MessageType.ASYNCHRONOUS
import io.lsdconsulting.lsd.mono.core.domain.NoteSide
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.ACTOR
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.BOUNDARY
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.DATABASE
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.PARTICIPANT
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.QUEUE
import io.lsdconsulting.lsd.mono.core.domain.ScenarioError
import io.lsdconsulting.lsd.mono.core.domain.Status

/**
 * Report behind the root README's feature tour (`docs/readme/feature-tour.gif`).
 * `:modules:lsd-mono-core:readmeSamples` captures it and clicks around it.
 *
 * A trimmed shop: six lifelines so the diagram reads at README size, four
 * scenarios with every status, payloads, durations for Metrics, and enough
 * messages for the minimap. `scripts/readme-samples.mjs` finds the
 * `authorise £24.00` arrow, the `Order events` participant, and the three-message
 * Orders to Orders DB link by name, so keep those in sync with it.
 */
fun main() {
    val lsd = LsdContext()
    lsd.addParticipants(
        ACTOR.called("Customer"),
        BOUNDARY.called("Web Shop"),
        PARTICIPANT.called("Orders", colour = "#2563eb"),
        PARTICIPANT.called("Payments", colour = "#16a34a"),
        DATABASE.called("Orders DB"),
        QUEUE.called("Order events"),
    )

    placeOrder(lsd)
    cardDeclined(lsd)
    outOfStock(lsd)
    shippingUpdate(lsd)

    val listing = lsd.completeReport("Online shop")
    lsd.createIndex()
    println(listing)
}

private fun checkout(lsd: LsdContext, orderId: String, sku: String) {
    lsd.capture("Customer" messages "Web Shop" withLabel "click Place order")
    lsd.activate("Web Shop")
    lsd.capture(
        "Web Shop" messages "Orders" withLabel "POST /orders" withDurationMs 412 withData mapOf(
            "method" to "POST",
            "path" to "/orders",
            "headers" to mapOf("x-request-id" to "req-$orderId", "content-type" to "application/json"),
            "body" to mapOf("orderId" to orderId, "lines" to listOf(mapOf("sku" to sku, "qty" to 2)), "currency" to "GBP"),
        ),
    )
    lsd.activate("Orders")
}

private fun placeOrder(lsd: LsdContext) {
    lsd.addFact("orderId", "ord-1001")
    lsd.addFact("customer", "cust-42")
    lsd.addFact("card", "**** 4242")

    lsd.section("Given a basket with two pairs of socks")
    checkout(lsd, "ord-1001", "SOCK-1")
    lsd.capture("Orders" messages "Orders DB" withLabel "load basket" withDurationMs 18)
    lsd.response("Orders DB", "Orders", "2 lines", data = mapOf("lines" to listOf("SOCK-1", "SOCK-1")))
    lsd.capture("Orders" messages "Orders" withLabel "apply promo SOCKS10")
    lsd.note("SOCKS10 takes 10% off socks.", on = "Orders", side = NoteSide.RIGHT)
    lsd.capture("Orders" messages "Orders DB" withLabel "reserve stock" withDurationMs 95)
    lsd.response("Orders DB", "Orders", "reserved", durationMs = 4)

    lsd.section("When the customer pays by card")
    lsd.capture(
        "Orders" messages "Payments" withLabel "authorise £24.00" withDurationMs 640 withData mapOf(
            "method" to "POST",
            "path" to "/payments/authorise",
            "body" to mapOf("orderId" to "ord-1001", "amount" to 2400, "currency" to "GBP", "card" to "**** 4242"),
        ),
    )
    lsd.activate("Payments")
    lsd.capture("Payments" messages "Payments" withLabel "3-D Secure check" withDurationMs 210)
    lsd.capture("Payments" messages "Orders DB" withLabel "record payment" withDurationMs 22)
    lsd.response("Orders DB", "Payments", "1 row")
    lsd.response(
        "Payments",
        "Orders",
        "authorised",
        data = mapOf("status" to 200, "body" to mapOf("authCode" to "A1B2C3", "captured" to true)),
        durationMs = 12,
    )
    lsd.deactivate("Payments")

    lsd.section("Then the order is confirmed")
    lsd.capture("Orders" messages "Orders DB" withLabel "mark order paid" withDurationMs 31)
    lsd.response("Orders DB", "Orders", "1 row")
    lsd.capture(
        "Orders" messages "Order events" withLabel "order.paid" withType ASYNCHRONOUS withData mapOf(
            "orderId" to "ord-1001",
            "total" to 2400,
        ),
    )
    lsd.response(
        "Orders",
        "Web Shop",
        "201 Created",
        data = mapOf("status" to 201, "body" to mapOf("orderId" to "ord-1001", "eta" to "2026-10-12")),
    )
    lsd.deactivate("Orders")
    lsd.response("Web Shop", "Customer", "show confirmation")
    lsd.deactivate("Web Shop")
    lsd.capture("Order events" messages "Web Shop" withLabel "order.paid" withType ASYNCHRONOUS)
    lsd.capture("Web Shop" messages "Customer" withLabel "email receipt" withType ASYNCHRONOUS)
    lsd.completeScenario(
        "Place an order and pay by card",
        """
        Given a basket with two pairs of socks
        And the SOCKS10 promotion is live
        When the customer pays by card
        Then the order is confirmed
        And a receipt is emailed
        """.trimIndent(),
    )
}

private fun cardDeclined(lsd: LsdContext) {
    lsd.addFact("orderId", "ord-1002")
    lsd.addFact("card", "**** 0002")
    checkout(lsd, "ord-1002", "HAT-3")
    lsd.capture(
        "Orders" messages "Payments" withLabel "authorise £18.00" withDurationMs 702 withData mapOf(
            "amount" to 1800,
            "card" to "**** 0002",
        ),
    )
    lsd.activate("Payments")
    lsd.response("Payments", "Orders", "402 do_not_honour", data = mapOf("code" to "05", "reason" to "do_not_honour"))
    lsd.deactivate("Payments")
    lsd.response("Orders", "Web Shop", "402 Payment Required")
    lsd.deactivate("Orders")
    lsd.response("Web Shop", "Customer", "show 'card declined'")
    lsd.deactivate("Web Shop")
    lsd.completeScenario(
        "Card declined",
        "Given a card the issuer will decline\nWhen the customer pays\nThen the order is confirmed",
        status = Status.WARN,
        error =
            ScenarioError(
                headline = "AssertionFailedError",
                message = "expected: <CONFIRMED> but was: <PAYMENT_DECLINED>",
                stack =
                    """
                    org.opentest4j.AssertionFailedError: expected: <CONFIRMED> but was: <PAYMENT_DECLINED>
                    	at com.example.shop.PlaceOrderTest.cardIsDeclined(PlaceOrderTest.kt:61)
                    """.trimIndent(),
            ),
    )
}

private fun outOfStock(lsd: LsdContext) {
    lsd.addFact("orderId", "ord-1003")
    lsd.addFact("sku", "HAT-3")
    checkout(lsd, "ord-1003", "HAT-3")
    lsd.capture("Orders" messages "Orders DB" withLabel "reserve stock" withDurationMs 88)
    lsd.response("Orders DB", "Orders", "HAT-3: 0 left")
    lsd.capture("Orders" messages "Order events" withLabel "order.rejected" withType ASYNCHRONOUS)
    lsd.response("Orders", "Web Shop", "409 Conflict", data = mapOf("sku" to "HAT-3", "available" to 0))
    lsd.deactivate("Orders")
    lsd.response("Web Shop", "Customer", "show 'out of stock'")
    lsd.deactivate("Web Shop")
    lsd.completeScenario(
        "Out of stock",
        "Given HAT-3 has no stock\nWhen the customer places an order\nThen the order is rejected",
    )
}

private fun shippingUpdate(lsd: LsdContext) {
    lsd.addFact("orderId", "ord-1001")
    lsd.capture(
        "Order events" messages "Orders" withLabel "consume order.shipped" withType ASYNCHRONOUS withData mapOf(
            "orderId" to "ord-1001",
            "courier" to "Parcelly",
        ),
    )
    lsd.activate("Orders")
    lsd.capture("Orders" messages "Orders DB" withLabel "mark shipped")
    lsd.delay("30 s")
    lsd.completeScenario(
        "Shipping update",
        "Given an order has been paid\nWhen the courier collects it\nThen the order is marked shipped",
        status = Status.ERROR,
        error =
            ScenarioError(
                headline = "ConditionTimeoutException",
                message = "Orders DB never acknowledged 'mark shipped' within 30 s",
                stack =
                    "org.awaitility.core.ConditionTimeoutException: Condition was not fulfilled within 30 seconds.\n" +
                        "\tat com.example.shop.ShippingTest.shipmentIsRecorded(ShippingTest.kt:40)",
            ),
    )
}
