package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.api.io.TempDir
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
}
