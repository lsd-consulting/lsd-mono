package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.provider.Property
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.Internal
import org.gradle.api.tasks.Optional
import org.gradle.api.tasks.TaskAction
import org.gradle.api.tasks.UntrackedTask
import java.io.File
import java.io.IOException
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.URI
import java.util.concurrent.TimeUnit

/**
 * Runs LSD Studio in the foreground with local Node until it is stopped: Ctrl+C, a cancelled
 * build, the [stopFile] appearing, or Studio exiting. Configure it through [LsdStudioExtension].
 */
@UntrackedTask(because = "It runs LSD Studio until it is stopped; there is nothing to cache")
public abstract class LsdStudioTask : DefaultTask() {
    /** See [LsdStudioExtension.port]. */
    @get:Input
    public abstract val port: Property<Int>

    /** See [LsdStudioExtension.expose]. */
    @get:Input
    public abstract val expose: Property<Boolean>

    /** See [LsdStudioExtension.openBrowser]. */
    @get:Input
    public abstract val openBrowser: Property<Boolean>

    /** See [LsdStudioExtension.nodeCommand]. */
    @get:Input
    public abstract val nodeCommand: Property<String>

    /** See [LsdStudioExtension.npmCommand]. */
    @get:Input
    public abstract val npmCommand: Property<String>

    /** See [LsdStudioExtension.studioPackage]. */
    @get:Input
    @get:Optional
    public abstract val studioPackage: Property<String>

    /** See [LsdStudioExtension.cacheDir]. */
    @get:Internal
    public abstract val cacheDir: DirectoryProperty

    /** Stops Studio when this file appears, for scripts (and the plugin's tests) that cannot press Ctrl+C. */
    @get:Internal
    public abstract val stopFile: RegularFileProperty

    /** The project directory a relative [studioPackage] path is resolved against. */
    @get:Internal
    public abstract val projectDir: DirectoryProperty

    /** Whether this is a CI run (the `CI` variable), where the browser is never opened. */
    @get:Internal
    public abstract val ci: Property<Boolean>

    /** The build service that stops Studio when the build ends. */
    @get:Internal
    public abstract val processes: Property<StudioProcesses>

    @TaskAction
    public fun run() {
        val node = nodeCommand.get()
        checkNode(node)
        val bin = studioScript(node)
        val host = if (expose.get()) "0.0.0.0" else "127.0.0.1"
        val port = port.get()
        if (port != 0 && alreadyRunning(port)) return
        launch(node, bin, port, host)
    }

    private fun checkNode(node: String) {
        val output =
            try {
                runAndRead(listOf(node, "--version"))
            } catch (e: IOException) {
                throw GradleException(
                    "LSD Studio needs Node.js ${NodeVersion.MINIMUM} or newer, and '$node' was not found " +
                        "(${e.message}). Install Node.js (https://nodejs.org) and put it on the PATH, or set " +
                        "lsdStudio { nodeCommand = \"/path/to/node\" }.",
                    e,
                )
            }
        val version =
            NodeVersion.parse(output.lineSequence().firstOrNull { it.isNotBlank() } ?: "")
                ?: throw GradleException("Could not read the Node.js version from '$node --version': '${output.trim()}'")
        if (version < NodeVersion.MINIMUM) {
            throw GradleException(
                "LSD Studio needs Node.js ${NodeVersion.MINIMUM} or newer, and '$node' is $version. " +
                    "Install a newer Node.js, or point lsdStudio { nodeCommand = … } at one.",
            )
        }
        logger.info("LSD Studio: using Node.js {} ({})", version, node)
    }

    /** The entry script: a local directory runs in place; anything else is installed once into the cache. */
    private fun studioScript(node: String): File {
        val spec =
            try {
                StudioVersion.packageSpec(studioPackage.orNull)
            } catch (e: IllegalStateException) {
                throw GradleException(e.message ?: "No lsd-mono-studio to run", e)
            }
        val projectDir = projectDir.get().asFile
        StudioPackage.localDirectory(spec, projectDir)?.let { dir ->
            val script = StudioPackage.binScript(dir)
            logger.lifecycle("LSD Studio: running the local lsd-mono-studio in {}", dir)
            checkBuilt(script, dir)
            return script
        }
        val localFile = StudioPackage.localFile(spec, projectDir)
        val installDir = StudioPackage.installDir(cacheDir.get().asFile, spec, localFile)
        if (StudioInstaller.isComplete(installDir)) {
            logger.info("LSD Studio: {} is already installed in {}", spec, installDir)
        } else {
            StudioInstaller.ensureInstalled(installDir, spec) { target ->
                logger.lifecycle("LSD Studio: installing {} into {}", spec, installDir)
                val result =
                    runAndRead(
                        npm(npmCommand.get()) +
                            listOf(
                                "install",
                                "--prefix",
                                target.path,
                                "--no-save",
                                "--no-audit",
                                "--no-fund",
                                "--no-package-lock",
                                "--omit=dev",
                                localFile?.path ?: spec,
                            ),
                        directory = target,
                        check = true,
                    )
                logger.info("{}", result)
            }
        }
        // ensureInstalled only leaves a complete install in place, with its entry script and dist/main.js.
        return StudioPackage.binScript(StudioPackage.packageDir(installDir))
    }

    private fun checkBuilt(
        script: File,
        dir: File,
    ) {
        if (!script.isFile) throw GradleException("lsd-mono-studio's entry script $script is missing in $dir.")
        val main = StudioPackage.builtMain(script)
        if (!main.isFile) {
            throw GradleException(
                "lsd-mono-studio in $dir is not built ($main is missing): run npm ci and npm run build there.",
            )
        }
    }

    /** True when an LSD Studio already answers on [port]; fails when something else holds it. */
    private fun alreadyRunning(port: Int): Boolean {
        val url = "http://127.0.0.1:$port"
        val connection = URI("$url/api/reports").toURL().openConnection() as HttpURLConnection
        connection.connectTimeout = 2000
        connection.readTimeout = 2000
        try {
            val status = connection.responseCode
            val json = connection.contentType?.contains("json") == true
            if (status == 200 && json) {
                logger.lifecycle("LSD Studio is already running on {}: using it. Stop that one to start a new one here.", url)
                browse(url)
                return true
            }
            throw GradleException(
                "Port $port is in use, and not by LSD Studio (GET /api/reports answered $status). " +
                    "Stop what is using it, or choose another port: lsdStudio { port = 7358 }.",
            )
        } catch (e: ConnectException) {
            return false
        } catch (e: java.net.SocketTimeoutException) {
            throw GradleException("Port $port is in use, and not by LSD Studio (no answer). Choose another port.", e)
        } finally {
            connection.disconnect()
        }
    }

    private fun launch(
        node: String,
        bin: File,
        port: Int,
        host: String,
    ) {
        val command = mutableListOf(node, bin.path, "--port", port.toString())
        if (host == "0.0.0.0") command += "--expose"
        val process =
            ProcessBuilder(command)
                .directory(bin.parentFile)
                .redirectErrorStream(true)
                .start()
        val service = processes.get()
        service.add(process)
        logger.lifecycle("LSD Studio: started (pid {}). Press Ctrl+C to stop it.", process.pid())
        val reader =
            Thread({
                process.inputStream.bufferedReader().useLines { lines ->
                    lines.forEach { line ->
                        logger.lifecycle("{}", line)
                        STARTED.find(line)?.let { match ->
                            val url = match.groupValues[1].replace("0.0.0.0", "localhost")
                            logger.lifecycle("LSD Studio is running at {}", url)
                            browse(url)
                        }
                    }
                }
            }, "lsd-studio-output")
        reader.isDaemon = true
        reader.start()
        val stop = stopFile.orNull?.asFile
        var stopped = false
        try {
            while (process.isAlive) {
                if (stop != null && stop.exists()) {
                    stopped = true
                    break
                }
                process.waitFor(200, TimeUnit.MILLISECONDS)
            }
        } catch (e: InterruptedException) {
            // Ctrl+C or a cancelled build.
            stopped = true
            Thread.currentThread().interrupt()
        } finally {
            if (process.isAlive) {
                StudioProcesses.stop(process)
                stopped = true
            }
            service.remove(process)
            reader.join(2000)
        }
        if (stopped) {
            logger.lifecycle("LSD Studio: stopped.")
        } else if (process.exitValue() != 0) {
            throw GradleException("LSD Studio exited with code ${process.exitValue()}; its output is above.")
        }
    }

    private fun browse(url: String) {
        if (!openBrowser.get() || ci.get()) return
        val os = System.getProperty("os.name").lowercase()
        val command =
            when {
                os.contains("mac") -> listOf("open", url)
                os.contains("windows") -> listOf("rundll32", "url.dll,FileProtocolHandler", url)
                else -> listOf("xdg-open", url)
            }
        try {
            ProcessBuilder(command).redirectErrorStream(true).start()
        } catch (e: IOException) {
            logger.info("LSD Studio: could not open a browser ({}); open {} yourself.", e.message, url)
        }
    }

    private companion object {
        val STARTED = Regex("""LSD Studio on (https?://\S+)""")

        val WINDOWS = System.getProperty("os.name").lowercase().contains("windows")

        /** npm is a .cmd script on Windows, which only cmd runs. Only the install goes through it. */
        fun npm(command: String): List<String> = if (WINDOWS && !command.contains('.')) listOf("cmd", "/c", command) else listOf(command)

        fun runAndRead(
            command: List<String>,
            directory: File? = null,
            check: Boolean = false,
        ): String {
            val process =
                ProcessBuilder(command)
                    .apply { directory?.let { directory(it) } }
                    .redirectErrorStream(true)
                    .start()
            val output = process.inputStream.bufferedReader().readText()
            process.waitFor()
            if (check && process.exitValue() != 0) {
                throw GradleException("'${command.joinToString(" ")}' failed (exit ${process.exitValue()}):\n$output")
            }
            return output
        }
    }
}
