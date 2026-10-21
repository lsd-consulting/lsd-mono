import { devices, expect, test, type Locator, type Page } from '@playwright/test'
import { conformanceReport } from '../src/lib/conformance.test-util'
import { openExample } from './example-report'
import { openReport } from './open-report'
import { wideReport } from './wide-sample'
import { painted } from './ux-helpers'

// #120: the Components view opens on a true overview (the whole graph, never above 100%, down to
// the floor), the sequence view keeps its readable 95% default, and both have a 1:1 button next to
// Overview, with Shift+0, for the readable size. While a Components fit is below 100% it says so
// (a cue at every width, and the status line, worded for touch there), and a tap, click or Enter
// on the drawing goes to 1:1 rather than to a tiny target; the side panel never shrinks it.

const example = conformanceReport('example-components')
const NAME = '1:1 actual size, readable'
/** What the too-small drawing is described as on touch, where a tap is how to get to 1:1. */
const DESCRIPTION_TOUCH = 'Too small to read. Tap the drawing, or 1:1, to view at actual size.'
const shots = process.env.LSD_SHOTS

const pane = (page: Page) => page.locator('.diagram-pane[data-pane="components"]')
const toolbar = (page: Page) => pane(page).locator('.comp-toolbar')
const sequence = (page: Page) => page.locator('.seq-diagram').first()
const readout = (scope: Locator) => scope.locator('.zoom-readout')
const viewStatus = (page: Page) => page.locator('.diagram-view-status')

async function showComponents(page: Page, tap = false): Promise<void> {
  const tab = page.getByRole('tab', { name: 'Components', exact: true })
  if (tap) await tab.tap()
  else await tab.click()
  await expect(pane(page)).toBeVisible()
  await painted(page)
}

/** Every component node wholly inside the Components scrollport, and the smallest name in CSS px. */
function nodesInView(page: Page) {
  return page.evaluate(() => {
    const port = document.querySelector('.comp-scroll')!.getBoundingClientRect()
    const nodes = [...document.querySelectorAll('.comp-scroll .component-node')].map((n) => n.getBoundingClientRect())
    const names = [...document.querySelectorAll<SVGTextElement>('.comp-scroll .component-node text')].map(
      (text) => Number.parseFloat(getComputedStyle(text).fontSize) * text.getScreenCTM()!.a,
    )
    return {
      total: nodes.length,
      inside: nodes.filter(
        (n) =>
          n.left >= port.left - 1 && n.right <= port.right + 1 && n.top >= port.top - 1 && n.bottom <= port.bottom + 1,
      ).length,
      smallest: Math.min(...names),
    }
  })
}

/** How far [el]'s middle is from the middle of the Components scrollport. */
function offCentre(el: Locator) {
  return el.evaluate((node) => {
    const port = node.closest('.comp-scroll')!.getBoundingClientRect()
    const box = node.getBoundingClientRect()
    return {
      dx: Math.abs(box.left + box.width / 2 - (port.left + port.width / 2)),
      dy: Math.abs(box.top + box.height / 2 - (port.top + port.height / 2)),
    }
  })
}

const percent = async (scope: Locator) => Number.parseInt((await readout(scope).textContent()) ?? '', 10)

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('Components opens on the whole graph, says it is too small, and 1:1 makes it readable', async ({ page }) => {
    await openReport(page, { report: example })
    await showComponents(page)
    const { total, inside } = await nodesInView(page)
    expect(total).toBe(14)
    expect(inside, 'every component on the first screen').toBe(total)
    const opened = await percent(toolbar(page))
    expect(opened).toBeLessThan(100)
    expect(opened).toBeGreaterThanOrEqual(10)
    // Said when the view is shown, and seen in the toolbar, in the same words.
    await expect(viewStatus(page)).toHaveText(
      `Component diagram, 14 components, 13 links, zoom ${opened}%. Too small to read: press Shift+0.`,
    )
    const hint = toolbar(page).locator('.zoom-hint')
    await expect(hint).toBeVisible()
    await expect(hint.locator('.zoom-hint-key')).toHaveText('Too small to read: press Shift+0')
    await expect(hint.locator('.zoom-hint-touch')).toBeHidden()

    const overview = toolbar(page).getByRole('button', { name: 'Overview', exact: true })
    const actual = toolbar(page).getByRole('button', { name: NAME, exact: true })
    await expect(actual).toHaveText('1:1')
    await expect(actual).not.toHaveAttribute('aria-pressed')
    await expect(actual).toHaveAttribute('title', `${NAME} (Shift+0)`)
    expect(await overview.evaluate((el) => el.nextElementSibling?.getAttribute('data-zoom'))).toBe('actual')

    // From the fresh fit, 1:1 centres the busiest component (Orders: the most links).
    await actual.click()
    await expect(readout(toolbar(page))).toHaveText('100%')
    await expect(viewStatus(page)).toHaveText('Zoom 1:1, 100%')
    await expect(hint).toBeHidden()
    expect((await nodesInView(page)).smallest).toBeGreaterThanOrEqual(11)

    // Overview is a mode: pressed and enabled while on, and pressed again it goes back.
    await overview.click()
    expect((await nodesInView(page)).inside).toBe(total)
    await expect(overview).toHaveAttribute('aria-pressed', 'true')
    await expect(overview).not.toHaveAttribute('aria-disabled')
    await expect(hint).toBeVisible()
    await overview.click()
    await expect(overview).toHaveAttribute('aria-pressed', 'false')
    await expect(readout(toolbar(page))).toHaveText('100%')
  })

  test('Shift+0 from a focused link centres it at 100%, and the zoom is kept on switching views', async ({ page }) => {
    await openReport(page, { report: example })
    await showComponents(page)
    expect(await percent(toolbar(page))).toBeLessThan(100)
    // At 1:1 first: in a fit too small to read, focus alone is no target (Enter zooms, see below).
    const link = page.locator('.comp-scroll .edge-group').nth(6)
    await link.focus()
    await page.keyboard.press('Shift+Digit0')
    await expect(readout(toolbar(page))).toHaveText('100%')
    await expect(viewStatus(page)).toHaveText('Zoom 1:1, 100%')
    await painted(page)
    const centred = await offCentre(link)
    // Centred, or as near as the scroll range lets it be.
    expect(centred.dx).toBeLessThan(200)
    expect(centred.dy).toBeLessThan(200)
    await page.getByRole('tab', { name: 'Sequence', exact: true }).click()
    await showComponents(page)
    await expect(readout(toolbar(page))).toHaveText('100%')
  })

  test('the sequence view keeps its readable 95% default, and 1:1 and Shift+0 give 100%', async ({ page }) => {
    await openExample(page)
    const seq = sequence(page)
    await expect(readout(seq)).toHaveText('95%')
    // No too-small cue in the sequence view.
    await expect(seq.locator('.zoom-hint')).toHaveCount(0)
    const actual = seq.getByRole('button', { name: NAME, exact: true })
    await expect(actual).toHaveText('1:1')
    await expect(actual).not.toHaveAttribute('aria-pressed')
    await actual.click()
    await expect(readout(seq)).toHaveText('100%')
    await expect(seq.locator('.participant-filter-status')).toHaveText('Zoom 1:1, 100%')
    await readout(seq).click()
    await expect(readout(seq)).toHaveText('95%')
    await seq.locator('button.msg-open').nth(3).focus()
    await page.keyboard.press('Shift+Digit0')
    await expect(readout(seq)).toHaveText('100%')
    await expect(seq.locator('button.msg-open').nth(3)).toBeFocused()
  })
})

test.describe('a fit too small to read, at 1280', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('a click on a link goes to 1:1 centred on it, not to the side panel; then it opens without shrinking', async ({
    page,
  }) => {
    await openReport(page, { report: example })
    await showComponents(page)
    const fit = await percent(toolbar(page))
    expect(fit).toBeLessThan(100)
    if (shots) await page.screenshot({ path: `${shots}/120-1280-panel-before.png` })
    const link = page.locator('.comp-scroll .edge-group').nth(4)
    await link.click()
    await expect(readout(toolbar(page))).toHaveText('100%')
    await expect(page.locator('#inspector')).toBeHidden()
    await painted(page)
    const centred = await offCentre(link)
    expect(centred.dx).toBeLessThan(200)
    expect(centred.dy).toBeLessThan(200)
    // Readable now: the same link opens the side panel, and the drawing keeps its size.
    await link.click()
    await expect(page.locator('#inspector')).toBeVisible()
    await painted(page)
    await expect(readout(toolbar(page))).toHaveText('100%')
    if (shots) await page.screenshot({ path: `${shots}/120-1280-panel-after.png` })
  })

  test('Enter on a link goes to 1:1 on it; opening Metrics from the fit does not shrink it', async ({ page }) => {
    // The live example's first scenario: it has Metrics.
    await openExample(page)
    await showComponents(page)
    const fit = await percent(toolbar(page))
    expect(fit).toBeLessThan(100)
    await toolbar(page)
      .getByRole('button', { name: /Metrics/ })
      .click()
    await expect(page.locator('#inspector')).toBeVisible()
    await painted(page)
    await expect(readout(toolbar(page))).toHaveText(`${fit}%`)
    await page.keyboard.press('Escape')
    await expect(page.locator('#inspector')).toBeHidden()
    await painted(page)
    await expect(readout(toolbar(page))).toHaveText(`${fit}%`)

    const link = page.locator('.comp-scroll .edge-group').nth(2)
    await link.focus()
    await page.keyboard.press('Enter')
    await expect(readout(toolbar(page))).toHaveText('100%')
    await expect(page.locator('#inspector')).toBeHidden()
    await expect(link).toBeFocused()
  })

  // A macOS baseline like theme-* and fit-top-label in ux-diagram.spec: Linux fonts differ, so CI
  // (grepInvert /@screenshot/) leaves it out; it runs on the Mac. The layout is asserted above.
  test('the fitted Components view draws as in its baseline', { tag: '@screenshot' }, async ({ page }) => {
    await openReport(page, { report: example, media: { reducedMotion: 'reduce' } })
    await showComponents(page)
    expect(await percent(toolbar(page))).toBeLessThan(100)
    await pane(page).scrollIntoViewIfNeeded()
    await painted(page)
    await expect(pane(page)).toHaveScreenshot('components-fitted.png')
  })
})

test.describe('the dark theme', () => {
  test('Overview on looks different from off, in both views', async ({ page }) => {
    // CQ re-review: only forced colours guarded the on style; a selector that never matched passed.
    await page.setViewportSize({ width: 1440, height: 900 })
    await openReport(page, { report: example, media: { colorScheme: 'dark', reducedMotion: 'reduce' } })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    const looks = (button: Locator) =>
      button.evaluate((el) => {
        const style = getComputedStyle(el)
        return `${style.backgroundColor} ${style.color} ${style.borderColor}`
      })
    for (const scope of ['sequence', 'components'] as const) {
      if (scope === 'components') await showComponents(page)
      const bar = scope === 'sequence' ? sequence(page) : toolbar(page)
      const overview = bar.getByRole('button', { name: 'Overview', exact: true })
      await bar.getByRole('button', { name: NAME, exact: true }).click()
      await expect(overview).toHaveAttribute('aria-pressed', 'false')
      await page.mouse.move(0, 0)
      const off = await looks(overview)
      await overview.click()
      await expect(overview).toHaveAttribute('aria-pressed', 'true')
      await page.mouse.move(0, 0)
      await bar.getByRole('button', { name: NAME, exact: true }).focus()
      expect(await looks(overview), scope).not.toBe(off)
    }
  })
})

test.describe('forced colours', () => {
  test('the 1:1 glyph is text, so it shows, and Overview on takes Highlight in Components too', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openReport(page, { report: example, media: { forcedColors: 'active', reducedMotion: 'reduce' } })
    const actual = sequence(page).getByRole('button', { name: NAME, exact: true })
    const { colour, background } = await actual.locator('.zoom-actual-label').evaluate((el) => {
      const style = getComputedStyle(el)
      return { colour: style.color, background: getComputedStyle(el.parentElement!).backgroundColor }
    })
    expect(colour).not.toBe(background)
    expect(colour).not.toBe('rgba(0, 0, 0, 0)')
    await showComponents(page)
    const overview = toolbar(page).getByRole('button', { name: 'Overview', exact: true })
    await toolbar(page).getByRole('button', { name: NAME, exact: true }).click()
    const off = await overview.evaluate((el) => getComputedStyle(el).backgroundColor)
    await overview.click()
    await expect(overview).toHaveAttribute('aria-pressed', 'true')
    const on = await overview.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(on).not.toBe(off)
  })
})

for (const width of [320, 390] as const) {
  test.describe(`a ${width}px touch phone`, () => {
    const { userAgent, deviceScaleFactor, isMobile, hasTouch } = devices['iPhone 13']
    test.use({ viewport: { width, height: 760 }, userAgent, deviceScaleFactor, isMobile, hasTouch })

    test('Components opens whole with a cue that fits, says to tap 1:1, and a tap there goes to 1:1', async ({
      page,
    }) => {
      await openReport(page, { report: example })
      await showComponents(page, true)
      expect((await nodesInView(page)).inside).toBe(14)
      const fit = await percent(toolbar(page))
      expect(fit).toBeLessThan(100)
      await expect(viewStatus(page)).toHaveText(
        `Component diagram, 14 components, 13 links, zoom ${fit}%. Too small to read: tap 1:1.`,
      )
      // The cue: visible, one line, inside the card, and over no control.
      const hint = toolbar(page).locator('.zoom-hint')
      await expect(hint).toBeVisible()
      await expect(hint.locator('.zoom-hint-touch')).toHaveText('Too small to read: tap 1:1')
      await expect(hint.locator('.zoom-hint-key')).toBeHidden()
      const placed = await hint.evaluate((el) => {
        const box = el.getBoundingClientRect()
        const bar = el.closest('.comp-toolbar')!.getBoundingClientRect()
        const controls = [...el.closest('.comp-toolbar')!.querySelectorAll('button')].map((b) =>
          b.getBoundingClientRect(),
        )
        return {
          inside: box.left >= bar.left - 0.5 && box.right <= bar.right + 0.5,
          oneLine: box.height <= 24,
          overlaps: controls.filter(
            (c) => c.left < box.right && c.right > box.left && c.top < box.bottom && c.bottom > box.top,
          ).length,
          pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        }
      })
      expect(placed).toEqual({ inside: true, oneLine: true, overlaps: 0, pageOverflowX: 0 })
      const actual = toolbar(page).getByRole('button', { name: NAME, exact: true })
      const target = (await actual.boundingBox())!
      expect(Math.min(target.width, target.height)).toBeGreaterThanOrEqual(44)
      await toolbar(page).scrollIntoViewIfNeeded()
      if (shots) await page.screenshot({ path: `${shots}/120-${width}-components-cue.png` })

      // A tap on the drawing, even right on a tiny link, goes to 1:1 there and opens nothing.
      const link = page.locator('.comp-scroll .edge-group').nth(3)
      await link.scrollIntoViewIfNeeded()
      await link.tap()
      await expect(readout(toolbar(page))).toHaveText('100%')
      await expect(page.locator('#inspector')).toBeHidden()
      await expect(hint).toBeHidden()
      expect((await nodesInView(page)).smallest).toBeGreaterThanOrEqual(11)
      // Measured, not only by behaviour: at 1:1 each component box is at least a 24px target.
      const boxes = await page
        .locator('.comp-scroll .component-node')
        .evaluateAll((rects) =>
          rects.map((r) => Math.min(r.getBoundingClientRect().width, r.getBoundingClientRect().height)),
        )
      expect(boxes.length).toBe(14)
      expect(Math.min(...boxes)).toBeGreaterThanOrEqual(24)
      if (shots) await page.screenshot({ path: `${shots}/120-${width}-components-after-tap.png` })
    })

    test('opened straight on Components, the drawing is described as too small and the view is said', async ({
      page,
    }) => {
      // #120 round 2 (B1): a link or reload with &view=components has no tab press to say the view.
      await openReport(page, { report: example, path: '/#scenario=144&view=components', wait: 'none' })
      await expect(pane(page)).toBeVisible()
      const drawing = pane(page).locator('svg.component-diagram')
      await expect(drawing).toHaveAccessibleDescription(DESCRIPTION_TOUCH)
      await expect(viewStatus(page)).toHaveText(
        /^Component diagram, 14 components, 13 links, zoom \d+%\. Too small to read: tap 1:1\.$/,
      )
      // At 1:1 it reads, so it has no description; back at the fit it has it again.
      await toolbar(page).getByRole('button', { name: NAME, exact: true }).tap()
      await expect(readout(toolbar(page))).toHaveText('100%')
      await expect(drawing).toHaveAccessibleDescription('')
      await expect(drawing).not.toHaveAttribute('aria-describedby')
      await toolbar(page)
        .getByRole('button', { name: /^Reset zoom/ })
        .tap()
      await expect(drawing).toHaveAccessibleDescription(DESCRIPTION_TOUCH)
    })

    test('a tap on the sequence drawing in Overview goes to 1:1 there, as in Components', async ({ page }) => {
      await openExample(page)
      const seq = sequence(page)
      await seq.getByRole('button', { name: 'Overview', exact: true }).tap()
      await expect(seq.getByRole('button', { name: 'Overview', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await painted(page)
      // Right on a tiny arrow: it goes to 1:1 there and opens nothing.
      await seq.locator('button.msg-open').nth(2).tap()
      await expect(readout(seq)).toHaveText('100%')
      await expect(seq.getByRole('button', { name: 'Overview', exact: true })).toHaveAttribute('aria-pressed', 'false')
      await expect(page.locator('#inspector')).toBeHidden()
    })

    test('the sequence view opens readable, its arrows and lane heads at least 24px targets', async ({ page }) => {
      await openExample(page)
      await expect(readout(sequence(page))).toHaveText('95%')
      await painted(page)
      const sizes = await sequence(page).evaluate((el) => {
        const boxes = (selector: string) =>
          [...el.querySelectorAll(selector)].map((n) => n.getBoundingClientRect()).filter((b) => b.width > 0)
        return {
          arrows: boxes('button.msg-open').map((b) => Math.min(b.width, b.height)),
          heads: boxes('[data-participant-head]').map((b) => Math.min(b.width, b.height)),
        }
      })
      expect(sizes.arrows.length).toBeGreaterThan(0)
      expect(sizes.heads.length).toBeGreaterThan(0)
      expect(Math.min(...sizes.arrows)).toBeGreaterThanOrEqual(24)
      expect(Math.min(...sizes.heads)).toBeGreaterThanOrEqual(24)
      const actual = sequence(page).getByRole('button', { name: NAME, exact: true })
      const box = (await actual.boundingBox())!
      expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44)
    })

    test('a tapped 1:1 or reset stays on screen below the top bar', async ({ page }) => {
      await openExample(page)
      const seq = sequence(page)
      for (const name of [NAME, /^Reset zoom, now \d+%$/] as const) {
        const button = seq.getByRole('button', { name })
        await button.scrollIntoViewIfNeeded()
        await button.tap()
        await painted(page)
        const where = await button.evaluate((el) => {
          const bar = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0
          return { top: el.getBoundingClientRect().top, bar }
        })
        expect(where.top, String(name)).toBeGreaterThanOrEqual(where.bar - 1)
      }
    })
  })
}

test('the 100-component sample opens fitted, still too small to read, and 1:1 reads', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openReport(page, { report: wideReport(100, 400) })
  await showComponents(page)
  // At the 10% floor before #115 wrapped it into columns; whole, at about 26%, since.
  await expect(readout(toolbar(page))).toHaveText(/^(1\d|2\d|30)%$/)
  await expect(toolbar(page).locator('.zoom-hint')).toBeVisible()
  await toolbar(page).getByRole('button', { name: NAME, exact: true }).click()
  await expect(readout(toolbar(page))).toHaveText('100%')
})
