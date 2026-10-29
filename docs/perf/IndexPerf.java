import io.github.lsdconsulting.lsd.mono.jvm.LsdContext;
import io.github.lsdconsulting.lsd.mono.jvm.domain.Status;
import java.util.*;
/** 200 test classes x 5 scenarios x 20 call/reply pairs; times completeReport and createIndex per class. */
public class IndexPerf {
  public static void main(String[] a) {
    int n = Integer.parseInt(a[0]);
    System.setProperty("lsd.mono.report.outputDir", a[1]);
    System.setProperty("lsd.mono.ids.deterministic", "true");
    LsdContext lsd = LsdContext.getInstance();
    String[] svc = {"Customer","Gateway","Orders","Payments","Stock","Mail"};
    long[] write = new long[n], index = new long[n];
    for (int r = 0; r < n; r++) {
      for (int s = 0; s < 5; s++) {
        for (int m = 0; m < 20; m++) {
          final String from = svc[m % 5], to = svc[m % 5 + 1], label = "POST /op" + m;
          final int rr = r, ss = s, mm = m;
          lsd.capture(c -> { c.calls(from, to).label(label).data(Map.of("report", rr, "scenario", ss, "item", "x".repeat(200))); c.repliesTo(to, from).label("200"); });
        }
        Status st = (r % 17 == 0 && s == 4) ? Status.ERROR : (r % 11 == 0 && s == 3) ? Status.WARN : Status.SUCCESS;
        lsd.completeScenario("Scenario " + s + " of class " + r, "desc", st);
      }
      long t0 = System.nanoTime();
      lsd.completeReport("Test class " + r);
      long t1 = System.nanoTime();
      lsd.createIndex();
      long t2 = System.nanoTime();
      write[r] = t1 - t0; index[r] = t2 - t1;
    }
    for (int r : new int[]{0, 9, 49, 99, 199}) if (r < n)
      System.out.printf("class %d: completeReport %.1f ms, createIndex %.1f ms%n", r + 1, write[r] / 1e6, index[r] / 1e6);
    long t = System.nanoTime(); lsd.createIndex();
    System.out.printf("warm createIndex at %d: %.1f ms%n", n, (System.nanoTime() - t) / 1e6);
    long[] last = Arrays.copyOfRange(index, Math.max(0, n - 20), n); Arrays.sort(last);
    System.out.printf("median createIndex over last 20 classes: %.1f ms%n", last[last.length / 2] / 1e6);
  }
}
