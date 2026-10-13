package io.lsdconsulting.lsd.mono.core;

/** A Java record whose accessor throws, captured as message data in PayloadConvertersTest. */
public record FailingRecord(String name, String detail) {
    @Override
    public String detail() {
        throw new IllegalStateException("accessor failed");
    }
}
