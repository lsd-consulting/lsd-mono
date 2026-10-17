import io.lsdconsulting.lsd.mono.gradle.registerIntegrationReadmeSamples

plugins {
    id("lsd.kotlin-jvm")
    `java-library`
}

// Line coverage was 50.4% when the floor was set (#30). Raise the floor as tests are added.
lsdCoverage {
    lineFloor.set(53)
}

description = "LSD Mono Cucumber 8 integration — plugin for living sequence diagram reports"

// Reads its split-by-steps property through core's integration-only API.
kotlin {
    compilerOptions {
        optIn.add("io.lsdconsulting.lsd.mono.core.InternalLsdApi")
    }
}

val readmeSourceSet = sourceSets.create("readme")

majorLines {
    pin(
        "Cucumber 8",
        8,
        listOf("io.cucumber"),
        listOf(
            "cucumber-bom",
            "cucumber-plugin",
            "cucumber-java8",
            "cucumber-java",
            "cucumber-core",
            "cucumber-junit-platform-engine",
            "cucumber-junit",
            "cucumber-testng",
            "cucumber-spring",
            "cucumber-picocontainer",
            "cucumber-guice",
            "cucumber-cdi",
            "cucumber-gherkin",
            "cucumber-gherkin-messages",
            "datatable",
            "docstring",
            "cucumber-groovy",
        ),
    )
}

dependencies {
    api(project(":modules:lsd-mono-core"))
    api(libs.cucumber.plugin)

    implementation(platform(libs.cucumber.bom))

    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.cucumber.java8)
    testImplementation(libs.cucumber.junit.platform.engine)
    testImplementation(libs.junit.jupiter)
    testImplementation(libs.junit.platform.launcher)

    // readme source set does not inherit main deps.
    "readmeImplementation"(sourceSets.named("main").get().output)
    "readmeImplementation"(project(":modules:lsd-mono-core"))
    "readmeImplementation"(platform(libs.cucumber.bom))
    "readmeImplementation"(libs.cucumber.java8)
    "readmeImplementation"(libs.cucumber.junit.platform.engine)
}

tasks.test {
    systemProperty("lsd.mono.report.outputDir", "build/reports/lsd-test")
    systemProperty("lsd.core.report.outputDir", "build/reports/lsd-test")
    systemProperty("cucumber.publish.enabled", "false")
}

// README samples (captureReadmeReport, readmeSamples): the feature runs through LsdCucumberPlugin.
val readmeFeature = layout.projectDirectory.file(
    "src/readme/resources/io/lsdconsulting/lsd/mono/cucumber/readme/place_order.feature",
)

registerIntegrationReadmeSamples(
    readmeSourceSet,
    "io.lsdconsulting.lsd.mono.cucumber.readme.CucumberReadmeSampleKt",
    "Run the Cucumber README scenario through LsdCucumberPlugin",
) {
    args(readmeFeature.asFile.absolutePath)
    systemProperty("cucumber.publish.enabled", "false")
    inputs.file(readmeFeature)
}
