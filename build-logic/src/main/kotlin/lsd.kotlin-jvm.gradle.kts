import io.github.lsdconsulting.lsd.mono.gradle.MajorLines

plugins {
    id("org.jetbrains.kotlin.jvm")
    id("lsd.common")
    id("lsd.major-line")
    id("lsd.formatting")
    id("lsd.coverage")
    id("lsd.publishing")
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
// A module built against a library that needs a newer Java sets `lsd.jvm` in its own
// gradle.properties (lsd-mono-http4k-6: http4k 6 is compiled for 21), and that is its baseline
// instead. It is never below the repo's, and its tests never run on an older JDK.
val repoBaseline: Int =
    extensions
        .getByType<VersionCatalogsExtension>()
        .named("libs")
        .findVersion("jvm")
        .get()
        .requiredVersion
        .toInt()
val baseline: Int =
    (findProperty("lsd.jvm") as String?)
        ?.trim()
        ?.let { it.toIntOrNull() ?: error("lsd.jvm must be a Java version such as 21, was '$it' (${project.path}/gradle.properties)") }
        ?.coerceAtLeast(repoBaseline)
        ?: repoBaseline

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(baseline))
    }
    withSourcesJar()
}

// Jars are named after the project (the default archivesName) and say so in their manifest.
tasks.named<Jar>("jar") {
    manifest {
        attributes(
            "Implementation-Title" to project.name,
            "Implementation-Version" to project.version,
        )
    }
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
                annotatedWith.add("io.github.lsdconsulting.lsd.mono.jvm.InternalLsdApi")
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
        val runOn = testJvm.map { if (it.asInt() < baseline) JavaLanguageVersion.of(baseline) else it }
        javaLauncher.set(javaToolchains.launcherFor { languageVersion.set(runOn) })
    }
    useJUnitPlatform()
    testLogging {
        events("failed", "skipped")
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
}
