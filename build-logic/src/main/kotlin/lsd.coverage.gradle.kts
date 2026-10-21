import io.lsdconsulting.lsd.mono.gradle.LsdCoverage
import kotlinx.kover.gradle.plugin.dsl.CoverageUnit

// Line coverage with Kover. koverVerify runs on `check` and fails below the module's floor;
// `./gradlew koverHtmlReport` shows what is covered. A module sets its floor with
// `lsdCoverage { lineFloor.set(n) }`, a little under its current line coverage. The floor is a
// ratchet: koverVerify also fails when coverage rises more than ratchetMargin points above it
// (reported as a breached maximum), so a module that gains tests must raise its floor too.
// The `readme` source set, where a module has one, holds programs that build the README and
// example reports, not library code, so it is not counted. Nor are the test fixtures
// (`testFixtures`): they are test code for other modules' tests, not published.
plugins {
    id("org.jetbrains.kotlinx.kover")
}

val coverage = extensions.create<LsdCoverage>("lsdCoverage")
coverage.lineFloor.convention(0)

val ratchetMargin = 3

kover {
    currentProject {
        sources {
            excludedSourceSets.add("readme")
            excludedSourceSets.add("testFixtures")
        }
    }
    reports {
        verify {
            rule("line coverage") {
                bound {
                    minValue.set(coverage.lineFloor)
                    coverageUnits.set(CoverageUnit.LINE)
                }
            }
            rule("line coverage ratchet: raise lsdCoverage.lineFloor") {
                bound {
                    maxValue.set(coverage.lineFloor.map { it + ratchetMargin })
                    coverageUnits.set(CoverageUnit.LINE)
                }
            }
        }
    }
}

tasks.named("check") {
    dependsOn("koverVerify")
}
