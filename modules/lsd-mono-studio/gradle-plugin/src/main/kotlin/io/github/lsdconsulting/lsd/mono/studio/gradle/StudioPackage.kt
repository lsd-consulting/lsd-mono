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

    /** Where npm puts the package inside [installDir]. */
    fun packageDir(installDir: File): File = installDir.resolve("node_modules").resolve(StudioVersion.NPM_PACKAGE)

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
