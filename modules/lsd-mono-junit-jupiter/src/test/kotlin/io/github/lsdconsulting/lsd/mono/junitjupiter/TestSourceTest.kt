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
    fun `an expression body wrapped onto the next lines is taken whole`() {
        val text =
            """
            class Fixture {
                @Test
                fun `wrapped`() =
                    runTest { step() }

                @Test
                fun `wrapped call`() =
                    assertEquals(
                        1,
                        one(),
                    )

                @Test
                fun `chained`(): Unit = parse("a")
                    .let { check(it) }
                @Test
                fun `last`() =
                    done()
            }
            """.trimIndent()

        assertEquals(
            "@Test\nfun `wrapped`() =\n    runTest { step() }",
            TestSource.extract(text, listOf("Fixture"), "wrapped", kotlin = true),
        )
        assertEquals(
            "@Test\nfun `wrapped call`() =\n    assertEquals(\n        1,\n        one(),\n    )",
            TestSource.extract(text, listOf("Fixture"), "wrapped call", kotlin = true),
        )
        assertEquals(
            "@Test\nfun `chained`(): Unit = parse(\"a\")\n    .let { check(it) }",
            TestSource.extract(text, listOf("Fixture"), "chained", kotlin = true),
        )
        assertEquals("@Test\nfun `last`() =\n    done()", TestSource.extract(text, listOf("Fixture"), "last", kotlin = true))
    }

    @Test
    fun `annotations whose arguments span lines are kept, with those above them`() {
        val text =
            """
            class Fixture {
                @ParameterizedTest
                @CsvSource(
                    "getURLs, get urls",
                    "a(b), a b",
                )
                @Tag("slow")
                fun `splits words`(input: String, expected: String) {
                    check(input, expected)
                }

                fun helper() = listOf(
                    1,
                )
                fun `after a call`() { go() }
            }
            """.trimIndent()

        assertEquals(
            "@ParameterizedTest\n@CsvSource(\n    \"getURLs, get urls\",\n    \"a(b), a b\",\n)\n@Tag(\"slow\")\n" +
                "fun `splits words`(input: String, expected: String) {\n    check(input, expected)\n}",
            TestSource.extract(text, listOf("Fixture"), "splits words", kotlin = true),
        )
        // A `)` above that closes a call, not an annotation, is not taken.
        assertEquals("fun `after a call`() { go() }", TestSource.extract(text, listOf("Fixture"), "after a call", kotlin = true))
    }

    @Test
    fun `a call inside another method's body is not taken for the declaration`() {
        val text =
            """
            class OrderTest {
                Object other() { return placesAnOrder(); }

                @Test
                void placesAnOrder() {
                    go();
                }
            }
            """.trimIndent()

        assertEquals(
            "@Test\nvoid placesAnOrder() {\n    go();\n}",
            TestSource.extract(text, listOf("OrderTest"), "placesAnOrder", kotlin = false),
        )
    }

    @Test
    fun `a declaration inside a comment or string is not taken`() {
        val text =
            """
            class Fixture {
                /** Replaces fun same() { old() } */
                val note = "fun same() { quoted() }"

                @Test
                fun same() { real() }
            }
            """.trimIndent()

        assertEquals("@Test\nfun same() { real() }", TestSource.extract(text, listOf("Fixture"), "same", kotlin = true))
    }

    @Test
    fun `kotlin block comments nest, java ones do not`() {
        val kotlinText =
            """
            class Fixture {
                @Test
                fun nested() {
                    /* a /* b */ } */
                    go()
                }
            }
            """.trimIndent()
        assertEquals(
            "@Test\nfun nested() {\n    /* a /* b */ } */\n    go()\n}",
            TestSource.extract(kotlinText, listOf("Fixture"), "nested", kotlin = true),
        )
        val javaText =
            """
            class Fixture {
                @Test
                void flat() {
                    /* a /* b */ go();
                }
            }
            """.trimIndent()
        assertEquals(
            "@Test\nvoid flat() {\n    /* a /* b */ go();\n}",
            TestSource.extract(javaText, listOf("Fixture"), "flat", kotlin = false),
        )
    }

    @Test
    fun `an internal method's module suffix is dropped from its name`() {
        val method = WithInternal::class.java.declaredMethods.single { it.name.startsWith("probe") }
        assertTrue('$' in method.name, method.name)

        val source = TestSource.of(WithInternal::class.java, method, configuredRoots = emptyList())

        assertEquals("internal fun probe() {\n    \"internal\"\n}", source)
    }

    @Test
    fun `the source is found above the compiled classes when the working directory has none`() {
        val method = TestSourceTest::class.java.getDeclaredMethod("finds its own source under src test kotlin")

        val source = TestSource.of(TestSourceTest::class.java, method, configuredRoots = emptyList(), workingDir = tempDir)

        assertEquals("fun `finds its own source under src test kotlin`() {", source?.lines()?.get(1), source)
    }

    @Test
    fun `recent sources are kept up to their capacity, a missing one too`() {
        val recent = TestSource.Recent<String, String>(capacity = 2)
        var loads = 0
        assertEquals(
            "a",
            recent.get("a") {
                loads++
                "a"
            },
        )
        assertEquals(
            "a",
            recent.get("a") {
                loads++
                "again"
            },
        )
        assertNull(
            recent.get("none") {
                loads++
                null
            },
        )
        assertNull(
            recent.get("none") {
                loads++
                "late"
            },
        )
        assertEquals(2, loads)
        recent.get("b") { "b" }
        assertEquals(2, recent.size)
        assertEquals("reloaded", recent.get("a") { "reloaded" }, "the eldest went")
    }

    @Test
    fun `sources it cannot cut give none, and a one-line body ends at the class`() {
        fun cut(text: String, name: String = "x", kotlin: Boolean = true) = TestSource.extract(text, listOf("F"), name, kotlin)

        assertEquals("fun x() = 1", cut("class F {\n    fun x() = 1 }"))
        assertNull(cut("class F(val a: Int)\nfun x() {}"), "a class with no body")
        assertNull(cut("abstract class F {\n    abstract void x();\n}", kotlin = false), "no body")
        assertNull(cut("class F {\n    fun x(a: Int"), "an unfinished declaration")
        assertNull(cut("class F {\n    /* never closed\n    fun x() {}\n}"), "inside an open Kotlin comment")
        assertNull(cut("class F {\n    /* never closed\n    void x() {}\n}", kotlin = false), "inside an open Java comment")
        assertEquals("fun x() {}", cut("class F {\n    )\n    fun x() {}\n}"), "a stray ) above")
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

/** For the `$module` suffix test: an internal function's JVM name is `probe$<module>`. */
class WithInternal {
    internal fun probe() {
        "internal"
    }
}
