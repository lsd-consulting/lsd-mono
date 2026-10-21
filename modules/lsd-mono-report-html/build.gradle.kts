import io.lsdconsulting.lsd.mono.gradle.withNodeOnPath

plugins {
    id("lsd.kotlin-jvm")
    `java-library`
    // ReportFiles: the writer's file names for other modules' tests. Not published.
    `java-test-fixtures`
}

description =
    "LSD Mono report writer: writes a report as JSON and as the interactive, self-contained HTML page, with the report UI bundled"

// The report model is experimental (@ExperimentalLsdReportModel); the writer takes it, and is marked the
// same way.
kotlin {
    compilerOptions {
        optIn.add("io.lsdconsulting.lsd.mono.report.model.ExperimentalLsdReportModel")
    }
}

// Line coverage was 95.3% when the floor was set, from this module's own tests. lsd-mono-core's
// tests exercise the writer too, but Kover counts each module's tests only.
lsdCoverage {
    lineFloor.set(93)
}

dependencies {
    // ReportWriter takes and writes the model's ReportJson.
    api(project(":modules:lsd-mono-report-model"))

    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
}

// Node helpers (withNodeOnPath, nodeCommandLine) live in build-logic NodeToolchain.kt.
// When a task runs, they put the .nvmrc Node from nvm first for it and do not change the nvm default alias.

// The report UI: its own npm package, built into the single-file shell this jar bundles.
val reportDir = layout.projectDirectory.dir("ui")
val generatedResourcesDir = layout.buildDirectory.dir("generated/resources")
// Built by `npm run build:single` into ui/dist (gitignored), then packaged from there.
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
    // The demo report the shell falls back to is a shared test report beside the schema.
    inputs
        .file(rootProject.layout.projectDirectory.file("modules/lsd-mono-report-schema/conformance/reports/sample.json"))
        .withPathSensitivity(PathSensitivity.RELATIVE)
    outputs.dir(reportDir.dir("dist"))
}

val copyReportShell = tasks.register<Copy>("copyReportShell") {
    group = "build"
    description =
        "Copy ui/dist/lsd-report.html into build/generated/resources as the classpath shell."
    dependsOn(reportSingle)
    from(reportShell) { rename { "lsd-report.single.html" } }
    into(generatedResourcesDir.map { it.dir("lsd-mono-report-html") })
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

// Not a source dir: sourcesJar must not treat the generated shell as project source.
// processResources copies it into the packaged resources.
tasks.named<ProcessResources>("processResources") {
    dependsOn(copyReportShell)
    from(generatedResourcesDir)
}

tasks.named("check") {
    dependsOn("reportTest", "reportLint")
}

// The test fixtures are for this repository's tests: keep them out of the published component, as
// lsd-mono-report-model does.
val javaComponent = components["java"] as AdhocComponentWithVariants
javaComponent.withVariantsFromConfiguration(configurations["testFixturesApiElements"]) { skip() }
javaComponent.withVariantsFromConfiguration(configurations["testFixturesRuntimeElements"]) { skip() }
