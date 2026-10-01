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
              build-logic/     — shared Gradle conventions (included build)
              modules/         — git submodules (source ownership)
              gradle/          — version catalog + wrapper
            """.trimIndent()
        )
    }
}
