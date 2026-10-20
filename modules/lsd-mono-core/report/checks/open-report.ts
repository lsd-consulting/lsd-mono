import { expect, type Page } from '@playwright/test'
import type { IndexManifest } from '../src/lib/report-index'
import type { Report } from '../src/types'

/**
 * The one way the checks open a page (#97): a single report, or an index page whose reports load
 * when opened. Anything to set up before the app script runs (theme, storage, payloads, media)
 * goes in the options.
 */
export interface OpenOptions {
  /** A single-report page (`window.__LSD_REPORT__`). */
  report?: Report
  /** An index page: the manifest, and each listed report by id, served at its `data` file. */
  index?: { manifest: IndexManifest; reports: Record<string, Report> }
  /** A stored theme choice. Leave it out to follow the OS. */
  theme?: string
  /** Other localStorage items to set before the app runs. */
  storage?: Record<string, string>
  /** The path and hash to open. Default `/`. */
  path?: string
  /** The sibling payload script: its file name and its body. */
  payloads?: { src: string; body: string }
  /**
   * Media to emulate. Reduced motion is on unless this says otherwise: the context option alone
   * does not take in this Chromium build, and the entrance animation would leave axe and
   * screenshots looking at a half-faded page.
   */
  media?: Parameters<Page['emulateMedia']>[0]
  /** The viewport, when a test does not set one with `test.use`. */
  viewport?: { width: number; height: number }
  /**
   * What to wait for before returning. `diagram` (the default) waits for the first diagram and
   * the fonts; `labels` also waits for the first message label; `none` returns after `goto`, or
   * before it with `navigate: false`.
   */
  wait?: 'diagram' | 'labels' | 'none'
  /** False to set everything up and leave the `goto` to the test. Default true. */
  navigate?: boolean
}

/** What a test may want back: the ids of index reports whose data file loaded, in order. */
export interface Opened {
  loaded: string[]
}

export async function openReport(page: Page, options: OpenOptions): Promise<Opened> {
  const { report, index, theme, storage = {}, path = '/', payloads, media, viewport } = options
  const opened: Opened = { loaded: [] }
  const items = theme === undefined ? storage : { 'lsd-report-theme-v2': theme, ...storage }
  if (viewport) await page.setViewportSize(viewport)
  await page.addInitScript(
    ({ single, manifest, payloadsSrc, stored }) => {
      if (single) window.__LSD_REPORT__ = single
      if (manifest) window.__LSD_INDEX__ = manifest
      if (single && payloadsSrc) window.__LSD_PAYLOADS_SRC__ = payloadsSrc
      for (const [key, value] of Object.entries(stored)) localStorage.setItem(key, value)
    },
    { single: report ?? null, manifest: index?.manifest ?? null, payloadsSrc: payloads?.src ?? null, stored: items },
  )
  for (const entry of index?.manifest.reports ?? []) {
    const listed = index!.reports[entry.id]
    if (!listed) continue
    const body = `(window.__LSD_REPORTS__=window.__LSD_REPORTS__||{})[${JSON.stringify(entry.id)}]={report:${JSON.stringify(listed)},payloadsSrc:${JSON.stringify(payloads?.src ?? null)}};`
    await page.route(`**/${entry.data}`, (route) => {
      opened.loaded.push(entry.id)
      return route.fulfill({ contentType: 'text/javascript', body })
    })
  }
  if (payloads)
    await page.route(`**/${payloads.src}`, (route) =>
      route.fulfill({ contentType: 'text/javascript', body: payloads.body }),
    )
  await page.emulateMedia({ reducedMotion: 'reduce', ...media })
  if (options.navigate === false) return opened
  await page.goto(path)
  const wait = options.wait ?? 'diagram'
  if (wait === 'none') return opened
  await expect(page.locator('.seq-svg').first()).toBeVisible()
  if (wait === 'labels') await expect(page.locator('.msg-label').first()).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  return opened
}
