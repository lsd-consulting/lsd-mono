package io.lsdconsulting.lsd.mono.junitjupiter

import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.LsdScenario
import io.lsdconsulting.lsd.mono.core.domain.ScenarioError
import io.lsdconsulting.lsd.mono.core.domain.Status
import io.lsdconsulting.lsd.mono.core.properties.LsdProperties
import org.junit.jupiter.api.extension.AfterAllCallback
import org.junit.jupiter.api.extension.AfterTestExecutionCallback
import org.junit.jupiter.api.extension.BeforeEachCallback
import org.junit.jupiter.api.extension.ExtensionContext
import org.junit.jupiter.api.extension.TestWatcher
import java.lang.reflect.InvocationTargetException
import java.lang.reflect.Method
import java.util.Optional
import java.util.regex.Pattern

/**
 * JUnit Jupiter 6 extension that turns each test into an LSD scenario and writes
 * living sequence diagram reports when the test class finishes.
 *
 * Uses first-party [LsdContext] from `lsd-mono-core` (greenfield), not Maven lsd-core.
 *
 * Failures and aborts are stored as [ScenarioError] (headline, message, stack) on the
 * scenario JSON. Descriptions stay plain text — no legacy `:target` overlay markup.
 *
 * This extension does not capture interaction events by itself. Call
 * [LsdContext.capture] (or [LsdContext.message]) inside the test, and optionally
 * [LsdPostTestProcessing] for late capture before the scenario is completed.
 *
 * **Parallel execution.** Safe with `junit.jupiter.execution.parallel.enabled`. Each
 * test gets its own [io.lsdconsulting.lsd.mono.core.LsdScenario], keyed by the test's
 * unique id and bound to the thread that runs it, so `LsdContext.instance.capture`
 * in the test, its `@BeforeEach`/`@AfterEach` methods and [LsdPostTestProcessing]
 * lands in that test. Each top-level class is its own report, keyed by the class's
 * unique id, so parallel classes do not take each other's scenarios. Work the test
 * hands to other threads should be wrapped with [LsdContext.wrap].
 * The extension keeps no state of its own.
 */
class LsdExtension : BeforeEachCallback, TestWatcher, AfterTestExecutionCallback, AfterAllCallback {
    private val lsdContext: LsdContext = LsdContext.instance

    override fun beforeEach(context: ExtensionContext) {
        lsdContext.findScenario(context.uniqueId)?.discard()
        lsdContext.beginScenario(reportKey = reportKey(context), key = context.uniqueId)
    }

    override fun testSuccessful(context: ExtensionContext) {
        scenarioFor(context).complete(
            prefixParentDisplayName(context),
            "Test passed",
            Status.SUCCESS,
        )
    }

    override fun testDisabled(context: ExtensionContext, reason: Optional<String>) {
        val description =
            reason
                .filter { it.isNotBlank() }
                .map { "Test disabled: $it" }
                .orElse("Test disabled")
        scenarioFor(context).complete(
            prefixParentDisplayName(context),
            description,
            Status.FAILURE,
        )
    }

    override fun testAborted(context: ExtensionContext, cause: Throwable?) {
        scenarioFor(context).complete(
            prefixParentDisplayName(context),
            "Test aborted",
            Status.FAILURE,
            structuredError(cause, "Test aborted"),
        )
    }

    override fun testFailed(context: ExtensionContext, cause: Throwable?) {
        scenarioFor(context).complete(
            prefixParentDisplayName(context),
            "Test failed",
            Status.ERROR,
            structuredError(cause, "Failed"),
        )
    }

    override fun afterTestExecution(context: ExtensionContext) {
        // Bind explicitly in case the body ran elsewhere (for example @Timeout on a separate thread).
        scenarioFor(context).bind().use {
            additionalProcessing(context.requiredTestInstance, LsdPostTestProcessing::class.java)
        }
    }

    override fun afterAll(context: ExtensionContext) {
        if (isNested(context)) {
            return
        }
        lsdContext.completeReport(context.displayName, reportKey(context))
        lsdContext.createIndex()
    }

    /** The test's running scenario. A disabled test never ran beforeEach, so it gets an empty one. */
    private fun scenarioFor(context: ExtensionContext): LsdScenario =
        lsdContext.findScenario(context.uniqueId)
            ?: lsdContext.beginScenario(reportKey = reportKey(context), key = context.uniqueId, bindCurrentThread = false)

    /** The top-level class's unique id: one report per top-level class, nested classes included. */
    private fun reportKey(context: ExtensionContext): String {
        var current = context
        while (true) {
            val parent = current.parent.orElse(null) ?: return current.uniqueId
            if (!parent.parent.isPresent) return current.uniqueId
            current = parent
        }
    }

    private fun isNested(context: ExtensionContext): Boolean =
        context.parent
            .map { it.parent }
            .map { it.isPresent }
            .orElse(false)

    private fun prefixParentDisplayName(context: ExtensionContext): String {
        val parent = context.parent
        if (parent.isPresent) {
            val parentDisplayName = prefixParentDisplayName(parent.get())
            val separator = if (parentDisplayName.isBlank()) "" else ": "
            return parentDisplayName + separator + context.displayName.deCamelCase()
        }
        return ""
    }

    private fun structuredError(cause: Throwable?, headline: String): ScenarioError =
        ScenarioError(
            headline = headline,
            message = cause?.message.orEmpty(),
            stack = readStackTrace(cause),
        )

    private fun additionalProcessing(instance: Any, annotation: Class<out Annotation?>) {
        var klass: Class<*> = instance.javaClass
        while (klass != Any::class.java) {
            klass.declaredMethods
                .filter { method: Method -> method.isAnnotationPresent(annotation) }
                .forEach { method -> invokeMethodOn(instance, method) }
            klass = klass.superclass
        }
    }

    private fun readStackTrace(cause: Throwable?): String {
        if (cause == null || LsdProperties.hideStacktrace()) {
            return "[Displaying the stacktrace was disabled or no cause was provided]"
        }
        return cause.stackTraceToString()
    }

    private fun invokeMethodOn(instance: Any, method: Method) {
        method.isAccessible = true
        try {
            method.invoke(instance)
        } catch (e: InvocationTargetException) {
            // Fail the test with what the @LsdPostTestProcessing method threw, not the reflection wrapper.
            throw e.targetException ?: e
        }
    }
}

internal fun String.deCamelCase(): String =
    replace(Pattern.compile("([a-z])([A-Z])").toRegex(), "$1 $2")
        .replace(Pattern.compile("([A-Z])([a-z])").toRegex(), " $1$2")
        .replace("  ", " ")
        .replace(Pattern.compile("[()]").toRegex(), "")
        .trim()
        .lowercase()
