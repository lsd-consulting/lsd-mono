package io.lsdconsulting.lsd.mono.core

import java.util.concurrent.Callable
import java.util.function.Consumer

/**
 * The receiver of [LsdContext.report]: one report being built. Its scenarios go into
 * this report whichever thread runs them.
 */
@LsdDsl
public class LsdReport internal constructor(
    private val context: LsdContext,
    public val title: String,
    /** The report key its scenarios carry; unique among the open `report { }` blocks. */
    public val key: String,
) {
    /** [LsdContext.scenario] in this report. Safe to call from other threads. */
    @JvmSynthetic
    public fun <T> scenario(
        title: String,
        description: String = "",
        block: LsdScenario.() -> T,
    ): T = context.scenario(title, description, key, block)

    /** Java form of [scenario]. */
    @JvmOverloads
    public fun scenario(
        title: String,
        description: String = "",
        block: Consumer<LsdScenario>,
    ): Unit = context.scenario(title, description, key, block)

    /** Java form of [scenario] for a block that returns a value. */
    @JvmOverloads
    public fun <T> scenario(
        title: String,
        description: String = "",
        block: Callable<T>,
    ): T = context.scenario(title, description, key, block)

    override fun toString(): String = "LsdReport(title=$title, key=$key)"
}
