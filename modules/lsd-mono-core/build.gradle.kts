import io.lsdconsulting.lsd.mono.gradle.withNodeOnPath

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

dependencies {
    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testImplementation(libs.json.schema.validator)
    testRuntimeOnly(libs.junit.platform.launcher)

    testFixturesImplementation(platform(libs.junit.bom))
    testFixturesImplementation(libs.junit.jupiter.api)
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
    // LsdPropertiesTest reads this module's README, RootReadmeExampleTest the root one (#68).
    inputs
        .files(layout.projectDirectory.file("README.md"), rootProject.layout.projectDirectory.file("README.md"))
        .withPathSensitivity(PathSensitivity.RELATIVE)
        .withPropertyName("readmes")
    // ReportSchemaTest validates real output against the report JSON Schema.
    inputs
        .dir(rootProject.layout.projectDirectory.dir("modules/lsd-mono-report-schema"))
        .withPathSensitivity(PathSensitivity.RELATIVE)
        .withPropertyName("reportSchema")
    systemProperty("lsd.mono.report.outputDir", "build/reports/lsd-mono")
    systemProperty("lsd.mono.test.projectVersion", project.version.toString())
}

// Node helpers (withNodeOnPath, nodeCommandLine) live in build-logic NodeToolchain.kt.
// When a task runs, they put the .nvmrc Node from nvm first for it and do not change the nvm default alias.

val reportDir = layout.projectDirectory.dir("report")
val generatedResourcesDir = layout.buildDirectory.dir("generated/resources")
// Built by `npm run build:single` into report/dist (gitignored), then packaged from there.
val reportShell = reportDir.file("dist/lsd-report.html")

val reportSingle = tasks.register<Exec>("reportSingle") {
    group = "build"
    description = "npm ci, then npm run build:single, for the report shell."
    workingDir = reportDir.asFile
    withNodeOnPath()
    val npm = if (System.getProperty("os.name").lowercase().contains("windows")) {
        listOf("cmd", "/c", "node -v && npm ci && npm run build:single")
    } else {
        listOf("sh", "-c", "node -v && npm ci && npm run build:single")
    }
    commandLine(npm)
    inputs.file(reportDir.file("package.json")).withPathSensitivity(PathSensitivity.RELATIVE)
    inputs.file(reportDir.file("package-lock.json")).withPathSensitivity(PathSensitivity.RELATIVE)
    inputs.file(reportDir.file("index.html")).withPathSensitivity(PathSensitivity.RELATIVE)
    inputs.file(reportDir.file("tsconfig.json")).withPathSensitivity(PathSensitivity.RELATIVE)
    inputs.file(reportDir.file("vite.config.ts")).withPathSensitivity(PathSensitivity.RELATIVE)
    inputs.dir(reportDir.dir("src")).withPathSensitivity(PathSensitivity.RELATIVE)
    inputs.dir(reportDir.dir("scripts")).withPathSensitivity(PathSensitivity.RELATIVE)
    inputs.dir(reportDir.dir("public")).withPathSensitivity(PathSensitivity.RELATIVE)
    outputs.dir(reportDir.dir("dist"))
}

val copyReportShell = tasks.register<Copy>("copyReportShell") {
    group = "build"
    description =
        "Copy report/dist/lsd-report.html into build/generated/resources as the classpath shell."
    dependsOn(reportSingle)
    from(reportShell) { rename { "lsd-report.single.html" } }
    into(generatedResourcesDir.map { it.dir("lsd-mono-core/report") })
}

tasks.register<Exec>("reportTest") {
    group = "verification"
    description = "Run the report's vitest suite with coverage thresholds (npm test) on the Gradle check path."
    dependsOn(reportSingle)
    workingDir = reportDir.asFile
    // Through sh, so npm is looked up on the task's PATH (the chosen Node first), not the Gradle client's.
    commandLine("sh", "-c", "npm test")
    withNodeOnPath()
}

tasks.register<Exec>("reportLint") {
    group = "verification"
    description =
        "Type-check the report UI with its tests (npm run typecheck), check its generated types match the " +
        "report schema (npm run types:check), then lint it (npm run lint)."
    dependsOn(reportSingle)
    workingDir = reportDir.asFile
    commandLine("sh", "-c", "npm run typecheck && npm run types:check && npm run lint")
    withNodeOnPath()
}

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

// Not a source dir: sourcesJar must not treat the generated shell as project source.
// processResources copies it into the packaged resources. The generated file is
// listed last and overwrites a leftover hand copy at the same classpath path.
tasks.named<ProcessResources>("processResources") {
    dependsOn(copyReportShell, versionResource)
    duplicatesStrategy = DuplicatesStrategy.INCLUDE
    from(generatedResourcesDir)
}

tasks.named("check") {
    dependsOn("reportTest", "reportLint")
}
