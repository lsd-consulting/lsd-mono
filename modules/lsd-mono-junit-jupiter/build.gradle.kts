import io.lsdconsulting.lsd.mono.gradle.registerIntegrationReadmeSamples

plugins {
    id("lsd.kotlin-jvm")
    `java-library`
}

// Line coverage was 71.7% when the floor was set (#30). Raise the floor as tests are added.
lsdCoverage {
    lineFloor.set(70)
}

description = "LSD Mono JUnit Jupiter 6 integration — extension for living sequence diagram reports"

val readmeSourceSet = sourceSets.create("readme")

dependencies {
    api(project(":modules:lsd-mono-core"))
    api(libs.junit.jupiter.api)

    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testImplementation(libs.junit.platform.launcher)

    // readme source set does not inherit main deps; need core for LsdContext.
    "readmeImplementation"(sourceSets.named("main").get().output)
    "readmeImplementation"(project(":modules:lsd-mono-core"))
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

// README samples (captureReadmeReport, readmeSamples). Same titles LsdExtension would use.
registerIntegrationReadmeSamples(
    readmeSourceSet,
    "io.lsdconsulting.lsd.mono.junitjupiter.readme.JunitReadmeSampleKt",
    "Capture the JUnit README scenario",
)
