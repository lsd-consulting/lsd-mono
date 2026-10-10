package io.lsdconsulting.lsd.mono.junitjupiter

/**
 * Marks a no-arg method that [LsdExtension] should invoke after each test has run
 * but before the scenario sequence diagram is completed.
 *
 * Useful for capturing extra interactions or facts on
 * [io.lsdconsulting.lsd.mono.core.LsdContext] after the test body finishes.
 */
@Retention(AnnotationRetention.RUNTIME)
@Target(AnnotationTarget.FUNCTION, AnnotationTarget.PROPERTY_GETTER, AnnotationTarget.PROPERTY_SETTER)
public annotation class LsdPostTestProcessing
