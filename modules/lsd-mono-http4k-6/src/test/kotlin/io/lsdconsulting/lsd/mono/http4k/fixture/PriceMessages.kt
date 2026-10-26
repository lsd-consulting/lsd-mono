package io.lsdconsulting.lsd.mono.http4k.fixture

import io.lsdconsulting.lsd.mono.http4k.LsdHttp4k
import org.http4k.lens.BiDiWsMessageLens
import org.http4k.lens.string
import org.http4k.websocket.WsMessage

/** A client asks for a sku's prices, the next [ticks] of them. */
data class Subscribe(
    val sku: String,
    val ticks: Int = 2,
)

/** A sku's new price. */
data class PriceChanged(
    val sku: String,
    val pence: Int,
)

/**
 * The live-price messages as JSON, through lenses [LsdHttp4k.labelled] wraps so their arrows say
 * `Subscribe` and `PriceChanged`. An app would use `WsMessage.auto<Subscribe>().toLens()` from
 * http4k-format-jackson; these are written by hand so the tests need no JSON library.
 */
object PriceMessages {
    private fun field(
        json: String,
        name: String,
    ): String? = Regex(""""$name"\s*:\s*"?([^",}]*)"?""").find(json)?.groupValues?.get(1)

    val subscribe: BiDiWsMessageLens<Subscribe> =
        LsdHttp4k.labelled(
            WsMessage
                .string()
                .map(
                    { Subscribe(field(it, "sku")!!, field(it, "ticks")?.toInt() ?: 2) },
                    { """{"sku":"${it.sku}","ticks":${it.ticks}}""" },
                ).toLens(),
        )

    val priceChanged: BiDiWsMessageLens<PriceChanged> =
        LsdHttp4k.labelled(
            WsMessage
                .string()
                .map(
                    { PriceChanged(field(it, "sku")!!, field(it, "pence")!!.toInt()) },
                    { """{"sku":"${it.sku}","pence":${it.pence}}""" },
                ).toLens(),
        )
}
