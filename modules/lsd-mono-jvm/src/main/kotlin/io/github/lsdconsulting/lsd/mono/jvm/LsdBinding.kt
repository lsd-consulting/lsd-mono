package io.github.lsdconsulting.lsd.mono.jvm

/**
 * A thread's binding to a scenario, from [LsdScenario.bind]. [close] restores whatever the
 * thread was bound to before. Its `close()` throws nothing, so Java's try-with-resources
 * needs no `catch`:
 *
 * ```java
 * try (LsdBinding bound = scenario.bind()) {
 *     lsd.message("Worker", "Db", "select");
 * }
 * ```
 *
 * Close it on the thread that bound it. Closing it again does nothing.
 */
public class LsdBinding internal constructor(
    private val restore: () -> Unit,
) : AutoCloseable {
    private var closed = false

    /** Restore the thread's previous binding. */
    override fun close() {
        if (closed) return
        closed = true
        restore()
    }
}
