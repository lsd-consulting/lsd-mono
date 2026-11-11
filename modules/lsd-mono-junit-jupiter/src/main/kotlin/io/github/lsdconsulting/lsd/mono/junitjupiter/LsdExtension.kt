package io.github.lsdconsulting.lsd.mono.junitjupiter

import io.github.lsdconsulting.lsd.mono.jvm.LsdContext
import io.github.lsdconsulting.lsd.mono.jvm.LsdScenario
import io.github.lsdconsulting.lsd.mono.jvm.domain.ScenarioError
import io.github.lsdconsulting.lsd.mono.jvm.domain.Status
import io.github.lsdconsulting.lsd.mono.jvm.properties.LsdProperties
import org.junit.jupiter.api.TestFactory
import org.junit.jupiter.api.extension.AfterAllCallback
import org.junit.jupiter.api.extension.BeforeAllCallback
import org.junit.jupiter.api.extension.BeforeEachCallback
import org.junit.jupiter.api.extension.DynamicTestInvocationContext
import org.junit.jupiter.api.extension.ExtensionContext
import org.junit.jupiter.api.extension.InvocationInterceptor
import org.junit.jupiter.api.extension.ParameterContext
import org.junit.jupiter.api.extension.ParameterResolutionException
import org.junit.jupiter.api.extension.ParameterResolver
import org.junit.jupiter.api.extension.TestWatcher
import org.opentest4j.TestAbortedException
import java.lang.reflect.Method
import java.util.Optional

/**
 * JUnit Jupiter 6 extension that turns each test into an LSD scenario and writes
 * living sequence diagram reports when the test class finishes.
 *
 * Uses first-party [LsdContext] from `lsd-mono-jvm` (greenfield), not Maven lsd-core.
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
 * test gets its own [io.github.lsdconsulting.lsd.mono.jvm.LsdScenario], keyed by the test's
 * unique id and bound to the thread that runs it, so `LsdContext.instance.capture`
 * in the test and its `@BeforeEach`/`@AfterEach` methods lands in that test. Each top-level class is its own report, keyed by the class's
 * unique id, so parallel classes do not take each other's scenarios. Work the test
 * hands to other threads should be wrapped with [LsdContext.wrap].
 * The extension keeps no state of its own.
 *
 * **Configuration.** Every `lsd.mono.*` property can also be set as a JUnit configuration
 * parameter, for example in `src/test/resources/junit-platform.properties`. These come after
 * system properties and environment variables, and before `lsd-mono.properties`.
 */
public class LsdExtension : BeforeAllCallback, BeforeEachCallback, InvocationInterceptor, TestWatcher, AfterAllCallback, ParameterResolver {
    private val lsdContext: LsdContext = LsdContext.instance

    override fun beforeAll(context: ExtensionContext) {
        useConfigurationParameters(context)
    }

    @OptIn(io.github.lsdconsulting.lsd.mono.jvm.InternalLsdApi::class)
    override fun beforeEach(context: ExtensionContext) {
        useConfigurationParameters(context)
        lsdContext.findScenario(context.uniqueId)?.discard()
        lsdContext.reportTitle(reportKey(context), reportContext(context).displayName)
        // Dynamic tests are completed from interceptDynamicTest; beginning a factory scenario here
        // would leave it running as Warn. @BeforeAll captures stay on the default scenario until
        // the first real test (a child or an ordinary @Test) begins.
        if (isTestFactory(context)) return
        val scenario = lsdContext.beginScenario(reportKey = reportKey(context), key = context.uniqueId)
        lsdContext.scenarioTitle(scenario, prefixParentDisplayName(context))
    }

    /**
     * Jupiter does not call [TestWatcher] for `@TestFactory` methods or their dynamic children.
     * Each child's executable runs here, so outcomes and captures belong to that child.
     */
    @OptIn(io.github.lsdconsulting.lsd.mono.jvm.InternalLsdApi::class)
    override fun interceptDynamicTest(
        invocation: InvocationInterceptor.Invocation<Void?>,
        @Suppress("UNUSED_PARAMETER") invocationContext: DynamicTestInvocationContext,
        extensionContext: ExtensionContext,
    ) {
        useConfigurationParameters(extensionContext)
        lsdContext.findScenario(extensionContext.uniqueId)?.discard()
        val scenario =
            lsdContext.beginScenario(reportKey = reportKey(extensionContext), key = extensionContext.uniqueId)
        val title = prefixParentDisplayName(extensionContext)
        lsdContext.scenarioTitle(scenario, title)
        try {
            invocation.proceed()
            scenario.complete(title, "Test passed", Status.SUCCESS)
        } catch (e: TestAbortedException) {
            scenario.complete(title, "Test aborted", Status.ABORTED, ScenarioError.of("Test aborted", e))
            throw e
        } catch (e: Throwable) {
            scenario.complete(title, "Test failed", Status.ERROR, ScenarioError.of("Failed", e))
            throw e
        }
    }

    override fun testSuccessful(context: ExtensionContext) {
        finish(context, "Test passed", Status.SUCCESS)
    }

    override fun testDisabled(context: ExtensionContext, reason: Optional<String>) {
        val description =
            reason
                .filter { it.isNotBlank() }
                .map { "Test disabled: $it" }
                .orElse("Test disabled")
        finish(context, description, Status.SKIPPED)
    }

    override fun testAborted(context: ExtensionContext, cause: Throwable?) {
        finish(context, "Test aborted", Status.ABORTED, ScenarioError.of("Test aborted", cause))
    }

    override fun testFailed(context: ExtensionContext, cause: Throwable?) {
        finish(context, "Test failed", Status.ERROR, ScenarioError.of("Failed", cause))
    }

    /** Completes the test's scenario, with the test method's source as its last fact (#72). */
    private fun finish(context: ExtensionContext, description: String, status: Status, error: ScenarioError? = null) {
        val scenario = scenarioFor(context)
        testSource(context)?.let { scenario.addFact(TestSource.FACT_KEY, it) }
        scenario.complete(prefixParentDisplayName(context), description, status, error)
    }

    /**
     * The test method's source, unless `lsd.mono.junit.showSource` is false or it cannot be found. Never
     * throws. A dynamic test has no method of its own and gets none.
     */
    @OptIn(io.github.lsdconsulting.lsd.mono.jvm.InternalLsdApi::class)
    private fun testSource(context: ExtensionContext): String? =
        runCatching {
            if (!LsdProperties.junitShowSource()) return null
            val method = context.testMethod.orElse(null) ?: return null
            TestSource.of(method.declaringClass, method, LsdProperties.junitSourceRoots())
        }.getOrNull()

    /** An [LsdScenario] parameter of a test, `@BeforeEach` or `@AfterEach` method. */
    override fun supportsParameter(parameterContext: ParameterContext, extensionContext: ExtensionContext): Boolean =
        parameterContext.parameter.type == LsdScenario::class.java &&
            parameterContext.declaringExecutable is Method &&
            extensionContext.testMethod.isPresent

    /** The test's own scenario, begun by [beforeEach]. */
    override fun resolveParameter(parameterContext: ParameterContext, extensionContext: ExtensionContext): LsdScenario =
        lsdContext.findScenario(extensionContext.uniqueId)
            ?: throw ParameterResolutionException("No LSD scenario is running for '${extensionContext.displayName}'.")

    @OptIn(io.github.lsdconsulting.lsd.mono.jvm.InternalLsdApi::class)
    override fun afterAll(context: ExtensionContext) {
        if (isNested(context)) {
            return
        }
        lsdContext.completeReport(context.displayName, reportKey(context), source = "junit")
        lsdContext.createIndex()
    }

    /** Read `lsd.mono.*` keys from this run's JUnit configuration parameters too. */
    @OptIn(io.github.lsdconsulting.lsd.mono.jvm.InternalLsdApi::class)
    private fun useConfigurationParameters(context: ExtensionContext) {
        val root = context.root
        LsdProperties.useConfigurationSource { key -> root.getConfigurationParameter(key).orElse(null) }
    }

    private fun isTestFactory(context: ExtensionContext): Boolean =
        context.testMethod.map { it.isAnnotationPresent(TestFactory::class.java) }.orElse(false)

    /** The test's running scenario. A disabled test never ran beforeEach, so it gets an empty one. */
    private fun scenarioFor(context: ExtensionContext): LsdScenario =
        lsdContext.findScenario(context.uniqueId)
            ?: lsdContext.beginScenario(reportKey = reportKey(context), key = context.uniqueId, bindCurrentThread = false)

    /** The top-level class's unique id: one report per top-level class, nested classes included. */
    private fun reportKey(context: ExtensionContext): String = reportContext(context).uniqueId

    /** The top-level class's context, whose display name titles the report. */
    private fun reportContext(context: ExtensionContext): ExtensionContext {
        var current = context
        while (true) {
            val parent = current.parent.orElse(null) ?: return current
            if (!parent.parent.isPresent) return current
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
            return parentDisplayName + separator + titlePart(context)
        }
        return ""
    }

    /**
     * The context's part of the scenario title. JUnit's default name for a method or class (a
     * camelCase identifier) is split into lower-case words; the parameter types JUnit adds to a
     * method's default name (`placesAnOrder(LsdScenario)`) are left out, so an injected parameter
     * does not change the title. A name someone wrote (`@DisplayName`, a backticked Kotlin name, a
     * display name generator, a parameterised invocation) is kept as written.
     */
    private fun titlePart(context: ExtensionContext): String {
        val name = context.displayName
        val default =
            when (val element = context.element.orElse(null)) {
                is Method ->
                    element.name.takeIf { name == it || (name.startsWith("$it(") && name.endsWith(")")) }
                is Class<*> -> element.simpleName.takeIf { name == it }
                else -> null
            }
        return default?.deCamelCase() ?: name.trim()
    }
}

private val identifier = Regex("""[\p{L}_$][\p{L}\p{N}_$]*""")

/**
 * A word of a camelCase or snake_case name: an acronym with a plural s (`URLs`), an acronym
 * (`HTTP` in `parseHTTPResponse`), a capitalised or lower-case word, or a number; digits stay on
 * the word before them (`test1`, `retry3 times`), as they always have.
 */
private val word = Regex("""(?:\p{Lu}{2,}s(?!\p{Ll})|\p{Lu}+(?!\p{Ll})|\p{Lu}?\p{Ll}+|\p{N}+)\p{N}*""")

/**
 * `placesAnOrder` as `places an order`. Only an identifier is split: text with spaces,
 * brackets or other punctuation is returned as written, trimmed.
 */
internal fun String.deCamelCase(): String {
    val name = trim()
    if (!identifier.matches(name)) return name
    val words = word.findAll(name).map { it.value.lowercase() }.toList()
    return if (words.isEmpty()) name else words.joinToString(" ")
}
