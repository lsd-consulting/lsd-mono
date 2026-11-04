package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertDoesNotThrow
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.api.io.TempDir
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import java.io.File

class StudioPackageTest {
    @TempDir
    lateinit var dir: File

    @Test
    fun `finds the bin script from package json`() {
        val pkg = dir.resolve("pkg").apply { mkdirs() }
        pkg.resolve("package.json").writeText("""{"name":"lsd-mono-studio","bin":{"lsd-mono-studio":"bin/lsd-mono-studio.js"}}""")
        assertEquals(pkg.resolve("bin/lsd-mono-studio.js").canonicalFile, StudioPackage.binScript(pkg))
        pkg.resolve("package.json").writeText("""{"name":"lsd-mono-studio","bin":"cli.js"}""")
        assertEquals(pkg.resolve("cli.js").canonicalFile, StudioPackage.binScript(pkg))
        pkg.resolve("package.json").writeText("""{"name":"lsd-mono-studio"}""")
        assertThrows<IllegalStateException> { StudioPackage.binScript(pkg) }
    }

    @Test
    fun `a directory with a package json runs in place, relative to the project`() {
        dir.resolve("studio").mkdirs()
        dir.resolve("studio/package.json").writeText("{}")
        assertEquals(dir.resolve("studio").canonicalFile, StudioPackage.localDirectory("studio", dir))
        assertNull(StudioPackage.localDirectory("lsd-mono-studio@0.17.0", dir))
    }

    @Test
    fun `registry versions get readable cache folders, local packs a new one per pack`() {
        val cache = dir.resolve("cache")
        assertEquals(cache.resolve("lsd-mono-studio-0.17.0"), StudioPackage.installDir(cache, "lsd-mono-studio@0.17.0", null))
        val tgz = dir.resolve("lsd-mono-studio-0.0.0.tgz").apply { writeText("a") }
        val first = StudioPackage.installDir(cache, tgz.path, StudioPackage.localFile(tgz.path, dir))
        tgz.writeText("ab")
        val second = StudioPackage.installDir(cache, tgz.path, StudioPackage.localFile(tgz.path, dir))
        assertNotEquals(first, second)
        assertEquals(cache.resolve("x/node_modules/lsd-mono-studio"), StudioPackage.packageDir(cache.resolve("x")))
    }

    @ParameterizedTest
    @ValueSource(
        strings = [
            "lsd-mono-studio@latest",
            "lsd-mono-studio@next",
            "lsd-mono-studio@^1.0.0",
            "lsd-mono-studio@~1.2.3",
            "lsd-mono-studio@1",
            "lsd-mono-studio@1.2",
            "lsd-mono-studio@1.2.x",
            "lsd-mono-studio@>=1.2.3",
            "lsd-mono-studio@1.2.3 - 2.0.0",
            "lsd-mono-studio@1.2.3 || 2.0.0",
            "lsd-mono-studio",
            "@acme/lsd-mono-studio@latest",
            "lsd-mono-studio@v1.0.0",
            "github:lsd-consulting/lsd-mono#main",
            "github:lsd-consulting/lsd-mono#abc12",
            "github:lsd-consulting/lsd-mono#298e5b9",
            "github:lsd-consulting/lsd-mono#main#298e5b9eddea5e2a8da0e6c51524c92de0be08c6",
            "https://github.com/lsd-consulting/lsd-mono#main",
            "https://github.com/lsd-consulting/lsd-mono",
            "https://codeload.github.com/lsd-consulting/lsd-mono/tar.gz/main",
            "https://registry.example.com/lsd-mono-studio-1.2.3.tgz#semver:^1",
            "https://registry.example.com/lsd-mono-studio-1.2.3.tgz?v=1",
            "http://registry.example.com/lsd-mono-studio-1.2.3.tgz",
            "other-pkg@1.2.3",
            "@acme/lsd-mono-studio@1.2.3",
            "LSD-Mono-Studio@1.2.3",
            ".lsd-mono-studio@1.2.3",
            "_lsd-mono-studio@1.2.3",
            "no-such-dir/studio",
        ],
    )
    fun `a spec that can move is refused, naming what to use instead`(spec: String) {
        val e = assertThrows<IllegalArgumentException> { StudioPackage.requireFixed(spec) }
        assertTrue(e.message!!.contains("'$spec'"), e.message)
        assertTrue(e.message!!.contains("lsd-mono-studio@1.2.3"), e.message)
        assertNull(StudioPackage.exactVersion(spec))
    }

    @ParameterizedTest
    @ValueSource(
        strings = [
            "lsd-mono-studio@1.2.3",
            "lsd-mono-studio@1.2.3-rc.1",
            " lsd-mono-studio@1.2.3 ",
            "github:lsd-consulting/lsd-mono#298e5b9eddea5e2a8da0e6c51524c92de0be08c6",
            "git+https://github.com/lsd-consulting/lsd-mono.git#298e5b9eddea5e2a8da0e6c51524c92de0be08c6",
            "https://registry.example.com/lsd-mono-studio/-/lsd-mono-studio-1.2.3.tgz",
            "https://example.com/lsd-mono-studio-1.2.3.tar.gz",
        ],
    )
    fun `a spec that cannot move is accepted`(spec: String) {
        assertDoesNotThrow { StudioPackage.requireFixed(spec) }
    }

    @Test
    fun `an exact spec names its version, for lsd-mono-studio only`() {
        assertEquals("1.2.3", StudioPackage.exactVersion("lsd-mono-studio@1.2.3"))
        assertEquals("1.2.3-rc.1", StudioPackage.exactVersion(" lsd-mono-studio@1.2.3-rc.1 "))
        assertNull(StudioPackage.exactVersion("@acme/lsd-mono-studio@0.17.0"))
        assertNull(StudioPackage.exactVersion("other-pkg@9.9.9"))
    }
}
