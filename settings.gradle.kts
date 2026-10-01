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

// Own Gradle projects belonging to this monorepo can be included here, e.g.:
// include("modules:example")
// project(":modules:example").projectDir = file("modules/example")
//
// Submodules under modules/ (e.g. lsd-core) keep their own independent Gradle
// builds and are NOT included here by default. To wire one later as a composite:
//   includeBuild("modules/lsd-core")
// See README.md.
