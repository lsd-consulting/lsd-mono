import io.github.lsdconsulting.lsd.mono.jvm.LsdContext;
/** A fresh JVM (a new Gradle test fork) rebuilding the index of a full directory. */
public class IndexPerfCold { public static void main(String[] a) {
  System.setProperty("lsd.mono.report.outputDir", a[0]);
  long t = System.nanoTime(); new LsdContext().createIndex();
  System.out.printf("cold createIndex (new JVM): %.1f ms%n", (System.nanoTime() - t) / 1e6);
  t = System.nanoTime(); new LsdContext().createIndex();
  System.out.printf("second createIndex same JVM: %.1f ms%n", (System.nanoTime() - t) / 1e6);
}}
