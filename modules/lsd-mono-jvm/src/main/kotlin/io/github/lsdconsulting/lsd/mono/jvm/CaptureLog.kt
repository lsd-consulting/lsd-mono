package io.github.lsdconsulting.lsd.mono.jvm

import java.lang.System.Logger.Level.DEBUG
import java.lang.System.Logger.Level.WARNING

/**
 * The warnings capture and report writing log. They go to the [LsdContext] logger, so log
 * configuration for that name covers all of them. Each says what was lost and how to avoid it.
 */
internal object CaptureLog {
    private val logger = System.getLogger(LsdContext::class.java.name)

    /** A capture of [kind] failed inside the application; [first] is the first of that kind. */
    fun dropped(
        kind: String,
        failure: Throwable,
        first: Boolean,
    ) {
        logger.log(
            if (first) WARNING else DEBUG,
            "LSD: capture failed and was dropped ($kind): $failure. The application carried on; the report " +
                "is missing it." + if (first) " Further failures of this kind are logged at DEBUG." else "",
            failure,
        )
    }

    fun stillRunning(
        report: String,
        running: List<LsdScenario>,
    ) {
        logger.log(
            WARNING,
            "LSD: report '$report' is being written while ${running.size} of its scenario(s) are still running " +
                "(keys: ${running.joinToString { "'${it.key}'" }}). They are completed now with status WARN. " +
                "Complete or discard each scenario before completeReport.",
        )
    }

    fun strayCaptures(
        report: String,
        events: Int,
        facts: Int,
    ) {
        logger.log(
            WARNING,
            "LSD: report '$report' dropped $events event(s) and $facts fact(s) captured outside " +
                "any scenario. Capture inside a test, or call completeScenario before completeReport.",
        )
    }

    fun unreplied(
        scenario: String,
        calls: List<PendingCall>,
    ) {
        if (calls.isEmpty()) return
        logger.log(
            WARNING,
            "LSD: scenario '$scenario' completed with ${calls.size} call(s) still waiting for a reply: " +
                calls.joinToString { it.describe() } + ". Reply before the test ends; a later reply is dropped.",
        )
    }

    fun doubleReply(call: String) {
        logger.log(WARNING, "LSD: ignored a second reply to the call $call. Only the first reply or fail counts.")
    }

    fun late(
        scenario: LsdScenario,
        what: String,
    ) {
        logger.log(
            WARNING,
            "LSD: dropped a $what captured after scenario '${scenario.key}' finished. " +
                "Capture before the test ends, or wait for background work first.",
        )
    }

    fun unattributed(running: Int) {
        logger.log(
            WARNING,
            "LSD: captured on thread '${Thread.currentThread().name}', which is not bound to a scenario, " +
                "while $running scenarios are running in parallel. It cannot be attributed and goes to " +
                "the default scenario. Use LsdScenario.bind() or LsdContext.wrap() on threads you start.",
        )
    }
}
