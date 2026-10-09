package io.lsdconsulting.lsd.mono.cucumber.fixture

import io.cucumber.java8.En
import io.lsdconsulting.lsd.mono.core.LsdContext
import java.util.concurrent.atomic.AtomicInteger

/** Steps for the parallel features: one fact, then messages tagged with the scenario's name. */
class ParallelSteps : En {
    init {
        val lsd = LsdContext.instance

        Given("the scenario {string}") { tag: String ->
            lsd.addFact("scenario", tag)
        }

        When("{string} sends {int} messages") { tag: String, count: Int ->
            val now = inFlight.incrementAndGet()
            maxInFlight.accumulateAndGet(now) { a, b -> maxOf(a, b) }
            try {
                repeat(count) { i ->
                    lsd.message("Client $tag", "Service", "$tag-$i")
                    Thread.sleep(1)
                }
            } finally {
                inFlight.decrementAndGet()
            }
        }
    }

    companion object {
        private val inFlight = AtomicInteger()
        val maxInFlight = AtomicInteger()
    }
}
