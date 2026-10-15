package io.lsdconsulting.lsd.mono.core

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class ScenarioRegistryTest {
    private val context = LsdContext()
    private val registry = ScenarioRegistry(context, Any())

    @Test
    fun `an unbound capture goes to the only running scenario, else the default`() {
        assertSame(registry.defaultScenario, registry.target())
        val one = registry.begin("r", "one", bindCurrentThread = false)
        assertSame(one, registry.target())
        registry.begin("r", "two", bindCurrentThread = false)
        assertSame(registry.defaultScenario, registry.target())
    }

    @Test
    fun `a bound thread captures into its scenario until it is removed`() {
        val bound = registry.begin(null, "a", bindCurrentThread = true)
        registry.begin(null, "b", bindCurrentThread = false)
        assertSame(bound, registry.current())
        assertTrue(registry.remove(bound))
        assertFalse(registry.remove(bound), "a second remove finds nothing")
        registry.forget(bound)
        assertNull(registry.current())
        assertFalse(registry.isActive(bound))
    }

    @Test
    fun `keys are unique while running, and running lists a report's scenarios in begin order`() {
        val a = registry.begin("r", "a", bindCurrentThread = false)
        assertThrows<IllegalStateException> { registry.begin("r", "a", bindCurrentThread = false) }
        val b = registry.begin("r", "b", bindCurrentThread = false)
        registry.begin("other", "c", bindCurrentThread = false)
        assertTrue(registry.running("r") == listOf(a, b))
        assertSame(b, registry.findByCorrelationId(b.correlationId))
        registry.clear()
        assertTrue(registry.isEmpty())
        assertNull(registry.find("a"))
    }
}
