import io.lsdconsulting.lsd.mono.gradle.writesSampleReport

plugins {
    id("lsd.kotlin-jvm")
    `java-library`
}

lsdCoverage {
    lineFloor.set(97)
}

description = "LSD Mono http4k 6 integration — filters that draw an http4k app's HTTP calls and WebSockets"

// The server filter finds the scenario on a server's own threads (LsdContext.runningScenario).
kotlin {
    compilerOptions {
        optIn.add("io.lsdconsulting.lsd.mono.core.InternalLsdApi")
    }
}

// Built against http4k 6. The exact version is the catalog's `http4k`; this only stops a resolve
// from landing on another major. http4k 7 would be a new module (lsd-mono-http4k-7).
majorLines {
    pin("http4k 6", 6, listOf("org.http4k"))
}

dependencies {
    api(project(":modules:lsd-mono-core"))

    // http4k is the application's, not ours: compile against it and ship none of it, so the app's
    // own http4k 6.x wins. The WebSocket filter needs http4k-realtime-core, which only apps
    // with WebSockets have; the HTTP filters never load its classes.
    compileOnly(platform(libs.http4k.bom))
    compileOnly("org.http4k:http4k-core")
    compileOnly("org.http4k:http4k-realtime-core")

    testImplementation(platform(libs.http4k.bom))
    testImplementation("org.http4k:http4k-core")
    testImplementation("org.http4k:http4k-realtime-core")
    // A real server and WebSocket client for the end-to-end tests (SunHttp is in http4k-core).
    testImplementation("org.http4k:http4k-server-jetty")
    testImplementation("org.http4k:http4k-client-websocket")
    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    // LsdTestConfig and ReportJson (#74).
    testImplementation(testFixtures(project(":modules:lsd-mono-core")))
    // The fixtures are plain JUnit tests with LsdExtension, as an http4k app's tests would be.
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

// The sample report the module README links to: the shop fixtures, plain JUnit tests of an
// http4k app with the filters in its chain, writing a deterministic report into
// build/sample-report. Not part of build or check: Kover leaves this test task out.
// ShopFixture has a test that fails on purpose, to show an error scenario, so this task ignores
// test failures and checks instead that every report was written.
val sampleReportDir = layout.buildDirectory.dir("sample-report")
val sampleReportTests =
    tasks.register<Test>("sampleReportTests") {
        description = "Run the http4k shop fixtures and write the sample report into build/sample-report."
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

// The sample as published on Pages under http4k-6/: the report index plus each report, with
// stable addresses for the diagrams (files carry a short hash; a report is named after its class). The Pages workflow copies
// build/pages into the site next to lsd-mono-core's example report.
tasks.register<Sync>("sampleReport") {
    group = "documentation"
    description = "Build the http4k integration's sample report site into build/pages. Not part of build or check."
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
