// Kotlin formatting and lint: ktlint through Spotless. spotlessCheck runs on `check`, so CI
// fails on unformatted code; `./gradlew spotlessApply` fixes it. Rules and style are in
// the root .editorconfig. The ktlint version comes from the version catalog.
plugins {
    id("com.diffplug.spotless")
}

val ktlintVersion =
    extensions
        .getByType<VersionCatalogsExtension>()
        .named("libs")
        .findVersion("ktlint")
        .get()
        .requiredVersion

spotless {
    kotlin {
        target("src/**/*.kt")
        ktlint(ktlintVersion)
    }
    kotlinGradle {
        target("*.gradle.kts")
        ktlint(ktlintVersion)
    }
}
