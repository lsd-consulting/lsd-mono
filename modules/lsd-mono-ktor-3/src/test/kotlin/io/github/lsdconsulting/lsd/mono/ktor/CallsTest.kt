package io.github.lsdconsulting.lsd.mono.ktor

import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Test
import java.io.IOException
import kotlin.coroutines.cancellation.CancellationException

/** The failure a caller sees, read through the cancellations that carry it. */
class CallsTest {
    @Test
    fun `the cause is the first one that is not a cancellation, not the last`() {
        val root = IOException("socket closed")
        val first = IllegalStateException("timed out", root)
        val cancelled = CancellationException("cancelled").apply { initCause(first) }

        assertSame(first, Calls.cause(cancelled))
    }

    @Test
    fun `a failure that is not a cancellation is its own cause`() {
        val e = IllegalStateException("boom", IOException("under"))

        assertSame(e, Calls.cause(e))
    }

    @Test
    fun `a cancellation with no other cause is itself`() {
        val e = CancellationException("gone")

        assertSame(e, Calls.cause(e))
    }
}
