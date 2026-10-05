import io.lsdconsulting.lsd.mono.gradle.MajorLines

plugins {
    id("org.jetbrains.kotlin.jvm")
    id("lsd.common")
    id("lsd.major-line")
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
