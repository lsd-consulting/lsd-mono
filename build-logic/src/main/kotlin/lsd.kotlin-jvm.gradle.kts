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

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
    withSourcesJar()
}

// Every module using this convention is published, so its public API is deliberate:
// explicit API mode makes each declaration state its visibility and return type
// (tests are exempt), and the committed `api/<module>.api` dump makes any change to
// the public ABI show up in review. `check` runs `checkKotlinAbi`; after an intended
// API change run `./gradlew updateKotlinAbi` and commit the new dump.
kotlin {
    explicitApi()

    @OptIn(org.jetbrains.kotlin.gradle.dsl.abi.ExperimentalAbiValidation::class)
    abiValidation()
}

tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_21)
    }
}

tasks.withType<Test>().configureEach {
    useJUnitPlatform()
    testLogging {
        events("failed", "skipped")
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
}
