import io.lsdconsulting.lsd.mono.gradle.nodeCommandLine

plugins {
    id("lsd.kotlin-jvm")
    `java-library`
}

// Line coverage was 50.4% when the floor was set (#30). Raise the floor as tests are added.
lsdCoverage {
    lineFloor.set(49)
}

base.archivesName.set("lsd-mono-cucumber-8")

description = "LSD Mono Cucumber 8 integration — plugin for living sequence diagram reports"

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

tasks.jar {
    manifest {
        attributes(
            "Implementation-Title" to "lsd-mono-cucumber-8",
            "Implementation-Version" to project.version,
        )
    }
}

// Node 22 helpers live in build-logic NodeToolchain.kt (shared with lsd-mono-core).

// README samples are slow and write docs/. They are not on build or check.
val readmeReportDir = layout.buildDirectory.dir("readme-report")
val readmeDocsDir = layout.projectDirectory.dir("docs/readme")
val coreProject = project(":modules:lsd-mono-core")
val coreReportDir = coreProject.layout.projectDirectory.dir("report")
val readmeFeature = layout.projectDirectory.file(
    "src/readme/resources/io/lsdconsulting/lsd/mono/cucumber/readme/place_order.feature",
)

tasks.register<JavaExec>("captureReadmeReport") {
    group = "documentation"
    description =
        "Run the Cucumber README scenario through LsdCucumberPlugin and write its report HTML."
    dependsOn(coreProject.tasks.named("copyReportShell"))
    dependsOn(coreProject.tasks.named("classes"))
    classpath = readmeSourceSet.runtimeClasspath
    mainClass.set("io.lsdconsulting.lsd.mono.cucumber.readme.CucumberReadmeSampleKt")
    args(readmeFeature.asFile.absolutePath)
    javaLauncher.set(
        javaToolchains.launcherFor {
            languageVersion.set(JavaLanguageVersion.of(21))
        },
    )
    systemProperty("lsd.mono.report.outputDir", readmeReportDir.get().asFile.absolutePath)
    // Report names carry a hash, so start clean: the README scripts expect one *-diagram.html.
    val cleanDir = readmeReportDir.get().asFile
    doFirst { cleanDir.deleteRecursively() }
    systemProperty("lsd.mono.ids.deterministic", "true")
    systemProperty("lsd.mono.report.generatedAt", providers.gradleProperty("lsd.samples.generatedAt").get())
    systemProperty("cucumber.publish.enabled", "false")
    outputs.dir(readmeReportDir)
    inputs.file(readmeFeature)
}

tasks.register<Exec>("readmeSamples") {
    group = "documentation"
    description =
        "Regenerate docs/readme PNG and GIF samples from the current report UI. Not part of build or check."
    dependsOn("captureReadmeReport")
    workingDir = coreReportDir.asFile
    inputs.dir(readmeReportDir)
    inputs.file(coreReportDir.file("scripts/readme-samples.mjs"))
    outputs.file(readmeDocsDir.file("diagram.png"))
    outputs.file(readmeDocsDir.file("inspector.png"))
    outputs.file(readmeDocsDir.file("zoom.gif"))
    val reportOut = readmeReportDir.get().asFile.absolutePath
    val docsOut = readmeDocsDir.asFile.absolutePath
    nodeCommandLine("scripts/readme-samples.mjs", reportOut, docsOut)
}
