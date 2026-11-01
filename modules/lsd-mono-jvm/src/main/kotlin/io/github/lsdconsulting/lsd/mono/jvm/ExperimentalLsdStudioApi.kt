package io.github.lsdconsulting.lsd.mono.jvm

/**
 * Marks API for streaming captures to LSD Studio while tests run (the live capture protocol, v0).
 * It follows the protocol and can change in any release until the protocol reaches 1.0. Opt in with
 * `@OptIn(ExperimentalLsdStudioApi::class)` or `-opt-in=io.github.lsdconsulting.lsd.mono.jvm.ExperimentalLsdStudioApi`.
 */
@RequiresOptIn(
    message = "Live capture to LSD Studio is experimental: it follows protocol v0 and can change in any release.",
    level = RequiresOptIn.Level.WARNING,
)
// RUNTIME rather than BINARY, so ExperimentalStudioApiGuardTest can check what carries it.
@Retention(AnnotationRetention.RUNTIME)
@Target(AnnotationTarget.CLASS, AnnotationTarget.FUNCTION, AnnotationTarget.PROPERTY)
public annotation class ExperimentalLsdStudioApi
