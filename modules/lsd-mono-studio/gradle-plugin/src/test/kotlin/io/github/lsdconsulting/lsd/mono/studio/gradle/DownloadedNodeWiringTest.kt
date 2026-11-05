package io.github.lsdconsulting.lsd.mono.studio.gradle

import com.github.gradle.node.NodeExtension
import com.github.gradle.node.NodePlugin
import org.gradle.testfixtures.ProjectBuilder
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File

class DownloadedNodeWiringTest {
    @AfterEach
    fun resetLayoutFlag() {
        Commands.windowsOverride = null
    }

    @Test
    fun `the node layout flag follows the host unless a test sets it`() {
        Commands.windowsOverride = null
        assertEquals(System.getProperty("os.name").lowercase().contains("windows"), Commands.WINDOWS)
    }

    @Test
    fun `download wiring uses node exe and npm cmd when the host is Windows`(
        @TempDir dir: File,
    ) {
        val wired = wire(dir, windows = true)
        assertEquals(wired.nodeDir, wired.binDir)
        assertEquals(File(wired.nodeDir, "node.exe").path, wired.nodeCommand)
        assertEquals(File(wired.nodeDir, "npm.cmd").path, wired.npmCommand)
    }

    @Test
    fun `download wiring uses bin node and npm when the host is not Windows`(
        @TempDir dir: File,
    ) {
        val wired = wire(dir, windows = false)
        val bin = File(wired.nodeDir, "bin")
        assertEquals(bin, wired.binDir)
        assertEquals(File(bin, "node").path, wired.nodeCommand)
        assertEquals(File(bin, "npm").path, wired.npmCommand)
    }

    private fun wire(
        dir: File,
        windows: Boolean,
    ): Wired {
        Commands.windowsOverride = windows
        val project = ProjectBuilder.builder().withProjectDir(dir).build()
        project.tasks.register("lsdStudio", LsdStudioTask::class.java)
        val extension = project.extensions.create("lsdStudio", LsdStudioExtension::class.java)
        project.pluginManager.apply(NodePlugin::class.java)
        val node = project.extensions.getByType(NodeExtension::class.java)
        node.version.set("22.22.0")
        wireDownloadedNodeLayout(project, extension, node)
        val task = project.tasks.getByName("lsdStudio") as LsdStudioTask
        assertTrue(task.dependsOn.any { it.toString().contains("nodeSetup") }, task.dependsOn.toString())
        return Wired(
            nodeDir = node.resolvedNodeDir.get().asFile,
            binDir = task.nodeBinDir.get().asFile,
            nodeCommand = extension.nodeCommand.get(),
            npmCommand = extension.npmCommand.get(),
        )
    }

    private data class Wired(
        val nodeDir: File,
        val binDir: File,
        val nodeCommand: String,
        val npmCommand: String,
    )
}
