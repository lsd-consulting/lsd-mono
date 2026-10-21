import io.lsdconsulting.lsd.mono.gradle.nodeCommandLine
import io.lsdconsulting.lsd.mono.gradle.writesSampleReport

// Sample reports for lsd-mono-core: the feature tour the root README's GIF clicks around, and the
// example report the Pages workflow publishes. They are programs in the `readme` source set.
// Slow, and they write docs/ or build/pages, so none of these tasks is on build or check.
plugins {
    java
}

val readmeSourceSet = sourceSets.create("readme")

dependencies {
    "readmeImplementation"(sourceSets.named("main").get().output)
}

// The samples run the module's main code, so they need its dependencies too (the report model
// and writer, for lsd-mono-core).
configurations.named("readmeImplementation") { extendsFrom(configurations.getByName("implementation")) }

// The report UI's scripts, which screenshot the sample reports.
val reportDir = rootProject.layout.projectDirectory.dir("modules/lsd-mono-report-html/ui")

/** Run [mainClass] from the readme source set, writing a deterministic report into [outDir]. */
fun registerCapture(
    name: String,
    what: String,
    mainClass: String,
    outDir: Provider<Directory>,
): TaskProvider<JavaExec> =
    tasks.register<JavaExec>(name) {
        description = "Capture the $what and write the report HTML."
        classpath = readmeSourceSet.runtimeClasspath
        this.mainClass.set("io.lsdconsulting.lsd.mono.core.readme.$mainClass")
        writesSampleReport(outDir)
    }

val featureTourReportDir = layout.buildDirectory.dir("feature-tour-report")
val exampleReportDir = layout.buildDirectory.dir("example-report")
val readmeDocsDir = rootProject.layout.projectDirectory.dir("docs/readme")
val pagesDir = layout.buildDirectory.dir("pages")

// Feature tour: a trimmed shop report the root README's tour GIF clicks around.
registerCapture("captureFeatureTourReport", "feature-tour scenarios", "FeatureTourSampleKt", featureTourReportDir)
// Example report (the kitchen sink): every diagram feature in one report, for eyeballing layout.
// Published on Pages as example-report.html. Not committed.
val captureKitchenSinkReport =
    registerCapture("captureKitchenSinkReport", "example report scenarios", "KitchenSinkSampleKt", exampleReportDir)

tasks.register<Exec>("readmeSamples") {
    group = "documentation"
    description = "Regenerate docs/readme/feature-tour.gif from the current report UI. Not part of build or check."
    dependsOn("captureFeatureTourReport")
    workingDir = reportDir.asFile
    inputs.dir(featureTourReportDir)
    inputs.file(reportDir.file("scripts/readme-samples.mjs"))
    inputs.dir(reportDir.dir("scripts/readme"))
    val gif = readmeDocsDir.file("feature-tour.gif")
    outputs.file(gif)
    val tourReport = featureTourReportDir.get().asFile.absolutePath
    nodeCommandLine("scripts/readme-samples.mjs", "tour", tourReport, gif.asFile.absolutePath)
}

tasks.register<Sync>("kitchenSinkSample") {
    group = "documentation"
    description =
        "Build the GitHub Pages site (the example report and its index.html) into build/pages. Not part of build or check."
    dependsOn(captureKitchenSinkReport)
    // The report directory as written: index.html is the site's front page and loads each report's
    // data script. Index entries (.lsd-index) are bookkeeping and are not published.
    from(exampleReportDir) { exclude(".lsd-index/**") }
    // A stable address for the example report's diagram (files carry a short hash). It loads the hashed payloads file.
    from(exampleReportDir) {
        include("Example-report-*-diagram.html")
        rename("""Example-report-[0-9a-f]{8}-diagram\.html""", "example-report.html")
    }
    into(pagesDir)
}
