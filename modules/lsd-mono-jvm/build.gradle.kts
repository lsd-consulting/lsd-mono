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
// Never let a model or writer type (io.github.lsdconsulting.lsd.mono.report.model or .report.html) appear in
// core's public API. This opt-in covers the whole module, so the compiler does not warn here. But
// core takes the model and writer as implementation, not api: a consumer has them only at runtime,
// so its compiler would fail with "Cannot access class FactJson", and the experimental opt-in would
// leak into core's API. checkKotlinAbi fails on such a change; do not accept it with
// updateKotlinAbi.
kotlin {
    compilerOptions {
        optIn.add("io.github.lsdconsulting.lsd.mono.report.model.ExperimentalLsdReportModel")
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
    // HtmlEscapingGuardTest scans every module's main Kotlin, and JsonChecksRatchetTest every
    // module's tests (#109), not only this one's.
    inputs
        .files(
            rootProject.layout.projectDirectory
                .dir("modules")
                .asFileTree
                .matching { include("*/src/main/**/*.kt", "*/src/test/**/*.kt", "*/src/test/**/*.java") },
        ).withPathSensitivity(PathSensitivity.RELATIVE)
        .withPropertyName("guardedSources")
    // LsdPropertiesTest reads this module's README, RootReadmeExampleTest the root one (#68), and
    // the release docs, the modules list and the versioning notes against the module list (#122).
    inputs
        .files(
            layout.projectDirectory.file("README.md"),
            rootProject.layout.projectDirectory.file("README.md"),
            rootProject.layout.projectDirectory.file("docs/releasing.md"),
            rootProject.layout.projectDirectory.file("docs/versioning-notes.md"),
            rootProject.layout.projectDirectory.file("modules/README.md"),
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
    description = "Write lsd-mono-jvm/version.properties into build/generated/resources."
    val version = project.version.toString()
    val out = generatedResourcesDir.map { it.file("lsd-mono-jvm/version.properties") }
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
    from(generatedResourcesDir) { include("lsd-mono-jvm/version.properties") }
}

// This module was lsd-mono-core until #126. A POM-only lsd-mono-core at the same version relocates
// to lsd-mono-jvm, so Maven and Gradle builds still on the old coordinate get the new artifact and
// a message to switch. lsd.publishing gives it the full POM and signs it; the release publishes it
// with the rest. Remove it after the first release that carries it (docs/releasing.md): the
// published relocation stays on Central. It is an alias, so a project dependency on this module
// still resolves to lsd-mono-jvm alone.
// TODO(#126): remove this publication and checkRelocationPom after the first release that carries
// the relocation (docs/releasing.md, "The lsd-mono-core relocation").
publishing {
    publications {
        register<MavenPublication>("relocation") {
            // Internal Gradle API (MavenPublicationInternal.isAlias): without it, project dependencies on this
            // module fail with "multiple publications with different coordinates". If a Gradle upgrade breaks
            // it (a compile error here), fall back to a small separate subproject that publishes only this POM.
            (this as org.gradle.api.publish.maven.internal.publication.MavenPublicationInternal).isAlias = true
            artifactId = "lsd-mono-core"
            pom {
                packaging = "pom"
                description.set("Relocated to io.github.lsd-consulting:lsd-mono-jvm (#126).")
                distributionManagement {
                    relocation {
                        groupId.set(provider { project.group.toString() })
                        artifactId.set("lsd-mono-jvm")
                        version.set(provider { project.version.toString() })
                        message.set(
                            "lsd-mono-core is now lsd-mono-jvm, and its packages moved from io.lsdconsulting.lsd.mono.core " +
                                "to io.github.lsdconsulting.lsd.mono.jvm.",
                        )
                    }
                }
            }
        }
    }
}

// Guards the relocation POM (#126): fails `check` if the generated lsd-mono-core POM is not packaging
// pom with a relocation to lsd-mono-jvm at this project's version.
val relocationPom = tasks.named<GenerateMavenPom>("generatePomFileForRelocationPublication")
val checkRelocationPom =
    tasks.register("checkRelocationPom") {
        group = "verification"
        description = "Checks the lsd-mono-core relocation POM points at lsd-mono-jvm at this version."
        val pomFile = relocationPom.map { it.destination }
        val expectedGroup = provider { project.group.toString() }
        val expectedVersion = provider { project.version.toString() }
        inputs.file(pomFile)
        inputs.property("group", expectedGroup)
        inputs.property("version", expectedVersion)
        dependsOn(relocationPom)
        doLast {
            val factory = javax.xml.parsers.DocumentBuilderFactory
                .newInstance()
            val doc = factory.newDocumentBuilder().parse(pomFile.get())

            fun text(path: String): String? {
                var node: org.w3c.dom.Element = doc.documentElement
                for (name in path.split("/")) {
                    val child = node.getElementsByTagName(name).let { if (it.length == 0) null else it.item(0) }
                    node = child as? org.w3c.dom.Element ?: return null
                }
                return node.textContent.trim()
            }
            val expected =
                mapOf(
                    "groupId" to expectedGroup.get(),
                    "artifactId" to "lsd-mono-core",
                    "version" to expectedVersion.get(),
                    "packaging" to "pom",
                    "distributionManagement/relocation/groupId" to "io.github.lsd-consulting",
                    "distributionManagement/relocation/artifactId" to "lsd-mono-jvm",
                    "distributionManagement/relocation/version" to expectedVersion.get(),
                )
            val wrong = expected.filter { (path, value) -> text(path) != value }.map { (path, value) -> "$path: expected '$value', was '${text(path)}'" }
            check(wrong.isEmpty()) { "The lsd-mono-core relocation POM (${pomFile.get()}) is wrong (#126):\n" + wrong.joinToString("\n") }
        }
    }
tasks.named("check") { dependsOn(checkRelocationPom) }
