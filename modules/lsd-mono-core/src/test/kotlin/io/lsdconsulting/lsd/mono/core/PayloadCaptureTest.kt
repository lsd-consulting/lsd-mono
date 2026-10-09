package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.PayloadSnapshotTest.Companion.assertValidJson
import io.lsdconsulting.lsd.mono.core.capture.PayloadSnapshot
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import java.util.Collections
import java.util.concurrent.CyclicBarrier
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name
import kotlin.io.path.readText

/** Awkward message data through the whole capture and report path (#27). */
class PayloadCaptureTest {

    @TempDir
    lateinit var tempDir: Path

    @BeforeEach
    fun pointReportsAtTempDir() {
        System.setProperty("lsd.mono.report.outputDir", tempDir.toString())
    }

    @AfterEach
    fun restore() {
        System.setProperty("lsd.mono.report.outputDir", "build/reports/lsd-mono")
        System.clearProperty(PayloadSnapshot.Limits.MAX_STRING_LENGTH)
    }

    class Explodes {
        override fun toString(): String = throw IllegalStateException("toString exploded")
        override fun hashCode(): Int = throw IllegalStateException("hashCode exploded")
    }

    private fun reportFiles(prefix: String) = tempDir.listDirectoryEntries("$prefix*").associate { it.name to it.readText() }

    @Test
    fun `hostile data never breaks capture and the report stays valid and embeddable`() {
        val lsd = LsdContext()
        val cyclic = mutableMapOf<String, Any?>("id" to 1)
        cyclic["self"] = cyclic
        var deep: Any? = "bottom"
        repeat(10_000) { deep = mapOf("next" to deep) }

        lsd.message("Client", "Api", "POST /orders", data = cyclic)
        lsd.message("Api", "Db", "insert", data = Explodes())
        lsd.message("Api", "Db", "record", data = FailingRecord("n", "s"))
        lsd.message("Api", "Db", "deep", data = deep)
        lsd.message("Api", "Queue", "binary", data = byteArrayOf(0, 0xFF.toByte(), 0x10))
        lsd.message("Api", "Client", "html", data = mapOf("body" to "</script><script>alert(1)</script>\u2028<!--", 7 to "\uD800"))
        lsd.message("Api", "Client", "big", data = "z".repeat(300_000))
        lsd.completeScenario("hostile")
        lsd.completeReport("Hostile payloads")

        val files = reportFiles("Hostile-payloads")
        val json = files.entries.single { it.key.endsWith("-report.json") }.value
        assertValidJson(json)
        assertTrue(json.contains("[lsd: cycle back to java.util.LinkedHashMap]"), json.take(2_000))
        assertTrue(json.contains("[lsd: toString() of ${Explodes::class.java.name} threw java.lang.IllegalStateException: toString exploded]"))
        assertTrue(json.contains("[lsd: secret could not be read: java.lang.IllegalStateException: accessor failed]"))
        assertTrue(json.contains("[lsd: max depth 32 reached]"))
        assertTrue(json.contains("[lsd: binary, 3 bytes] base64:AP8Q"))
        assertTrue(json.contains("[lsd: truncated 200000 characters]"))
        assertTrue(json.contains(""""7": "\ufffd""""))
        assertEquals(4, files.size, files.keys.toString())
        for ((name, text) in files) {
            assertFalse(text.contains("alert(1)</script>"), "$name embeds the payload unescaped")
            assertFalse(text.contains("<!--"), "$name embeds a raw <!--")
            assertFalse(text.contains("\u2028"), "$name embeds a raw U+2028")
        }
    }

    @Test
    fun `limits come from properties and clear re-reads them, keeping converters`() {
        System.setProperty(PayloadSnapshot.Limits.MAX_STRING_LENGTH, "4")
        val lsd = LsdContext()
        lsd.payloads.register(StringBuilder::class.java) { "builder:$it" }
        lsd.message("A", "B", "short", data = "abcdefgh")
        lsd.message("A", "B", "builder", data = StringBuilder("xy"))
        lsd.completeScenario("limits")
        lsd.completeReport("Payload limits")
        val json = reportFiles("Payload-limits").entries.single { it.key.endsWith("-report.json") }.value
        assertTrue(json.contains(""""data": "abcd… [lsd: truncated 4 characters]""""), json)
        assertTrue(json.contains(""""data": "buil… [lsd: truncated 6 characters]""""), json)

        System.clearProperty(PayloadSnapshot.Limits.MAX_STRING_LENGTH)
        lsd.clear()
        assertEquals(PayloadSnapshot.Limits(), lsd.payloads.limits)
        assertEquals("builder:xy", lsd.payloads.snapshot(StringBuilder("xy")))
    }

    @Test
    fun `capturing data that other threads are changing never throws`() {
        val lsd = LsdContext()
        val shared = Collections.synchronizedList(mutableListOf<Any?>())
        val plain = mutableListOf<Int>()
        val running = AtomicBoolean(true)
        val mutator = Thread {
            var i = 0
            while (running.get()) {
                shared += i
                plain += i
                if (++i % 50 == 0) {
                    shared.clear()
                    plain.clear()
                }
            }
        }.apply { start() }

        val threads = 6
        val perThread = 500
        val pool = Executors.newFixedThreadPool(threads)
        val barrier = CyclicBarrier(threads)
        val futures = (0 until threads).map { t ->
            pool.submit {
                barrier.await()
                repeat(perThread) { i -> lsd.message("Client $t", "Api", "t$t-$i", data = mapOf("shared" to shared, "plain" to plain)) }
            }
        }
        futures.forEach { it.get(60, TimeUnit.SECONDS) } // rethrows anything capture threw
        running.set(false)
        mutator.join()
        pool.shutdown()

        lsd.completeScenario("racing")
        lsd.completeReport("Racing payloads")
        val json = reportFiles("Racing-payloads").entries.single { it.key.endsWith("-report.json") }.value
        assertValidJson(json)
        assertEquals(threads * perThread, Regex(""""label": "t\d+-\d+"""").findAll(json).count())
    }

    @Test
    fun `snapshot cost stays small for typical payloads`() {
        val payload = mapOf(
            "method" to "POST",
            "path" to "/orders/123",
            "status" to 201,
            "headers" to (1..12).associate { "x-header-$it" to "value-$it" },
            "body" to mapOf("items" to (1..20).map { mapOf("sku" to "SKU-$it", "qty" to it, "price" to it * 1.25) }),
        )
        val lsd = LsdContext()
        repeat(2_000) { lsd.payloads.snapshot(payload) } // warm up
        val captures = 20_000
        val started = System.nanoTime()
        repeat(captures) { i -> lsd.message("Client", "Api", "POST /orders/$i", data = payload) }
        val millis = (System.nanoTime() - started) / 1_000_000
        println("PayloadCaptureTest: $captures captures with a ~${payload.toString().length}-character payload took $millis ms")
        // A generous ceiling that only catches a pathological regression (about 4 µs each when measured).
        assertTrue(millis < 10_000, "took $millis ms")
        lsd.clear()
    }
}
