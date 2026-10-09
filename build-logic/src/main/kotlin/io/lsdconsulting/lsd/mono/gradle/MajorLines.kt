package io.lsdconsulting.lsd.mono.gradle

/**
 * Dependency families a module may only use at one major version, plus coordinates
 * it must never resolve.
 *
 * The exact version comes from `gradle/libs.versions.toml` (Renovate keeps it inside
 * the major). This only guards the major. When a family's next major arrives, add a
 * new module for it instead of moving the pin.
 *
 * Open so Gradle can register it as the `majorLines` project extension.
 */
open class MajorLines {
    private data class Line(
        val name: String,
        val major: Int,
        val groups: Set<String>,
        val modules: Set<String>,
    ) {
        fun covers(group: String, module: String): Boolean =
            group in groups && (modules.isEmpty() || module in modules)
    }

    private data class Ban(val group: String, val module: String?, val reason: String) {
        fun covers(group: String, module: String): Boolean =
            group == this.group && (this.module == null || this.module == module)
    }

    private val lines = mutableListOf<Line>()
    private val bans = mutableListOf<Ban>()

    /**
     * @param modules limit the pin to these artifacts. Empty means every artifact in [groups].
     * Use it when a group also carries artifacts on their own version line.
     */
    @JvmOverloads
    fun pin(name: String, major: Int, groups: Collection<String>, modules: Collection<String> = emptyList()) {
        lines += Line(name, major, groups.toSet(), modules.toSet())
    }

    /** @param module null bans the whole [group]. */
    @JvmOverloads
    fun ban(group: String, reason: String, module: String? = null) {
        bans += Ban(group, module, reason)
    }

    /** @return why this candidate is not allowed, or null when it is. */
    fun problem(group: String, module: String, version: String): String? {
        bans.firstOrNull { it.covers(group, module) }?.let {
            return "blocked $group:$module:$version; ${it.reason}"
        }
        val line = lines.firstOrNull { it.covers(group, module) } ?: return null
        val major = version.substringBefore('.').toIntOrNull()
        if (major == line.major) {
            return null
        }
        return "$group:$module:$version is outside the ${line.name} line (${line.major}.x). " +
            "A new major needs a new module; do not move this pin."
    }
}
