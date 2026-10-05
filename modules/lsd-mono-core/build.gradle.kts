plugins {
    id("lsd.kotlin-jvm")
    `java-library`
}

base.archivesName.set("lsd-mono-core")

description =
    "LSD Mono core — greenfield report UI + thin Kotlin capture/report façade (not legacy lsd-core)"

val readmeSourceSet = sourceSets.create("readme")

dependencies {
    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
    "readmeImplementation"(sourceSets.named("main").get().output)
}

tasks.test {
    systemProperty("lsd.mono.report.outputDir", "build/reports/lsd-mono")
}

tasks.jar {
    manifest {
        attributes(
            "Implementation-Title" to "lsd-mono-core",
            "Implementation-Version" to project.version,
        )
    }
}

// Vite 7 / Vitest 3 need a current Node. These tasks prepend an installed
// Node 22 (nvm) when the default alias is still the older 17.x toolchain.
// They do not change the user's nvm default.
fun node22BinDir(): File? {
    val versions = File(System.getProperty("user.home"), ".nvm/versions/node")
    val version = Regex("""v22\.(\d+)\.(\d+)""")
    return versions.listFiles()
        ?.filter { dir ->
            version.matches(dir.name) && File(dir, "bin/npm").canExecute() && File(dir, "bin/node").canExecute()
        }
        ?.maxWithOrNull(
            compareBy(
                { version.matchEntire(it.name)!!.groupValues[1].toInt() },
                { version.matchEntire(it.name)!!.groupValues[2].toInt() },
            ),
        )
        ?.resolve("bin")
}

fun Exec.withNodeOnPath() {
    val nodeBin = node22BinDir()
    if (nodeBin != null) {
        val base = System.getenv("PATH").orEmpty()
        environment("PATH", nodeBin.absolutePath + File.pathSeparator + base)
    }
}

val reportDir = layout.projectDirectory.dir("report")
val generatedResourcesDir = layout.buildDirectory.dir("generated/resources")
val reportShell = reportDir.file("lsd-report.single.html")

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
    outputs.file(reportShell)
    outputs.dir(reportDir.dir("dist"))
}

val copyReportShell = tasks.register<Copy>("copyReportShell") {
    group = "build"
    description =
        "Copy report/lsd-report.single.html into build/generated/resources. Does not touch src/main/resources."
    dependsOn(reportSingle)
    // Drop output left by earlier shell names so a dirty build dir cannot
    // package both the old classpath root and the previous filename.
    doFirst {
        delete(layout.buildDirectory.dir("generated/resources/lsd-mono-core/report-next"))
        delete(layout.buildDirectory.file("generated/resources/lsd-mono-core/report/lsd-report-next.single.html"))
    }
    from(reportShell)
    into(generatedResourcesDir.map { it.dir("lsd-mono-core/report") })
}

tasks.register<Exec>("reportTest") {
    group = "verification"
    description = "Run report vitest (npm test) on the Gradle check path."
    dependsOn(reportSingle)
    workingDir = reportDir.asFile
    withNodeOnPath()
    // Gradle resolves a bare "npm" against the client PATH, which is still Node 17's
    // absence when nvm is not sourced. Put Node 22 on PATH inside the shell instead.
    val nodeBin = node22BinDir()?.absolutePath
    val script = if (nodeBin != null) "export PATH=\"$nodeBin:\$PATH\"; npm test" else "npm test"
    commandLine("sh", "-c", script)
}

// Not a source dir: sourcesJar must not treat the generated shell as project source.
// processResources copies it into the packaged resources. The generated file is
// listed last and overwrites a leftover hand copy at the same classpath path.
tasks.named<ProcessResources>("processResources") {
    dependsOn(copyReportShell)
    duplicatesStrategy = DuplicatesStrategy.INCLUDE
    from(generatedResourcesDir)
}

tasks.named("check") {
    dependsOn("reportTest")
}

// README samples are slow and write docs/. They are not on build or check.
val readmeReportDir = layout.buildDirectory.dir("readme-report")
val readmeDocsDir = rootProject.layout.projectDirectory.dir("docs/readme")

tasks.register<JavaExec>("captureReadmeReport") {
    group = "documentation"
    description = "Capture the README scenario and write its report HTML."
    classpath = readmeSourceSet.runtimeClasspath
    mainClass.set("io.lsdconsulting.lsd.mono.core.readme.ReadmeSampleKt")
    javaLauncher.set(
        javaToolchains.launcherFor {
            languageVersion.set(JavaLanguageVersion.of(21))
        },
    )
    systemProperty("lsd.mono.report.outputDir", readmeReportDir.get().asFile.absolutePath)
    systemProperty("lsd.mono.ids.deterministic", "true")
    outputs.dir(readmeReportDir)
}

tasks.register<Exec>("readmeSamples") {
    group = "documentation"
    description =
        "Regenerate docs/readme PNG and GIF samples from the current report UI. Not part of build or check."
    dependsOn("captureReadmeReport")
    workingDir = reportDir.asFile
    withNodeOnPath()
    inputs.dir(readmeReportDir)
    inputs.file(reportDir.file("scripts/readme-samples.mjs"))
    outputs.file(readmeDocsDir.file("diagram.png"))
    outputs.file(readmeDocsDir.file("inspector.png"))
    outputs.file(readmeDocsDir.file("zoom.gif"))
    outputs.file(readmeDocsDir.file("fit.gif"))
    outputs.file(readmeDocsDir.file("inspector-drag.gif"))
    val reportOut = readmeReportDir.get().asFile.absolutePath
    val docsOut = readmeDocsDir.asFile.absolutePath
    val node = node22BinDir()?.resolve("node")?.takeIf { it.canExecute() }?.absolutePath ?: "node"
    commandLine(node, "scripts/readme-samples.mjs", reportOut, docsOut)
}
