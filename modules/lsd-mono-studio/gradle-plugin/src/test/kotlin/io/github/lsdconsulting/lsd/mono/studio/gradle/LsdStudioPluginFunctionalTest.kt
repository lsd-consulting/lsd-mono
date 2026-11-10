package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.gradle.testkit.runner.BuildResult
import org.gradle.testkit.runner.GradleRunner
import org.gradle.testkit.runner.TaskOutcome
import org.gradle.tooling.BuildCancelledException
import org.gradle.tooling.GradleConnectionException
import org.gradle.tooling.GradleConnector
import org.gradle.tooling.ResultHandler
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assumptions.assumeFalse
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Timeout
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.io.OutputStream
import java.io.Writer
import java.net.HttpURLConnection
import java.net.ServerSocket
import java.net.URI
import java.nio.file.Files
import java.nio.file.Paths
import java.util.Properties
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

/**
 * Runs the `lsdStudio` task in real Gradle builds (TestKit) against the repo's own LSD Studio
 * (modules/lsd-mono-studio, built by the buildStudio task), never the published package.
 */
private const val MINIMUM_GRADLE = "9.0"

class LsdStudioPluginFunctionalTest {
    @TempDir
    lateinit var projectDir: File

    @TempDir
    lateinit var home: File

    private val studioDir = File(System.getProperty("lsd.studio.dir")).canonicalFile
    private val studioVersion = StudioPackage.version(studioDir.resolve("package.json"))!!
    private val windows = System.getProperty("os.name").lowercase().contains("windows")

    @BeforeEach
    fun project() {
        projectDir.resolve("settings.gradle.kts").writeText("rootProject.name = \"studio-user\"\n")
    }

    private fun buildFile(lsdStudio: String) {
        projectDir.resolve("build.gradle.kts").writeText(
            """
            plugins { id("io.github.lsd-consulting.lsd-mono-studio") }
            lsdStudio {
                openBrowser = false
                cacheDir = layout.projectDirectory.dir("studio-cache")
                $lsdStudio
            }
            """.trimIndent(),
        )
    }

    private fun path(file: File) = file.path.replace("\\", "\\\\")

    /** Studio keeps its reports under the home directory: give it a temporary one. */
    private fun runner(
        vararg args: String,
        env: Map<String, String> = emptyMap(),
    ): GradleRunner =
        GradleRunner
            .create()
            .withProjectDir(projectDir)
            .withPluginClasspath()
            .withEnvironment(System.getenv() + mapOf("HOME" to home.path, "USERPROFILE" to home.path) + env)
            .withArguments(*args, "--stacktrace")

    @Test
    fun `fails clearly when there is no Node`() {
        buildFile("""nodeCommand = "${path(projectDir.resolve("no-such-dir/node"))}"""")
        val result = runner("lsdStudio").buildAndFail()
        assertTrue(result.output.contains("LSD Studio needs Node.js v22.6.0 or newer"), result.output)
        assertTrue(result.output.contains("was not found"), result.output)
    }

    @Test
    fun `fails clearly when Node is too old`() {
        val fake =
            if (windows) {
                projectDir.resolve("old-node.cmd").apply { writeText("@echo v20.11.0\r\n") }
            } else {
                projectDir.resolve("old-node").apply {
                    writeText("#!/bin/sh\necho v20.11.0\n")
                    setExecutable(true)
                }
            }
        buildFile("""nodeCommand = "${path(fake)}"""")
        val result = runner("lsdStudio").buildAndFail()
        assertTrue(result.output.contains("and '${fake.path}' is v20.11.0"), result.output)
    }

    @Test
    fun `a development build of the plugin says which lsd-mono-studio to point it at`() {
        buildFile("")
        val result = runner("lsdStudio").buildAndFail()
        assertTrue(result.output.contains("lsd.studio.package"), result.output)
    }

    @Test
    fun `leaves node-gradle out unless downloadNode is on`() {
        buildFile("")
        val result = runner("tasks", "--all").build()
        assertFalse(result.output.contains("nodeSetup"), result.output)
    }

    @Test
    fun `downloadNode sets up Node through node-gradle, from the mirror, before lsdStudio`() {
        buildFile(
            """
            downloadNode = true
            nodeVersion = "22.22.0"
            nodeDistUrl = "https://mirror.example/node"
            }
            afterEvaluate {
                val node = extensions.getByType(com.github.gradle.node.NodeExtension::class.java)
                println("node: " + node.download.get() + " " + node.version.get() + " " + node.distBaseUrl.get())
                println("lsdStudio after: " + tasks.getByName("lsdStudio").dependsOn.toList())
            """.trimIndent(),
        )
        // Resolving the task graph would fetch Node from the mirror, so this checks the wiring only.
        val result = runner("help").build()
        assertTrue(result.output.contains("node: true 22.22.0 https://mirror.example/node"), result.output)
        assertTrue(result.output.contains(Regex("lsdStudio after: .*nodeSetup")), result.output)
    }

    @Test
    fun `setting downloadNode after the build script fails instead of being ignored`() {
        buildFile("}\nafterEvaluate { lsdStudio { downloadNode = true }")
        val result = runner("help").buildAndFail()
        assertTrue(result.output.contains(Regex("property 'downloadNode' is final")), result.output)
    }

    @Test
    fun `setting nodeDistUrl after the build script fails instead of being ignored`() {
        buildFile("downloadNode = true\n}\nafterEvaluate { lsdStudio { nodeDistUrl = \"https://later.example/node\" }")
        val result = runner("help").buildAndFail()
        assertTrue(result.output.contains(Regex("property 'nodeDistUrl' is final")), result.output)
    }

    @Test
    fun `a nodeVersion set after the build script still reaches the download`() {
        buildFile(
            """
            downloadNode = true
            nodeDistUrl = "https://mirror.example/node"
            }
            afterEvaluate {
                lsdStudio { nodeVersion = "9.9.9" }
                val node = extensions.getByType(com.github.gradle.node.NodeExtension::class.java)
                println("LATE_VERSION " + node.version.get())
            """.trimIndent(),
        )
        val result = runner("help").build()
        assertTrue(result.output.contains("LATE_VERSION 9.9.9"), result.output)
    }

    @Test
    fun `downloadNode wires node and npm for this operating system`() {
        buildFile(
            """
            downloadNode = true
            nodeDistUrl = "https://mirror.example/node"
            }
            afterEvaluate {
                val studio = tasks.getByName("lsdStudio") as io.github.lsdconsulting.lsd.mono.studio.gradle.LsdStudioTask
                val node = extensions.getByType(com.github.gradle.node.NodeExtension::class.java)
                println("NODE_DIR=" + node.resolvedNodeDir.get().asFile)
                println("NODE_CMD=" + studio.nodeCommand.get())
                println("NPM_CMD=" + studio.npmCommand.get())
            """.trimIndent(),
        )
        val result = runner("help").build()

        fun value(key: String): String {
            val match = Regex("$key=(.+)").find(result.output) ?: error(result.output)
            return match.groupValues[1].trim()
        }

        val nodeDir = File(value("NODE_DIR"))
        val nodeCmd = value("NODE_CMD")
        val npmCmd = value("NPM_CMD")
        if (windows) {
            assertEquals(File(nodeDir, "node.exe").path, nodeCmd)
            assertEquals(File(nodeDir, "npm.cmd").path, npmCmd)
        } else {
            assertEquals(File(nodeDir, "bin/node").path, nodeCmd)
            assertEquals(File(nodeDir, "bin/npm").path, npmCmd)
        }
    }

    @Test
    @Timeout(60)
    fun `an http node mirror is refused`() {
        buildFile("downloadNode = true\n    nodeDistUrl = \"http://mirror.example/node\"")
        val result = runner("nodeSetup").buildAndFail()
        assertTrue(result.output.contains("insecure protocol", ignoreCase = true), result.output)
        assertTrue(result.output.contains("Node.js"), result.output)
    }

    /**
     * A fake Node.js [version] in nodejs.org's layout under `mirror/`: its node answers `--version`,
     * and its npm (bin/npm, a link into lib/node_modules as in the real archive) records its own
     * path and the first node on the `PATH` in [record], then fails. Returns the archive's name.
     */
    private fun nodeMirror(
        version: String,
        record: File,
    ): String {
        val os = if (System.getProperty("os.name").lowercase().contains("mac")) "darwin" else "linux"
        val arch = if (System.getProperty("os.arch") in setOf("aarch64", "arm64")) "arm64" else "x64"
        val name = "node-v$version-$os-$arch"
        val root = projectDir.resolve("fixture/$name")
        root.resolve("bin").mkdirs()
        root.resolve("bin/node").apply {
            writeText("#!/bin/sh\necho v$version\n")
            setExecutable(true)
        }
        root.resolve("lib/node_modules/npm/bin/npm-cli.js").apply {
            parentFile.mkdirs()
            writeText("#!/bin/sh\necho \"npm=$0\" > '${record.path}'\necho \"node=$(command -v node)\" >> '${record.path}'\nexit 3\n")
            setExecutable(true)
        }
        Files.createSymbolicLink(root.resolve("bin/npm").toPath(), Paths.get("../lib/node_modules/npm/bin/npm-cli.js"))
        val archive = projectDir.resolve("mirror/v$version/$name.tar.gz").apply { parentFile.mkdirs() }
        val tar = ProcessBuilder("tar", "czf", archive.path, "-C", root.parentFile.path, name).redirectErrorStream(true).start()
        val output = tar.inputStream.bufferedReader().readText()
        assertTrue(tar.waitFor(60, TimeUnit.SECONDS) && tar.exitValue() == 0, output)
        return name
    }

    private fun mirrorUrl() = projectDir
        .resolve("mirror")
        .toURI()
        .toString()
        .removeSuffix("/")

    /** The downloaded npm ran, with the downloaded node first on the PATH, both from node-gradle's install. */
    private fun assertDownloadedNodeRan(
        name: String,
        record: File,
        result: BuildResult,
    ) {
        assertTrue(record.exists(), result.output)
        val lines = record.readLines()
        val bin = "/.gradle/nodejs/$name/bin/"
        assertTrue(lines[0].startsWith("npm=") && lines[0].endsWith(bin + "npm"), lines.toString())
        assertTrue(lines[1].startsWith("node=") && lines[1].endsWith(bin + "node"), lines.toString())
        assertTrue(result.output.contains("exit 3"), result.output)
    }

    @Test
    fun `downloadNode fetches the default Node from the mirror and runs its npm with its node first on the PATH`() {
        assumeFalse(windows, "the fake Node is a shell script")
        val record = projectDir.resolve("npm-call.txt")
        // The default, written out, so a change to it is a deliberate change to this test too.
        val name = nodeMirror("22.22.0", record)
        buildFile("downloadNode = true\n    nodeDistUrl = \"${mirrorUrl()}\"")
        val result = runner("lsdStudio", "-Plsd.studio.package=lsd-mono-studio@1.2.3").buildAndFail()
        assertDownloadedNodeRan(name, record, result)
    }

    @Test
    fun `under FAIL_ON_PROJECT_REPOS a blank nodeDistUrl takes Node from the settings repositories`() {
        assumeFalse(windows, "the fake Node is a shell script")
        val record = projectDir.resolve("npm-call.txt")
        val name = nodeMirror("22.22.0", record)
        projectDir.resolve("settings.gradle.kts").writeText(
            """
            rootProject.name = "studio-user"
            dependencyResolutionManagement {
                repositoriesMode = RepositoriesMode.FAIL_ON_PROJECT_REPOS
                repositories {
                    ivy {
                        name = "Node.js"
                        setUrl("${mirrorUrl()}")
                        patternLayout { artifact("v[revision]/[artifact](-v[revision]-[classifier]).[ext]") }
                        metadataSources { artifact() }
                        content { includeModule("org.nodejs", "node") }
                    }
                }
            }
            """.trimIndent(),
        )
        buildFile("downloadNode = true\n    nodeDistUrl = \"\"")
        val result = runner("lsdStudio", "-Plsd.studio.package=lsd-mono-studio@1.2.3").buildAndFail()
        assertFalse(result.output.contains("was added by plugin"), result.output)
        assertDownloadedNodeRan(name, record, result)
    }

    @Test
    fun `a successful npm install log redacts credentials`() {
        assumeFalse(windows, "the fake npm is a shell script")
        val secret = "fakepasszz"
        val npm =
            projectDir.resolve("fake-npm").apply {
                writeText("#!/bin/sh\necho \"registry http://fakeuser:$secret@p:1\"\nexit 0\n")
                setExecutable(true)
            }
        buildFile("npmCommand = \"${path(npm)}\"")
        val result = runner("lsdStudio", "--info", "-Plsd.studio.package=lsd-mono-studio@1.2.3").buildAndFail()
        assertTrue(result.output.contains("registry http://***@p:1"), result.output)
        assertTrue(result.output.contains("incomplete"), result.output)
        assertFalse(result.output.contains(secret), result.output)
    }

    @Test
    fun `passes npmRegistry and Gradle's proxy settings to npm`() {
        assumeFalse(windows, "the fake npm is a shell script")
        val record = projectDir.resolve("npm-call.txt")
        val npm =
            projectDir.resolve("fake-npm").apply {
                writeText("#!/bin/sh\necho \"$*\" > '${record.path}'\necho \"proxy=${'$'}HTTPS_PROXY no=${'$'}NO_PROXY\" >> '${record.path}'\nexit 3\n")
                setExecutable(true)
            }
        buildFile("npmCommand = \"${path(npm)}\"\n    npmRegistry = \"https://npm.example/\"")
        projectDir.resolve("gradle.properties").writeText(
            "systemProp.https.proxyHost=proxy.example\nsystemProp.https.proxyPort=3128\nsystemProp.http.nonProxyHosts=localhost|*.corp\n",
        )
        val result = runner("lsdStudio", "-Plsd.studio.package=lsd-mono-studio@1.2.3", env = mapOf("HTTPS_PROXY" to "", "https_proxy" to "")).buildAndFail()
        val lines = record.readLines()
        assertTrue(lines[0].contains("--registry https://npm.example/ lsd-mono-studio@1.2.3"), lines.toString())
        assertTrue(lines[1].contains("proxy=http://proxy.example:3128 no=localhost,.corp"), lines.toString())
        assertFalse(result.output.contains("proxy.example"), result.output)
    }

    @Test
    fun `refuses an npm tag before installing anything`() {
        buildFile("port = 0")
        // An unreachable registry, so that if the check were lost npm fails at once instead of installing.
        val offline = mapOf("npm_config_registry" to "http://127.0.0.1:9", "npm_config_fetch_retries" to "0")
        val result = runner("lsdStudio", "-Plsd.studio.package=lsd-mono-studio@latest", env = offline).buildAndFail()
        assertTrue(result.output.contains("'lsd-mono-studio@latest' is not a directory or file here"), result.output)
        assertFalse(result.output.contains("LSD Studio: installing"), result.output)
        assertFalse(projectDir.resolve("studio-cache").exists(), "it touched the cache")
    }

    @Test
    fun `runs a local lsd-mono-studio in place, serves it, and stops it cleanly`() {
        buildFile("port = 0")
        val run = Running(projectDir, runner("lsdStudio", "-Plsd.studio.package=${studioDir.path}", stopArg()))
        val url = run.awaitUrl()
        assertEquals(200, get("$url/"))
        assertEquals(200, get("$url/api/reports"))
        val result = run.stop()
        assertEquals(TaskOutcome.SUCCESS, result.task(":lsdStudio")?.outcome)
        assertTrue(result.output.contains("LSD Studio: stopped."), result.output)
        assertGone(run.pid(), url)
    }

    /**
     * The oldest Gradle the plugin supports (see the README): 9.0, alongside the build's own.
     * TestKit downloads the 9.0 distribution on first use, so this test needs network access.
     */
    @Test
    fun `runs on the minimum supported Gradle, 9_0`() {
        buildFile("port = 0")
        val run =
            Running(
                projectDir,
                runner("lsdStudio", "-Plsd.studio.package=${studioDir.path}", stopArg()).withGradleVersion(MINIMUM_GRADLE),
            )
        val url = run.awaitUrl()
        assertEquals(200, get("$url/api/reports"))
        val result = run.stop()
        assertEquals(TaskOutcome.SUCCESS, result.task(":lsdStudio")?.outcome)
        assertGone(run.pid(), url)
    }

    @Test
    fun `under --offline npm installs from its cache only, and a miss says so`() {
        buildFile("port = 0")
        // An empty npm cache and an unreachable registry: if --offline were lost npm fails differently.
        val env =
            mapOf(
                "npm_config_cache" to projectDir.resolve("npm-cache").path,
                "npm_config_registry" to "http://127.0.0.1:9",
                "npm_config_fetch_retries" to "0",
            )
        val result = runner("lsdStudio", "--offline", "-Plsd.studio.package=lsd-mono-studio@9.9.9", env = env).buildAndFail()
        assertTrue(result.output.contains("Gradle is offline (--offline) and npm's cache has no copy of lsd-mono-studio@9.9.9"), result.output)
    }

    /**
     * Ctrl+C, or an IDE's stop button: the Tooling API cancels the build, which interrupts the task;
     * Studio must not outlive it. TestKit cannot cancel a build, so this drives Gradle directly.
     */
    @Test
    fun `cancelling the build stops Studio`() {
        val metadata = Properties()
        javaClass.classLoader.getResourceAsStream("plugin-under-test-metadata.properties")!!.use { metadata.load(it) }
        val classpath =
            metadata
                .getProperty("implementation-classpath")
                .split(File.pathSeparator)
                .joinToString(", ") { "'" + it.replace("\\", "/") + "'" }
        projectDir.resolve("build.gradle").writeText(
            """
            buildscript { dependencies { classpath files($classpath) } }
            apply plugin: 'io.github.lsd-consulting.lsd-mono-studio'
            lsdStudio {
                openBrowser.set(false)
                port.set(0)
                cacheDir.set(layout.projectDirectory.dir('studio-cache'))
            }
            """.trimIndent(),
        )
        val connector =
            GradleConnector
                .newConnector()
                .forProjectDirectory(projectDir)
                .useInstallation(File(System.getProperty("lsd.gradle.home")))
                .useGradleUserHomeDir(File(System.getProperty("lsd.tooling.home")))
        val output = StringBuffer()
        val outcome = CompletableFuture<Throwable?>()
        val cancel = GradleConnector.newCancellationTokenSource()
        try {
            connector.connect().use { connection ->
                connection
                    .newBuild()
                    .forTasks("lsdStudio")
                    .withArguments("-Plsd.studio.package=${studioDir.path}", "--stacktrace")
                    .setEnvironmentVariables(System.getenv() + mapOf("HOME" to home.path, "USERPROFILE" to home.path))
                    .withCancellationToken(cancel.token())
                    .setStandardOutput(Collect(output))
                    .setStandardError(Collect(output))
                    .run(
                        object : ResultHandler<Void> {
                            override fun onComplete(result: Void?) {
                                outcome.complete(null)
                            }

                            override fun onFailure(failure: GradleConnectionException) {
                                outcome.complete(failure)
                            }
                        },
                    )
                val pid = awaitOutput(output, outcome, Regex("""LSD Studio: started \(pid (\d+)\)""")).toLong()
                val url = awaitOutput(output, outcome, Regex("""LSD Studio is running at (\S+)"""))
                cancel.cancel()
                val failure = outcome.get(60, TimeUnit.SECONDS)
                assertTrue(failure is BuildCancelledException, "expected the build to be cancelled, got $failure\n$output")
                assertGone(pid, url, seconds = 30)
                // The task itself stopped it (the interrupt path), not the daemon going away.
                assertTrue(output.contains("LSD Studio: stopped."), output.toString())
            }
        } finally {
            connector.disconnect()
        }
    }

    /** Collects a Tooling API build's output; its lines are ASCII, which is all the tests look for. */
    private class Collect(
        private val into: StringBuffer,
    ) : OutputStream() {
        override fun write(b: Int) {
            into.append(b.toChar())
        }

        override fun write(
            b: ByteArray,
            off: Int,
            len: Int,
        ) {
            into.append(String(b, off, len))
        }
    }

    private fun awaitOutput(
        output: StringBuffer,
        outcome: CompletableFuture<Throwable?>,
        pattern: Regex,
    ): String {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(180)
        while (System.nanoTime() < deadline) {
            pattern.find(output)?.let { return it.groupValues[1] }
            if (outcome.isDone) error("The build ended before Studio started (${outcome.get()}):\n$output")
            Thread.sleep(100)
        }
        error("Studio did not start within 180s:\n$output")
    }

    /** A stand-in lsd-mono-studio that runs [script] instead of serving anything. */
    private fun fakeStudio(script: String): File {
        val dir = home.resolve("fake-studio")
        dir.resolve("bin").mkdirs()
        dir.resolve("dist").mkdirs()
        dir.resolve("package.json").writeText(
            """{ "name": "lsd-mono-studio", "version": "$studioVersion", "type": "module", """ +
                """"bin": { "lsd-mono-studio": "bin/lsd-mono-studio.js" } }""",
        )
        dir.resolve("dist/main.js").writeText("")
        dir.resolve("bin/lsd-mono-studio.js").writeText(script)
        return dir
    }

    @Test
    fun `fails with the exit code when Studio exits on its own`() {
        buildFile("port = 0")
        val studio = fakeStudio("console.log('giving up'); process.exit(3)")
        val result = runner("lsdStudio", "-Plsd.studio.package=${studio.path}").buildAndFail()
        assertTrue(result.output.contains("giving up"), result.output)
        assertTrue(result.output.contains("LSD Studio exited with code 3"), result.output)
    }

    @Test
    fun `warns when Studio exits on its own without an error`() {
        buildFile("port = 0")
        val studio = fakeStudio("console.log('done already')")
        val result = runner("lsdStudio", "-Plsd.studio.package=${studio.path}").build()
        assertTrue(result.output.contains("LSD Studio exited on its own"), result.output)
        assertFalse(result.output.contains("LSD Studio: stopped."), result.output)
    }

    @Test
    fun `works with the configuration cache, and reuses it on the next run`() {
        buildFile("port = 0")
        val args = arrayOf("lsdStudio", "--configuration-cache", "-Plsd.studio.package=${studioDir.path}", stopArg())
        repeat(2) { attempt ->
            val run = Running(projectDir, runner(*args))
            val url = run.awaitUrl()
            assertEquals(200, get("$url/api/reports"))
            val result = run.stop()
            assertEquals(TaskOutcome.SUCCESS, result.task(":lsdStudio")?.outcome)
            assertTrue(result.output.contains("LSD Studio: stopped."), result.output)
            val cache = if (attempt == 0) "Configuration cache entry stored" else "Reusing configuration cache"
            assertTrue(result.output.contains(cache), result.output)
            assertGone(run.pid(), url)
        }
    }

    @Test
    fun `installs a packed lsd-mono-studio into the cache once and runs it with node`() {
        val packs = projectDir.resolve("packs").apply { mkdirs() }
        val pack = npm(studioDir, "pack", "--ignore-scripts", "--pack-destination", packs.path)
        val tgz = packs.listFiles()!!.single { it.name.endsWith(".tgz") }
        buildFile("port = 0\n    studioPackage = \"${path(tgz)}\"")

        val first = Running(projectDir, runner("lsdStudio", stopArg()))
        val url = first.awaitUrl()
        assertEquals(200, get("$url/"), pack)
        val firstResult = first.stop()
        assertTrue(firstResult.output.contains("LSD Studio: installing"), firstResult.output)
        assertGone(first.pid(), url)
        val installed = projectDir.resolve("studio-cache").listFiles { file -> file.isDirectory }!!.single()
        assertTrue(installed.resolve("node_modules/lsd-mono-studio/bin/lsd-mono-studio.js").isFile)

        val second = Running(projectDir, runner("lsdStudio", stopArg()))
        val again = second.awaitUrl()
        val secondResult = second.stop()
        assertFalse(secondResult.output.contains("LSD Studio: installing"), secondResult.output)
        assertGone(second.pid(), again)
    }

    @Test
    fun `points at a Studio that is already running instead of failing`() {
        val port = ServerSocket(0).use { it.localPort }
        buildFile("port = $port")
        val first = Running(projectDir, runner("lsdStudio", "-Plsd.studio.package=${studioDir.path}", stopArg()))
        val url = first.awaitUrl()
        try {
            val second = runner("lsdStudio", "-Plsd.studio.package=${studioDir.path}").build()
            assertTrue(second.output.contains("LSD Studio $studioVersion is already running on http://127.0.0.1:$port"), second.output)
        } finally {
            first.stop()
        }
        assertGone(first.pid(), url)
    }

    @Test
    fun `fails clearly when something else holds the port`() {
        imposter("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n") { port ->
            buildFile("port = $port")
            val result = runner("lsdStudio", "-Plsd.studio.package=${studioDir.path}").buildAndFail()
            assertTrue(result.output.contains("An LSD Studio older than $studioVersion, or another app, is using port $port"), result.output)
        }
    }

    @Test
    fun `a JSON answer without the Studio header is not taken for Studio, and the next port is suggested`() {
        val ok = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}"
        imposter(ok) { port ->
            buildFile("port = $port")
            val result = runner("lsdStudio", "-Plsd.studio.package=${studioDir.path}").buildAndFail()
            assertTrue(result.output.contains("or another app, is using port $port (GET /api/reports answered 200 without"), result.output)
            assertTrue(result.output.contains("lsdStudio { port = ${port + 1} }"), result.output)
        }
    }

    @Test
    fun `a Studio that answers with an error is refused, naming the status rather than the header`() {
        imposter(studioReply("404 Not Found", studioVersion)) { port ->
            buildFile("port = $port")
            val result = runner("lsdStudio", "-Plsd.studio.package=${studioDir.path}").buildAndFail()
            assertTrue(result.output.contains("LSD Studio $studioVersion is on port $port, but GET /api/reports answered 404"), result.output)
            assertFalse(result.output.contains("without an X-LSD-Studio header"), result.output)
        }
    }

    @Test
    fun `a running Studio of the same version is reused without a warning`() {
        imposter(studioReply("200 OK", studioVersion)) { port ->
            buildFile("port = $port")
            val result = runner("lsdStudio", "-Plsd.studio.package=${studioDir.path}").build()
            assertTrue(result.output.contains("LSD Studio $studioVersion is already running on http://127.0.0.1:$port"), result.output)
            assertFalse(result.output.contains("may not line up"), result.output)
        }
    }

    @Test
    fun `a running Studio of another version is reused with a warning naming both`() {
        imposter(studioReply("200 OK", "9.9.9")) { port ->
            buildFile("port = $port")
            val result = runner("lsdStudio", "-Plsd.studio.package=${studioDir.path}").build()
            assertTrue(
                result.output.contains("LSD Studio 9.9.9 is running on http://127.0.0.1:$port, but this build runs LSD Studio $studioVersion"),
                result.output,
            )
            assertTrue(result.output.contains("may not line up"), result.output)
            assertTrue(result.output.contains("LSD Studio 9.9.9 is already running on http://127.0.0.1:$port"), result.output)
        }
    }

    /**
     * A Java project with the plugin, one class under src/test and no tests in it, whose test
     * task writes the JVM arguments it ran with to jvm-args.txt.
     */
    private fun testProject(
        lsdStudio: String,
        test: String = "",
    ) {
        projectDir.resolve("build.gradle.kts").writeText(
            """
            plugins {
                java
                id("io.github.lsd-consulting.lsd-mono-studio")
            }
            lsdStudio {
                $lsdStudio
            }
            tasks.test {
                failOnNoDiscoveredTests = false
                $test
                val out = file("jvm-args.txt")
                doLast { out.writeText((this as Test).allJvmArgs.joinToString("\n")) }
            }
            """.trimIndent(),
        )
        projectDir.resolve("src/test/java/Empty.java").apply { parentFile.mkdirs() }.writeText("class Empty {}\n")
    }

    private fun testJvmArgs() = projectDir.resolve("jvm-args.txt").readLines()

    private fun studioUrlArg(port: Int) = "-Dlsd.mono.studio.url=ws://127.0.0.1:$port/ws/captures"

    @Test
    fun `tests are pointed at a running Studio`() {
        imposter(studioReply("200 OK", studioVersion)) { port ->
            testProject("port = $port")
            val result = runner("test").build()
            assertEquals(TaskOutcome.SUCCESS, result.task(":test")?.outcome, result.output)
            assertTrue(testJvmArgs().contains(studioUrlArg(port)), testJvmArgs().toString())
            assertTrue(result.output.contains("LSD Studio is running: :test streams its reports to ws://127.0.0.1:$port/ws/captures"), result.output)
        }
    }

    @Test
    fun `tests run as usual when Studio is not running`() {
        val port = ServerSocket(0).use { it.localPort }
        testProject("port = $port")
        val result = runner("test").build()
        assertEquals(TaskOutcome.SUCCESS, result.task(":test")?.outcome, result.output)
        assertFalse(testJvmArgs().any { it.contains("lsd.mono.studio.url") }, testJvmArgs().toString())
    }

    @Test
    fun `something on the port that is not Studio does not get the tests`() {
        imposter("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n[]") { port ->
            testProject("port = $port")
            runner("test").build()
            assertFalse(testJvmArgs().any { it.contains("lsd.mono.studio.url") }, testJvmArgs().toString())
        }
    }

    @Test
    fun `wireTests = false leaves the tests alone`() {
        imposter(studioReply("200 OK", studioVersion)) { port ->
            testProject("port = $port\nwireTests = false")
            runner("test").build()
            assertFalse(testJvmArgs().any { it.contains("lsd.mono.studio.url") }, testJvmArgs().toString())
        }
    }

    @Test
    fun `a URL the build already sets is kept`() {
        imposter(studioReply("200 OK", studioVersion)) { port ->
            testProject("port = $port", test = "systemProperty(\"lsd.mono.studio.url\", \"ws://elsewhere/ws/captures\")")
            runner("test").build()
            assertEquals(listOf("-Dlsd.mono.studio.url=ws://elsewhere/ws/captures"), testJvmArgs().filter { it.contains("lsd.mono.studio.url") })
        }
    }

    @Test
    fun `an LSD_MONO_STUDIO_URL the build already sets is kept`() {
        imposter(studioReply("200 OK", studioVersion)) { port ->
            testProject("port = $port", test = "environment(\"LSD_MONO_STUDIO_URL\", \"ws://elsewhere/ws/captures\")")
            runner("test").build()
            assertFalse(testJvmArgs().any { it.contains("lsd.mono.studio.url") }, testJvmArgs().toString())
        }
    }

    @Test
    fun `port = 0 leaves the tests alone`() {
        testProject("port = 0")
        val result = runner("test").build()
        assertEquals(TaskOutcome.SUCCESS, result.task(":test")?.outcome, result.output)
        assertFalse(testJvmArgs().any { it.contains("lsd.mono.studio.url") }, testJvmArgs().toString())
    }

    @Test
    fun `points the tests at Studio with the configuration cache, and checks again when it is reused`() {
        imposter(studioReply("200 OK", studioVersion)) { port ->
            testProject("port = $port")
            val first = runner("test", "--configuration-cache").build()
            assertTrue(first.output.contains("Configuration cache entry stored"), first.output)
            assertTrue(testJvmArgs().contains(studioUrlArg(port)), testJvmArgs().toString())
            val second = runner("test", "--configuration-cache", "--rerun-tasks").build()
            assertTrue(second.output.contains("Configuration cache entry reused"), second.output)
            assertTrue(testJvmArgs().contains(studioUrlArg(port)), testJvmArgs().toString())
        }
        // The same cached configuration, with Studio gone: whether it runs is checked as the test starts.
        val third = runner("test", "--configuration-cache", "--rerun-tasks").build()
        assertTrue(third.output.contains("Configuration cache entry reused"), third.output)
        assertEquals(TaskOutcome.SUCCESS, third.task(":test")?.outcome, third.output)
        assertFalse(testJvmArgs().any { it.contains("lsd.mono.studio.url") }, testJvmArgs().toString())
    }

    @Test
    fun `tests still stream to a Studio of another version, with a warning naming both`() {
        imposter(studioReply("200 OK", "0.0.1")) { port ->
            testProject("port = $port\nstudioPackage = \"${path(studioDir)}\"")
            val result = runner("test").build()
            assertTrue(testJvmArgs().contains(studioUrlArg(port)), testJvmArgs().toString())
            assertTrue(
                result.output.contains("LSD Studio 0.0.1 is running on http://127.0.0.1:$port, but this build runs LSD Studio $studioVersion"),
                result.output,
            )
        }
    }

    @Test
    fun `a Studio of the same version gets no warning`() {
        imposter(studioReply("200 OK", studioVersion)) { port ->
            testProject("port = $port\nstudioPackage = \"${path(studioDir)}\"")
            val result = runner("test").build()
            assertTrue(testJvmArgs().contains(studioUrlArg(port)), testJvmArgs().toString())
            assertFalse(result.output.contains("may not line up"), result.output)
        }
    }

    @Test
    fun `a redirect is not followed to a Studio elsewhere`() {
        imposter(studioReply("200 OK", studioVersion)) { studio ->
            imposter("HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:$studio/api/reports\r\nContent-Length: 0\r\nConnection: close\r\n\r\n") { port ->
                testProject("port = $port")
                runner("test").build()
                assertFalse(testJvmArgs().any { it.contains("lsd.mono.studio.url") }, testJvmArgs().toString())
            }
        }
    }

    @Test
    fun `a port that takes the connection but never answers is reported, and the tests still run`() {
        ServerSocket(0).use { socket ->
            testProject("port = ${socket.localPort}")
            val result = runner("test").build()
            assertEquals(TaskOutcome.SUCCESS, result.task(":test")?.outcome, result.output)
            assertTrue(result.output.contains("LSD Studio: something on port ${socket.localPort} did not answer in time"), result.output)
            assertFalse(testJvmArgs().any { it.contains("lsd.mono.studio.url") }, testJvmArgs().toString())
        }
    }

    @Test
    fun `a URL from the build's own argument provider is kept`() {
        imposter(studioReply("200 OK", studioVersion)) { port ->
            testProject(
                "port = $port",
                test = "jvmArgumentProviders.add(CommandLineArgumentProvider { listOf(\"-Dlsd.mono.studio.url=ws://elsewhere/ws/captures\") })",
            )
            val result = runner("test").build()
            // Detected, not just winning by argument order: the plugin adds no URL of its own.
            assertFalse(result.output.contains("streams its reports to"), result.output)
            assertEquals(listOf("-Dlsd.mono.studio.url=ws://elsewhere/ws/captures"), testJvmArgs().filter { it.contains("lsd.mono.studio.url") })
        }
    }

    @Test
    fun `an argument provider that fails when checked does not stop the tests`() {
        imposter(studioReply("200 OK", studioVersion)) { port ->
            // Throws on its first call only, the plugin's check; Gradle's own call for the command line works.
            testProject(
                "port = $port",
                test =
                    "val calls = intArrayOf(0)\n" +
                        "jvmArgumentProviders.add(CommandLineArgumentProvider { " +
                        "if (calls[0]++ == 0) throw IllegalStateException(\"not yet\") else listOf(\"-Dother=1\") })",
            )
            val result = runner("test", "--info").build()
            assertEquals(TaskOutcome.SUCCESS, result.task(":test")?.outcome, result.output)
            assertTrue(result.output.contains("a JVM argument provider of :test failed when checked"), result.output)
            assertTrue(testJvmArgs().contains(studioUrlArg(port)), testJvmArgs().toString())
        }
    }

    @Test
    fun `whether Studio is running does not make the tests out of date`() {
        imposter(studioReply("200 OK", studioVersion)) { port ->
            testProject("port = $port")
            runner("test").build()
        }
        // Studio has gone from that port.
        val again = runner("test").build()
        assertEquals(TaskOutcome.UP_TO_DATE, again.task(":test")?.outcome, again.output)
    }

    /** An HTTP reply with [status] and the Studio header valued [version]. */
    private fun studioReply(
        status: String,
        version: String,
    ) = "HTTP/1.1 $status\r\nX-LSD-Studio: $version\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n[]"

    /** Runs [block] with the port of a server that reads each request and answers [response]. */
    private fun imposter(
        response: String,
        block: (Int) -> Unit,
    ) {
        ServerSocket(0).use { socket ->
            val server =
                Thread {
                    runCatching {
                        while (true) {
                            socket.accept().use { client ->
                                // Read the whole request first: closing with unread data resets the connection on Windows.
                                val input = client.getInputStream()
                                var tail = 0
                                while (tail != 0x0d0a0d0a) {
                                    val b = input.read()
                                    if (b < 0) break
                                    tail = (tail shl 8) or b
                                }
                                client.getOutputStream().write(response.toByteArray())
                                client.shutdownOutput()
                            }
                        }
                    }
                }.apply {
                    isDaemon = true
                    start()
                }
            block(socket.localPort)
            server.interrupt()
        }
    }

    @Test
    fun `fails clearly when something on the port resets the connection`() {
        ServerSocket(0).use { socket ->
            // Reads the request, then closes with SO_LINGER 0, which sends a reset instead of an answer on every OS.
            val server =
                Thread {
                    runCatching {
                        while (true) {
                            socket.accept().use { client ->
                                client.setSoLinger(true, 0)
                                val input = client.getInputStream()
                                var tail = 0
                                while (tail != 0x0d0a0d0a) {
                                    val b = input.read()
                                    if (b < 0) break
                                    tail = (tail shl 8) or b
                                }
                            }
                        }
                    }
                }.apply {
                    isDaemon = true
                    start()
                }
            buildFile("port = ${socket.localPort}")
            val result = runner("lsdStudio", "-Plsd.studio.package=${studioDir.path}").buildAndFail()
            assertTrue(result.output.contains("or another app, is using port ${socket.localPort} (java.net.SocketException"), result.output)
            server.interrupt()
        }
    }

    private fun stopArg() = "-Plsd.studio.stopFile=${projectDir.resolve("stop").path}"

    private fun npm(
        dir: File,
        vararg args: String,
    ): String {
        val command = (if (windows) listOf("cmd", "/c", "npm") else listOf("npm")) + args
        val process = ProcessBuilder(command).directory(dir).redirectErrorStream(true).start()
        val output = process.inputStream.bufferedReader().readText()
        assertTrue(process.waitFor(120, TimeUnit.SECONDS) && process.exitValue() == 0, output)
        return output
    }

    private fun get(url: String): Int {
        val connection = URI(url).toURL().openConnection() as HttpURLConnection
        connection.connectTimeout = 5000
        connection.readTimeout = 5000
        return try {
            connection.responseCode
        } finally {
            connection.disconnect()
        }
    }

    private fun assertGone(
        pid: Long,
        url: String,
        seconds: Long = 10,
    ) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(seconds)
        while (ProcessHandle.of(pid).map { it.isAlive }.orElse(false) && System.nanoTime() < deadline) Thread.sleep(100)
        assertFalse(ProcessHandle.of(pid).map { it.isAlive }.orElse(false), "Studio (pid $pid) is still running")
        assertTrue(runCatching { get(url) }.isFailure, "$url still answers")
    }

    /** A `lsdStudio` build running in the background, stopped through the stop file. */
    private class Running(
        private val projectDir: File,
        runner: GradleRunner,
    ) {
        private val output = StringBuffer()
        private val result: CompletableFuture<BuildResult> =
            CompletableFuture.supplyAsync {
                runner
                    .forwardStdOutput(
                        object : Writer() {
                            override fun write(
                                cbuf: CharArray,
                                off: Int,
                                len: Int,
                            ) {
                                output.append(cbuf, off, len)
                            }

                            override fun flush() = Unit

                            override fun close() = Unit
                        },
                    ).build()
            }

        fun awaitUrl(): String = await(Regex("""LSD Studio is running at (\S+)"""))

        fun pid(): Long = await(Regex("""LSD Studio: started \(pid (\d+)\)""")).toLong()

        private fun await(pattern: Regex): String {
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(180)
            while (System.nanoTime() < deadline) {
                pattern.find(output)?.let { return it.groupValues[1] }
                if (result.isDone) error("The build ended before Studio started:\n$output")
                Thread.sleep(100)
            }
            error("Studio did not start within 180s:\n$output")
        }

        fun stop(): BuildResult {
            projectDir.resolve("stop").createNewFile()
            return result.get(60, TimeUnit.SECONDS).also { projectDir.resolve("stop").delete() }
        }
    }
}
