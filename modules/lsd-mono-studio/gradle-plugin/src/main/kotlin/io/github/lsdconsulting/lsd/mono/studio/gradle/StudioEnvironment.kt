package io.github.lsdconsulting.lsd.mono.studio.gradle

/** Values taken from the environment the plugin and the lsdStudio task run in. */
internal object StudioEnvironment {
    /**
     * Whether this is a CI run, from the `CI` variable: set and neither blank nor `false`.
     * The browser is never opened on CI.
     */
    fun isCi(value: String): Boolean = value.isNotBlank() && value != "false"
}
