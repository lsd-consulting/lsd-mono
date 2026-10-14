package io.lsdconsulting.lsd.mono.gradle

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File

class NodeToolchainTest {
    @TempDir
    lateinit var home: File

    private fun install(version: String, npm: Boolean = true) {
        val bin = File(home, ".nvm/versions/node/$version/bin").apply { mkdirs() }
        File(bin, "node").apply { writeText("#!/bin/sh\n") }.setExecutable(true)
        if (npm) File(bin, "npm").apply { writeText("#!/bin/sh\n") }.setExecutable(true)
    }

    private fun bin(version: String) = File(home, ".nvm/versions/node/$version/bin")

    @Test
    fun `prefers the newest complete Node of the CI major`() {
        install("v17.9.1")
        install("v22.23.3")
        install("v24.1.0")
        install("v24.3.0")
        install("v24.9.0", npm = false)
        install("v25.0.0")

        assertEquals(bin("v24.3.0"), nodeBinDir(24, home))
    }

    @Test
    fun `without the CI major, takes the newest Node of at least 22_6`() {
        install("v20.11.0")
        install("v22.5.1")
        install("v22.9.0")
        install("v22.10.0")

        assertEquals(bin("v22.10.0"), nodeBinDir(24, home))
        assertEquals(bin("v22.10.0"), nodeBinDir(null, home))
    }

    @Test
    fun `is null without nvm or without a Node new enough`() {
        assertNull(nodeBinDir(24, home))
        install("v20.11.0")
        install("v22.6.0", npm = false)
        assertNull(nodeBinDir(24, home))
    }

    @Test
    fun `reads the major from nvmrc`() {
        val nvmrc = File(home, ".nvmrc")
        assertNull(nvmrcMajor(nvmrc))
        for ((text, major) in listOf("24\n" to 24, "v24" to 24, "24.1.0" to 24, "lts/*" to null)) {
            nvmrc.writeText(text)
            assertEquals(major, nvmrcMajor(nvmrc), text)
        }
    }
}
