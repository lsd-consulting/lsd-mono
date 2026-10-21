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

// The report model is experimental (@ExperimentalLsdReportModel); core maps its scenarios to it, as the
// model and writer move with it in lockstep.
//
// Never let a model or writer type (io.lsdconsulting.lsd.mono.report.model or .report.html) appear in
// core's public API. This opt-in covers the whole module, so the compiler does not warn here. But
// core takes the model and writer as implementation, not api: a consumer has them only at runtime,
// so its compiler would fail with "Cannot access class FactJson", and the experimental opt-in would
// leak into core's API. checkKotlinAbi fails on such a change; do not accept it with
// updateKotlinAbi.
kotlin {
    compilerOptions {
        optIn.add("io.lsdconsulting.lsd.mono.report.model.ExperimentalLsdReportModel")
    }
}

dependencies {
    // The report as plain values (ReportJson and the rest), and the writer of its JSON and HTML
    // files with the report UI. Neither is in core's public API.
    implementation(project(":modules:lsd-mono-report-model"))
    implementation(project(":modules:lsd-mono-report-html"))

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
    // HtmlEscapingGuardTest scans every module's main Kotlin, not only this one's.
    inputs
        .files(
            rootProject.layout.projectDirectory
                .dir("modules")
                .asFileTree
                .matching { include("*/src/main/**/*.kt") },
        ).withPathSensitivity(PathSensitivity.RELATIVE)
        .withPropertyName("guardedSources")
    // LsdPropertiesTest reads this module's README, RootReadmeExampleTest the root one (#68), and
    // the release docs and the module list against it.
    inputs
        .files(
            layout.projectDirectory.file("README.md"),
            rootProject.layout.projectDirectory.file("README.md"),
            rootProject.layout.projectDirectory.file("docs/releasing.md"),
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
    description = "Write lsd-mono-core/version.properties into build/generated/resources."
    val version = project.version.toString()
    val out = generatedResourcesDir.map { it.file("lsd-mono-core/version.properties") }
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
    from(generatedResourcesDir) { include("lsd-mono-core/version.properties") }
}
