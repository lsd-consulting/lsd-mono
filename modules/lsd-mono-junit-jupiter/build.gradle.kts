plugins {
    id("lsd.kotlin-jvm")
    `java-library`
}

version = "0.0.1-SNAPSHOT"
base.archivesName.set("lsd-mono-junit-jupiter")

description = "LSD Mono JUnit Jupiter 6 integration — extension for living sequence diagram reports"

dependencies {
    // First-party greenfield core (not Maven lsd-core).
    api(project(":modules:lsd-mono-core"))

    // Compile against Jupiter 6 API so LsdExtension can implement Extension callbacks.
    api(libs.junit.jupiter.api)

    testImplementation(libs.junit.jupiter)
    testImplementation(libs.junit.platform.launcher)
}

tasks.test {
    useJUnitPlatform {
        // Engine fixtures are launched explicitly from LsdExtensionOutcomesTest.
        excludeTags("lsd-fixture")
    }
    systemProperty("lsd.mono.report.outputDir", "build/reports/lsd-test")
    // Legacy key still honoured by mono LsdProperties fallbacks
    systemProperty("lsd.core.report.outputDir", "build/reports/lsd-test")
}

tasks.jar {
    manifest {
        attributes(
            "Implementation-Title" to "lsd-mono-junit-jupiter",
            "Implementation-Version" to project.version,
        )
    }
}
