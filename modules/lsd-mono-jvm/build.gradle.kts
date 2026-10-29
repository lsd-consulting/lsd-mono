plugins {
    id("lsd.kotlin-jvm")
    `java-library`
    // LsdTestConfig and ReportJson for this module's tests and the integrations' (#74). Not published.
    `java-test-fixtures`
    // Feature-tour and example report (kitchen-sink) sample tasks (readmeSamples, kitchenSinkSample).
    id("lsd.samples")
}

// Line coverage was 73.3% when the floor was set (#30), with the readme samples counted. Without them
// it is 97.4%. Raise the floor as tests are added.
lsdCoverage {
    lineFloor.set(95)
}

description =
    "Living sequence diagrams: capture the interactions in your tests and write an interactive HTML report"

// Core maps its scenarios to the report model and writes them with the writer, which move with it in
// lockstep.
//
// Never let a model or writer type (io.github.lsdconsulting.lsd.mono.report.model or .report.html)
// appear in core's public API. Core takes the model and writer as implementation, not api: a
// consumer has them only at runtime, so its compiler would fail with "Cannot access class
// FactJson". checkKotlinAbi fails on such a change; do not accept it with updateKotlinAbi.
dependencies {
    // The report as plain values (ReportJson and the rest), and the writer of its JSON and HTML
    // files with the report UI. Neither is in core's public API.
    implementation(project(":modules:lsd-mono-report-model"))
    // api: completeReport and report { } return its ReportFiles.
    api(project(":modules:lsd-mono-report-html"))

    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testImplementation(libs.json.schema.validator)
    // ExampleReportGoldenTest writes the example report's scenarios (the readme source set's
    // KitchenSinkSample) and compares them with the shared test report captured from it.
    testImplementation(sourceSets["readme"].output)
    // ReportFiles.stem: the writer's file names, which it keeps internal.
    testImplementation(testFixtures(project(":modules:lsd-mono-report-html")))
    testRuntimeOnly(libs.junit.platform.launcher)

    testFixturesImplementation(platform(libs.junit.bom))
    testFixturesImplementation(libs.junit.jupiter.api)
    // ReportSchemas and ReportCorpus (the schemas and shared test reports, from the classpath):
    // this module's tests and the integration modules' validate their output with them.
    testFixturesApi(testFixtures(project(":modules:lsd-mono-report-model")))
}

// The test fixtures are for this repository's tests: keep them out of the published component, so
// Maven Central gets no -test-fixtures jar and the POM and Gradle metadata do not mention one.
val javaComponent = components["java"] as AdhocComponentWithVariants
javaComponent.withVariantsFromConfiguration(configurations["testFixturesApiElements"]) { skip() }
javaComponent.withVariantsFromConfiguration(configurations["testFixturesRuntimeElements"]) { skip() }

tasks.test {
    // HtmlEscapingGuardTest scans every module's main Kotlin, and JsonChecksRatchetTest every
    // module's tests (#109), not only this one's.
    inputs
        .files(
            rootProject.layout.projectDirectory
                .dir("modules")
                .asFileTree
                .matching { include("*/src/main/**/*.kt", "*/src/test/**/*.kt", "*/src/test/**/*.java") },
        ).withPathSensitivity(PathSensitivity.RELATIVE)
        .withPropertyName("guardedSources")
    // LsdPropertiesTest reads docs/jvm-api.md, RootReadmeExampleTest this module's README, the root one (#68),
    // every module's install snippet and the release script, and the release docs, the modules list and the
    // versioning notes against the module list (#122).
    inputs
        .files(
            layout.projectDirectory.file("README.md"),
            rootProject.layout.projectDirectory.file("README.md"),
            rootProject.layout.projectDirectory.file("docs/jvm-api.md"),
            rootProject.layout.projectDirectory.file("docs/releasing.md"),
            rootProject.layout.projectDirectory.file("tools/release/update-readme-version.sh"),
            rootProject.layout.projectDirectory.file("docs/versioning-notes.md"),
            rootProject.layout.projectDirectory.file("modules/README.md"),
            rootProject.layout.projectDirectory
                .dir("modules")
                .asFileTree
                .matching { include("*/README.md") },
            rootProject.layout.projectDirectory.file("settings.gradle.kts"),
        ).withPathSensitivity(PathSensitivity.RELATIVE)
        .withPropertyName("readmes")
    systemProperty("lsd.mono.report.outputDir", "build/reports/lsd-mono")
    systemProperty("lsd.mono.test.projectVersion", project.version.toString())
}

val generatedResourcesDir = layout.buildDirectory.dir("generated/resources")

// The report's `generator` field reads this, so it follows the project version in tests and the jar.
val versionResource = tasks.register("writeVersionResource") {
    group = "build"
    description = "Write lsd-mono-jvm/version.properties into build/generated/resources."
    val version = project.version.toString()
    val out = generatedResourcesDir.map { it.file("lsd-mono-jvm/version.properties") }
    inputs.property("version", version)
    outputs.file(out)
    doLast {
        val file = out.get().asFile
        file.parentFile.mkdirs()
        file.writeText("version=$version\n")
    }
}

// Not a source dir: sourcesJar must not treat the generated file as project source.
// processResources copies it into the packaged resources.
tasks.named<ProcessResources>("processResources") {
    dependsOn(versionResource)
    // Only the version file: a shell left there by an older build is not core's any more.
    from(generatedResourcesDir) { include("lsd-mono-jvm/version.properties") }
}
