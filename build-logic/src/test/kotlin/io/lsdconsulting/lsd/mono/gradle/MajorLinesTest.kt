package io.lsdconsulting.lsd.mono.gradle

import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class MajorLinesTest {
    private val junitGroups = listOf("org.junit", "org.junit.jupiter", "org.junit.platform")

    private fun junit6() = MajorLines().apply { pin("JUnit 6", 6, junitGroups) }

    @Test
    fun `a version on the pinned major passes`() {
        assertNull(junit6().problem("org.junit.jupiter", "junit-jupiter-api", "6.1.3"))
        assertNull(junit6().problem("org.junit.platform", "junit-platform-launcher", "6.0.0"))
    }

    @Test
    fun `a newer major is rejected and says to make a new module`() {
        val problem = junit6().problem("org.junit.jupiter", "junit-jupiter-api", "7.0.0")
        assertTrue(problem!!.contains("outside the JUnit 6 line"))
        assertTrue(problem.contains("new module"))
    }

    @Test
    fun `an older major is rejected`() {
        assertTrue(junit6().problem("org.junit.platform", "junit-platform-engine", "1.13.4") != null)
    }

    @Test
    fun `a non numeric version is rejected`() {
        assertTrue(junit6().problem("org.junit", "junit-bom", "latest.release") != null)
    }

    @Test
    fun `groups that are not pinned are ignored`() {
        assertNull(junit6().problem("com.example", "thing", "99.0.0"))
    }

    @Test
    fun `a module filter leaves other artifacts in the group alone`() {
        val cucumber = MajorLines().apply {
            pin("Cucumber 8", 8, listOf("io.cucumber"), listOf("cucumber-plugin", "cucumber-java8"))
        }
        assertNull(cucumber.problem("io.cucumber", "cucumber-plugin", "8.0.4"))
        assertTrue(cucumber.problem("io.cucumber", "cucumber-java8", "9.0.0") != null)
        assertNull(cucumber.problem("io.cucumber", "messages", "27.2.0"))
        assertNull(cucumber.problem("io.cucumber", "gherkin", "32.1.0"))
    }

    @Test
    fun `a banned module is rejected whatever its version`() {
        val lines = MajorLines().apply { ban("junit", "JUnit 4 is not used", module = "junit") }
        assertTrue(lines.problem("junit", "junit", "4.13.2")!!.contains("JUnit 4 is not used"))
        assertNull(lines.problem("junit", "other", "4.13.2"))
    }

    @Test
    fun `a banned group is rejected for every module`() {
        val lines = MajorLines().apply { ban("org.junit.vintage", "no vintage engine") }
        assertTrue(lines.problem("org.junit.vintage", "junit-vintage-engine", "6.1.3") != null)
    }

    @Test
    fun `a ban wins over a pin`() {
        val lines = MajorLines().apply {
            pin("JUnit 6", 6, junitGroups)
            ban("org.junit.vintage", "no vintage engine")
            ban("org.junit.jupiter", "no", module = "junit-jupiter-migrationsupport")
        }
        assertTrue(lines.problem("org.junit.jupiter", "junit-jupiter-migrationsupport", "6.1.3")!!.startsWith("blocked"))
    }
}
