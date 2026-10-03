package io.lsdconsulting.lsd.mono.cucumber.readme

import io.cucumber.java8.En
import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.capture.messages
import io.lsdconsulting.lsd.mono.core.capture.withData
import io.lsdconsulting.lsd.mono.core.capture.withLabel
import io.lsdconsulting.lsd.mono.core.capture.withType
import io.lsdconsulting.lsd.mono.core.domain.MessageType
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.ACTOR
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.DATABASE
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.PARTICIPANT
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.QUEUE

/** Step definitions for the README feature. The plugin completes the scenario. */
class PlaceOrderSteps : En {
    init {
        val lsd = LsdContext.instance

        Given("a customer is ready to check out") {
            lsd.addParticipants(
                ACTOR.called("Customer"),
                PARTICIPANT.called("Checkout"),
                DATABASE.called("Orders"),
                QUEUE.called("Order events"),
            )
            lsd.addFact("orderId", "ord-1001")
        }

        When("the customer places an order for socks") {
            lsd.capture(
                "Customer" messages "Checkout" withLabel "POST /orders" withData mapOf(
                    "method" to "POST",
                    "path" to "/orders",
                    "status" to 201,
                    "body" to mapOf("sku" to "SOCK-1", "qty" to 2),
                ),
            )
            lsd.activate("Checkout")
            lsd.capture("Checkout" messages "Orders" withLabel "insert order")
            lsd.response("Orders", "Checkout", "row saved")
            lsd.capture(
                "Checkout" messages "Order events" withLabel "order.placed"
                    withType MessageType.ASYNCHRONOUS withData mapOf(
                        "orderId" to "ord-1001",
                        "sku" to "SOCK-1",
                    ),
            )
        }

        Then("the order is stored and confirmed") {
            lsd.response("Checkout", "Customer", "201 Created")
            lsd.deactivate("Checkout")
        }
    }
}
