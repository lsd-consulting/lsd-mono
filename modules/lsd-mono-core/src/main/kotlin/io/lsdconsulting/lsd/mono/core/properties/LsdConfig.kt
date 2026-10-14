package io.lsdconsulting.lsd.mono.core.properties

import java.io.IOException
import java.util.Properties
import java.util.concurrent.ConcurrentHashMap

/**
 * Where a property's value comes from, first match wins:
 * 1. the system property;
 * 2. the environment variable, the name in upper case with dots as underscores
 *    (`LSD_MONO_REPORT_OUTPUTDIR`);
 * 3. the configuration source a test integration installed, such as JUnit configuration
 *    parameters (`junit-platform.properties`);
 * 4. `lsd-mono.properties` at the root of the classpath, read once;
 * 5. the key's default.
 */
internal object LsdConfig {
    const val FILE_NAME: String = "lsd-mono.properties"

    private val logger = System.getLogger(LsdConfig::class.java.name)

    @Volatile
    private var configurationSource: ((String) -> String?)? = null

    @Volatile
    private var file: Properties? = null

    private val warned: MutableSet<String> = ConcurrentHashMap.newKeySet()

    /** The value set for [name] in any source, or null. Blank values count as set. */
    fun lookup(name: String): String? =
        System.getProperty(name)
            ?: System.getenv(name.replace('.', '_').uppercase())
            ?: configurationSource?.let { source -> runCatching { source(name) }.getOrNull() }
            ?: file().getProperty(name)

    fun useConfigurationSource(source: ((String) -> String?)?) {
        configurationSource = source
    }

    private fun file(): Properties =
        file ?: load(Thread.currentThread().contextClassLoader ?: LsdConfig::class.java.classLoader).also { file = it }

    /** Read [FILE_NAME] from [loader]; empty when there is none or it cannot be read. */
    fun load(loader: ClassLoader): Properties {
        val properties = Properties()
        val url = loader.getResource(FILE_NAME) ?: return properties
        try {
            url.openStream().use { properties.load(it) }
        } catch (e: IOException) {
            logger.log(System.Logger.Level.WARNING, "LSD: could not read $url, so it is ignored: $e")
        } catch (e: IllegalArgumentException) {
            logger.log(System.Logger.Level.WARNING, "LSD: could not read $url, so it is ignored: $e")
        }
        return properties
    }

    /** Warn about [message] once for each [key] and [value] seen. */
    fun warnOnce(key: String, value: String, message: () -> String) {
        if (warned.add("$key=$value")) logger.log(System.Logger.Level.WARNING, message())
    }

    /** Tests only: use [properties] as the file (or read it again when null), and forget warnings. */
    fun resetForTests(properties: Properties? = null) {
        file = properties
        configurationSource = null
        warned.clear()
    }
}
