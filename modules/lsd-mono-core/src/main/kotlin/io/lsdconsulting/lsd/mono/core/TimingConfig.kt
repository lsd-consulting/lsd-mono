package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.properties.LsdProperties

/**
 * Timing settings of one [LsdContext], changed with [LsdContext.configure]. Plain methods that
 * return this config, so they chain the same way from Java and Kotlin. Thread-safe.
 */
public class TimingConfig internal constructor() {
    @Volatile
    private var clockOrdering: ClockOrdering? = null

    /**
     * Clock ordering for scenarios completed from now on. `null` (the default) reads
     * `lsd.mono.timing.orderByCreatedAt`, which defaults to [ClockOrdering.SAME_SOURCE].
     */
    public fun orderByCreatedAt(mode: ClockOrdering?): TimingConfig = apply { clockOrdering = mode }

    /** The clock ordering set with [orderByCreatedAt], or `null` when it comes from config. */
    public fun orderByCreatedAt(): ClockOrdering? = clockOrdering

    /** The clock ordering in force: the one set here, else `lsd.mono.timing.orderByCreatedAt`. */
    public fun effectiveOrderByCreatedAt(): ClockOrdering = clockOrdering ?: LsdProperties.clockOrdering()
}
