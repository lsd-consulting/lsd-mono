import io.lsdconsulting.lsd.mono.gradle.nodeCommandLine

// Sample reports for lsd-mono-core: the README report, the feature tour its GIF clicks around, and
// the kitchen-sink report the Pages workflow publishes. They are programs in the `readme` source
// set. Slow, and they write docs/ or build/pages, so none of these tasks is on build or check.
plugins {
    java
}

val readmeSourceSet = sourceSets.create("readme")

dependencies {
    "readmeImplementation"(sourceSets.named("main").get().output)
}

val reportDir = layout.projectDirectory.dir("report")

// Sample reports use this instead of the time they ran, so regenerating them changes nothing
// unless the UI or the sample does. See gradle.properties.
val samplesGeneratedAt = providers.gradleProperty("lsd.samples.generatedAt").get()

/** Run [mainClass] from the readme source set, writing a deterministic report into [outDir]. */
fun registerCapture(
    name: String,
    what: String,
    mainClass: String,
    outDir: Provider<Directory>,
): TaskProvider<JavaExec> =
    tasks.register<JavaExec>(name) {
        group = "documentation"
        description = "Capture the $what and write the report HTML."
        classpath = readmeSourceSet.runtimeClasspath
        this.mainClass.set("io.lsdconsulting.lsd.mono.core.readme.$mainClass")
        systemProperty("lsd.mono.report.outputDir", outDir.get().asFile.absolutePath)
        // Report names carry a hash, so start clean: the scripts and copies expect one *-diagram.html.
        val cleanDir = outDir.get().asFile
        doFirst { cleanDir.deleteRecursively() }
        systemProperty("lsd.mono.ids.deterministic", "true")
        systemProperty("lsd.mono.report.generatedAt", samplesGeneratedAt)
        outputs.dir(outDir)
    }

val readmeReportDir = layout.buildDirectory.dir("readme-report")
val featureTourReportDir = layout.buildDirectory.dir("feature-tour-report")
val kitchenSinkReportDir = layout.buildDirectory.dir("kitchen-sink-report")
val readmeDocsDir = rootProject.layout.projectDirectory.dir("docs/readme")
val pagesDir = layout.buildDirectory.dir("pages")

registerCapture("captureReadmeReport", "README scenario", "ReadmeSampleKt", readmeReportDir)
// Feature tour: a trimmed shop report the root README's tour GIF clicks around.
registerCapture("captureFeatureTourReport", "feature-tour scenarios", "FeatureTourSampleKt", featureTourReportDir)
// Kitchen sink: every diagram feature in one report, for eyeballing layout. Not committed.
val captureKitchenSinkReport =
    registerCapture("captureKitchenSinkReport", "kitchen-sink scenarios", "KitchenSinkSampleKt", kitchenSinkReportDir)

tasks.register<Exec>("readmeSamples") {
    group = "documentation"
    description =
        "Regenerate the docs/readme feature tour and component GIFs from the current report UI. Not part of build or check."
    dependsOn("captureReadmeReport", "captureFeatureTourReport")
    workingDir = reportDir.asFile
    inputs.dir(readmeReportDir)
    inputs.dir(featureTourReportDir)
    inputs.file(reportDir.file("scripts/readme-samples.mjs"))
    outputs.file(readmeDocsDir.file("feature-tour.gif"))
    outputs.file(readmeDocsDir.file("components.gif"))
    val reportOut = readmeReportDir.get().asFile.absolutePath
    val docsOut = readmeDocsDir.asFile.absolutePath
    val tourOut = featureTourReportDir.get().asFile.absolutePath
    nodeCommandLine("scripts/readme-samples.mjs", reportOut, docsOut, tourOut)
}

tasks.register<Sync>("kitchenSinkSample") {
    group = "documentation"
    description =
        "Build the GitHub Pages site (the kitchen-sink report and its index.html) into build/pages. Not part of build or check."
    dependsOn(captureKitchenSinkReport)
    // The report directory as written: index.html is the site's front page and loads each report's
    // data script. Index entries (.lsd-index) are bookkeeping and are not published.
    from(kitchenSinkReportDir) { exclude(".lsd-index/**") }
    // A stable address for the kitchen-sink diagram (files carry a short hash). It loads the hashed payloads file.
    from(kitchenSinkReportDir) {
        include("kitchen-sink-*-diagram.html")
        rename("""kitchen-sink-[0-9a-f]{8}-diagram\.html""", "kitchen-sink.html")
    }
    into(pagesDir)
}
