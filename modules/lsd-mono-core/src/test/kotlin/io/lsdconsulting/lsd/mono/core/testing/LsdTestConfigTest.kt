package io.lsdconsulting.lsd.mono.core.testing

import io.lsdconsulting.lsd.mono.core.properties.LsdProperties
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.MethodOrderer
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Order
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestMethodOrder
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path

/** [LsdTestConfig] points each test at its temp dir and puts every `lsd.*` property back (#74). */
@LsdTestConfig(deterministicIds = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation::class)
class LsdTestConfigTest {
    @TempDir
    lateinit var tempDir: Path

    @Test
    @Order(1)
    fun `the output dir is the test's temp dir and ids are deterministic`() {
        assertEquals(tempDir.toString(), System.getProperty(LsdProperties.OUTPUT_DIR))
        assertEquals("true", System.getProperty(LsdProperties.DETERMINISTIC_IDS))
    }

    @Test
    @Order(2)
    fun `a test sets a key and changes another`() {
        System.setProperty(LEAK, "left behind")
        System.clearProperty(LsdProperties.DETERMINISTIC_IDS)
        System.setProperty(LsdProperties.OUTPUT_DIR, "elsewhere")
    }

    @Test
    @Order(3)
    fun `the next test starts from the snapshot, not from what the last one left`() {
        assertNull(System.getProperty(LEAK))
        assertEquals("true", System.getProperty(LsdProperties.DETERMINISTIC_IDS))
        assertEquals(tempDir.toString(), System.getProperty(LsdProperties.OUTPUT_DIR))
    }

    @Nested
    inner class WithoutItsOwnTempDir {
        @Test
        fun `a nested test uses the enclosing class's temp dir`() {
            assertEquals(tempDir.toString(), System.getProperty(LsdProperties.OUTPUT_DIR))
        }
    }

    companion object {
        const val LEAK = "lsd.mono.test.leak"
    }
}

@LsdTestConfig
class LsdTestConfigOwnDirTest {
    @Test
    fun `without a @TempDir field it makes a temp dir of its own, and ids stay random`() {
        val dir = Path.of(System.getProperty(LsdProperties.OUTPUT_DIR))
        assert(Files.isDirectory(dir)) { "$dir" }
        assertNull(System.getProperty(LsdProperties.DETERMINISTIC_IDS))
    }
}
