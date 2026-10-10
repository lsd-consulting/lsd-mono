package io.lsdconsulting.lsd.mono.core;

import java.util.List;

/** A plain Java record, captured as message data in PayloadConvertersTest. */
public record OrderRecord(String id, int quantity, List<String> tags) {}
