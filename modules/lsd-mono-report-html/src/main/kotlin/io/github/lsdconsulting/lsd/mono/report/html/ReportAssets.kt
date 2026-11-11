package io.github.lsdconsulting.lsd.mono.report.html

/**
 * How [ReportWriter] writes the report app into each page.
 *
 * - [INLINE], the default: every `<stem>-diagram.html` and `index.html` carries the whole app and
 *   its report, so one page opens on its own (it still loads `<stem>-payloads.js` for message data).
 * - [SHARED]: the app is written once per directory, as `lsd-report-<hash>.js` and
 *   `lsd-report-<hash>.css`, and each page is a small file that loads them and its
 *   `<stem>-report.js`. A directory of many reports is much smaller, and zips much smaller, but a
 *   page copied without those files shows nothing. The hash is of the file's content, so
 *   two lsd-mono versions writing to one directory keep their own copies.
 */
public enum class ReportAssets {
    INLINE,
    SHARED,
}
