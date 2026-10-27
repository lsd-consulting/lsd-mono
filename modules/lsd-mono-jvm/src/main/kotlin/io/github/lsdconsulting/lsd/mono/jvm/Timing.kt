package io.github.lsdconsulting.lsd.mono.jvm

import java.time.Duration
import java.time.Instant

/**
 * Trace ids from W3C Trace Context (OpenTelemetry) or B3 propagation, as they were propagated:
 * W3C and OpenTelemetry ids are lowercase hex, 32 characters for [traceId] and 16 for the span
 * ids, and a B3 [traceId] may be 16. [spanId] pairs a reply with its call
 * (`reply.spanId == call.spanId`), and [parentSpanId] nests a call inside another.
 * Optional input from any library that has them; lsd-mono never invents them. The report's trace
 * is frozen at these three ids.
 */
public data class Trace
    @JvmOverloads
    constructor(
        val traceId: String,
        val spanId: String? = null,
        val parentSpanId: String? = null,
    )

/**
 * Timing the caller asserts for one interaction. Every field is optional, and a
 * report with none of them is still a valid structural sketch.
 *
 * @property startedAt the caller's wall clock when it started. Trusted only within one [source].
 * @property durationMs a measured duration, fractional milliseconds. It belongs to the call: on a
 *   reply it is moved to the call it answers.
 * @property source the clock domain (service or JVM id). `null` means `"local"`.
 * @property orderByStartedAt per-interaction hint for clock ordering: `true` opts in (same source
 *   only) even when the report option is [ClockOrdering.OFF], `false` opts out, `null` inherits.
 */
public data class Timing(
    val startedAt: Instant? = null,
    val durationMs: Double? = null,
    val source: String? = null,
    val orderByStartedAt: Boolean? = null,
) {
    init {
        require(durationMs == null || (durationMs >= 0.0 && durationMs.isFinite())) { "durationMs must be finite and >= 0: $durationMs" }
    }

    /** A copy with [orderByStartedAt] set; the Java form of `copy(orderByStartedAt = …)`. */
    public fun withOrderByStartedAt(hint: Boolean?): Timing = copy(orderByStartedAt = hint)

    /** A copy in clock domain [source]. */
    public fun withSource(source: String?): Timing = copy(source = source)

    /** Factories. */
    public companion object {
        /** No timing: the structural sketch. */
        @JvmStatic
        public fun none(): Timing = Timing()

        /** Started at [t]. */
        @JvmStatic
        public fun at(t: Instant): Timing = Timing(startedAt = t)

        /** Took [d], measured. Kept as fractional milliseconds. */
        @JvmStatic
        public fun took(d: Duration): Timing = Timing(durationMs = d.toNanos() / 1_000_000.0)

        /** Took [ms] fractional milliseconds, measured. */
        @JvmStatic
        public fun tookMs(ms: Double): Timing = Timing(durationMs = ms)

        /** Started at [t] and took [d]. */
        @JvmStatic
        public fun of(
            t: Instant,
            d: Duration,
        ): Timing = Timing(startedAt = t, durationMs = d.toNanos() / 1_000_000.0)

        internal const val LOCAL: String = "local"
    }
}

/** How an interaction's timing is known. Never raised by clock ordering. */
public enum class TimingSource {
    /** No duration and no `startedAt`. `capturedAt` alone does not count. */
    NONE,

    /** `startedAt` only. */
    TIMESTAMPED,

    /** A measured duration: given by the caller, or timed by lsd-mono between `call()` and `reply()`. */
    MEASURED,

    /** Computed as `reply.startedAt − call.startedAt` in one source. Never shown as measured. */
    DERIVED,
}

/** How a call was paired with its reply. */
public enum class PairingSource {
    /** No reply was found. */
    NONE,

    /** Matched by the direction heuristic. */
    GUESSED,

    /** Matched by `callId`/`replyTo`. */
    CALL_ID,

    /** Matched by span id. */
    TRACE,
}

/** A scenario's timing accuracy, derived from its interactions. */
public enum class Accuracy {
    /** No timing at all. */
    STRUCTURE_ONLY,

    /** Timestamps, but nothing measured. */
    TIMESTAMPED,

    /** At least one measured call. */
    MEASURED,

    /** Measured, and every call paired by call id or span id. */
    TRACED,
}

/**
 * Whether events with no measured duration may be reordered by their `startedAt`.
 * Config key `lsd.mono.timing.orderByStartedAt`: `false`, `source` (default, also `true`) or `all`.
 */
public enum class ClockOrdering {
    /** Timestamps are advisory; order is capture order and structure only. */
    OFF,

    /** Reorder among events of the same source, under the same parent call. The default. */
    SAME_SOURCE,

    /** Also compare events from different sources. Opt-in. */
    ALL_SOURCES,
}

/** Why a message sits where it does in the report. */
public enum class OrderSource {
    /** Capture order. */
    SEQUENCE,

    /** Pairing or trace nesting. */
    STRUCTURE,

    /** Moved by clock ordering. */
    CLOCK,
}

/**
 * The id of a captured call or published message: pass it as `replyTo` or `causedBy` to link a
 * reply or a consume to it. [callId] is the id the caller gave, or else the event's own id,
 * which is known once the event is captured.
 */
public class CallRef internal constructor(
    @Volatile internal var id: String?,
) {
    /** The id, or `""` when the capture failed. */
    public val callId: String get() = id.orEmpty()

    override fun toString(): String = "CallRef($callId)"

    /** Wraps an id another library supplied. */
    public companion object {
        /** A reference to [callId], an id supplied by another library. */
        @JvmStatic
        public fun of(callId: String): CallRef = CallRef(callId)
    }
}
