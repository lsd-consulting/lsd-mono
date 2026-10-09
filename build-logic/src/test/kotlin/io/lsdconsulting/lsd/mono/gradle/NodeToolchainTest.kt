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

    @Test
    fun `picks the newest complete Node 22 and ignores other majors`() {
        install("v17.9.1")
        install("v22.6.0")
        install("v22.23.3")
        install("v22.30.0", npm = false)
        install("v24.1.0")

        assertEquals(File(home, ".nvm/versions/node/v22.23.3/bin"), node22BinDir(home))
    }

    @Test
    fun `compares minor versions as numbers`() {
        install("v22.9.0")
        install("v22.10.0")

        assertEquals(File(home, ".nvm/versions/node/v22.10.0/bin"), node22BinDir(home))
    }

    @Test
    fun `is null without nvm or without a Node 22`() {
        assertNull(node22BinDir(home))
        install("v20.11.0")
        assertNull(node22BinDir(home))
    }
}
