package io.github.lsdconsulting.lsd.mono.report.html

import io.github.lsdconsulting.lsd.mono.report.model.GeneratorJson
import java.time.Instant

/**
 * What [ReportWriter] writes beyond the reports it is given. The index page's manifest says what
 * wrote it ([generator], such as `my-adapter` version `1.0`), when ([generatedAt], or the time of writing
 * when null) and whether the page may send the usage ping ([usagePing]). [assets] says whether
 * each page carries the report app or the directory shares one copy ([ReportAssets.INLINE], the
 * default, or [ReportAssets.SHARED]). The writer reads no properties or environment of its own.
 */
public class ReportWriterSettings
    @JvmOverloads
    constructor(
        public val generator: GeneratorJson,
        public val generatedAt: Instant? = null,
        public val usagePing: Boolean = true,
    ) {
        /** Whether pages carry the report app or share one copy per directory. Default [ReportAssets.INLINE]. */
        public var assets: ReportAssets = ReportAssets.INLINE
            private set

        /** These settings with [assets] (#64). */
        public constructor(
            generator: GeneratorJson,
            generatedAt: Instant?,
            usagePing: Boolean,
            assets: ReportAssets,
        ) : this(generator, generatedAt, usagePing) {
            this.assets = assets
        }

        override fun equals(other: Any?): Boolean =
            other is ReportWriterSettings &&
                generator == other.generator &&
                generatedAt == other.generatedAt &&
                usagePing == other.usagePing &&
                assets == other.assets

        override fun hashCode(): Int = generator.hashCode()

        override fun toString(): String = "ReportWriterSettings(generator=$generator, generatedAt=$generatedAt, usagePing=$usagePing, assets=$assets)"
    }
