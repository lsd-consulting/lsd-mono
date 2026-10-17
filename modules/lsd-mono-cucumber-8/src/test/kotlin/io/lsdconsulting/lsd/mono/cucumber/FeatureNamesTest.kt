package io.lsdconsulting.lsd.mono.cucumber

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.net.URI
import java.nio.file.Path
import java.nio.file.Paths

class FeatureNamesTest {
    private val cwd: Path = Paths.get("").toAbsolutePath()

    @Test
    fun `a feature file under the working directory is keyed by its relative path`() {
        val uri = cwd.resolve("src/test/resources/shop/checkout.feature").toUri()

        assertEquals("src/test/resources/shop/checkout.feature", featureKey(uri, cwd))
    }

    @Test
    fun `a feature file elsewhere, or a classpath feature, keeps its URI`() {
        val elsewhere = cwd.root
            .resolve("elsewhere-lsd")
            .resolve("checkout.feature")
            .toUri()
        val classpath = URI("classpath:shop/checkout.feature")

        assertEquals(elsewhere.toString(), featureKey(elsewhere, cwd))
        assertEquals("classpath:shop/checkout.feature", featureKey(classpath, cwd))
    }

    @Test
    fun `a file URI that is not a local path keeps its URI`() {
        val remote = URI("file://build-host/shared/checkout.feature")

        assertEquals("file://build-host/shared/checkout.feature", featureKey(remote, cwd))
    }

    @Test
    fun `the title is the file name without its extension, query or fragment`() {
        assertEquals("checkout", featureTitle(URI("classpath:shop/checkout.feature"), "fallback"))
        assertEquals("checkout", featureTitle(URI("file:/work/shop/checkout.feature?line=3#x"), "fallback"))
        assertEquals("checkout", featureTitle(URI("classpath:checkout.feature"), "fallback"))
    }

    @Test
    fun `a URI with no file name falls back to the given title`() {
        assertEquals("Place an order", featureTitle(URI("file:/work/shop/"), "Place an order"))
    }
}
