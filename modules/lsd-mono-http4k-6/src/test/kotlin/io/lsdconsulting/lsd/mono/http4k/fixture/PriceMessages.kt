package io.lsdconsulting.lsd.mono.http4k.fixture

import io.lsdconsulting.lsd.mono.http4k.JsonText
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
 * http4k-format-jackson; these are written by hand on the module's own JSON reader, so the tests need
 * no JSON library.
 */
object PriceMessages {
    /** The module's own small JSON reader, so the tests need no JSON library. */
    private fun fields(json: String): Map<*, *> = JsonText.parse(json.toByteArray()) as Map<*, *>

    val subscribe: BiDiWsMessageLens<Subscribe> =
        LsdHttp4k.labelled(
            WsMessage
                .string()
                .map(
                    { fields(it).let { f -> Subscribe(f["sku"] as String, (f["ticks"] as Number?)?.toInt() ?: 2) } },
                    { """{"sku":"${it.sku}","ticks":${it.ticks}}""" },
                ).toLens(),
        )

    val priceChanged: BiDiWsMessageLens<PriceChanged> =
        LsdHttp4k.labelled(
            WsMessage
                .string()
                .map(
                    { fields(it).let { f -> PriceChanged(f["sku"] as String, (f["pence"] as Number).toInt()) } },
                    { """{"sku":"${it.sku}","pence":${it.pence}}""" },
                ).toLens(),
        )
}
