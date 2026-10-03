plugins {
    id("lsd.kotlin-jvm")
    `java-library`
}

version = "0.0.1-SNAPSHOT"
base.archivesName.set("lsd-mono-junit-jupiter")

description = "LSD Mono JUnit Jupiter 6 integration — extension for living sequence diagram reports"

val readmeSourceSet = sourceSets.create("readme")

dependencies {
    // First-party greenfield core (not Maven lsd-core).
    api(project(":modules:lsd-mono-core"))

    // Compile against Jupiter 6 API so LsdExtension can implement Extension callbacks.
    api(libs.junit.jupiter.api)

    testImplementation(libs.junit.jupiter)
    testImplementation(libs.junit.platform.launcher)

    // readme source set does not inherit main deps; need core for LsdContext.
    "readmeImplementation"(sourceSets.named("main").get().output)
    "readmeImplementation"(project(":modules:lsd-mono-core"))
}

tasks.test {
    useJUnitPlatform {
        // Engine fixtures are launched explicitly from LsdExtensionOutcomesTest.
        excludeTags("lsd-fixture")
    }
    systemProperty("lsd.mono.report.outputDir", "build/reports/lsd-test")
    // Legacy key still honoured by mono LsdProperties fallbacks
    systemProperty("lsd.core.report.outputDir", "build/reports/lsd-test")
}

tasks.jar {
    manifest {
        attributes(
            "Implementation-Title" to "lsd-mono-junit-jupiter",
            "Implementation-Version" to project.version,
        )
    }
}

// Vite / Playwright need a current Node. Prepend nvm Node 22 when present.
// Does not change the user's nvm default alias.
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

// README samples are slow and write docs/. They are not on build or check.
val readmeReportDir = layout.buildDirectory.dir("readme-report")
val readmeDocsDir = layout.projectDirectory.dir("docs/readme")
val coreProject = project(":modules:lsd-mono-core")
val coreReportDir = coreProject.layout.projectDirectory.dir("report")

tasks.register<JavaExec>("captureReadmeReport") {
    group = "documentation"
    description =
        "Capture the JUnit README scenario and write its report HTML (same titles LsdExtension would use)."
    // Shell must be on the core classpath for ReportWriter.
    dependsOn(coreProject.tasks.named("copyReportShell"))
    dependsOn(coreProject.tasks.named("classes"))
    classpath = readmeSourceSet.runtimeClasspath
    mainClass.set("io.lsdconsulting.lsd.mono.junitjupiter.readme.JunitReadmeSampleKt")
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
    // Reuse the core report's Playwright screenshot script and node_modules.
    workingDir = coreReportDir.asFile
    withNodeOnPath()
    inputs.dir(readmeReportDir)
    inputs.file(coreReportDir.file("scripts/readme-samples.mjs"))
    outputs.file(readmeDocsDir.file("diagram.png"))
    outputs.file(readmeDocsDir.file("inspector.png"))
    outputs.file(readmeDocsDir.file("zoom.gif"))
    val reportOut = readmeReportDir.get().asFile.absolutePath
    val docsOut = readmeDocsDir.asFile.absolutePath
    val node = node22BinDir()?.resolve("node")?.takeIf { it.canExecute() }?.absolutePath ?: "node"
    commandLine(node, "scripts/readme-samples.mjs", reportOut, docsOut)
}
