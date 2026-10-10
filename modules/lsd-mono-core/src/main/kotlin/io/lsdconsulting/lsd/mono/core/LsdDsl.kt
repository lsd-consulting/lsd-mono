package io.lsdconsulting.lsd.mono.core

/**
 * Marks the receivers of lsd-mono's blocks ([Capturer] and its subclasses, [LsdReport]),
 * so a nested block's lambda cannot call an outer block's receiver by accident. Inside
 * `report { scenario { capture { } } }`, `scenario(...)` and `addFact(...)` mean the
 * innermost receiver that has them, or do not compile. Name the outer one to reach it.
 */
@DslMarker
@Target(AnnotationTarget.CLASS)
internal annotation class LsdDsl
