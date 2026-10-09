package io.lsdconsulting.lsd.mono.core.report

import io.lsdconsulting.lsd.mono.core.IdGenerator
import io.lsdconsulting.lsd.mono.core.html.Html

/** A link that opens an overlay, as lsd-core's popup helper did. */
object PopupContent {
    private val idGenerator = IdGenerator()

    /**
     * [id], [popupTitle] and [hyperlinkText] are text and are escaped. [popupContent] is
     * HTML and is used as given: escape any text in it with [Html.text].
     */
    @JvmStatic
    fun popupHyperlink(
        id: String = idGenerator.next(),
        popupTitle: String = "",
        hyperlinkText: String,
        popupContent: String,
    ): String =
        """
            <a href="#${Html.attribute(id)}">${Html.text(hyperlinkText)}</a>
            <div id="${Html.attribute(id)}" class="overlay" onclick="location.href='#!';">
                <div class="popup" onclick="event.stopPropagation();">
                    <h2>${Html.text(popupTitle)}</h2>
                    <a class="close" href="#!">&times;</a>
                    <div class="content">$popupContent</div>
                </div>
            </div>
        """.trimIndent()
}
