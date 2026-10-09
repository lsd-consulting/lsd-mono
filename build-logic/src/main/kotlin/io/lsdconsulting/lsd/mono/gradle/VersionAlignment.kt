package io.lsdconsulting.lsd.mono.gradle

/**
 * Train version lives on the root project. A module matches it, or a recorded
 * patch / solo-major in gradle/version-overrides.properties.
 */
object VersionAlignment {
    const val OVERRIDES_PATH = "gradle/version-overrides.properties"
    const val CORE_PATH = ":modules:lsd-mono-core"

    enum class Kind(val wire: String) {
        PATCH("patch"),
        SOLO_MAJOR("solo-major"),
    }

    data class SemVer(val major: Int, val minor: Int, val patch: Int, val qualifier: String?)

    data class VersionOverride(val kind: Kind, val version: String, val trainMajor: Int?)

    private val semver = Regex("""^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z][0-9A-Za-z.-]*))?$""")
    private val entry = Regex(
        """^(patch|solo-major):(\S+)(?:\s+train-major:(\d+))?$""",
    )

    fun parse(text: String): Map<String, VersionOverride> {
        val out = linkedMapOf<String, VersionOverride>()
        text.lineSequence().forEachIndexed { index, raw ->
            val line = raw.trim()
            if (line.isEmpty() || line.startsWith("#") || line.startsWith("!")) {
                return@forEachIndexed
            }
            val lineNo = index + 1
            val eq = line.indexOf('=')
            if (eq <= 0) {
                fail(lineNo, "expected :project=patch:<version> or :project=solo-major:<version> train-major:<n>")
            }
            val path = line.substring(0, eq).trim()
            val rest = line.substring(eq + 1).trim()
            if (!path.startsWith(":")) {
                fail(lineNo, "project path must start with ':' ($path)")
            }
            val match = entry.matchEntire(rest) ?: fail(
                lineNo,
                "expected patch:<version> or solo-major:<version> train-major:<n>",
            )
            val kind = Kind.entries.first { it.wire == match.groupValues[1] }
            val version = match.groupValues[2]
            val trainMajor = match.groupValues[3].ifEmpty { null }?.toInt()
            if (kind == Kind.PATCH && trainMajor != null) {
                fail(lineNo, "a patch override has no train-major")
            }
            if (kind == Kind.SOLO_MAJOR && trainMajor == null) {
                fail(lineNo, "a solo-major override needs train-major:<n>")
            }
            if (path in out) {
                fail(lineNo, "duplicate override for $path")
            }
            out[path] = VersionOverride(kind, version, trainMajor)
        }
        return out
    }

    /**
     * @return null when [actual] is the train version, or the recorded override and that override is legal.
     */
    fun alignmentFailure(
        projectPath: String,
        actual: String,
        train: String,
        recorded: VersionOverride?,
    ): String? {
        recordedProblem(projectPath, train, recorded)?.let { return it }
        val expected = recorded?.version ?: train
        if (actual == expected) {
            return null
        }
        return if (recorded == null) {
            "$projectPath is $actual but the train is $train. " +
                "Leave the train only with a patch or solo-major line in $OVERRIDES_PATH."
        } else {
            "$projectPath is $actual but the recorded ${recorded.kind.wire} override is ${recorded.version}."
        }
    }

    fun recordedProblem(projectPath: String, train: String, recorded: VersionOverride?): String? {
        if (recorded == null) {
            return null
        }
        val trainVer = parseSemVer(train)
            ?: return "Train version '$train' is not major.minor.patch."
        val overVer = parseSemVer(recorded.version)
            ?: return "$projectPath override '${recorded.version}' is not major.minor.patch."
        if (recorded.version == train) {
            return "$projectPath override ${recorded.version} is the train version. Remove the line from $OVERRIDES_PATH."
        }
        return when (recorded.kind) {
            Kind.PATCH -> patchProblem(projectPath, trainVer, overVer, recorded.version)
            Kind.SOLO_MAJOR -> soloProblem(projectPath, trainVer, recorded)
        }
    }

    private fun patchProblem(path: String, train: SemVer, over: SemVer, written: String): String? {
        val sameLine = over.major == train.major && over.minor == train.minor && over.patch > train.patch
        if (sameLine) {
            return null
        }
        return "$path patch override must keep ${train.major}.${train.minor} and use a patch above ${train.patch} (was $written)."
    }

    private fun soloProblem(path: String, train: SemVer, recorded: VersionOverride): String? {
        if (path == CORE_PATH) {
            return "$path cannot take a solo major. A core major moves the train for every module."
        }
        val base = recorded.trainMajor
            ?: return "$path solo-major override needs train-major:<n>."
        if (train.major != base) {
            return "$path solo major ${recorded.version} was allowed while the train major was $base. " +
                "The train is now ${train.major}.${train.minor}.${train.patch}. " +
                "Remove the line from $OVERRIDES_PATH so this module joins the train. " +
                "The solo number stays in the changelog; it is not added on."
        }
        return null
    }

    fun parseSemVer(version: String): SemVer? {
        val match = semver.matchEntire(version) ?: return null
        return SemVer(
            match.groupValues[1].toInt(),
            match.groupValues[2].toInt(),
            match.groupValues[3].toInt(),
            match.groupValues[4].ifEmpty { null },
        )
    }

    private fun fail(lineNo: Int, message: String): Nothing = throw IllegalArgumentException("$OVERRIDES_PATH:$lineNo: $message")
}
