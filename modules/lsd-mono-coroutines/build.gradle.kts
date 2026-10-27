plugins {
    id("lsd.kotlin-jvm")
    `java-library`
}

// Line coverage was 100% when the floor was set. Raise the floor as tests are added.
lsdCoverage {
    lineFloor.set(98)
}

description = "LSD Mono coroutines integration — keeps a scenario bound while a coroutine hops threads"

// This module is built against kotlinx.coroutines 1. The exact version is the catalog's
// `kotlinx-coroutines`; this only stops a resolve from landing on another major. A 2.x
// integration would be a new module, not a move of this pin.
// Only the coroutines artifacts are pinned: other org.jetbrains.kotlinx groups on the
// classpath (such as the Kover agent) have their own versions.
majorLines {
    pin(
        "kotlinx.coroutines 1",
        1,
        listOf("org.jetbrains.kotlinx"),
        listOf("kotlinx-coroutines-core", "kotlinx-coroutines-core-jvm", "kotlinx-coroutines-bom"),
    )
}

dependencies {
    api(project(":modules:lsd-mono-jvm"))

    // Public API returns ThreadContextElement and takes a CoroutineScope block.
    api(libs.kotlinx.coroutines.core)

    testImplementation(platform(libs.junit.bom))
    // LsdTestConfig and ReportJson (#74).
    testImplementation(testFixtures(project(":modules:lsd-mono-jvm")))
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
}

tasks.test {
    systemProperty("lsd.mono.report.outputDir", "build/reports/lsd-test")
}
