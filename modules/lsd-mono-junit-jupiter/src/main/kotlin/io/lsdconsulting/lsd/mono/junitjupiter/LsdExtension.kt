package io.lsdconsulting.lsd.mono.junitjupiter

import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.LsdScenario
import io.lsdconsulting.lsd.mono.core.domain.ScenarioError
import io.lsdconsulting.lsd.mono.core.domain.Status
import org.junit.jupiter.api.extension.AfterAllCallback
import org.junit.jupiter.api.extension.BeforeEachCallback
import org.junit.jupiter.api.extension.ExtensionContext
import org.junit.jupiter.api.extension.ParameterContext
import org.junit.jupiter.api.extension.ParameterResolutionException
import org.junit.jupiter.api.extension.ParameterResolver
import org.junit.jupiter.api.extension.TestWatcher
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
 * [LsdContext.capture] (or [LsdContext.message]) inside the test, or declare an
 * [LsdScenario] parameter on the test (or its `@BeforeEach`/`@AfterEach` methods) and
 * capture through that: it is the test's own scenario, whichever thread uses it.
 *
 * **Parallel execution.** Safe with `junit.jupiter.execution.parallel.enabled`. Each
 * test gets its own [io.lsdconsulting.lsd.mono.core.LsdScenario], keyed by the test's
 * unique id and bound to the thread that runs it, so `LsdContext.instance.capture`
 * in the test and its `@BeforeEach`/`@AfterEach` methods lands in that test. Each top-level class is its own report, keyed by the class's
 * unique id, so parallel classes do not take each other's scenarios. Work the test
 * hands to other threads should be wrapped with [LsdContext.wrap].
 * The extension keeps no state of its own.
 */
public class LsdExtension : BeforeEachCallback, TestWatcher, AfterAllCallback, ParameterResolver {
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
            Status.WARN,
        )
    }

    override fun testAborted(context: ExtensionContext, cause: Throwable?) {
        scenarioFor(context).complete(
            prefixParentDisplayName(context),
            "Test aborted",
            Status.WARN,
            ScenarioError.of("Test aborted", cause),
        )
    }

    override fun testFailed(context: ExtensionContext, cause: Throwable?) {
        scenarioFor(context).complete(
            prefixParentDisplayName(context),
            "Test failed",
            Status.ERROR,
            ScenarioError.of("Failed", cause),
        )
    }

    /** An [LsdScenario] parameter of a test, `@BeforeEach` or `@AfterEach` method. */
    override fun supportsParameter(parameterContext: ParameterContext, extensionContext: ExtensionContext): Boolean =
        parameterContext.parameter.type == LsdScenario::class.java &&
            parameterContext.declaringExecutable is Method &&
            extensionContext.testMethod.isPresent

    /** The test's own scenario, begun by [beforeEach]. */
    override fun resolveParameter(parameterContext: ParameterContext, extensionContext: ExtensionContext): LsdScenario =
        lsdContext.findScenario(extensionContext.uniqueId)
            ?: throw ParameterResolutionException("No LSD scenario is running for '${extensionContext.displayName}'.")

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
            return parentDisplayName + separator + ownName(context).deCamelCase()
        }
        return ""
    }

    /**
     * The context's display name, without the parameter types JUnit adds to a method's
     * default one (`places an order(LsdScenario)`), so an injected parameter does not
     * change the scenario's title.
     */
    private fun ownName(context: ExtensionContext): String {
        val name = context.displayName
        val method = context.element.orElse(null) as? Method ?: return name
        return if (name.startsWith(method.name + "(") && name.endsWith(")")) method.name else name
    }
}

internal fun String.deCamelCase(): String =
    replace(Pattern.compile("([a-z])([A-Z])").toRegex(), "$1 $2")
        .replace(Pattern.compile("([A-Z])([a-z])").toRegex(), " $1$2")
        .replace("  ", " ")
        .replace(Pattern.compile("[()]").toRegex(), "")
        .trim()
        .lowercase()
