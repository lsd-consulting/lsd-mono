package io.lsdconsulting.lsd.mono.gradle

import org.gradle.api.provider.Property

/** `lsdCoverage { lineFloor.set(n) }`: the lowest line coverage, in percent, that `check` accepts. */
abstract class LsdCoverage {
    abstract val lineFloor: Property<Int>
}
