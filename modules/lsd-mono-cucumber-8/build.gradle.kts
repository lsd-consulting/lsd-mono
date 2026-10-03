plugins {
    id("lsd.kotlin-jvm")
    `java-library`
}

version = "0.0.1-SNAPSHOT"
base.archivesName.set("lsd-mono-cucumber-8")

description = "LSD Mono Cucumber 8 integration — plugin for living sequence diagram reports"

val readmeSourceSet = sourceSets.create("readme")

dependencies {
    // First-party greenfield core (not Maven lsd-core).
    api(project(":modules:lsd-mono-core"))

    // Concrete Cucumber 8 from the catalog (8.0.4). The constraints below are the major range.
    api(libs.cucumber.plugin)
    testImplementation(libs.cucumber.java8)
    testImplementation(libs.cucumber.junit.platform.engine)
    testImplementation(libs.junit.jupiter)
    testImplementation(libs.junit.platform.launcher)

    // readme source set does not inherit main deps.
    "readmeImplementation"(sourceSets.named("main").get().output)
    "readmeImplementation"(project(":modules:lsd-mono-core"))
    "readmeImplementation"(libs.cucumber.java8)
    "readmeImplementation"(libs.cucumber.junit.platform.engine)
}

// Cucumber 8 major line for every io.cucumber artifact this module resolves.
// Catalog still requests 8.0.4. strictly [8,9) blocks 7.x and 9+ and still lets
// Dependabot bump patch and minor inside 8. Not a single-patch lock.
// cucumber-groovy has no 8.x on Maven Central (latest is 6.10.4) and is not a dependency.
dependencies {
    implementation(platform(libs.cucumber.bom))
    testImplementation(platform(libs.junit.bom))
    "readmeImplementation"(platform(libs.cucumber.bom))
    constraints {
        // Cucumber-JVM modules that share the 8.x line. Other io.cucumber coordinates
        // (messages, gherkin, formatters, cucumber-expressions) use their own versions
        // and are aligned by cucumber-bom, not forced into [8,9).
        listOf(
            "cucumber-bom",
            "cucumber-plugin",
            "cucumber-java8",
            "cucumber-java",
            "cucumber-core",
            "cucumber-junit-platform-engine",
            "cucumber-junit",
            "cucumber-gherkin",
            "cucumber-gherkin-messages",
            "datatable",
            "docstring",
        ).forEach { artifact ->
            implementation("io.cucumber:$artifact") {
                version { strictly("[8,9)") }
            }
        }
        testImplementation(libs.junit.bom) {
            version { strictly("[6,7)") }
        }
        testImplementation("org.junit.jupiter:junit-jupiter") {
            version { strictly("[6,7)") }
        }
        testImplementation("org.junit.jupiter:junit-jupiter-api") {
            version { strictly("[6,7)") }
        }
        testImplementation("org.junit.jupiter:junit-jupiter-engine") {
            version { strictly("[6,7)") }
        }
        testImplementation("org.junit.platform:junit-platform-commons") {
            version { strictly("[6,7)") }
        }
        testImplementation("org.junit.platform:junit-platform-engine") {
            version { strictly("[6,7)") }
        }
        testImplementation("org.junit.platform:junit-platform-launcher") {
            version { strictly("[6,7)") }
        }
    }
}

configurations.configureEach {
    resolutionStrategy.componentSelection {
        all {
            val cucumber8Line = setOf(
                "cucumber-bom",
                "cucumber-plugin",
                "cucumber-java8",
                "cucumber-java",
                "cucumber-core",
                "cucumber-junit-platform-engine",
                "cucumber-junit",
                "cucumber-testng",
                "cucumber-spring",
                "cucumber-picocontainer",
                "cucumber-guice",
                "cucumber-cdi",
                "cucumber-gherkin",
                "cucumber-gherkin-messages",
                "datatable",
                "docstring",
                "cucumber-groovy",
            )
            if (candidate.group == "io.cucumber" && candidate.module in cucumber8Line) {
                val major = candidate.version.substringBefore('.').toIntOrNull()
                if (major != 8) {
                    reject("strictly [8,9) rejected ${candidate.group}:${candidate.module}:${candidate.version}")
                }
            }
            if (candidate.group == "junit" && candidate.module == "junit") {
                reject("blocked junit:junit:${candidate.version}; JUnit 4 is not used")
            }
            if (candidate.group == "org.junit.vintage") {
                reject("blocked ${candidate.group}:${candidate.module}:${candidate.version}")
            }
            if (candidate.group == "org.junit.jupiter" || candidate.group == "org.junit.platform" || candidate.group == "org.junit") {
                val major = candidate.version.substringBefore('.').toIntOrNull()
                if (major != 6) {
                    reject("strictly [6,7) rejected ${candidate.group}:${candidate.module}:${candidate.version}")
                }
            }
        }
    }
}

tasks.test {
    systemProperty("lsd.mono.report.outputDir", "build/reports/lsd-test")
    systemProperty("lsd.core.report.outputDir", "build/reports/lsd-test")
    systemProperty("cucumber.publish.enabled", "false")
}

tasks.jar {
    manifest {
        attributes(
            "Implementation-Title" to "lsd-mono-cucumber-8",
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
val readmeFeature = layout.projectDirectory.file(
    "src/readme/resources/io/lsdconsulting/lsd/mono/cucumber/readme/place_order.feature",
)

tasks.register<JavaExec>("captureReadmeReport") {
    group = "documentation"
    description =
        "Run the Cucumber README scenario through LsdCucumberPlugin and write its report HTML."
    dependsOn(coreProject.tasks.named("copyReportShell"))
    dependsOn(coreProject.tasks.named("classes"))
    classpath = readmeSourceSet.runtimeClasspath
    mainClass.set("io.lsdconsulting.lsd.mono.cucumber.readme.CucumberReadmeSampleKt")
    args(readmeFeature.asFile.absolutePath)
    javaLauncher.set(
        javaToolchains.launcherFor {
            languageVersion.set(JavaLanguageVersion.of(21))
        },
    )
    systemProperty("lsd.mono.report.outputDir", readmeReportDir.get().asFile.absolutePath)
    systemProperty("lsd.mono.ids.deterministic", "true")
    systemProperty("cucumber.publish.enabled", "false")
    outputs.dir(readmeReportDir)
    inputs.file(readmeFeature)
}

tasks.register<Exec>("readmeSamples") {
    group = "documentation"
    description =
        "Regenerate docs/readme PNG and GIF samples from the current report UI. Not part of build or check."
    dependsOn("captureReadmeReport")
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
