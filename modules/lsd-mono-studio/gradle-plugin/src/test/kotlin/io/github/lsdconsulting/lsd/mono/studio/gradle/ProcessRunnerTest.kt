package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.gradle.api.GradleException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.api.io.TempDir
import org.slf4j.LoggerFactory
import java.io.File
import java.lang.reflect.Proxy
import java.time.Duration
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread

class ProcessRunnerTest {
    private val java = File(System.getProperty("java.home"), "bin/java").path

    /** Runs a small Java program, so the test behaves the same on every OS. */
    private fun javaRunning(code: String, dir: File): List<String> {
        val source = File(dir, "Main.java").apply { writeText("public class Main { public static void main(String[] a) throws Exception { $code } }") }
        return listOf(java, source.path)
    }

    /**
     * A program that starts a child Java process, writes both pids to [pids], prints [output] and
     * sleeps, so a test can check that the whole tree is stopped.
     */
    private fun parentAndChild(
        dir: File,
        pids: File,
        output: String = "",
    ): List<String> {
        val child = File(
            dir,
            "Child.java",
        ).apply { writeText("public class Child { public static void main(String[] a) throws Exception { Thread.sleep(120000); } }") }
        val p = pids.path.replace("\\", "\\\\")
        return javaRunning(
            "Process c = new ProcessBuilder(\"${java.replace("\\", "\\\\")}\", \"${child.path.replace("\\", "\\\\")}\").start();" +
                " java.nio.file.Files.writeString(java.nio.file.Path.of(\"$p.tmp\"), ProcessHandle.current().pid() + \"\\n\" + c.pid());" +
                " java.nio.file.Files.move(java.nio.file.Path.of(\"$p.tmp\"), java.nio.file.Path.of(\"$p\"));" +
                " System.out.print(\"$output\"); System.out.flush(); Thread.sleep(120000);",
            dir,
        )
    }

    private fun assertAllGone(pids: File) {
        assertTrue(pids.isFile, "the program wrote its pids")
        pids.readLines().map { it.trim().toLong() }.forEach { pid ->
            val handle = ProcessHandle.of(pid)
            handle.ifPresent { it.onExit().get(10, TimeUnit.SECONDS) }
            assertFalse(handle.map { it.isAlive }.orElse(false), "process $pid is still running")
        }
    }

    private fun awaitFile(file: File) {
        val deadline = System.nanoTime() + Duration.ofSeconds(30).toNanos()
        while (!file.isFile && System.nanoTime() < deadline) Thread.sleep(50)
    }

    // The budget covers starting two source-file JVMs (each compiles first), which is slow on a busy machine.
    @Test
    fun `a command that runs too long is stopped with its children, and fails with its last output`(
        @TempDir dir: File,
    ) {
        val pids = File(dir, "pids")
        val e =
            assertThrows<GradleException> {
                ProcessRunner.run(parentAndChild(dir, pids, "x".repeat(5000) + "the last words"), timeout = Duration.ofSeconds(40))
            }
        assertTrue(e.message!!.contains("did not finish within"), e.message)
        assertTrue(e.message!!.endsWith("the last words"), e.message)
        assertTrue(e.message!!.length < ProcessRunner.OUTPUT_TAIL + 500, "only the end of the output is shown")
        assertAllGone(pids)
    }

    @Test
    fun `an interrupted run stops the command and keeps the interrupt`(
        @TempDir dir: File,
    ) {
        val pids = File(dir, "pids")
        val failure = AtomicReference<Throwable>()
        val interrupted = AtomicReference<Boolean>()
        val runner =
            thread {
                try {
                    ProcessRunner.run(parentAndChild(dir, pids), timeout = Duration.ofMinutes(2))
                } catch (e: Throwable) {
                    failure.set(e)
                    interrupted.set(Thread.currentThread().isInterrupted)
                }
            }
        awaitFile(pids)
        runner.interrupt()
        runner.join(30_000)
        assertTrue(failure.get() is InterruptedException, failure.get()?.toString())
        assertTrue(interrupted.get())
        assertAllGone(pids)
    }

    @Test
    fun `the exit code and output come back`(
        @TempDir dir: File,
    ) {
        val result = ProcessRunner.run(javaRunning("System.out.print(\"hello\"); System.exit(3);", dir), timeout = Duration.ofMinutes(1))
        assertEquals(ProcessResult(3, "hello"), result)
        val e = assertThrows<GradleException> { ProcessRunner.runChecked(javaRunning("System.exit(2);", dir), timeout = Duration.ofMinutes(1)) }
        assertTrue(e.message!!.contains("exit 2"), e.message)
    }

    @Test
    fun `lots of output does not block the command`(
        @TempDir dir: File,
    ) {
        val result =
            ProcessRunner.run(
                javaRunning(
                    "StringBuilder s = new StringBuilder(); for (int i = 0; i < 1024 * 1024; i++) s.append('x'); System.out.print(s); System.err.print(s);",
                    dir,
                ),
                timeout = Duration.ofMinutes(1),
            )
        assertEquals(0, result.exitCode)
        assertEquals(2 * 1024 * 1024, result.output.length)
    }

    @Test
    fun `redacts credentials in URLs, leaving the rest`() {
        assertEquals(
            "via http://***@proxy:3128 and https://***@h/x, not https://h/x or me@corp",
            ProcessRunner.redact("via http://me:s3cr%40t@proxy:3128 and https://tok@h/x, not https://h/x or me@corp"),
        )
    }

    @Test
    fun `a failure does not repeat credentials from the command or the output`(
        @TempDir dir: File,
    ) {
        val outputSecret = "fakepasszz"
        val commandSecret = "fakecmdzz"
        val e =
            assertThrows<GradleException> {
                ProcessRunner.runChecked(
                    javaRunning("System.out.print(\"proxy http://fakeuser:$outputSecret@p:1\"); System.exit(2);", dir) +
                        "https://fakeuser:$commandSecret@registry.example/x",
                    timeout = Duration.ofMinutes(1),
                )
            }
        assertTrue(e.message!!.contains("proxy http://***@p:1"), e.message)
        assertTrue(e.message!!.contains("https://***@registry.example/x"), e.message)
        assertTrue(e.message!!.contains("exit 2"), e.message)
        assertFalse(e.message!!.contains(outputSecret), e.message)
        assertFalse(e.message!!.contains(commandSecret), e.message)
    }

    @Test
    fun `a timeout does not repeat credentials from the command or its output`(
        @TempDir dir: File,
    ) {
        val pids = File(dir, "pids")
        val outputSecret = "fakepasszz"
        val commandSecret = "fakecmdzz"
        val e =
            assertThrows<GradleException> {
                ProcessRunner.run(
                    parentAndChild(dir, pids, "http://fakeuser:$outputSecret@p:1") +
                        "https://fakeuser:$commandSecret@registry.example/x",
                    timeout = Duration.ofSeconds(40),
                )
            }
        assertTrue(e.message!!.contains("did not finish within"), e.message)
        assertTrue(e.message!!.contains("http://***@p:1"), e.message)
        assertTrue(e.message!!.contains("https://***@registry.example/x"), e.message)
        assertFalse(e.message!!.contains(outputSecret), e.message)
        assertFalse(e.message!!.contains(commandSecret), e.message)
        assertAllGone(pids)
    }

    /**
     * The parent exits while a child still holds its output pipe, which is the case the warning
     * exists for. The wait is the runner's own few seconds, then the child is stopped.
     */
    @Test
    fun `a command that leaves its output open redacts credentials in the warning`(
        @TempDir dir: File,
    ) {
        val pids = File(dir, "pids")
        val secret = "fakewarnzz"
        val warnings = mutableListOf<String>()
        val restore = captureLogMessages(warnings)
        try {
            val result =
                ProcessRunner.run(
                    leavingOutputOpen(dir, pids) + "https://fakeuser:$secret@registry.example/x",
                    timeout = Duration.ofMinutes(1),
                )
            assertEquals(0, result.exitCode)
            val text = warnings.joinToString("\n")
            assertTrue(text.contains("still open"), text)
            assertTrue(text.contains("https://***@registry.example/x"), text)
            assertFalse(text.contains(secret), text)
        } finally {
            restore()
            if (pids.isFile) {
                pids.readLines().map { it.trim().toLong() }.forEach { pid ->
                    ProcessHandle.of(pid).ifPresent { handle ->
                        if (handle.isAlive) handle.destroyForcibly()
                    }
                }
            }
        }
        assertAllGone(pids)
    }

    /** A parent that exits as soon as a child has inherited its output. */
    private fun leavingOutputOpen(
        dir: File,
        pids: File,
    ): List<String> {
        val child =
            File(dir, "Hold.java").apply {
                writeText("public class Hold { public static void main(String[] a) throws Exception { Thread.sleep(120000); } }")
            }
        val p = pids.path.replace("\\", "\\\\")
        val j = java.replace("\\", "\\\\")
        val hold = child.path.replace("\\", "\\\\")
        return javaRunning(
            "ProcessBuilder b = new ProcessBuilder(\"$j\", \"$hold\");" +
                " b.redirectOutput(ProcessBuilder.Redirect.INHERIT);" +
                " b.redirectError(ProcessBuilder.Redirect.INHERIT);" +
                " Process c = b.start();" +
                " java.nio.file.Files.writeString(java.nio.file.Path.of(\"$p\"), ProcessHandle.current().pid() + \"\\n\" + c.pid());" +
                " System.exit(0);",
            dir,
        )
    }

    /** Gradle's log listener for the duration of a call. Restores the previous listener. */
    private fun captureLogMessages(into: MutableList<String>): () -> Unit {
        val factory = LoggerFactory.getILoggerFactory()
        val getter = factory.javaClass.methods.find { it.name == "getOutputEventListener" && it.parameterCount == 0 }
        val setter = factory.javaClass.methods.find { it.name == "setOutputEventListener" && it.parameterCount == 1 }
        check(getter != null && setter != null) { "Gradle log listener is not available (${factory.javaClass.name})" }
        val previous = getter.invoke(factory)
        val listenerType = setter.parameterTypes[0]
        val listener =
            Proxy.newProxyInstance(listenerType.classLoader, arrayOf(listenerType)) { _, method, args ->
                when (method.name) {
                    "onOutput" -> {
                        val event = args[0]
                        val message =
                            event.javaClass.methods
                                .find { it.name == "getMessage" && it.parameterCount == 0 }
                                ?.invoke(event) as? String
                        if (message != null) into.add(message)
                        previous
                            ?.javaClass
                            ?.methods
                            ?.find { it.name == "onOutput" && it.parameterCount == 1 }
                            ?.invoke(previous, event)
                        null
                    }
                    "hashCode" -> System.identityHashCode(this)
                    "equals" -> false
                    else -> null
                }
            }
        setter.invoke(factory, listener)
        return { setter.invoke(factory, previous) }
    }
}
