package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.api.tasks.testing.Test

/**
 * `io.github.lsd-consulting.lsd-mono-studio`: adds the [lsdStudio][LsdStudioExtension] extension and
 * the [lsdStudio][LsdStudioTask] task, which runs LSD Studio with the Node on the `PATH` (#210).
 */
public class LsdStudioPlugin : Plugin<Project> {
    override fun apply(project: Project) {
        val extension = project.extensions.create("lsdStudio", LsdStudioExtension::class.java)
        val gradleProperty = project.providers.gradleProperty(STUDIO_PACKAGE_PROPERTY)
        extension.port.convention(DEFAULT_PORT)
        extension.expose.convention(false)
        extension.openBrowser.convention(true)
        extension.nodeCommand.convention("node")
        extension.npmCommand.convention("npm")
        extension.studioPackage.convention(gradleProperty)
        extension.wireTests.convention(true)
        // Resolve the Gradle user home now: providers that capture the Project break the configuration cache.
        val cacheDir = project.gradle.gradleUserHomeDir.resolve("caches/lsd-mono-studio")
        extension.cacheDir.convention(project.layout.dir(project.provider { cacheDir }))
        val processes =
            project.gradle.sharedServices.registerIfAbsent("lsdStudioProcesses", StudioProcesses::class.java) {}
        project.tasks.register("lsdStudio", LsdStudioTask::class.java) { task ->
            task.group = "lsd"
            task.description = "Runs LSD Studio in the foreground until you stop it (Ctrl+C)."
            task.port.convention(extension.port)
            task.expose.convention(extension.expose)
            task.openBrowser.convention(extension.openBrowser)
            task.nodeCommand.convention(extension.nodeCommand)
            task.npmCommand.convention(extension.npmCommand)
            task.studioPackage.convention(extension.studioPackage)
            task.cacheDir.convention(extension.cacheDir)
            task.stopFile.convention(
                project.layout.projectDirectory.file(project.providers.gradleProperty(STOP_FILE_PROPERTY)),
            )
            task.projectDir.set(project.layout.projectDirectory)
            task.ci.set(
                project.providers
                    .environmentVariable("CI")
                    .map { it.isNotBlank() && it != "false" }
                    .orElse(false),
            )
            task.processes.set(processes)
            task.usesService(processes)
        }
        project.tasks.withType(Test::class.java).configureEach { task ->
            val wiring = StudioUrlWiring(extension.port, extension.wireTests)
            task.doFirst(wiring)
            task.jvmArgumentProviders.add(wiring)
        }
    }

    public companion object {
        /** LSD Studio's own default port. */
        public const val DEFAULT_PORT: Int = 7357

        /** The Gradle property that overrides which lsd-mono-studio to run (see [LsdStudioExtension.studioPackage]). */
        public const val STUDIO_PACKAGE_PROPERTY: String = "lsd.studio.package"

        /** The Gradle property that sets [LsdStudioTask.stopFile]. */
        public const val STOP_FILE_PROPERTY: String = "lsd.studio.stopFile"
    }
}
