package io.github.lsdconsulting.lsd.mono.ktor.fixture

import io.github.lsdconsulting.lsd.mono.ktor.JsonText
import io.github.lsdconsulting.lsd.mono.ktor.LsdKtor
import io.ktor.serialization.WebsocketContentConverter
import io.ktor.util.reflect.TypeInfo
import io.ktor.websocket.Frame
import java.nio.charset.Charset

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
 * The live-price messages as JSON, through a converter [LsdKtor.labelled] wraps so their arrows
 * say `Subscribe` and `PriceChanged`. An app would use `KotlinxWebsocketSerializationConverter`
 * from ktor-serialization-kotlinx-json; this one is written by hand on the module's own JSON
 * reader, so the tests need no JSON library.
 */
object PriceMessages {
    val converter: WebsocketContentConverter = LsdKtor.labelled(PriceConverter)

    private object PriceConverter : WebsocketContentConverter {
        override suspend fun serialize(
            charset: Charset,
            typeInfo: TypeInfo,
            value: Any?,
        ): Frame =
            Frame.Text(
                when (value) {
                    is Subscribe -> """{"sku":"${value.sku}","ticks":${value.ticks}}"""
                    is PriceChanged -> """{"sku":"${value.sku}","pence":${value.pence}}"""
                    else -> error("not a price message: $value")
                },
            )

        override suspend fun deserialize(
            charset: Charset,
            typeInfo: TypeInfo,
            content: Frame,
        ): Any {
            val fields = JsonText.parse(content.data) as Map<*, *>
            return when (typeInfo.type) {
                Subscribe::class -> Subscribe(fields["sku"] as String, (fields["ticks"] as Number?)?.toInt() ?: 2)
                PriceChanged::class -> PriceChanged(fields["sku"] as String, (fields["pence"] as Number).toInt())
                else -> error("not a price message: ${typeInfo.type}")
            }
        }

        override fun isApplicable(frame: Frame): Boolean = frame is Frame.Text
    }
}
