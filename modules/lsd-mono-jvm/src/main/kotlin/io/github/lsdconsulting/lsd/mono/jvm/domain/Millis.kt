package io.github.lsdconsulting.lsd.mono.jvm.domain

import java.math.BigDecimal
import java.math.RoundingMode

/**
 * Milliseconds to at most three places, without trailing zeros: `42`, `17.625`, `0.333`. The one
 * rule for the report JSON, the metrics and the timing warnings.
 */
internal fun formatMs(ms: Double): String =
    BigDecimal
        .valueOf(ms)
        .setScale(3, RoundingMode.HALF_UP)
        .stripTrailingZeros()
        .toPlainString()
