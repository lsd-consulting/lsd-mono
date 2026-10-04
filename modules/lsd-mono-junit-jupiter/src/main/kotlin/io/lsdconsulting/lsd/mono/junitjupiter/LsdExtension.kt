package io.lsdconsulting.lsd.mono.junitjupiter

import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.domain.ScenarioError
import io.lsdconsulting.lsd.mono.core.domain.Status
import io.lsdconsulting.lsd.mono.core.properties.LsdProperties
import org.junit.jupiter.api.extension.AfterAllCallback
import org.junit.jupiter.api.extension.AfterTestExecutionCallback
import org.junit.jupiter.api.extension.ExtensionContext
import org.junit.jupiter.api.extension.TestWatcher
import org.junit.platform.commons.util.ExceptionUtils
import org.junit.platform.commons.util.StringUtils
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
 */
class LsdExtension : TestWatcher, AfterTestExecutionCallback, AfterAllCallback {

    private val lsdContext: LsdContext = LsdContext.instance

    override fun testSuccessful(context: ExtensionContext) {
        lsdContext.completeScenario(
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
        lsdContext.completeScenario(
            prefixParentDisplayName(context),
            description,
            Status.FAILURE,
        )
    }

    override fun testAborted(context: ExtensionContext, cause: Throwable?) {
        lsdContext.completeScenario(
            prefixParentDisplayName(context),
            "Test aborted",
            Status.FAILURE,
            structuredError(cause, "Test aborted"),
        )
    }

    override fun testFailed(context: ExtensionContext, cause: Throwable?) {
        lsdContext.completeScenario(
            prefixParentDisplayName(context),
            "Test failed",
            Status.ERROR,
            structuredError(cause, "Failed"),
        )
    }

    override fun afterTestExecution(context: ExtensionContext) {
        additionalProcessing(context.requiredTestInstance, LsdPostTestProcessing::class.java)
    }

    override fun afterAll(context: ExtensionContext) {
        if (isNested(context)) {
            return
        }
        lsdContext.completeReport(context.displayName)
        lsdContext.createIndex()
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
            val separator = if (StringUtils.isBlank(parentDisplayName)) "" else ": "
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
        return ExceptionUtils.readStackTrace(cause)
    }

    private fun invokeMethodOn(instance: Any, method: Method) {
        try {
            method.isAccessible = true
            method.invoke(instance)
        } catch (e: IllegalAccessException) {
            throw RuntimeException(e)
        } catch (e: InvocationTargetException) {
            throw RuntimeException(e)
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
