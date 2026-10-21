plugins {
    id("lsd.kotlin-jvm")
    `java-library`
}

description =
    "LSD Mono report model: the report JSON as plain Kotlin values, for producers that write a report without lsd-mono-core"

// The report model is experimental (@ExperimentalLsdReportModel); its own tests use it freely.
kotlin {
    compilerOptions {
        optIn.add("io.lsdconsulting.lsd.mono.report.model.ExperimentalLsdReportModel")
    }
}

// The model is plain values, so there is little to cover. Line coverage was 73.1% when the floor
// was set: what is left is the data classes' generated code.
lsdCoverage {
    lineFloor.set(71)
}

dependencies {
    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
}
