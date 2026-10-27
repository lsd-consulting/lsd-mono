package io.github.lsdconsulting.lsd.mono.cucumber.fixture

import io.cucumber.java8.En
import io.github.lsdconsulting.lsd.mono.jvm.LsdContext
import io.github.lsdconsulting.lsd.mono.jvm.domain.ParticipantType.ACTOR
import io.github.lsdconsulting.lsd.mono.jvm.domain.ParticipantType.PARTICIPANT

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
            lsd.capture {
                "Customer" calls "Checkout" label "POST /orders" data mapOf(
                    "method" to "POST",
                    "path" to "/orders",
                    "status" to 201,
                )
            }
        }

        Then("the order is accepted") {
            lsd.response("Checkout", "Customer", "201 Created")
        }
    }
}
