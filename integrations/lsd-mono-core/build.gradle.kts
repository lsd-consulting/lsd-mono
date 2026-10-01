plugins {
    id("lsd.kotlin-jvm")
    `java-library`
}

version = "0.0.1-SNAPSHOT"
base.archivesName.set("lsd-mono-core")

description =
    "LSD Mono core — greenfield report-next UI + thin Kotlin capture/report façade (not legacy lsd-core)"

dependencies {
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
}

tasks.test {
    systemProperty("lsd.mono.report.outputDir", "build/reports/lsd-mono")
}

tasks.jar {
    manifest {
        attributes(
            "Implementation-Title" to "lsd-mono-core",
            "Implementation-Version" to project.version,
        )
    }
}

// Spike lives under report-next/ (Vite+TS). Full npm/vite build is optional and
// not required for ./gradlew build. Prebuilt single-file HTML is packaged as a
// classpath resource under lsd-mono-core/report-next/.
