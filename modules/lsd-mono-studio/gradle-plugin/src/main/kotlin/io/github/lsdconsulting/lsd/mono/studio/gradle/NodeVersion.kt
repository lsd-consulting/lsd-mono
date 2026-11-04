package io.github.lsdconsulting.lsd.mono.studio.gradle

/**
 * A Node.js version as `node --version` prints it (`v22.6.0`, or `22.6.0`). [parse] tolerates banner
 * lines around it. A pre-release or build suffix is dropped, so `v22.6.0-rc.1` counts as 22.6.0.
 */
internal data class NodeVersion(
    val major: Int,
    val minor: Int,
    val patch: Int,
) : Comparable<NodeVersion> {
    override fun compareTo(other: NodeVersion): Int = compareValuesBy(this, other, NodeVersion::major, NodeVersion::minor, NodeVersion::patch)

    override fun toString(): String = "v$major.$minor.$patch"

    companion object {
        /** lsd-mono-studio's `engines.node`. */
        val MINIMUM = NodeVersion(22, 6, 0)

        /**
         * The first line that is a version and nothing else, with an optional pre-release or build
         * suffix, so a banner line such as `127.0.0.1:9229 …` never counts. At most nine digits a
         * part, so a number always fits an Int.
         */
        private val PATTERN = Regex("""(?m)^\s*v?(\d{1,9})\.(\d{1,9})\.(\d{1,9})(?:[-+][0-9A-Za-z.-]+)?\s*$""")

        fun parse(text: String): NodeVersion? =
            PATTERN.find(text)?.destructured?.let { (major, minor, patch) ->
                NodeVersion(major.toInt(), minor.toInt(), patch.toInt())
            }
    }
}
