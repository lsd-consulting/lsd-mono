import io.lsdconsulting.lsd.mono.gradle.LsdCoverage
import kotlinx.kover.gradle.plugin.dsl.CoverageUnit

// Line coverage with Kover. koverVerify runs on `check` and fails below the module's floor;
// `./gradlew koverHtmlReport` shows what is covered. A module sets its floor with
// `lsdCoverage { lineFloor.set(n) }`, a little under its current line coverage, and raises
// it as tests are added.
plugins {
    id("org.jetbrains.kotlinx.kover")
}

val coverage = extensions.create<LsdCoverage>("lsdCoverage")
coverage.lineFloor.convention(0)

kover {
    reports {
        verify {
            rule("line coverage") {
                bound {
                    minValue.set(coverage.lineFloor)
                    coverageUnits.set(CoverageUnit.LINE)
                }
            }
        }
    }
}

tasks.named("check") {
    dependsOn("koverVerify")
}
