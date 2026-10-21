package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.domain.Scenario
import io.lsdconsulting.lsd.mono.report.html.WrittenReport

/**
 * Report-level state of one [LsdContext]: completed scenarios waiting for their report, the
 * reports written so far (for the index) and the keys of open `report { }` blocks. Every
 * method takes the context's report [lock], the one [ScenarioRegistry] shares.
 */
internal class CompletedReports(
    private val lock: Any,
) {
    private val completed = LinkedHashMap<String?, MutableList<Pair<Long, Scenario>>>()
    private val written = ArrayList<WrittenReport>()
    private val open = HashSet<String>()

    /** Keep [scenario] for the report [reportKey]; [order] is when it began, which the report follows. */
    fun add(
        reportKey: String?,
        order: Long,
        scenario: Scenario,
    ) {
        synchronized(lock) { completed.getOrPut(reportKey) { ArrayList() }.add(order to scenario) }
    }

    /** Remove and return the scenarios completed for [reportKey], in the order they began. */
    fun take(reportKey: String?): List<Scenario> =
        synchronized(lock) {
            completed
                .remove(reportKey)
                .orEmpty()
                .sortedBy { it.first }
                .map { it.second }
        }

    fun written(report: WrittenReport) {
        synchronized(lock) { written.add(report) }
    }

    fun writtenSoFar(): List<WrittenReport> = synchronized(lock) { written.toList() }

    /**
     * The key of a new `report { }` block: its title, so its file name is the same on every run,
     * with a number added while another open block has the same title. [close] releases it.
     */
    fun open(title: String): String =
        synchronized(lock) {
            generateSequence(1) { it + 1 }
                .map { if (it == 1) title else "$title #$it" }
                .first { open.add(it) }
        }

    fun close(key: String) {
        synchronized(lock) { open.remove(key) }
    }

    /** Forget completed scenarios and written reports. Open blocks keep their keys. */
    fun clear() {
        synchronized(lock) {
            completed.clear()
            written.clear()
        }
    }
}
