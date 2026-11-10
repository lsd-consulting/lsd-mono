package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.provider.MapProperty
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

    /** See [LsdStudioExtension.npmRegistry]. */
    @get:Input
    @get:Optional
    public abstract val npmRegistry: Property<String>

    /** Gradle's proxy system properties, which npm gets as its proxy variables (see [NpmEnvironment]). */
    @get:Internal
    internal abstract val proxyProperties: MapProperty<String, String>

    /** A downloaded Node's folder of executables, put first on npm's `PATH` (see [LsdStudioExtension.downloadNode]). */
    @get:Internal
    internal abstract val nodeBinDir: DirectoryProperty

    /** See [LsdStudioExtension.cacheDir]. */
    @get:Internal
    public abstract val cacheDir: DirectoryProperty

    /** Stops Studio when this file appears, for scripts (and the plugin's tests) that cannot press Ctrl+C. */
    @get:Internal
    internal abstract val stopFile: RegularFileProperty

    /** The project directory a relative [studioPackage] path is resolved against. */
    @get:Internal
    internal abstract val projectDir: DirectoryProperty

    /** Whether this is a CI run (the `CI` variable), where the browser is never opened. */
    @get:Internal
    internal abstract val ci: Property<Boolean>

    /** Whether Gradle runs offline (`--offline`): npm then installs from its cache only. */
    @get:Internal
    internal abstract val offline: Property<Boolean>

    /** The build service that stops Studio when the build ends. */
    @get:Internal
    internal abstract val processes: Property<StudioProcesses>

    @TaskAction
    public fun run() {
        val node = nodeCommand.get()
        checkNode(node)
        val bin = studioScript(node)
        val expected = StudioPackage.version(bin)
        val host = StudioLaunch.host(expose.get())
        val port = port.get()
        if (port != 0 && alreadyRunning(port, expected)) return
        launch(node, bin, port, host)
    }

    private fun checkNode(node: String) {
        val result =
            try {
                // Run directly, like the launch, so the check and the launch find the same node.
                ProcessRunner.run(listOf(node, "--version"), timeout = ProcessRunner.NODE_VERSION_TIMEOUT)
            } catch (e: IOException) {
                throw NodeCheck.notFound(node, e.message, e)
            }
        val version = NodeCheck.version(node, result)
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
        if (localFile == null) {
            try {
                StudioPackage.requireFixed(spec)
            } catch (e: IllegalArgumentException) {
                throw GradleException(e.message ?: "lsd.studio.package '$spec' is not an exact version", e)
            }
        }
        val installDir = StudioPackage.installDir(cacheDir.get().asFile, spec, localFile)
        // Only decides what to log: ensureInstalled checks again under its lock.
        if (StudioInstaller.isComplete(installDir, spec)) {
            logger.info("LSD Studio: {} is already installed in {}", spec, installDir)
        } else {
            Commands.requireInstallSafe(npmCommand.get(), localFile?.path ?: spec, installDir.path)
            val registry = npmRegistry.orNull?.trim()?.takeIf { it.isNotEmpty() }
            registry?.let { Commands.requireCmdSafe(it, "npmRegistry") }
            val environment = NpmEnvironment.of(proxyProperties.getOrElse(emptyMap()), System.getenv(), nodeBinDir.orNull?.asFile)
            StudioInstaller.ensureInstalled(installDir, spec) { target ->
                logger.lifecycle("LSD Studio: installing {} into {}", spec, installDir)
                val result =
                    NpmInstall.explainOfflineMiss(offline.get(), spec) {
                        ProcessRunner.runChecked(
                            Commands.resolve(npmCommand.get(), NpmInstall.args(target, localFile?.path ?: spec, offline.get(), registry)),
                            directory = target,
                            timeout = ProcessRunner.NPM_INSTALL_TIMEOUT,
                            environment = environment,
                        )
                    }
                logger.info("{}", ProcessRunner.redact(result))
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

    /**
     * True when an LSD Studio already answers on [port], warning when its version is not [expected];
     * fails when an older Studio or something else holds it.
     */
    private fun alreadyRunning(
        port: Int,
        expected: String?,
    ): Boolean {
        val url = "http://127.0.0.1:$port"
        val connection = URI("$url/api/reports").toURL().openConnection() as HttpURLConnection
        connection.connectTimeout = 2000
        connection.readTimeout = 2000
        // A redirect could lead to a Studio elsewhere while this build would open and wire this port.
        connection.instanceFollowRedirects = false
        try {
            val status = connection.responseCode
            when (val verdict = StudioProbe.judge(url, port, status, connection.getHeaderField(StudioProbe.STUDIO_HEADER), expected)) {
                is StudioProbe.Verdict.InUse -> throw verdict.failure
                is StudioProbe.Verdict.Reuse -> {
                    verdict.warning?.let { logger.warn(it) }
                    logger.lifecycle(
                        "LSD Studio {} is already running on {}: using it. Stop that one to start a new one here.",
                        verdict.version,
                        url,
                    )
                    browse(url)
                    return true
                }
            }
        } catch (e: ConnectException) {
            return false
        } catch (e: java.net.SocketTimeoutException) {
            throw StudioProbe.portInUse(port, expected, "no answer", e)
        } catch (e: IOException) {
            // Something that is not an HTTP server can reset the connection instead of answering.
            throw StudioProbe.portInUse(port, expected, e.toString(), e)
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
        val command = StudioLaunch.command(node, bin.path, port, host)
        // Node is started directly, not through cmd, so stopping it leaves no wrapper behind; on
        // Windows nodeCommand must therefore name node.exe (or a command that resolves to it).
        val process =
            try {
                ProcessBuilder(command)
                    .directory(bin.parentFile)
                    .redirectErrorStream(true)
                    .start()
            } catch (e: IOException) {
                throw NodeCheck.notFound(node, e.message, e)
            }
        val service = processes.get()
        service.add(process)
        logger.lifecycle("LSD Studio: started (pid {}). Press Ctrl+C to stop it.", process.pid())
        val reader =
            Thread({
                process.inputStream.bufferedReader().useLines { lines ->
                    lines.forEach { line ->
                        logger.lifecycle("{}", line)
                        StudioLaunch.startedUrl(line)?.let { url ->
                            logger.lifecycle("LSD Studio is running at {}", url)
                            browse(url)
                        }
                    }
                }
            }, "lsd-studio-output")
        reader.isDaemon = true
        reader.start()
        val stop = stopFile.orNull?.asFile
        // True only when this task stopped a live Studio. A stop request that races Studio exiting
        // by itself does not count, so its own exit code is still reported.
        var stopped = false
        var requested = false
        try {
            while (process.isAlive) {
                if (stop != null && stop.exists()) {
                    requested = true
                    break
                }
                process.waitFor(200, TimeUnit.MILLISECONDS)
            }
        } catch (e: InterruptedException) {
            // Ctrl+C or a cancelled build.
            requested = true
            Thread.currentThread().interrupt()
        } finally {
            if (process.isAlive) {
                StudioProcesses.stop(process)
                stopped = true
            }
            service.remove(process)
            reader.join(2000)
        }
        val exit = process.exitValue()
        when (StudioOutcome.of(stopped, requested || stop?.exists() == true, exit)) {
            StudioOutcome.STOPPED -> logger.lifecycle("LSD Studio: stopped.")
            StudioOutcome.FAILED -> throw GradleException("LSD Studio exited with code $exit; its output is above.")
            StudioOutcome.ENDED_ON_ITS_OWN -> logger.warn("LSD Studio exited on its own; its output is above.")
        }
    }

    private fun browse(url: String) {
        // Off the output reader, so a slow or hung launcher cannot stall Studio's output.
        val log = logger
        BrowserLauncher.browse(url, openBrowser.get(), ci.get(), System.getProperty("os.name")) { command ->
            BrowserLauncher.launch(command) { e ->
                log.info("LSD Studio: could not open a browser ({}); open {} yourself.", e.message, url)
            }
        }
    }
}
