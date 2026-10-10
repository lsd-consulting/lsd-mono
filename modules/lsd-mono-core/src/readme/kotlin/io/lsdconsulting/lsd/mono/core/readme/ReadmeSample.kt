package io.lsdconsulting.lsd.mono.core.readme

import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.ACTOR
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.DATABASE
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.PARTICIPANT
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.QUEUE

/**
 * Scenario shown in the root README.
 * `:modules:lsd-mono-core:readmeSamples` screenshots the report this writes.
 * Keep the calls in sync with that example.
 */
fun main() {
    val lsd = LsdContext()
    lsd.addParticipants(
        ACTOR.called("Customer"),
        PARTICIPANT.called("Checkout"),
        DATABASE.called("Orders"),
        QUEUE.called("Order events"),
    )
    lsd.addFact("orderId", "ord-1001")
    lsd.capture {
        "Customer" calls "Checkout" label "POST /orders" data mapOf(
            "method" to "POST",
            "path" to "/orders",
            "status" to 201,
            "body" to mapOf("sku" to "SOCK-1", "qty" to 2),
        )
        activate("Checkout")
        "Checkout" calls "Orders" label "insert order"
        "Orders" repliesTo "Checkout" label "row saved"
        "Checkout" sends "Order events" label "order.placed" data mapOf(
            "orderId" to "ord-1001",
            "sku" to "SOCK-1",
        )
        "Checkout" repliesTo "Customer" label "201 Created"
        deactivate("Checkout")
    }
    lsd.completeScenario("Place an order", "Customer checks out two pairs of socks.")
    val listing = lsd.completeReport("Place an order")
    lsd.createIndex()
    println(listing)
}
