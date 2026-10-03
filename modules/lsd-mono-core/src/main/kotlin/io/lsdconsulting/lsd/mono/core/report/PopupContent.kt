package io.lsdconsulting.lsd.mono.core.report

import io.lsdconsulting.lsd.mono.core.IdGenerator

object PopupContent {
    private val idGenerator = IdGenerator()

    @JvmStatic
    fun popupHyperlink(
        id: String = idGenerator.next(),
        popupTitle: String = "",
        hyperlinkText: String,
        popupContent: String,
    ): String =
        """
            <a href="#$id">$hyperlinkText</a>
            <div id="$id" class="overlay" onclick="location.href='#!';">
                <div class="popup" onclick="event.stopPropagation();">
                    <h2>$popupTitle</h2>
                    <a class="close" href="#!">&times;</a>
                    <div class="content">$popupContent</div>
                </div>
            </div>
        """.trimIndent()
}
