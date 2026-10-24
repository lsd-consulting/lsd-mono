package io.lsdconsulting.lsd.mono.springboot

import io.lsdconsulting.lsd.mono.core.InternalLsdApi
import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.LsdScenario
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType
import io.lsdconsulting.lsd.mono.core.domain.ScenarioError
import io.lsdconsulting.lsd.mono.core.domain.Status
import io.lsdconsulting.lsd.mono.springboot.SpringScenarios.guarded
import org.springframework.test.context.TestContext
import java.lang.reflect.AnnotatedElement
import java.util.concurrent.ConcurrentHashMap

/**
 * What [LsdSpringTestListener] does: begins a scenario before each test method, completes it with
 * the test's outcome, and writes the class's report (and `index.html`) after the class.
 *
 * A class that already uses `@ExtendWith(LsdExtension::class)` is left to the extension.
 * (The listener itself is Java: Spring instantiates a Kotlin `spring.factories` entry through
 * kotlin-reflect, which an app's test classpath may not have.)
 */
@InternalLsdApi
public class LsdSpringTestLifecycle {
    public fun beforeTestMethod(testContext: TestContext) {
        if (!enabled(testContext)) return
        guarded(Unit) {
            val lsd = LsdContext.instance
            val key = "spring:${testContext.testClass.name}#${testContext.testMethod.name}@${System.identityHashCode(testContext.testInstance)}"
            lsd.findScenario(key)?.discard()
            val reportKey = reportKey(testContext.testClass)
            val scenario = lsd.beginScenario(reportKey = reportKey, key = key)
            val client =
                testContext.applicationContext.environment.getProperty("lsd.mono.spring.client-name")
                    ?: ParticipantNames.DEFAULT_CLIENT
            lsd.addParticipants(ParticipantType.ACTOR.called(client))
            testContext.setAttribute(ATTRIBUTE, scenario)
            SpringScenarios.started(scenario)
            pending[reportKey] = outerClass(testContext.testClass)
        }
    }

    public fun afterTestMethod(testContext: TestContext) {
        val scenario = testContext.removeAttribute(ATTRIBUTE) as? LsdScenario ?: return
        guarded(Unit) { SpringScenarios.settle(scenario) }
        SpringScenarios.finished(scenario)
        guarded(Unit) {
            val title = "${classTitle(testContext.testClass)}: ${methodTitle(testContext)}"
            val description = "${testContext.testClass.simpleName}.${testContext.testMethod.name}(), drawn by the Spring Boot starter"
            when (val e = testContext.testException) {
                null -> scenario.complete(title, description, Status.SUCCESS)
                else ->
                    if (aborted(e)) {
                        scenario.complete(title, description, Status.WARN, ScenarioError.of("Aborted: ${e.message ?: e.javaClass.simpleName}", e))
                    } else {
                        scenario.complete(title, description, Status.ERROR, ScenarioError.of(e.message ?: e.javaClass.simpleName, e))
                    }
            }
        }
    }

    public fun afterTestClass(testContext: TestContext) {
        val reportKey = reportKey(testContext.testClass)
        // A nested class's scenarios go in its outer class's report, written once that one ends.
        if (testContext.testClass.enclosingClass != null) return
        val outer = pending.remove(reportKey) ?: return
        guarded(Unit) {
            val lsd = LsdContext.instance
            lsd.completeReport(classTitle(outer), reportKey, source = SOURCE)
            lsd.createIndex()
        }
    }

    private fun enabled(testContext: TestContext): Boolean {
        if (usesExtension(testContext.testClass)) return false
        val env = runCatching { testContext.applicationContext.environment }.getOrNull() ?: return false
        return env.getProperty("lsd.mono.spring.enabled", "true").toBoolean()
    }

    private companion object {
        const val ATTRIBUTE = "io.lsdconsulting.lsd.mono.springboot.scenario"

        /** The report source: this is JUnit running the tests, under Spring's TestContext. */
        const val SOURCE = "junit"
        const val EXTENSION = "io.lsdconsulting.lsd.mono.junitjupiter.LsdExtension"

        val pending = ConcurrentHashMap<String, Class<*>>()

        fun outerClass(type: Class<*>): Class<*> = generateSequence(type) { it.enclosingClass }.last()

        fun reportKey(type: Class<*>): String = outerClass(type).name

        fun usesExtension(type: Class<*>): Boolean =
            generateSequence(type) { it.enclosingClass }.any { c ->
                c.annotations.any { a -> mentionsExtension(a) } ||
                    c.annotations.any { a ->
                        a.annotationClass.java.annotations
                            .any(::mentionsExtension)
                    }
            }

        private fun mentionsExtension(annotation: Annotation): Boolean {
            val type = annotation.annotationClass.java
            val values =
                when (type.name) {
                    "org.junit.jupiter.api.extension.ExtendWith" -> type.getMethod("value").invoke(annotation)
                    "org.junit.jupiter.api.extension.Extensions" ->
                        (type.getMethod("value").invoke(annotation) as Array<*>)
                            .flatMap {
                                (
                                    (it as Annotation)
                                        .annotationClass.java
                                        .getMethod("value")
                                        .invoke(it) as Array<*>
                                ).toList()
                            }.toTypedArray()
                    else -> return false
                }
            return (values as Array<*>).any { (it as Class<*>).name == EXTENSION }
        }

        fun aborted(e: Throwable): Boolean = e.javaClass.name == "org.opentest4j.TestAbortedException"

        fun displayName(element: AnnotatedElement): String? =
            element.annotations
                .firstOrNull { it.annotationClass.java.name == "org.junit.jupiter.api.DisplayName" }
                ?.let {
                    it.annotationClass.java
                        .getMethod("value")
                        .invoke(it) as String
                }

        fun classTitle(type: Class<*>): String =
            displayName(type) ?: words(type.simpleName.removeSuffix("Tests").removeSuffix("Test")).ifBlank { type.simpleName }

        fun methodTitle(testContext: TestContext): String =
            displayName(testContext.testMethod) ?: words(testContext.testMethod.name).ifBlank { testContext.testMethod.name }

        /** `placesAnOrder` → `places an order`, `card_is_declined` → `card is declined`. */
        fun words(name: String): String =
            Regex("""\p{Lu}{2,}(?!\p{Ll})|\p{Lu}?\p{Ll}+|\p{N}+""")
                .findAll(name.replace('_', ' '))
                .joinToString(" ") { it.value.lowercase() }
    }
}
