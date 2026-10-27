package io.github.lsdconsulting.lsd.mono.jvm

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.lang.ref.WeakReference

/** A loaded payload class for [PayloadFieldCacheTest], defined again by a throwaway class loader. */
class ReloadedPayload(
    val id: String = "r-1",
)

/** The reflection cache must not keep payload classes, and so their class loaders, alive (#48). */
class PayloadFieldCacheTest {
    @Test
    fun `a payload class from a discarded class loader can be unloaded`() {
        val loader = capture()
        repeat(50) {
            if (loader.get() == null) return@repeat
            System.gc()
            Thread.sleep(20)
        }
        assertNull(loader.get(), "the class loader is still reachable after capturing one of its classes")
    }

    /** Captures an instance of a class only [IsolatedLoader] knows, and returns a weak reference to that loader. */
    private fun capture(): WeakReference<ClassLoader> {
        val loader = IsolatedLoader(ReloadedPayload::class.java)
        val type = loader.loadClass(ReloadedPayload::class.java.name)
        assertTrue(type !== ReloadedPayload::class.java)
        val instance = type.getConstructor(String::class.java).newInstance("r-2")
        assertEquals(mapOf("id" to "r-2"), PayloadConverters(PayloadConverters.Limits()).snapshot(instance))
        return WeakReference(loader)
    }

    /** Defines [isolated] itself, as a hot-reload class loader would; everything else comes from the parent. */
    private class IsolatedLoader(
        private val isolated: Class<*>,
    ) : ClassLoader(isolated.classLoader) {
        override fun loadClass(name: String, resolve: Boolean): Class<*> {
            if (name != isolated.name) return super.loadClass(name, resolve)
            synchronized(getClassLoadingLock(name)) {
                findLoadedClass(name)?.let { return it }
                val path = name.replace('.', '/') + ".class"
                val bytes = isolated.classLoader.getResourceAsStream(path)!!.use { it.readBytes() }
                return defineClass(name, bytes, 0, bytes.size)
            }
        }
    }
}
