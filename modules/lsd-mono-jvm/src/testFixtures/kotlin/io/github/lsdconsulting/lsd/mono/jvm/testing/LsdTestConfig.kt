package io.github.lsdconsulting.lsd.mono.jvm.testing

import io.github.lsdconsulting.lsd.mono.jvm.properties.LsdConfig
import io.github.lsdconsulting.lsd.mono.jvm.properties.LsdProperties
import org.junit.jupiter.api.extension.AfterAllCallback
import org.junit.jupiter.api.extension.AfterEachCallback
import org.junit.jupiter.api.extension.BeforeAllCallback
import org.junit.jupiter.api.extension.BeforeEachCallback
import org.junit.jupiter.api.extension.ExtendWith
import org.junit.jupiter.api.extension.ExtensionContext
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.nio.file.Files
import java.nio.file.Path

/**
 * LSD configuration for one test class, put back exactly afterwards (#74).
 *
 * Before each test it takes a snapshot of every `lsd.*` (and `cucumber.*`) system property, points
 * [LsdProperties.OUTPUT_DIR] at the test's `@TempDir` field (or a temp dir of its own, deleted
 * afterwards), sets [LsdProperties.DETERMINISTIC_IDS] when [deterministicIds] is true, and resets
 * [LsdConfig]. After each test it puts the snapshot back: the values that were set, and no value
 * for keys that were unset. So a test may set any property it needs and leave it.
 *
 * After the class, it fails if a property differs from what it was when the first class using
 * this started, which catches a test that changes one outside a test method.
 */
@Target(AnnotationTarget.CLASS)
@Retention(AnnotationRetention.RUNTIME)
@ExtendWith(LsdTestConfigExtension::class)
annotation class LsdTestConfig(
    /** Number ids 1, 2, 3… instead of random ones. */
    val deterministicIds: Boolean = false,
)

class LsdTestConfigExtension :
    BeforeAllCallback,
    BeforeEachCallback,
    AfterEachCallback,
    AfterAllCallback {
    override fun beforeAll(context: ExtensionContext) {
        // Only the outermost class: a @Nested class shares its tests' snapshots.
        if (!isTopLevel(context)) return
        val drift = differences(START, snapshot())
        check(drift.isEmpty()) { "LSD system properties changed before ${context.displayName} started: $drift" }
    }

    override fun beforeEach(context: ExtensionContext) {
        val store = context.getStore(NAMESPACE)
        store.put(SAVED, snapshot())
        val outputDir =
            tempDirOf(context)
                ?: Files.createTempDirectory("lsd-test").also { store.put(OWN_DIR, it) }
        System.setProperty(LsdProperties.OUTPUT_DIR, outputDir.toString())
        if (config(context)?.deterministicIds == true) System.setProperty(LsdProperties.DETERMINISTIC_IDS, "true")
        LsdConfig.resetForTests()
    }

    override fun afterEach(context: ExtensionContext) {
        val store = context.getStore(NAMESPACE)
        @Suppress("UNCHECKED_CAST")
        restore(store.get(SAVED) as Map<String, String>)
        LsdConfig.resetForTests()
        (store.remove(OWN_DIR) as Path?)?.toFile()?.deleteRecursively()
    }

    override fun afterAll(context: ExtensionContext) {
        if (!isTopLevel(context)) return
        val drift = differences(START, snapshot())
        if (drift.isEmpty()) return
        restore(START)
        LsdConfig.resetForTests()
        throw AssertionError("${context.displayName} left LSD system properties changed: $drift")
    }

    companion object {
        private val NAMESPACE = ExtensionContext.Namespace.create(LsdTestConfigExtension::class.java)
        private const val SAVED = "saved"
        private const val OWN_DIR = "ownDir"
        private val PREFIXES = listOf("lsd.", "cucumber.")

        /** The properties when the first class using [LsdTestConfig] loaded: Gradle's `systemProperty` lines. */
        private val START: Map<String, String> = snapshot()

        /** Every `lsd.*` and `cucumber.*` system property, by key. */
        fun snapshot(): Map<String, String> =
            System
                .getProperties()
                .stringPropertyNames()
                .filter { key -> PREFIXES.any { key.startsWith(it) } }
                .associateWith { System.getProperty(it) }

        /** Put [saved] back: its values, and no value for any other `lsd.*` or `cucumber.*` key. */
        fun restore(saved: Map<String, String>) {
            (snapshot().keys - saved.keys).forEach { System.clearProperty(it) }
            saved.forEach { (key, value) -> System.setProperty(key, value) }
        }

        private fun differences(
            before: Map<String, String>,
            after: Map<String, String>,
        ): List<String> =
            (before.keys + after.keys).sorted().mapNotNull { key ->
                val was = before[key]
                val now = after[key]
                if (was == now) null else "$key: ${was ?: "(unset)"} -> ${now ?: "(unset)"}"
            }

        private fun isTopLevel(context: ExtensionContext): Boolean =
            context.parent.map { !it.parent.isPresent }.orElse(false)

        private fun config(context: ExtensionContext): LsdTestConfig? =
            generateSequence(context.testClass.orElse(null)) { it.enclosingClass }
                .firstNotNullOfOrNull { it.getAnnotation(LsdTestConfig::class.java) }

        /** The value of a `@TempDir` field on the test instance or an enclosing one, once JUnit has set it. */
        private fun tempDirOf(context: ExtensionContext): Path? =
            context.requiredTestInstances.allInstances.reversed().firstNotNullOfOrNull { instance ->
                generateSequence<Class<*>>(instance.javaClass) { it.superclass }
                    .flatMap { it.declaredFields.asSequence() }
                    .filter { it.isAnnotationPresent(TempDir::class.java) }
                    .firstNotNullOfOrNull { field ->
                        field.isAccessible = true
                        when (val value = field.get(instance)) {
                            is Path -> value
                            is File -> value.toPath()
                            else -> null
                        }
                    }
            }
    }
}
