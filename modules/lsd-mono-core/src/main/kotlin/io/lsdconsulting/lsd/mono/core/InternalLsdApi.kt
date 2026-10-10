package io.lsdconsulting.lsd.mono.core

/**
 * Marks API that exists only for lsd-mono's own integrations (JUnit, Cucumber). It can
 * change in any release and is left out of the ABI dump. An integration module opts in
 * once, with the compiler option `-opt-in=io.lsdconsulting.lsd.mono.core.InternalLsdApi`.
 */
@RequiresOptIn(
    message = "Only lsd-mono's own integrations use this. It can change in any release.",
    level = RequiresOptIn.Level.ERROR,
)
@Retention(AnnotationRetention.BINARY)
@Target(AnnotationTarget.CLASS, AnnotationTarget.FUNCTION, AnnotationTarget.PROPERTY)
public annotation class InternalLsdApi
