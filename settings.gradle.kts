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
    repositoriesMode.set(RepositoriesMode.PREFER_PROJECT)
    repositories {
        mavenCentral()
    }
}

rootProject.name = "lsd-mono"

// First-party mono projects. See modules/README.md.
// Names include "mono" so they do not clash with published lsd-consulting libs.
include("modules:lsd-mono-core")
project(":modules:lsd-mono-core").projectDir = file("modules/lsd-mono-core")

include("modules:lsd-mono-junit-jupiter")
project(":modules:lsd-mono-junit-jupiter").projectDir = file("modules/lsd-mono-junit-jupiter")

include("modules:lsd-mono-cucumber-8")
project(":modules:lsd-mono-cucumber-8").projectDir = file("modules/lsd-mono-cucumber-8")
