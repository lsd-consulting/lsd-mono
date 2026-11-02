package io.github.lsdconsulting.lsd.mono.studio.gradle

/** A Node.js version as `node --version` prints it (`v22.6.0`). */
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

        private val PATTERN = Regex("""v?(\d+)\.(\d+)\.(\d+).*""")

        fun parse(text: String): NodeVersion? =
            PATTERN.matchEntire(text.trim())?.destructured?.let { (major, minor, patch) ->
                NodeVersion(major.toInt(), minor.toInt(), patch.toInt())
            }
    }
}
