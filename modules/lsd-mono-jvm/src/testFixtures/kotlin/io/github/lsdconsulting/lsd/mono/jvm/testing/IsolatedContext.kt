package io.github.lsdconsulting.lsd.mono.jvm.testing

import io.github.lsdconsulting.lsd.mono.jvm.LsdContext

/** A context of its own, for tests in other modules: [LsdContext]'s constructor is internal. */
public fun isolatedLsdContext(): LsdContext = LsdContext()
