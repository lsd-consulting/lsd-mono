package io.github.lsdconsulting.lsd.mono.jvm.domain

/**
 * Scenario outcome, named after the report's status filters. The report JSON writes `success`,
 * `warn`, `error`, `skipped` and `aborted`.
 *
 * The integrations use [SKIPPED] for a test that did not run (a disabled JUnit test, a skipped
 * Cucumber scenario), [ABORTED] for one stopped part way (a failed JUnit assumption), and [WARN]
 * for one that ran but neither passed nor failed, such as a pending or undefined Cucumber step.
 */
public enum class Status {
    /** Failed: an exception or a failed assertion. */
    ERROR,

    /** Ran, but neither passed nor failed: a pending, undefined or ambiguous step, or left open. */
    WARN,

    /** Passed. */
    SUCCESS,

    /** Did not run: disabled or skipped. */
    SKIPPED,

    /** Started, then stopped before it finished, such as by a failed assumption. */
    ABORTED,
}
