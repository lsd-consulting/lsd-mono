package io.github.lsdconsulting.lsd.mono.junitjupiter

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File

/** [TestSource]: finding a test method's source on disk and cutting the method out (#72). */
class TestSourceTest {
    @TempDir
    lateinit var tempDir: File

    @Test
    fun `finds its own source under src test kotlin`() {
        val method = TestSourceTest::class.java.getDeclaredMethod("finds its own source under src test kotlin")

        val source = TestSource.of(TestSourceTest::class.java, method, configuredRoots = emptyList())

        assertEquals(
            listOf("@Test", "fun `finds its own source under src test kotlin`() {"),
            source?.lines()?.take(2),
            source,
        )
        assertTrue(source!!.endsWith("}"), source)
        assertTrue("configuredRoots = emptyList()" in source, source)
    }

    @Test
    fun `a configured source root is tried first`() {
        val dir = File(tempDir, TestSourceTest::class.java.packageName.replace('.', '/')).apply { mkdirs() }
        File(dir, "TestSourceTest.kt").writeText(
            """
            package ${TestSourceTest::class.java.packageName}
            class TestSourceTest {
                @Test
                fun `a configured source root is tried first`() {
                    from("the configured root")
                }
            }
            """.trimIndent(),
        )
        val method = TestSourceTest::class.java.getDeclaredMethod("a configured source root is tried first")

        val source = TestSource.of(TestSourceTest::class.java, method, configuredRoots = listOf(tempDir.absolutePath))

        assertEquals(
            "@Test\nfun `a configured source root is tried first`() {\n    from(\"the configured root\")\n}",
            source,
        )
    }

    @Test
    fun `no source on disk means none`() {
        val method = TestSourceTest::class.java.getDeclaredMethod("no source on disk means none")

        // A JDK class: no compiled location to walk up from, and nothing under the roots given.
        assertNull(TestSource.of(String::class.java, method, configuredRoots = listOf(tempDir.absolutePath), workingDir = tempDir))
    }

    @Test
    fun `braces in strings, characters and comments do not end the method`() {
        val text =
            """
            class Fixture {
                @Test
                @DisplayName("tricky")
                fun `tricky braces`() {
                    val s = "}"
                    val c = '}'
                    // a closing } in a comment
                    /* and { another } */
                    val raw = ${"\"\"\""}{ "json": } ${"\"\"\""}
                    val t = "${'$'}{s.length}"
                    listOf(1).forEach { n ->
                        if (n > 0) { println(n) }
                    }
                }

                fun after() {}
            }
            """.trimIndent()

        val source = TestSource.extract(text, listOf("Fixture"), "tricky braces", kotlin = true)

        assertEquals("@Test", source?.lines()?.first(), source)
        assertEquals("@DisplayName(\"tricky\")", source?.lines()?.get(1), source)
        assertTrue(source!!.lines().last() == "}", source)
        assertTrue("println(n)" in source, source)
        assertTrue("after" !in source, source)
    }

    @Test
    fun `a Kotlin expression body ends with its line`() {
        val text =
            """
            class Fixture {
                @Test
                fun `blows up`(): Unit = throw IllegalStateException("boom {")

                @Test
                fun `runs a block`() = runTest {
                    step()
                }
            }
            """.trimIndent()

        assertEquals(
            "@Test\nfun `blows up`(): Unit = throw IllegalStateException(\"boom {\")",
            TestSource.extract(text, listOf("Fixture"), "blows up", kotlin = true),
        )
        assertEquals(
            "@Test\nfun `runs a block`() = runTest {\n    step()\n}",
            TestSource.extract(text, listOf("Fixture"), "runs a block", kotlin = true),
        )
    }

    @Test
    fun `a Java method is found by its declaration, not a call`() {
        val text =
            """
            class OrderTest {
                @Test
                void placesAnOrder() throws Exception {
                    helper(placesAnOrderCount());
                    if (true) { return; }
                }

                private int placesAnOrderCount() { return placesAnOrder2(); }
            }
            """.trimIndent()

        assertEquals(
            "@Test\nvoid placesAnOrder() throws Exception {\n    helper(placesAnOrderCount());\n    if (true) { return; }\n}",
            TestSource.extract(text, listOf("OrderTest"), "placesAnOrder", kotlin = false),
        )
    }

    @Test
    fun `a nested class's method is taken from that class`() {
        val text =
            """
            class Outer {
                @Test
                fun same() { outer() }

                @Nested
                inner class Inner(val f: () -> Unit = {}) {
                    @Test
                    fun same() { inner() }
                }
            }
            """.trimIndent()

        assertEquals("@Test\nfun same() { outer() }", TestSource.extract(text, listOf("Outer"), "same", kotlin = true))
        assertEquals("@Test\nfun same() { inner() }", TestSource.extract(text, listOf("Outer", "Inner"), "same", kotlin = true))
    }

    @Test
    fun `a method that is not there, or is too long, gives none`() {
        val long = (1..TestSource.MAX_LINES).joinToString("\n") { "    step($it)" }
        val text = "class Fixture {\n  fun long() {\n$long\n  }\n}"

        assertNull(TestSource.extract(text, listOf("Fixture"), "missing", kotlin = true))
        assertNull(TestSource.extract(text, listOf("Other"), "long", kotlin = true))
        assertNull(TestSource.extract(text, listOf("Fixture"), "long", kotlin = true))
    }

    @Nested
    inner class WhenNested {
        @Test
        fun `a nested test class is found in its outer class's file`() {
            val method = WhenNested::class.java.getDeclaredMethod("a nested test class is found in its outer class's file")

            val source = TestSource.of(WhenNested::class.java, method, configuredRoots = emptyList())

            assertEquals("fun `a nested test class is found in its outer class's file`() {", source?.lines()?.get(1), source)
        }
    }
}
