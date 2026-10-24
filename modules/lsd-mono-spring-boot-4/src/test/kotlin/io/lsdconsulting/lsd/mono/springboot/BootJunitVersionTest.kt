package io.lsdconsulting.lsd.mono.springboot

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Test

/**
 * The starter's tests run on the JUnit the Spring Boot BOM manages, not the repo's: that is the
 * JUnit an app on Boot 4 has. If Boot moves it, bump `spring-boot-junit` in the catalog.
 */
class BootJunitVersionTest {
    @Test
    fun `tests run on the JUnit the Spring Boot BOM manages`() {
        val managed = System.getProperty("lsd.test.bootManagedJunit")
        assertNotNull(managed, "set by the build from the Boot BOM")
        val running = Test::class.java.`package`.implementationVersion
        assertEquals(managed, running, "junit-jupiter-api on the test classpath")
    }
}
