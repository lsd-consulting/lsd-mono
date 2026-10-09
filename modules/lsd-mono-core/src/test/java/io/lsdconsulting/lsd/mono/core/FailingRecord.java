package io.lsdconsulting.lsd.mono.core;

/** A Java record whose accessor throws, captured as message data in PayloadSnapshotTest. */
public record FailingRecord(String name, String secret) {
    @Override
    public String secret() {
        throw new IllegalStateException("accessor failed");
    }
}
