plugins {
    id("lsd.kotlin-jvm")
    `java-library`
    // ReportSchemas and ReportCorpus: the report schemas and shared test reports on the classpath,
    // for every module's tests. Not published.
    `java-test-fixtures`
}

description =
    "LSD Mono report model: the report JSON as plain Kotlin values, for producers that write a report without lsd-mono-core"

// The report model is experimental (@ExperimentalLsdReportModel); its own tests use it freely.
kotlin {
    compilerOptions {
        optIn.add("io.lsdconsulting.lsd.mono.report.model.ExperimentalLsdReportModel")
    }
}

// The model is plain values; what its tests leave is mostly the data classes' generated code.
// Line coverage was 85.6% when the floor was set, from the model's own code: the test fixtures
// (ReportSchemas, ReportCorpus, assertValidJson) are not counted (lsd.coverage).
lsdCoverage {
    lineFloor.set(84)
}

dependencies {
    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    // ReportSchemasTest reads the corpus manifest.
    testImplementation(libs.json.schema.validator)
    testRuntimeOnly(libs.junit.platform.launcher)

    testFixturesImplementation(platform(libs.junit.bom))
    testFixturesImplementation(libs.junit.jupiter.api)
    testFixturesImplementation(libs.json.schema.validator)
}

// The test fixtures are for this repository's tests: keep them out of the published component, so
// Maven Central gets no -test-fixtures jar and the POM and Gradle metadata do not mention one.
val javaComponent = components["java"] as AdhocComponentWithVariants
javaComponent.withVariantsFromConfiguration(configurations["testFixturesApiElements"]) { skip() }
javaComponent.withVariantsFromConfiguration(configurations["testFixturesRuntimeElements"]) { skip() }

// The schema directory goes onto the test fixtures' classpath as /lsd-mono-report-schema. A test
// that reads it through ReportSchemas has it on its runtime classpath, so Gradle reruns the test,
// and does not take it from the build cache, when a schema or a corpus file changes.
val schemaDir = rootProject.layout.projectDirectory.dir("modules/lsd-mono-report-schema")
val corpusDir = schemaDir.dir("conformance")
val corpusListDir = layout.buildDirectory.dir("generated/corpus-list")

// A classpath has no directory listing, so the corpus's file list goes beside it (ReportCorpus.files).
val writeCorpusList = tasks.register("writeCorpusList") {
    description = "List the shared test reports' files for the test fixtures' classpath."
    val corpus = corpusDir.asFile
    inputs.dir(corpusDir).withPathSensitivity(PathSensitivity.RELATIVE)
    val out = corpusListDir.map { it.file("lsd-mono-report-schema/conformance/files.txt") }
    outputs.file(out)
    doLast {
        val files =
            corpus
                .walkTopDown()
                .filter { it.isFile }
                .map { it.relativeTo(corpus).invariantSeparatorsPath }
                .sorted()
        out.get().asFile.writeText(files.joinToString("\n", postfix = "\n"))
    }
}

tasks.named<ProcessResources>("processTestFixturesResources") {
    from(schemaDir) { into("lsd-mono-report-schema") }
    from(writeCorpusList.map { corpusListDir.get() })
}
