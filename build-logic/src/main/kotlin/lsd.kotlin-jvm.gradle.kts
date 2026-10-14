import io.lsdconsulting.lsd.mono.gradle.MajorLines

plugins {
    id("org.jetbrains.kotlin.jvm")
    id("lsd.common")
    id("lsd.major-line")
    id("lsd.formatting")
    id("lsd.coverage")
}

extensions.configure<MajorLines>("majorLines") {
    pin("JUnit 6", 6, listOf("org.junit", "org.junit.jupiter", "org.junit.platform"))
    ban("junit", "JUnit 4 is not used", module = "junit")
    ban("org.junit.vintage", "JUnit 4 is not used")
}

// The Java baseline, `jvm` in gradle/libs.versions.toml, is the one place the version lives.
// Sources compile for it (Kotlin jvmTarget and -Xjdk-release, javac --release) with a toolchain
// of that version, and tests run on it by default. `-Plsd.test.jvm=21` runs the tests on another
// JDK instead, which is how CI covers 21 and 25 (see .github/workflows/gradle.yml).
val baseline: Int =
    extensions
        .getByType<VersionCatalogsExtension>()
        .named("libs")
        .findVersion("jvm")
        .get()
        .requiredVersion
        .toInt()

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(baseline))
    }
    withSourcesJar()
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(baseline)
}

val testJvm: Provider<JavaLanguageVersion> =
    providers.gradleProperty("lsd.test.jvm").map { JavaLanguageVersion.of(it.trim().toInt()) }
val javaToolchains = extensions.getByType<JavaToolchainService>()

// Every module using this convention is published, so its public API is deliberate:
// explicit API mode makes each declaration state its visibility and return type
// (tests are exempt), and the committed `api/<module>.api` dump makes any change to
// the public ABI show up in review. `check` runs `checkKotlinAbi`; after an intended
// API change run `./gradlew updateKotlinAbi` and commit the new dump. API marked
// @InternalLsdApi is only for lsd-mono's own integrations, so it is left out of the dump.
kotlin {
    explicitApi()

    @OptIn(org.jetbrains.kotlin.gradle.dsl.abi.ExperimentalAbiValidation::class)
    abiValidation {
        filters {
            exclude {
                annotatedWith.add("io.lsdconsulting.lsd.mono.core.InternalLsdApi")
            }
        }
    }
}

tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
    compilerOptions {
        jvmTarget.set(
            org.jetbrains.kotlin.gradle.dsl.JvmTarget
                .fromTarget(baseline.toString()),
        )
        // Kotlin's --release: compile against the baseline JDK's API, not the toolchain's.
        freeCompilerArgs.add("-Xjdk-release=$baseline")
    }
}

tasks.withType<Test>().configureEach {
    if (testJvm.isPresent) {
        javaLauncher.set(javaToolchains.launcherFor { languageVersion.set(testJvm) })
    }
    useJUnitPlatform()
    testLogging {
        events("failed", "skipped")
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
}
