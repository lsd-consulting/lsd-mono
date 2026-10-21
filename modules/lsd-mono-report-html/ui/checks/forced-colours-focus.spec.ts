import { devices, expect, test, type Locator, type Page } from '@playwright/test'
import { PAGES, sectionsReport } from './diagram-pages'
import { example, openExample } from './example-report'
import { openReport } from './open-report'
import { painted } from './ux-helpers'

// #116: in forced colours (Windows Contrast themes) box-shadow is not drawn, and most focus rings
// were a box-shadow over outline: none. Every Tab stop must show a ring there: a real outline on
// each HTML control, one that changes its pixels, and one no scrolling container clips.

const { userAgent, deviceScaleFactor } = devices['iPhone 13']
const SIZES = {
  '1440': { viewport: { width: 1440, height: 900 } },
  '390 touch': { viewport: { width: 390, height: 844 }, userAgent, deviceScaleFactor, isMobile: true, hasTouch: true },
} as const

interface Stop {
  name: string
  svg: boolean
  /** Outline style and width, as computed. */
  outline: string
  /** Why the ring would be cut off by a scrolling container, or null. */
  clipped: string | null
}

/** The focused element: its name, its outline, and whether an overflow container cuts into it. */
function readStop(page: Page): Promise<Stop | null> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el || el === document.body) return null
    const cs = getComputedStyle(el)
    const label = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30)
    const name = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${[...el.classList].map((c) => `.${c}`).join('')} "${label}"`
    const r = el.getBoundingClientRect()
    let clipped: string | null = null
    // Probe the outermost pixel of the ring, wherever the outline puts it: 1px inside the control
    // for the forced-colours ring (offset -2px, width 2px), outside it for an outward ring. At the
    // middle of each edge that pixel must be on screen, inside every box that clips overflow, and
    // not under another element (a sticky bar). A control taller or wider than most of the screen
    // (a scrollport) is skipped.
    const ring = cs.outlineStyle === 'none' ? 0 : parseFloat(cs.outlineOffset) + parseFloat(cs.outlineWidth)
    const out = ring - 1
    if (r.width < innerWidth * 0.6 && r.height < innerHeight * 0.6) {
      const edges: [string, number, number][] = [
        ['left', r.left - out, r.top + r.height / 2],
        ['right', r.right + out, r.top + r.height / 2],
        ['top', r.left + r.width / 2, r.top - out],
        ['bottom', r.left + r.width / 2, r.bottom + out],
      ]
      const clippers: Element[] = []
      for (let p = el.parentElement; p; p = p.parentElement) {
        const o = getComputedStyle(p)
        if (o.overflowX !== 'visible' || o.overflowY !== 'visible') clippers.push(p)
      }
      for (const [edge, x, y] of edges) {
        const at = `${edge} edge of the ring at ${Math.round(x)},${Math.round(y)}`
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) {
          clipped = `${at} is off screen`
          break
        }
        // Inside the control, hit testing below already sees any clip; outside it, it cannot.
        const clipper = (out > 0 ? clippers : []).find((c) => {
          if (c === document.documentElement || c === document.body) return false
          const b = c.getBoundingClientRect()
          const left = b.left + c.clientLeft
          const top = b.top + c.clientTop
          return x < left || x >= left + c.clientWidth || y < top || y >= top + c.clientHeight
        })
        if (clipper) {
          clipped = `${at} is cut off by ${clipper.tagName.toLowerCase()}.${[...clipper.classList].join('.')}`
          break
        }
        const hit = document.elementFromPoint(x, y)
        if (hit && (hit === el || el.contains(hit) || hit.contains(el))) continue
        const what = hit ? `${hit.tagName.toLowerCase()}.${[...hit.classList].join('.')}` : 'nothing'
        clipped = `${at} is ${what}`
        break
      }
    }
    return {
      name,
      svg: el instanceof SVGElement,
      outline: `${cs.outlineStyle} ${cs.outlineWidth}`,
      clipped,
    }
  })
}

/**
 * Tab from [start] until focus leaves [within] (a selector) or comes back round, and read each stop.
 * [max] bounds a run that never leaves.
 */
async function tabStops(page: Page, start: Locator, within: string | null, max = 120): Promise<Stop[]> {
  // A key press first, so the start's focus is keyboard focus too; it is the first stop.
  await page.keyboard.press('Shift')
  await start.focus()
  await painted(page)
  const stops: Stop[] = [(await readStop(page))!]
  const seen = new Set<string>()
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab')
    const inside = await page.evaluate(
      (sel) => (sel ? Boolean(document.activeElement?.closest(sel)) : document.activeElement !== document.body),
      within,
    )
    if (!inside) break
    // Focus can scroll the page; the sticky headers settle on the next frames.
    await painted(page)
    const stop = await readStop(page)
    if (!stop) break
    // Roving stops (message arrows) and repeated rows can share a name: key by name and index.
    const key = `${stop.name}#${await page.evaluate(() => [...document.querySelectorAll('*')].indexOf(document.activeElement!))}`
    if (seen.has(key)) break
    seen.add(key)
    stops.push(stop)
  }
  return stops
}

/** Stops that show no ring, or whose ring is clipped. */
function problems(stops: Stop[]): string[] {
  return stops.flatMap((s) => {
    const out: string[] = []
    const [style, width] = s.outline.split(' ')
    if (!s.svg && (style === 'none' || parseFloat(width) < 2)) out.push(`${s.name}: outline ${s.outline}`)
    if (s.clipped) out.push(`${s.name}: ${s.clipped}`)
    return out
  })
}

/**
 * True when keyboard focus changes [target]'s pixels (a ring is drawn), against it unfocused.
 * Focus first, so the page scrolls the way a Tab would, then blur, which leaves it where it is.
 */
async function focusShows(page: Page, target: Locator): Promise<boolean> {
  // A key press first, so the focus that follows is keyboard focus (:focus-visible).
  await page.keyboard.press('Shift')
  await target.focus()
  await painted(page)
  expect(await target.evaluate((el) => el.matches(':focus-visible'))).toBe(true)
  const box = (await target.boundingBox())!
  const clip = { x: Math.max(0, box.x - 3), y: Math.max(0, box.y - 3), width: box.width + 6, height: box.height + 6 }
  const focused = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' })
  await target.blur()
  await painted(page)
  expect(await target.boundingBox()).toEqual(box)
  const unfocused = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' })
  return !focused.equals(unfocused)
}

async function forced(page: Page): Promise<void> {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
}

for (const [size, use] of Object.entries(SIZES)) {
  test.describe(`forced colours focus at ${size}`, () => {
    test.use(use)

    test('every Tab stop on the page shows an unclipped ring', async ({ page }) => {
      await openExample(page)
      await forced(page)
      const stops = await tabStops(page, page.locator('#search'), null)
      expect(stops.length).toBeGreaterThan(15)
      expect(problems(stops)).toEqual([])
    })

    test('the controls #116 found unmarked now change when focused', async ({ page }) => {
      await openExample(page)
      await forced(page)
      const controls: Locator[] = [
        page.locator('.chip').first(),
        page.locator('#btn-theme'),
        page.locator('#btn-help'),
        page.locator('#search'),
        page.locator('.timing-chip').first(),
        page.locator('.section-jump button').first(),
      ]
      if (size === '1440') controls.push(page.locator('#btn-sidebar'), page.locator('#scenario-nav [data-nav]').nth(1))
      else controls.push(page.locator('#btn-nav-fold'))
      for (const control of controls) expect(await focusShows(page, control), String(control)).toBe(true)
    })

    test('every Tab stop in the Metrics view shows an unclipped ring, lane bars and waterfall rows too', async ({
      page,
    }) => {
      await openExample(page)
      await forced(page)
      await page.locator('.scenario-card').first().getByRole('button', { name: 'Metrics', exact: true }).click()
      await expect(page.locator('#inspector')).toBeVisible()
      const first = page.locator('#inspector button:visible').first()
      const stops = await tabStops(page, first, '#inspector')
      expect(stops.some((s) => s.name.includes('.lane-bar'))).toBe(true)
      expect(stops.some((s) => s.name.includes('.wf-row'))).toBe(true)
      expect(problems(stops)).toEqual([])
      // Back up the panel with Shift+Tab: nothing lands under its sticky head.
      const back: Stop[] = []
      for (let i = 0; i < stops.length - 1; i++) {
        await page.keyboard.press('Shift+Tab')
        await painted(page)
        back.push((await readStop(page))!)
      }
      expect(problems(back)).toEqual([])
      expect(await focusShows(page, page.locator('#inspector .lane-bar').first())).toBe(true)
      expect(await focusShows(page, page.locator('#inspector .wf-row').first())).toBe(true)
    })

    test("every Tab stop in a message's side panel shows an unclipped ring", async ({ page }) => {
      await openExample(page)
      await forced(page)
      await page.locator('.scenario-card').first().locator('button.msg-open').first().click()
      await expect(page.locator('#inspector')).toBeVisible()
      const stops = await tabStops(page, page.locator('#inspector button:visible').first(), '#inspector')
      expect(stops.length).toBeGreaterThan(1)
      expect(problems(stops)).toEqual([])
    })

    test('the keyboard help: its close button and setting show a ring', async ({ page }) => {
      await openExample(page)
      await forced(page)
      await page.getByRole('button', { name: 'Show keyboard help' }).click()
      await expect(page.locator('#help')).toHaveAttribute('data-open', 'true')
      const stops = await tabStops(page, page.locator('#help button').first(), '#help')
      expect(problems(stops)).toEqual([])
    })
  })
}

test('the index page: report groups and their scenarios show a ring in forced colours', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await PAGES.index(page, sectionsReport(3))
  await forced(page)
  const head = page.locator('.nav-group-head').first()
  await expect(head).toBeVisible()
  expect(await focusShows(page, head)).toBe(true)
  const stops = await tabStops(page, head, '#scenario-nav, .index-nav')
  expect(stops.some((s) => s.name.includes('nav-group-head'))).toBe(true)
  expect(problems(stops)).toEqual([])
})

test('the clipping probe catches a ring that falls outside a scrolling container', async ({ page }) => {
  // Self-check of readStop: the same rule flipped to draw outside (offset +2px) must fail where a
  // control touches the edge of a box that clips (the timing chips in the card), or the probe proves nothing.
  await page.setViewportSize({ width: 1440, height: 900 })
  await openExample(page)
  await forced(page)
  await page.addStyleTag({
    content:
      '@media (forced-colors: active) { html :focus-visible:not(svg, svg *) { outline-offset: 2px !important } }',
  })
  const stops = await tabStops(page, page.locator('#search'), null)
  // The timing chips touch the edges of the card, which clips: an outward ring is cut off there.
  const cut = problems(stops).filter((p) => p.includes('cut off'))
  expect(cut.some((p) => p.includes('timing-chip'))).toBe(true)
})

test('outside forced colours the rings are as before: box-shadow, no outline', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openExample(page)
  await page.keyboard.press('Shift')
  await page.locator('.chip').first().focus()
  const style = await page
    .locator('.chip')
    .first()
    .evaluate((el) => {
      const cs = getComputedStyle(el)
      return { outline: cs.outlineStyle, shadow: cs.boxShadow !== 'none' }
    })
  expect(style).toEqual({ outline: 'none', shadow: true })
})

test('a side panel head that wraps moves the scroll padding with it, past the 65px fallback', async ({ page }) => {
  // CQ re-review of #116: the one-line head is 65px, the fallback, so only a wrapped head shows
  // that --inspector-head-h is measured. A long message name wraps it to about 98px.
  const report = structuredClone(example)
  const first = report.scenarios[0].events.find((event) => event.kind === 'message')!
  Object.assign(first, {
    label: 'POST /api/v2/checkout/sessions/confirm-payment-with-three-d-secure-challenge-and-retry',
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await openReport(page, { report })
  await page.locator('.scenario-card').first().locator('button.msg-open').first().click()
  const panel = page.locator('#inspector')
  await expect(panel).toBeVisible()
  await expect
    .poll(() => panel.locator('.inspector-head').evaluate((el) => el.getBoundingClientRect().height))
    .toBeGreaterThan(85)
  const measured = await panel.evaluate((el) => ({
    head: el.querySelector('.inspector-head')!.getBoundingClientRect().height,
    padding: Number.parseFloat(getComputedStyle(el).scrollPaddingTop),
  }))
  expect(measured.padding).toBeCloseTo(measured.head + 8, 0)
})
