package io.github.lsdconsulting.lsd.mono.studio.gradle

import groovy.json.JsonSlurper
import java.io.File
import java.security.MessageDigest

/** Finds, and when needed installs, the lsd-mono-studio to run, and its entry script. */
internal object StudioPackage {
    /** A directory with a package.json: run in place, no install. */
    fun localDirectory(
        spec: String,
        projectDir: File,
    ): File? {
        val file = File(spec).let { if (it.isAbsolute) it else projectDir.resolve(spec) }
        return file.takeIf { it.isDirectory && it.resolve("package.json").isFile }?.canonicalFile
    }

    /** A local file (a .tgz from npm pack), resolved against the project. */
    fun localFile(
        spec: String,
        projectDir: File,
    ): File? {
        val file = File(spec).let { if (it.isAbsolute) it else projectDir.resolve(spec) }
        return file.takeIf { it.isFile }?.canonicalFile
    }

    /** `name@x.y.z`, optionally scoped and with a pre-release: the only npm specs that never move. */
    private val EXACT = Regex("""^((?:@[\w.-]+/)?[\w.-]+)@(\d+\.\d+\.\d+(?:-[\w.]+)?)$""")

    /** A git spec pinned to a commit, e.g. `github:org/repo#<sha>`. */
    private val GIT_COMMIT = Regex("""^(git\+[a-z]+://|git://|github:|gitlab:|bitbucket:)\S+#[0-9a-fA-F]{7,40}$""")

    /** The version an exact npm [spec] (`lsd-mono-studio@0.17.0`) names, else null. */
    fun exactVersion(spec: String): String? = EXACT.matchEntire(spec.trim())?.groupValues?.get(2)

    /**
     * Fails unless [spec], which is neither a local directory nor a local file, names something that
     * cannot change: an exact npm version, a tarball URL or a git commit. The install is cached by
     * spec, so a tag (`@latest`) or a range (`@^1.0.0`) would stay on whatever it first resolved to.
     */
    fun requireFixed(spec: String) {
        if (exactVersion(spec) != null || GIT_COMMIT.matches(spec) || Regex("""^https?://\S+$""").matches(spec)) return
        throw IllegalArgumentException(
            "lsd.studio.package '$spec' is not a directory or file here, and not an exact npm version. Use an exact " +
                "version such as ${StudioVersion.NPM_PACKAGE}@1.2.3 (not a tag such as @latest, or a range), a directory " +
                "holding a built lsd-mono-studio, or a .tgz from npm pack.",
        )
    }

    /**
     * The cache folder for [spec]: readable for a registry version (`lsd-mono-studio@0.17.0`), and
     * keyed on the file's path, size and time for a local .tgz, so a new pack installs again.
     */
    fun installDir(
        cacheDir: File,
        spec: String,
        localFile: File?,
    ): File {
        val key =
            if (localFile == null && Regex("""[A-Za-z0-9@._-]+""").matches(spec)) {
                spec.replace('@', '-')
            } else {
                val identity = localFile?.let { "${it.path}|${it.length()}|${it.lastModified()}" } ?: spec
                "spec-" +
                    MessageDigest
                        .getInstance("SHA-256")
                        .digest(identity.toByteArray())
                        .joinToString("") { "%02x".format(it) }
                        .take(16)
            }
        return cacheDir.resolve(key)
    }

    /** The marker a finished install leaves, so later runs skip npm (and work offline). */
    fun installedMarker(installDir: File): File = installDir.resolve(".lsd-studio-installed")

    /** The compiled dist/main.js that the entry [script] imports, which only a packed package or a build has. */
    fun builtMain(script: File): File = script.parentFile.resolveSibling("dist").resolve("main.js")

    /** Where npm puts the package inside [installDir]. */
    fun packageDir(installDir: File): File = installDir.resolve("node_modules").resolve(StudioVersion.NPM_PACKAGE)

    /** The `version` in the package.json nearest above [script], or null when there is none to read. */
    fun version(script: File): String? {
        val packageJson =
            generateSequence(script.absoluteFile.parentFile) { it.parentFile }
                .map { it.resolve("package.json") }
                .firstOrNull { it.isFile } ?: return null

        @Suppress("UNCHECKED_CAST")
        val json = runCatching { JsonSlurper().parse(packageJson) as Map<String, Any?> }.getOrNull() ?: return null
        return (json["version"] as? String)?.takeIf { it.isNotBlank() }
    }

    /** The script package.json's `bin` names, which `node <script>` runs without npx or a .cmd shim. */
    fun binScript(packageDir: File): File {
        val packageJson = packageDir.resolve("package.json")
        check(packageJson.isFile) { "No package.json in $packageDir" }

        @Suppress("UNCHECKED_CAST")
        val json = JsonSlurper().parse(packageJson) as Map<String, Any?>
        val bin =
            when (val value = json["bin"]) {
                is String -> value
                is Map<*, *> -> (value[StudioVersion.NPM_PACKAGE] ?: value.values.singleOrNull()) as String?
                else -> null
            } ?: error("$packageJson has no bin entry for ${StudioVersion.NPM_PACKAGE}")
        return packageDir.resolve(bin).canonicalFile
    }
}
