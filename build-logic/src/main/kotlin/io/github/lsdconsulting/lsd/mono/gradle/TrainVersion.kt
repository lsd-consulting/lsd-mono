package io.github.lsdconsulting.lsd.mono.gradle

/*
 * The train version (docs/versioning-notes.md), worked out once on the root project:
 *
 * - `-Plsd.version=X.Y.Z` wins. The release workflow passes the version it is about to tag.
 * - A commit tagged `vX.Y.Z` builds as `X.Y.Z` (the leading v is dropped, as lsd-core does).
 * - Any other commit builds as the next patch after the latest `v` tag, with `-SNAPSHOT`:
 *   `0.1.1-SNAPSHOT` after `v0.1.0`, and `0.0.1-SNAPSHOT` before the first tag or without git
 *   history (a shallow CI checkout has no tags). Snapshots are never published to Central.
 */

/** A release version: X.Y.Z, with an optional pre-release such as `-rc.1`. No build metadata. */
private val RELEASE = Regex("""(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?""")

/** `git describe --tags --long`: the tag, the commits since it, and the abbreviated hash. */
private val DESCRIBE = Regex("""v(.+)-(\d+)-g[0-9a-f]+""")

/** The version before any release, and whenever git cannot say. */
const val FIRST_SNAPSHOT: String = "0.0.1-SNAPSHOT"

/**
 * The version from an explicit `lsd.version` property, else from the output of
 * `git describe --tags --match 'v[0-9]*' --long` (null when it failed, e.g. no tag yet).
 */
fun trainVersion(
    explicit: String?,
    describe: String?,
): String {
    explicit?.trim()?.takeIf { it.isNotEmpty() }?.let { version ->
        require(RELEASE.matches(version)) { "lsd.version must be X.Y.Z (no leading v), got '$version'" }
        return version
    }
    val described = describe?.trim()?.takeIf { it.isNotEmpty() } ?: return FIRST_SNAPSHOT
    val (tag, distance) =
        DESCRIBE.matchEntire(described)?.destructured
            ?: error("Unexpected git describe output '$described'")
    val parts = RELEASE.matchEntire(tag) ?: error("Tag v$tag is not vX.Y.Z")
    if (distance.toInt() == 0) return tag
    val (major, minor, patch, preRelease) = parts.destructured
    // After a pre-release tag (v0.2.0-rc.1) the next release is that version itself.
    return if (preRelease.isNotEmpty()) {
        "$major.$minor.$patch-SNAPSHOT"
    } else {
        "$major.$minor.${patch.toInt() + 1}-SNAPSHOT"
    }
}
