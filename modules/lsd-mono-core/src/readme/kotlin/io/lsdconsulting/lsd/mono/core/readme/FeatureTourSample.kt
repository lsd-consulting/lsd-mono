package io.lsdconsulting.lsd.mono.core.readme

import io.lsdconsulting.lsd.mono.core.CaptureBlock
import io.lsdconsulting.lsd.mono.core.LsdContext
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

    val files = lsd.completeReport("Online shop")
    lsd.createIndex()
    println(files.diagramHtml)
}

private fun CaptureBlock.checkout(orderId: String, sku: String) {
    "Customer" calls "Web Shop" label "click Place order"
    activate("Web Shop")
    "Web Shop" calls "Orders" label "POST /orders" took 412 data mapOf(
        "method" to "POST",
        "path" to "/orders",
        "headers" to mapOf("x-request-id" to "req-$orderId", "content-type" to "application/json"),
        "body" to mapOf("orderId" to orderId, "lines" to listOf(mapOf("sku" to sku, "qty" to 2)), "currency" to "GBP"),
    )
    activate("Orders")
}

private fun placeOrder(lsd: LsdContext) {
    lsd.addFact("orderId", "ord-1001")
    lsd.addFact("customer", "cust-42")
    lsd.addFact("card", "**** 4242")

    lsd.capture {
        section("Given a basket with two pairs of socks")
        checkout("ord-1001", "SOCK-1")
        "Orders" calls "Orders DB" label "load basket" took 18
        "Orders DB" repliesTo "Orders" label "2 lines" data mapOf("lines" to listOf("SOCK-1", "SOCK-1"))
        "Orders" calls "Orders" label "apply promo SOCKS10"
        note("SOCKS10 takes 10% off socks.", on = "Orders", side = NoteSide.RIGHT)
        "Orders" calls "Orders DB" label "reserve stock" took 95
        "Orders DB" repliesTo "Orders" label "reserved" took 4

        section("When the customer pays by card")
        "Orders" calls "Payments" label "authorise £24.00" took 640 data mapOf(
            "method" to "POST",
            "path" to "/payments/authorise",
            "body" to mapOf("orderId" to "ord-1001", "amount" to 2400, "currency" to "GBP", "card" to "**** 4242"),
        )
        activate("Payments")
        "Payments" calls "Payments" label "3-D Secure check" took 210
        "Payments" calls "Orders DB" label "record payment" took 22
        "Orders DB" repliesTo "Payments" label "1 row"
        "Payments" repliesTo "Orders" label "authorised" took 12 data mapOf(
            "status" to 200,
            "body" to mapOf("authCode" to "A1B2C3", "captured" to true),
        )
        deactivate("Payments")

        section("Then the order is confirmed")
        "Orders" calls "Orders DB" label "mark order paid" took 31
        "Orders DB" repliesTo "Orders" label "1 row"
        "Orders" sends "Order events" label "order.paid" data mapOf(
            "orderId" to "ord-1001",
            "total" to 2400,
        )
        "Orders" repliesTo "Web Shop" label "201 Created" data mapOf(
            "status" to 201,
            "body" to mapOf("orderId" to "ord-1001", "eta" to "2026-10-12"),
        )
        deactivate("Orders")
        "Web Shop" repliesTo "Customer" label "show confirmation"
        deactivate("Web Shop")
        "Order events" sends "Web Shop" label "order.paid"
        "Web Shop" sends "Customer" label "email receipt"
    }
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
    lsd.capture {
        checkout("ord-1002", "HAT-3")
        "Orders" calls "Payments" label "authorise £18.00" took 702 data mapOf(
            "amount" to 1800,
            "card" to "**** 0002",
        )
        activate("Payments")
        "Payments" repliesTo "Orders" label "402 do_not_honour" data mapOf("code" to "05", "reason" to "do_not_honour")
        deactivate("Payments")
        "Orders" repliesTo "Web Shop" label "402 Payment Required"
        deactivate("Orders")
        "Web Shop" repliesTo "Customer" label "show 'card declined'"
        deactivate("Web Shop")
    }
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
    lsd.capture {
        checkout("ord-1003", "HAT-3")
        "Orders" calls "Orders DB" label "reserve stock" took 88
        "Orders DB" repliesTo "Orders" label "HAT-3: 0 left"
        "Orders" sends "Order events" label "order.rejected"
        "Orders" repliesTo "Web Shop" label "409 Conflict" data mapOf("sku" to "HAT-3", "available" to 0)
        deactivate("Orders")
        "Web Shop" repliesTo "Customer" label "show 'out of stock'"
        deactivate("Web Shop")
    }
    lsd.completeScenario(
        "Out of stock",
        "Given HAT-3 has no stock\nWhen the customer places an order\nThen the order is rejected",
    )
}

private fun shippingUpdate(lsd: LsdContext) {
    lsd.addFact("orderId", "ord-1001")
    lsd.capture {
        "Order events" sends "Orders" label "consume order.shipped" data mapOf(
            "orderId" to "ord-1001",
            "courier" to "Parcelly",
        )
        activate("Orders")
        "Orders" calls "Orders DB" label "mark shipped"
        delay("30 s")
    }
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
