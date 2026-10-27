package io.github.lsdconsulting.lsd.mono.jvm

import io.github.lsdconsulting.lsd.mono.jvm.properties.LsdProperties

/**
 * Timing settings of one [LsdContext], changed with [LsdContext.configure]. Plain methods that
 * return this config, so they chain the same way from Java and Kotlin. Thread-safe.
 */
public class TimingConfig internal constructor() {
    @Volatile
    private var clockOrdering: ClockOrdering? = null

    /**
     * Clock ordering for scenarios completed from now on. `null` (the default) reads
     * `lsd.mono.timing.orderByStartedAt`, which defaults to [ClockOrdering.SAME_SOURCE].
     */
    public fun orderByStartedAt(mode: ClockOrdering?): TimingConfig = apply { clockOrdering = mode }

    /** The clock ordering set with [orderByStartedAt], or `null` when it comes from config. */
    public fun orderByStartedAt(): ClockOrdering? = clockOrdering

    /** The clock ordering in force: the one set here, else `lsd.mono.timing.orderByStartedAt`. */
    public fun effectiveOrderByStartedAt(): ClockOrdering = clockOrdering ?: LsdProperties.clockOrdering()
}
