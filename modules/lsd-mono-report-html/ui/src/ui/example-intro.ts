// The example site's short introduction (#161): what LSD is and what the example shows. Only on the
// published example (the Pages site's index.html and example-report.html), never in a report
// someone generates from their own tests.

/** Where the example lives: the Pages site's root, not its spring-boot-4/, http4k-6/ or ktor-3/ demos. */
const EXAMPLE_HOST = 'lsd-consulting.github.io'
const EXAMPLE_PATHS = new Set(['/lsd-mono/', '/lsd-mono/index.html', '/lsd-mono/example-report.html'])

/** The remembered "dismissed" choice. */
export const INTRO_DISMISSED_KEY = 'lsd-example-intro-dismissed'

/**
 * True on the published example. `forced` is the page's `__LSD_EXAMPLE__` flag, which the UI's own
 * checks set to show the introduction on a local page.
 */
export function isExamplePage(where: Pick<Location, 'hostname' | 'pathname'>, forced = false): boolean {
  return forced || (where.hostname === EXAMPLE_HOST && EXAMPLE_PATHS.has(where.pathname))
}

const SITE = 'https://lsd-consulting.github.io/lsd-mono'

/** The introduction: a labelled region with a heading, a dismiss button, and links to read on. */
export function exampleIntroHtml(): string {
  return `<section class="example-intro" id="example-intro" aria-labelledby="example-intro-title">
      <div class="example-intro-body">
        <h2 class="example-intro-title" id="example-intro-title">An example LSD report</h2>
        <p>LSD (Living Sequence Diagrams) draws sequence diagrams from your tests, from the requests and messages they capture, so the diagrams stay true as the code changes. This example is an online shop checkout across 14 services, with some scenarios that warn or fail on purpose.</p>
        <p class="example-intro-links"><a href="https://github.com/lsd-consulting/lsd-mono#readme">Read the LSD README</a> · Demo reports: <a href="${SITE}/spring-boot-4/">Spring Boot 4 demo</a>, <a href="${SITE}/http4k-6/">http4k 6 demo</a>, <a href="${SITE}/ktor-3/">Ktor 3 demo</a></p>
      </div>
      <button type="button" class="icon-btn example-intro-close" id="example-intro-close" aria-label="Dismiss the introduction" title="Dismiss">×</button>
    </section>`
}

/** Whether the visitor dismissed it before. Storage that cannot be read counts as not dismissed. */
export function introDismissed(storage: Pick<Storage, 'getItem'> | null): boolean {
  try {
    return storage?.getItem(INTRO_DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

export function rememberIntroDismissed(storage: Pick<Storage, 'setItem'> | null): void {
  try {
    storage?.setItem(INTRO_DISMISSED_KEY, '1')
  } catch {
    // Private mode or storage off: it stays dismissed for this page only.
  }
}
