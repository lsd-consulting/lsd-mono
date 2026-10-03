plugins {
    // Root is a thin aggregator; convention plugins live in build-logic.
    base
}

group = "io.lsdconsulting"
version = "0.0.1-SNAPSHOT"

tasks.register("printLayout") {
    group = "help"
    description = "Prints the LSD Mono layout reminder"
    doLast {
        println(
            """
            LSD Mono layout:
              build-logic/       — shared Gradle conventions (included build)
              modules/           — first-party greenfield modules
                lsd-mono-core/           — core + report-next UI
                lsd-mono-junit-jupiter/  — JUnit 6 → mono-core
              gradle/            — version catalog + wrapper
            """.trimIndent()
        )
    }
}
