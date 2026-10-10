package io.lsdconsulting.lsd.mono.cucumber.readme

import io.cucumber.java8.En
import io.lsdconsulting.lsd.mono.core.LsdContext
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
            }
        }

        Then("the order is stored and confirmed") {
            lsd.capture {
                "Checkout" repliesTo "Customer" label "201 Created"
                deactivate("Checkout")
            }
        }
    }
}
