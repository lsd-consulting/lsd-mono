package io.lsdconsulting.lsd.mono.springboot.fixture;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;

/**
 * The batches a fixture's batch listener has handled, by size. A bean, so each fixture's context
 * has its own and a listener left running in another cached context cannot count towards it.
 */
public class Batches {
    private final List<Integer> sizes = new CopyOnWriteArrayList<>();

    synchronized void handled(int size) {
        sizes.add(size);
        notifyAll();
    }

    /** Whether the listener has handled at least {@code records} records in all, within the timeout. */
    public synchronized boolean await(int records, long timeout, TimeUnit unit) throws InterruptedException {
        long deadline = System.nanoTime() + unit.toNanos(timeout);
        while (total() < records) {
            long left = deadline - System.nanoTime();
            if (left <= 0) return false;
            TimeUnit.NANOSECONDS.timedWait(this, left);
        }
        return true;
    }

    public List<Integer> sizes() {
        return List.copyOf(sizes);
    }

    private int total() {
        return sizes.stream().mapToInt(Integer::intValue).sum();
    }
}
