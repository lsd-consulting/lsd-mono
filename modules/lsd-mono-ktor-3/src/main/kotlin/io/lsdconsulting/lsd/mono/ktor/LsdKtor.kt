package io.lsdconsulting.lsd.mono.ktor

import io.ktor.serialization.WebsocketContentConverter
import io.ktor.util.reflect.TypeInfo
import io.ktor.utils.io.charsets.Charset
import io.ktor.websocket.Frame

/** Defaults for the [Lsd] and [LsdClient] plugins, and labels for WebSocket messages. */
public object LsdKtor {
    /** Who a request comes from, or a call is made by, when nothing else says. */
    public const val DEFAULT_CLIENT: String = "Client"

    /** The app on the diagram when [LsdConfig.app] is not set. */
    public const val DEFAULT_APP: String = "App"

    /** How many messages each WebSocket draws by default. */
    public const val DEFAULT_MESSAGES_SHOWN: Int = 20

    /**
     * [converter], with each message it writes labelled on the diagram by the class it was
     * written from (`PriceChanged` rather than `text message`), at either end of the socket in
     * this JVM. Messages are read and written exactly as [converter] does.
     *
     * ```kotlin
     * install(WebSockets) { contentConverter = LsdKtor.labelled(KotlinxWebsocketSerializationConverter(Json)) }
     * ```
     */
    @JvmStatic
    public fun labelled(converter: WebsocketContentConverter): WebsocketContentConverter = Labelled(converter)
}

private class Labelled(
    private val converter: WebsocketContentConverter,
) : WebsocketContentConverter by converter {
    override suspend fun serialize(
        charset: Charset,
        typeInfo: TypeInfo,
        value: Any?,
    ): Frame = converter.serialize(charset, typeInfo, value).also { MessageNames.record(it, value) }
}
