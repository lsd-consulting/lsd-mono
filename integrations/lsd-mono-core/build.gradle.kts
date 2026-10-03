plugins {
    id("lsd.kotlin-jvm")
    `java-library`
}


version = "0.0.1-SNAPSHOT"
base.archivesName.set("lsd-mono-core")

description =
    "LSD Mono core — greenfield report-next UI + thin Kotlin capture/report façade (not legacy lsd-core)"

dependencies {
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
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

val reportNextDir = layout.projectDirectory.dir("report-next")
val generatedResourcesDir = layout.buildDirectory.dir("generated/resources")
val reportNextShell = reportNextDir.file("lsd-report-next.single.html")

val reportNextSingle = tasks.register<Exec>("reportNextSingle") {
    group = "build"
    description = "npm ci, then npm run build:single, for the report-next shell."
    workingDir = reportNextDir.asFile
    withNodeOnPath()
    val npm = if (System.getProperty("os.name").lowercase().contains("windows")) {
        listOf("cmd", "/c", "node -v && npm ci && npm run build:single")
    } else {
        listOf("sh", "-c", "node -v && npm ci && npm run build:single")
    }
    commandLine(npm)
    inputs.file(reportNextDir.file("package.json")).withPathSensitivity(PathSensitivity.RELATIVE)
    inputs.file(reportNextDir.file("package-lock.json")).withPathSensitivity(PathSensitivity.RELATIVE)
    inputs.file(reportNextDir.file("index.html")).withPathSensitivity(PathSensitivity.RELATIVE)
    inputs.file(reportNextDir.file("tsconfig.json")).withPathSensitivity(PathSensitivity.RELATIVE)
    inputs.file(reportNextDir.file("vite.config.ts")).withPathSensitivity(PathSensitivity.RELATIVE)
    inputs.dir(reportNextDir.dir("src")).withPathSensitivity(PathSensitivity.RELATIVE)
    inputs.dir(reportNextDir.dir("scripts")).withPathSensitivity(PathSensitivity.RELATIVE)
    inputs.dir(reportNextDir.dir("public")).withPathSensitivity(PathSensitivity.RELATIVE)
    outputs.file(reportNextShell)
    outputs.dir(reportNextDir.dir("dist"))
}

val copyReportNextShell = tasks.register<Copy>("copyReportNextShell") {
    group = "build"
    description =
        "Copy report-next/lsd-report-next.single.html into build/generated/resources. Does not touch src/main/resources."
    dependsOn(reportNextSingle)
    from(reportNextShell)
    into(generatedResourcesDir.map { it.dir("lsd-mono-core/report-next") })
}

tasks.register<Exec>("reportNextTest") {
    group = "verification"
    description = "Run report-next vitest (npm test) on the Gradle check path."
    dependsOn(reportNextSingle)
    workingDir = reportNextDir.asFile
    withNodeOnPath()
    commandLine("npm", "test")
}

// Not a source dir: sourcesJar must not treat the generated shell as project source.
// processResources copies it into the packaged resources. The generated file is
// listed last and overwrites a leftover hand copy at the same classpath path.
tasks.named<ProcessResources>("processResources") {
    dependsOn(copyReportNextShell)
    duplicatesStrategy = DuplicatesStrategy.INCLUDE
    from(generatedResourcesDir)
}

tasks.named("check") {
    dependsOn("reportNextTest")
}
