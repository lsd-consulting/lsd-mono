package io.github.lsdconsulting.lsd.mono.studio.gradle

/** How a Studio run ended, as the lsdStudio task reports it. */
internal enum class StudioOutcome {
    /** Stopped as asked: by this task, or as it ended cleanly by itself. */
    STOPPED,

    /** Ended with a non-zero code that nobody caused: the build fails. */
    FAILED,

    /** Ended with code 0 when nobody asked: unexpected for a server, so a warning. */
    ENDED_ON_ITS_OWN,
    ;

    internal companion object {
        /**
         * [stopped] is true only when the task stopped a live Studio, and [requested] when a stop was
         * asked for. A request that races Studio exiting by itself does not hide its [exit] code.
         */
        fun of(
            stopped: Boolean,
            requested: Boolean,
            exit: Int,
        ): StudioOutcome =
            when {
                stopped -> STOPPED
                exit != 0 -> FAILED
                requested -> STOPPED
                else -> ENDED_ON_ITS_OWN
            }
    }
}
