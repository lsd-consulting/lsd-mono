package io.github.lsdconsulting.lsd.mono.jvm.report

import io.github.lsdconsulting.lsd.mono.jvm.LsdVersion
import io.github.lsdconsulting.lsd.mono.jvm.properties.LsdProperties
import io.github.lsdconsulting.lsd.mono.report.html.ReportWriter
import io.github.lsdconsulting.lsd.mono.report.html.ReportWriterSettings

/**
 * A [ReportWriter] with the settings the properties give now: this version as the generator,
 * `lsd.mono.report.generatedAt` and `lsd.mono.report.usagePing`. Read on each call, as the
 * writer read them before it was given settings.
 */
internal fun reportWriter(): ReportWriter =
    ReportWriter(
        ReportWriterSettings(
            generator = LsdVersion.generator,
            generatedAt = LsdProperties.generatedAt(),
            usagePing = LsdProperties.usagePing(),
        ),
    )
