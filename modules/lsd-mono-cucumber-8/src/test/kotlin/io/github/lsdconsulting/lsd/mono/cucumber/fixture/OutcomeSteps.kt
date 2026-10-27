package io.github.lsdconsulting.lsd.mono.cucumber.fixture

import io.cucumber.java8.En
import io.cucumber.java8.HookNoArgsBody
import io.cucumber.java8.PendingException
import io.github.lsdconsulting.lsd.mono.jvm.LsdContext
import org.opentest4j.TestAbortedException

/** Steps for outcomes.feature: one step per Cucumber result, and hooks on `@audited`. */
class OutcomeSteps : En {
    init {
        val lsd = LsdContext.instance

        Before("@audited", HookNoArgsBody { lsd.message("Audit", "Shop", "audit opened") })
        After("@audited", HookNoArgsBody { lsd.message("Audit", "Shop", "audit closed") })

        Given("the shop is open") { lsd.message("Customer", "Shop", "open basket") }
        Then("the basket is checked out") { lsd.message("Customer", "Shop", "check out") }
        When("the card is declined") { throw IllegalStateException("card declined") }
        When("the refund is not written yet") { throw PendingException("refunds come later") }
        When("the payment provider is offline") { throw TestAbortedException("payment provider offline") }
        // Both match "a coupon SAVE10 applies", so that step is ambiguous.
        When("a coupon {word} applies") { _: String -> }
        When("a coupon SAVE10 applies") { }
    }
}
