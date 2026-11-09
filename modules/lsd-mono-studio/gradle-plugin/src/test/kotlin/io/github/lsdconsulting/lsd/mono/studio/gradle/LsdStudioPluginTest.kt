package io.github.lsdconsulting.lsd.mono.studio.gradle

import com.github.gradle.node.NodeExtension
import com.github.gradle.node.NodePlugin
import org.gradle.api.internal.project.ProjectInternal
import org.gradle.testfixtures.ProjectBuilder
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File

class LsdStudioPluginTest {
    @TempDir
    lateinit var dir: File

    @AfterEach
    fun resetLayoutFlag() {
        Commands.windowsOverride = null
    }

    private fun project(): org.gradle.api.Project {
        val project = ProjectBuilder.builder().withProjectDir(dir).build()
        project.pluginManager.apply(LsdStudioPlugin::class.java)
        return project
    }

    @Test
    fun `defaults node, npm and the downloaded Node version`() {
        val project = project()
        val extension = project.extensions.getByType(LsdStudioExtension::class.java)
        assertEquals("node", extension.nodeCommand.get())
        assertEquals("npm", extension.npmCommand.get())
        assertEquals("22.22.0", LsdStudioPlugin.DEFAULT_NODE_VERSION)
        assertEquals(LsdStudioPlugin.DEFAULT_NODE_VERSION, extension.nodeVersion.get())
        assertEquals(7357, LsdStudioPlugin.DEFAULT_PORT)
        assertEquals(LsdStudioPlugin.DEFAULT_PORT, extension.port.get())
        assertFalse(extension.expose.get())
        assertTrue(extension.openBrowser.get())
        assertFalse(extension.downloadNode.get())
        assertTrue(extension.wireTests.get())

        val task = project.tasks.named("lsdStudio", LsdStudioTask::class.java).get()
        assertEquals("node", task.nodeCommand.get())
        assertEquals("npm", task.npmCommand.get())
        assertEquals(LsdStudioPlugin.DEFAULT_PORT, task.port.get())
        assertFalse(task.expose.get())
        assertTrue(task.openBrowser.get())
        assertFalse(task.offline.get())
    }

    @Test
    fun `downloadNode applies node-gradle at the default Node version`() {
        val project = project()
        project.extensions
            .getByType(LsdStudioExtension::class.java)
            .downloadNode
            .set(true)
        (project as ProjectInternal).evaluate()
        assertTrue(project.plugins.hasPlugin(NodePlugin::class.java))
        val node = project.extensions.getByType(NodeExtension::class.java)
        assertTrue(node.download.get())
        assertEquals(LsdStudioPlugin.DEFAULT_NODE_VERSION, node.version.get())
    }

    @Test
    fun `a blank nodeDistUrl clears node-gradle's bundled repository`() {
        val project = project()
        val extension = project.extensions.getByType(LsdStudioExtension::class.java)
        extension.downloadNode.set(true)
        extension.nodeDistUrl.set("")
        (project as ProjectInternal).evaluate()
        assertNull(
            project.extensions
                .getByType(NodeExtension::class.java)
                .distBaseUrl.orNull,
        )
    }

    @Test
    fun `nodeDistUrl is handed to node-gradle`() {
        val project = project()
        val extension = project.extensions.getByType(LsdStudioExtension::class.java)
        extension.downloadNode.set(true)
        extension.nodeDistUrl.set("https://mirror.example/node")
        (project as ProjectInternal).evaluate()
        assertEquals(
            "https://mirror.example/node",
            project.extensions
                .getByType(NodeExtension::class.java)
                .distBaseUrl
                .get(),
        )
    }

    @Test
    fun `downloadNode off leaves node-gradle out`() {
        val project = project()
        (project as ProjectInternal).evaluate()
        assertFalse(project.plugins.hasPlugin(NodePlugin::class.java))
    }

    @Test
    fun `a blank dist URL means no bundled repository`() {
        assertNull(nodeDistBaseUrl(""))
        assertNull(nodeDistBaseUrl("   "))
        assertEquals("https://mirror.example/node", nodeDistBaseUrl("https://mirror.example/node"))
    }
}
