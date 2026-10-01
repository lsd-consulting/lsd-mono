plugins {
    id("lsd.kotlin-jvm")
    `java-library`
}

version = "0.0.1-SNAPSHOT"
base.archivesName.set("lsd-mono-junit-jupiter")

description = "LSD Mono JUnit Jupiter 6 integration — extension for living sequence diagram reports"

dependencies {
    // Prefer published lsd-core; do not wire the modules/lsd-core git submodule into this build.
    api(libs.lsd.core)

    // Compile against Jupiter 6 API so LsdExtension can implement Extension callbacks.
    api(libs.junit.jupiter.api)

    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
}

tasks.test {
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
