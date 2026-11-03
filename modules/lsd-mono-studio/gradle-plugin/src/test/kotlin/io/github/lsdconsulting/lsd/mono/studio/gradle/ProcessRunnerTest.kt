package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.gradle.api.GradleException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.api.io.TempDir
import java.io.File
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
}
