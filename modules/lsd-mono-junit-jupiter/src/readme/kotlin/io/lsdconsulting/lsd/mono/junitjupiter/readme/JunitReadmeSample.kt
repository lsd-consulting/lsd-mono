package io.lsdconsulting.lsd.mono.junitjupiter.readme

import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.ACTOR
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.DATABASE
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.PARTICIPANT
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.QUEUE
import io.lsdconsulting.lsd.mono.core.domain.Status

/**
 * Scenario shown in the JUnit module README.
 * `:modules:lsd-mono-junit-jupiter:readmeSamples` screenshots the report this writes.
 *
 * Mirrors what [io.lsdconsulting.lsd.mono.junitjupiter.LsdExtension] does after a
 * passing test: complete the scenario, then write the class report and index.
 * Keep the captures in sync with that README example (labels must stay
 * `POST /orders` so the shared screenshot script can open the inspector).
 */
fun main() {
    val lsd = LsdContext()
    lsd.clear()
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
    // Same titles LsdExtension would use for PlaceOrderTest / `places an order`.
    lsd.completeScenario("PlaceOrderTest: places an order", "Test passed", Status.SUCCESS)
    val listing = lsd.completeReport("PlaceOrderTest")
    lsd.createIndex()
    println(listing)
}
