package io.lsdconsulting.lsd.mono.cucumber.fixture

import io.cucumber.java8.En
import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.capture.messages
import io.lsdconsulting.lsd.mono.core.capture.withData
import io.lsdconsulting.lsd.mono.core.capture.withLabel
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.ACTOR
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.PARTICIPANT

class PlaceOrderSteps : En {
    init {
        val lsd = LsdContext.instance

        Given("a customer is ready to check out") {
            lsd.addParticipants(
                ACTOR.called("Customer"),
                PARTICIPANT.called("Checkout"),
            )
        }

        When("the customer places an order for socks") {
            lsd.capture(
                "Customer" messages "Checkout" withLabel "POST /orders" withData mapOf(
                    "method" to "POST",
                    "path" to "/orders",
                    "status" to 201,
                ),
            )
        }

        Then("the order is accepted") {
            lsd.response("Checkout", "Customer", "201 Created")
        }
    }
}
