package io.github.lsdconsulting.lsd.mono.studio.gradle

import com.github.gradle.node.NodeExtension
import com.github.gradle.node.NodePlugin
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.api.tasks.testing.Test

/**
 * `io.github.lsd-consulting.lsd-mono-studio`: adds the [lsdStudio][LsdStudioExtension] extension and
 * the [lsdStudio][LsdStudioTask] task, which runs LSD Studio with the Node on the `PATH` (#210).
 * Needs Gradle 9.0 or newer.
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
        extension.downloadNode.convention(false)
        extension.nodeVersion.convention(DEFAULT_NODE_VERSION)
        // Resolve the Gradle user home now: providers that capture the Project break the configuration cache.
        val cacheDir = project.gradle.gradleUserHomeDir.resolve("caches/lsd-mono-studio")
        extension.cacheDir.convention(project.layout.dir(project.provider { cacheDir }))
        val processes =
            project.gradle.sharedServices.registerIfAbsent("lsdStudioProcesses", StudioProcesses::class.java) {}
        project.tasks.register("lsdStudio", LsdStudioTask::class.java) { task ->
            task.group = "lsd"
            task.description = "Runs LSD Studio in the foreground until you stop it (Ctrl+C). Killing the Gradle daemon outright leaves it running."
            task.port.convention(extension.port)
            task.expose.convention(extension.expose)
            task.openBrowser.convention(extension.openBrowser)
            task.nodeCommand.convention(extension.nodeCommand)
            task.npmCommand.convention(extension.npmCommand)
            task.studioPackage.convention(extension.studioPackage)
            task.npmRegistry.convention(extension.npmRegistry)
            val proxy = NpmEnvironment.PROXY_PROPERTIES.toSet()
            task.proxyProperties.convention(
                project.providers
                    .systemPropertiesPrefixedBy("http.")
                    .zip(project.providers.systemPropertiesPrefixedBy("https.")) { http, https -> (http + https).filterKeys { it in proxy } },
            )
            task.cacheDir.convention(extension.cacheDir)
            task.stopFile.convention(
                project.layout.projectDirectory.file(project.providers.gradleProperty(STOP_FILE_PROPERTY)),
            )
            task.projectDir.set(project.layout.projectDirectory)
            task.offline.set(project.gradle.startParameter.isOffline)
            task.ci.set(
                project.providers
                    .environmentVariable("CI")
                    .map { it.isNotBlank() && it != "false" }
                    .orElse(false),
            )
            task.processes.set(processes)
            task.usesService(processes)
        }
        // After the build script, so downloadNode is known: node-gradle is applied only when it is on.
        project.afterEvaluate { if (extension.downloadNode.get()) useDownloadedNode(project, extension) }
        project.tasks.withType(Test::class.java).configureEach { task ->
            val wiring = StudioUrlWiring(extension.port, extension.wireTests, extension.studioPackage, project.layout.projectDirectory.asFile)
            task.doFirst(wiring)
            task.jvmArgumentProviders.add(wiring)
        }
    }

    private fun useDownloadedNode(
        project: Project,
        extension: LsdStudioExtension,
    ) {
        project.pluginManager.apply(NodePlugin::class.java)
        val node = project.extensions.getByType(NodeExtension::class.java)
        node.download.set(true)
        node.version.set(extension.nodeVersion)
        if (extension.nodeDistUrl.isPresent) node.distBaseUrl.set(extension.nodeDistUrl)
        val windows = Commands.WINDOWS
        // Node's own archives keep node.exe and npm.cmd at the top on Windows, and both under bin/ elsewhere.
        val binDir = node.resolvedNodeDir.map { if (windows) it else it.dir("bin") }
        extension.nodeCommand.convention(binDir.map { it.file(if (windows) "node.exe" else "node").asFile.path })
        extension.npmCommand.convention(binDir.map { it.file(if (windows) "npm.cmd" else "npm").asFile.path })
        project.tasks.named("lsdStudio", LsdStudioTask::class.java) { task ->
            task.dependsOn("nodeSetup")
            task.nodeBinDir.convention(binDir)
        }
    }

    public companion object {
        /** The Node.js version [LsdStudioExtension.downloadNode] fetches by default. */
        public const val DEFAULT_NODE_VERSION: String = "22.22.0"

        /** LSD Studio's own default port. */
        public const val DEFAULT_PORT: Int = 7357

        /** The Gradle property that overrides which lsd-mono-studio to run (see [LsdStudioExtension.studioPackage]). */
        public const val STUDIO_PACKAGE_PROPERTY: String = "lsd.studio.package"

        /** The Gradle property that sets [LsdStudioTask.stopFile]. */
        public const val STOP_FILE_PROPERTY: String = "lsd.studio.stopFile"
    }
}
