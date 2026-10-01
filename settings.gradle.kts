pluginManagement {
    includeBuild("build-logic")
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

plugins {
    // Apply the foojay toolchain resolver for reliable JDK provisioning
    id("org.gradle.toolchains.foojay-resolver-convention") version "0.9.0"
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.PREFER_PROJECT)
    repositories {
        mavenCentral()
    }
}

rootProject.name = "lsd-mono"

// First-party mono projects (not git submodules). See integrations/README.md.
// Names include "mono" so they do not clash with published lsd-consulting libs.
include("integrations:lsd-mono-junit-jupiter")
project(":integrations:lsd-mono-junit-jupiter").projectDir = file("integrations/lsd-mono-junit-jupiter")

// Submodules under modules/ (e.g. lsd-core) keep their own independent Gradle
// builds and are NOT included here by default. To wire one later as a composite:
//   includeBuild("modules/lsd-core")
// See README.md.
