@file:JvmName("Lsd")

package io.lsdconsulting.lsd.mono.core

import java.util.function.Consumer

/**
 * Shorthand for `LsdContext.instance.capture { }`. Inside a class that has its own
 * `val lsd`, write `lsd.capture { }` instead: the property hides this function.
 */
@JvmSynthetic
public fun lsd(block: CaptureBlock.() -> Unit): Unit = LsdContext.instance.capture(block)

/** Java form of [lsd]: `Lsd.lsd(c -> c.activate("Orders"))`. */
public fun lsd(block: Consumer<CaptureBlock>): Unit = LsdContext.instance.capture(block)
