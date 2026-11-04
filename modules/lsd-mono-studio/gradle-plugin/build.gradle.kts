plugins {
    id("lsd.kotlin-jvm")
    `java-gradle-plugin`
}

description = "LSD Studio Gradle plugin: an lsdStudio task that runs LSD Studio (the lsd-mono-studio npm package) with local Node"

gradlePlugin {
    // Not published yet: publishing to the Gradle Plugin Portal is a later slice of #210. Until
    // then no plugin marker or pluginMaven publication is created...
    isAutomatedPublishing = false
    plugins {
        register("lsdMonoStudio") {
            id = "io.github.lsd-consulting.lsd-mono-studio"
            implementationClass = "io.github.lsdconsulting.lsd.mono.studio.gradle.LsdStudioPlugin"
            displayName = "LSD Studio"
            description = project.description
        }
    }
}

// ...and lsd.publishing's Maven Central publication stays off, so a release does not ship it.
tasks.withType<AbstractPublishToMaven>().configureEach { enabled = false }

// Gradle runs plugins on the Kotlin it embeds, and build scripts read the plugin's classes with it.
// Compile for Kotlin 2.2, what Gradle 9 embeds, so build scripts on any Gradle 9 can read them.
tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
    compilerOptions {
        languageVersion.set(org.jetbrains.kotlin.gradle.dsl.KotlinVersion.KOTLIN_2_2)
        apiVersion.set(org.jetbrains.kotlin.gradle.dsl.KotlinVersion.KOTLIN_2_2)
    }
}

// The plugin's version is the train version, and it runs lsd-mono-studio at the same version
// (StudioVersion). It reads it from this resource at run time.
val versionResourceDir = layout.buildDirectory.dir("generated/studio-version")
val writeStudioVersion =
    tasks.register("writeStudioVersion") {
        description = "Write the train version the plugin runs lsd-mono-studio at."
        val version = project.version.toString()
        inputs.property("version", version)
        val out = versionResourceDir.map { it.file("io/github/lsdconsulting/lsd/mono/studio/gradle/version.properties") }
        outputs.file(out)
        doLast { out.get().asFile.writeText("version=$version\n") }
    }
sourceSets.main {
    resources.srcDir(writeStudioVersion.map { versionResourceDir.get() })
}

// The functional tests launch the repo's own LSD Studio (../), not the published package: build
// its dist/ first. Each step runs on its own, with no sh, so it works on Windows without Git's sh,
// and declares what it reads and writes, so it reruns only when those change, the tests do not
// depend on `npm ci`'s prepare script having run, and a stale node_modules cannot hide a missing
// schema/. The report viewer is skipped (Studio shows its "viewer not built" page without it).
val studioDir = layout.projectDirectory.dir("..")
val windows = System.getProperty("os.name").lowercase().contains("windows")
// npm is a .cmd script on Windows, which only cmd runs; node runs directly everywhere.
val npm = if (windows) listOf("cmd", "/c", "npm") else listOf("npm")
val studioNpmCi =
    tasks.register<Exec>("studioNpmCi") {
        description = "Install the local lsd-mono-studio's dependencies, without its prepare script."
        workingDir = studioDir.asFile
        commandLine(npm + listOf("ci", "--ignore-scripts", "--no-audit", "--no-fund"))
        inputs.file(studioDir.file("package.json")).withPathSensitivity(PathSensitivity.RELATIVE)
        inputs.file(studioDir.file("package-lock.json")).withPathSensitivity(PathSensitivity.RELATIVE)
        // npm's own record of what node_modules holds: a cheap stand-in for the whole directory.
        outputs.file(studioDir.file("node_modules/.package-lock.json"))
    }
val studioCopySchema =
    tasks.register<Exec>("studioCopySchema") {
        description = "Copy the report schema into the local lsd-mono-studio's schema/."
        workingDir = studioDir.asFile
        commandLine("node", "scripts/copy-schema.mjs")
        inputs.file(studioDir.file("scripts/copy-schema.mjs")).withPathSensitivity(PathSensitivity.RELATIVE)
        inputs.file(studioDir.file("../lsd-mono-report-schema/lsd-report.schema.json")).withPathSensitivity(PathSensitivity.RELATIVE)
        outputs.dir(studioDir.dir("schema"))
    }
val studioBuildViewer =
    tasks.register<Exec>("studioBuildViewer") {
        description = "Run the local lsd-mono-studio's viewer step, skipped: the tests do not need the viewer."
        workingDir = studioDir.asFile
        environment("LSD_STUDIO_SKIP_VIEWER", "1")
        commandLine("node", "scripts/build-viewer.mjs")
        inputs.file(studioDir.file("scripts/build-viewer.mjs")).withPathSensitivity(PathSensitivity.RELATIVE)
        inputs.property("skipViewer", "1")
        outputs.dir(studioDir.dir("viewer"))
    }
val buildStudio =
    tasks.register<Exec>("buildStudio") {
        group = "build"
        description = "Build the local lsd-mono-studio package (npm ci, schema, then tsc) for the functional tests."
        dependsOn(studioNpmCi, studioCopySchema, studioBuildViewer)
        workingDir = studioDir.asFile
        // The tsc that node_modules/.bin names (npx's), and never one fetched from the registry (--no).
        commandLine(npm + listOf("exec", "--no", "--", "tsc", "-p", "tsconfig.build.json"))
        val dist = studioDir.dir("dist").asFile
        doFirst { dist.deleteRecursively() }
        inputs.dir(studioDir.dir("src")).withPathSensitivity(PathSensitivity.RELATIVE)
        inputs.file(studioDir.file("package-lock.json")).withPathSensitivity(PathSensitivity.RELATIVE)
        inputs.file(studioDir.file("tsconfig.build.json")).withPathSensitivity(PathSensitivity.RELATIVE)
        outputs.dir(dist)
        outputs.cacheIf { true }
    }

// Most of the plugin runs only in the functional tests, which Gradle TestKit runs in a separate
// Gradle process that Kover does not see; the floor covers the unit-tested parts.
lsdCoverage {
    lineFloor.set(63)
}

dependencies {
    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testImplementation(gradleTestKit())
    testRuntimeOnly(libs.junit.platform.launcher)
}

tasks.named<Test>("test") {
    dependsOn(buildStudio)
    systemProperty("lsd.studio.dir", studioDir.asFile.absolutePath)
    // The cancellation test drives Gradle through the Tooling API: this Gradle, with its own user home.
    systemProperty("lsd.gradle.home", gradle.gradleHomeDir!!.absolutePath)
    systemProperty(
        "lsd.tooling.home",
        layout.buildDirectory
            .dir("tooling-api-home")
            .get()
            .asFile.absolutePath,
    )
    inputs.dir(studioDir.dir("bin")).withPathSensitivity(PathSensitivity.RELATIVE)
    inputs.dir(studioDir.dir("dist")).withPathSensitivity(PathSensitivity.RELATIVE)
    // Each test starts a Gradle build that runs Node.
    maxParallelForks = 1
    // Lists every test, so CI shows that the Windows-only ones ran there.
    testLogging { events("passed", "skipped", "failed") }
}
