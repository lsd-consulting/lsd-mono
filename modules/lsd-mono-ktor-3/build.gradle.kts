import io.lsdconsulting.lsd.mono.gradle.writesSampleReport

plugins {
    id("lsd.kotlin-jvm")
    `java-library`
}

lsdCoverage {
    lineFloor.set(97)
}

description = "LSD Mono Ktor 3 integration — plugins that draw a Ktor app's HTTP calls and WebSockets"

// The server plugin finds the scenario on a server's own threads (LsdContext.runningScenario).
// Ktor's request and response channels are swapped through two of its @InternalAPI members
// (PipelineRequest.setReceiveChannel and HttpResponse.rawContent), as its own plugins do.
kotlin {
    compilerOptions {
        optIn.add("io.lsdconsulting.lsd.mono.core.InternalLsdApi")
    }
}

// Built against Ktor 3. The exact version is the catalog's `ktor`; this only stops a resolve from
// landing on another major. Ktor 4 would be a new module (lsd-mono-ktor-4).
majorLines {
    pin("Ktor 3", 3, listOf("io.ktor"))
}

dependencies {
    api(project(":modules:lsd-mono-core"))

    // Ktor is the application's, not ours: compile against it and ship none of it, so the app's own
    // Ktor 3.x wins. A server-only app has no client, a client-only one no server, and an app
    // without WebSockets none of ktor-websockets: each part only loads the classes it draws.
    compileOnly(platform(libs.ktor.bom))
    compileOnly("io.ktor:ktor-server-core")
    compileOnly("io.ktor:ktor-server-websockets")
    compileOnly("io.ktor:ktor-client-core")
    compileOnly("io.ktor:ktor-websockets")
    compileOnly("io.ktor:ktor-serialization")

    testImplementation(platform(libs.ktor.bom))
    testImplementation("io.ktor:ktor-server-core")
    testImplementation("io.ktor:ktor-server-websockets")
    testImplementation("io.ktor:ktor-client-core")
    testImplementation("io.ktor:ktor-serialization")
    // testApplication, and a real server and client for the end-to-end tests.
    testImplementation("io.ktor:ktor-server-test-host")
    testImplementation("io.ktor:ktor-server-status-pages")
    testImplementation("io.ktor:ktor-server-cio")
    testImplementation("io.ktor:ktor-client-cio")
    // A client engine that is neither in memory nor a socket, to a host that is not allowed.
    testImplementation("io.ktor:ktor-client-mock")
    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    // LsdTestConfig and ReportJson (#74).
    testImplementation(testFixtures(project(":modules:lsd-mono-core")))
    // The fixtures are plain JUnit tests with LsdExtension, as a Ktor app's tests would be.
    testImplementation(project(":modules:lsd-mono-junit-jupiter"))
    testRuntimeOnly(libs.junit.platform.launcher)
}

val moduleBuildFiles =
    rootProject.layout.projectDirectory
        .dir("modules")
        .asFileTree
        .matching { include("*/build.gradle.kts") }

tasks.test {
    useJUnitPlatform {
        // The sample report's fixtures, run by sampleReportTests.
        excludeTags("lsd-fixture")
    }
    systemProperty("lsd.mono.report.outputDir", "build/reports/lsd-test")
    systemProperty("lsd.mono.report.usagePing", "false")
    // DependencyDirectionTest reads every module's build file.
    inputs.files(moduleBuildFiles).withPathSensitivity(PathSensitivity.RELATIVE).withPropertyName("moduleBuildFiles")
    systemProperty(
        "lsd.test.modulesDir",
        rootProject.layout.projectDirectory
            .dir("modules")
            .asFile.path,
    )
}

// The sample report the module README links to: the shop fixtures, plain JUnit tests of a Ktor
// app with the plugins installed, writing a deterministic report into build/sample-report. Not
// part of build or check: Kover leaves this test task out. ShopFixture has a test that fails on
// purpose, to show an error scenario, so this task ignores test failures and checks instead that
// every report was written.
val sampleReportDir = layout.buildDirectory.dir("sample-report")
val sampleReportTests =
    tasks.register<Test>("sampleReportTests") {
        description = "Run the Ktor shop fixtures and write the sample report into build/sample-report."
        testClassesDirs = sourceSets.test
            .get()
            .output.classesDirs
        classpath = sourceSets.test.get().runtimeClasspath
        useJUnitPlatform { includeTags("lsd-fixture") }
        writesSampleReport(sampleReportDir)
        ignoreFailures = true
        val dir = sampleReportDir.get().asFile
        doLast {
            val diagrams = dir.listFiles { f -> f.name.endsWith("-diagram.html") }.orEmpty().map { it.name }
            val expected = listOf("ShopFixture-", "ServerShopFixture-", "LivePricesFixture-")
            check(expected.all { prefix -> diagrams.any { it.startsWith(prefix) } }) {
                "sampleReportTests wrote $diagrams, not every report in $expected"
            }
        }
    }
kover {
    currentProject {
        instrumentation { disabledForTestTasks.add(sampleReportTests.name) }
    }
}

// The sample as published on Pages under ktor-3/: the report index plus each report, with stable
// addresses for the diagrams (files carry a short hash; a report is named after its class). The
// Pages workflow copies build/pages into the site next to lsd-mono-core's example report.
tasks.register<Sync>("sampleReport") {
    group = "documentation"
    description = "Build the Ktor integration's sample report site into build/pages. Not part of build or check."
    dependsOn(sampleReportTests)
    from(sampleReportDir) { exclude(".lsd-index/**") }
    from(sampleReportDir) {
        include("ShopFixture-*-diagram.html")
        rename("""^ShopFixture-[0-9a-f]{8}-diagram\.html$""", "shop-report.html")
    }
    from(sampleReportDir) {
        include("ServerShopFixture-*-diagram.html")
        rename("""^ServerShopFixture-[0-9a-f]{8}-diagram\.html$""", "server-shop-report.html")
    }
    from(sampleReportDir) {
        include("LivePricesFixture-*-diagram.html")
        rename("""^LivePricesFixture-[0-9a-f]{8}-diagram\.html$""", "live-prices-report.html")
    }
    into(layout.buildDirectory.dir("pages"))
}
