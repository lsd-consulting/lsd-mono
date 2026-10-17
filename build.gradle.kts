import io.lsdconsulting.lsd.mono.gradle.trainVersion

plugins {
    // Root is a thin aggregator; convention plugins live in build-logic.
    base
    id("lsd.formatting")
}

// The Maven Central namespace lsd-consulting already publishes lsd-core under. Packages stay
// io.lsdconsulting.lsd.mono; only the Maven group differs.
group = "io.github.lsd-consulting"
// The train version: -Plsd.version, else the `vX.Y.Z` tag on this commit, else a snapshot of the
// next patch (TrainVersion.kt, docs/releasing.md). git failing (no tags, no git) means a snapshot.
version =
    trainVersion(
        explicit = providers.gradleProperty("lsd.version").orNull,
        describe =
            runCatching {
                val describe =
                    providers.exec {
                        commandLine("git", "describe", "--tags", "--match", "v[0-9]*", "--long")
                        workingDir = rootDir
                        isIgnoreExitValue = true
                    }
                describe.standardOutput.asText
                    .get()
                    .takeIf { describe.result.get().exitValue == 0 }
            }.getOrNull(),
    )

// Prints the version a build here would publish; the release workflow checks it.
tasks.register("printVersion") {
    group = "help"
    description = "Prints the train version."
    val shown = version.toString()
    doLast { println(shown) }
}

// Picks up every subproject that registers readmeSamples, including ones added later.
tasks.register("readmeSamples") {
    group = "documentation"
    description =
        "Regenerate README sample images for every module that defines a readmeSamples task."
}

// build-logic is an included build, so its tests are not part of the root build by default.
tasks.named("check") {
    dependsOn(gradle.includedBuild("build-logic").task(":check"))
}

gradle.projectsEvaluated {
    val moduleSamples = subprojects.mapNotNull { it.tasks.findByName("readmeSamples") }
    tasks.named("readmeSamples").configure {
        dependsOn(moduleSamples)
    }
}

// Generated files must not drift (#26). Build outputs are gitignored and nothing the build
// writes is committed, so after a build the tree must be as checked out. This fails on any
// tracked file the build changed and any untracked, unignored file it left in a directory
// (untracked files at the root, such as personal notes, are not the build's doing).
// CI runs `./gradlew build verifyGenerated`. See docs/generated-files.md.
val verifyGenerated = tasks.register("verifyGenerated") {
    group = "verification"
    description = "Build, then fail if git shows changed or new files that the build should not leave."
    val status =
        providers
            .exec {
                commandLine("git", "status", "--porcelain", "--untracked-files=all")
                workingDir = rootDir
            }.standardOutput.asText
    doLast {
        val drift =
            status.get().lines().filter { it.isNotBlank() }.filter { line ->
                !line.startsWith("??") || line.substring(3).trim('"').contains('/')
            }
        if (drift.isNotEmpty()) {
            throw GradleException(
                """
                |The build changed or created files that git sees:
                |${drift.joinToString("\n") { "  $it" }}
                |A build must leave the tree as checked out. Either a committed file is generated
                |(commit the regenerated copy, or better, stop tracking it), or a new build output
                |needs a .gitignore entry. See docs/generated-files.md.
                """.trimMargin(),
            )
        }
        logger.lifecycle("verifyGenerated: the build left no changed or new files.")
    }
}

gradle.projectsEvaluated {
    verifyGenerated.configure {
        dependsOn(subprojects.mapNotNull { it.tasks.findByName("build") })
    }
}
