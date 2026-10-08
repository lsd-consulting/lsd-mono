pluginManagement {
    includeBuild("build-logic")
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

plugins {
    // Apply the foojay toolchain resolver for reliable JDK provisioning
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

dependencyResolutionManagement {
    // Every repository is declared here; a module that adds its own fails the build.
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        mavenCentral()
    }
}

rootProject.name = "lsd-mono"

// First-party mono projects. See modules/README.md.
// Names include "mono" so they do not clash with published lsd-consulting libs.
// Gradle maps ":modules:x" to modules/x, so no projectDir overrides are needed.
include("modules:lsd-mono-core")
include("modules:lsd-mono-junit-jupiter")
include("modules:lsd-mono-cucumber-8")
