package io.lsdconsulting.lsd.mono.gradle

import org.gradle.api.Project
import org.gradle.api.file.Directory
import org.gradle.api.provider.Provider
import org.gradle.api.tasks.Exec
import org.gradle.api.tasks.JavaExec
import org.gradle.api.tasks.SourceSet
import org.gradle.api.tasks.TaskProvider
import org.gradle.kotlin.dsl.register

/*
 * Sample reports: small programs in a module's `readme` source set that capture a report for the
 * READMEs or the Pages site. They are slow and write docs/ or build/pages, so no sample task is on
 * build or check.
 */

/**
 * Run this sample so it writes a deterministic report into [outDir]: ids are deterministic and the
 * "generated at" instant is `lsd.samples.generatedAt` (gradle.properties), so regenerating changes
 * nothing unless the UI or the sample does. [outDir] is emptied first, because report names carry
 * a hash and the scripts and copies that follow expect one `*-diagram.html`.
 */
fun JavaExec.writesSampleReport(outDir: Provider<Directory>) {
    group = "documentation"
    val dir = outDir.get().asFile
    systemProperty("lsd.mono.report.outputDir", dir.absolutePath)
    systemProperty("lsd.mono.ids.deterministic", "true")
    systemProperty("lsd.mono.report.generatedAt", project.providers.gradleProperty("lsd.samples.generatedAt").get())
    doFirst { dir.deleteRecursively() }
    outputs.dir(outDir)
}

/**
 * The README sample tasks of an integration module (JUnit, Cucumber): `captureReadmeReport` runs
 * [mainClass] from [readme] into `build/readme-report`, and `readmeSamples` screenshots that report
 * into the module's `docs/readme/diagram.png` with the core report's `scripts/readme-samples.mjs`.
 */
fun Project.registerIntegrationReadmeSamples(
    readme: SourceSet,
    mainClass: String,
    what: String,
    configure: JavaExec.() -> Unit = {},
): TaskProvider<Exec> {
    val reportDir = layout.buildDirectory.dir("readme-report")
    val png = layout.projectDirectory.file("docs/readme/diagram.png")
    val core = project(":modules:lsd-mono-core")
    val coreReportDir = core.layout.projectDirectory.dir("report")
    val capture =
        tasks.register<JavaExec>("captureReadmeReport") {
            description = "$what and write its report HTML."
            // The report shell must be on the core classpath for ReportWriter.
            dependsOn(core.tasks.named("copyReportShell"), core.tasks.named("classes"))
            classpath = readme.runtimeClasspath
            this.mainClass.set(mainClass)
            writesSampleReport(reportDir)
            configure()
        }
    return tasks.register<Exec>("readmeSamples") {
        group = "documentation"
        description = "Regenerate docs/readme/diagram.png from the current report UI. Not part of build or check."
        dependsOn(capture)
        workingDir = coreReportDir.asFile
        inputs.dir(reportDir)
        inputs.file(coreReportDir.file("scripts/readme-samples.mjs"))
        inputs.dir(coreReportDir.dir("scripts/readme"))
        outputs.file(png)
        val report = reportDir.get().asFile.absolutePath
        nodeCommandLine("scripts/readme-samples.mjs", "diagram", report, png.asFile.absolutePath)
    }
}
