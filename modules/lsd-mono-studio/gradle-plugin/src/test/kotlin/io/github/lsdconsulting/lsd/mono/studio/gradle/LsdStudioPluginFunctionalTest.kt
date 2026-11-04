package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.gradle.testkit.runner.BuildResult
import org.gradle.testkit.runner.GradleRunner
import org.gradle.testkit.runner.TaskOutcome
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.io.Writer
import java.net.HttpURLConnection
import java.net.ServerSocket
import java.net.URI
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

/**
 * Runs the `lsdStudio` task in real Gradle builds (TestKit) against the repo's own LSD Studio
 * (modules/lsd-mono-studio, built by the buildStudio task), never the published package.
 */
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
    private fun runner(vararg args: String): GradleRunner =
        GradleRunner
            .create()
            .withProjectDir(projectDir)
            .withPluginClasspath()
            .withEnvironment(System.getenv() + mapOf("HOME" to home.path, "USERPROFILE" to home.path))
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
    ) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
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
