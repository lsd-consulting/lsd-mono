package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.gradle.api.GradleException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import java.io.File
import java.time.Duration

class ProcessRunnerTest {
    private val java = File(System.getProperty("java.home"), "bin/java").path

    /** Runs a small Java program, so the test behaves the same on every OS. */
    private fun javaRunning(code: String, dir: File): List<String> {
        val source = File(dir, "Main.java").apply { writeText("public class Main { public static void main(String[] a) throws Exception { $code } }") }
        return listOf(java, source.path)
    }

    @Test
    fun `a command that runs too long is stopped and fails`(
        @org.junit.jupiter.api.io.TempDir dir: File,
    ) {
        val started = System.nanoTime()
        val e =
            assertThrows<GradleException> {
                ProcessRunner.run(javaRunning("Thread.sleep(60000);", dir), timeout = Duration.ofSeconds(3))
            }
        assertTrue(e.message!!.contains("did not finish within"), e.message)
        assertTrue(Duration.ofNanos(System.nanoTime() - started) < Duration.ofSeconds(30))
    }

    @Test
    fun `the exit code and output come back`(
        @org.junit.jupiter.api.io.TempDir dir: File,
    ) {
        val result = ProcessRunner.run(javaRunning("System.out.print(\"hello\"); System.exit(3);", dir), timeout = Duration.ofMinutes(1))
        assertEquals(ProcessResult(3, "hello"), result)
        val e = assertThrows<GradleException> { ProcessRunner.runChecked(javaRunning("System.exit(2);", dir), timeout = Duration.ofMinutes(1)) }
        assertTrue(e.message!!.contains("exit 2"), e.message)
    }

    @Test
    fun `lots of output does not block the command`(
        @org.junit.jupiter.api.io.TempDir dir: File,
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
