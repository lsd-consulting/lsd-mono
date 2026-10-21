import { devices, expect, test, type Locator, type Page } from '@playwright/test'
import { openExample } from './example-report'
import { openReport } from './open-report'
import { openFixture, painted, THEMES } from './ux-helpers'
import { wideReport } from './wide-sample'

// #94: zoom as [−] [N%] [+] [Overview] [1:1 (#120)]. − and + step through fixed levels, the % readout goes back
// to the default view (which never enlarges a narrow diagram past 100%), and Overview fits the
// whole width down to 10%. Run on the live example report's "Timed checkout" (14 lanes) and
// "Payment declined" (4 lanes) scenarios, and the 100-participant perf sample.

// Timed checkout (131) is the first scenario, so it opens without a scenarioId.
const DECLINED = '133'
const shots = process.env.LSD_SHOTS

const card = (page: Page) => page.locator('.scenario-card').first()
/** The sequence view of the card: the Components view (#105) has its own Zoom group. */
const seq = (page: Page) => card(page).locator('.seq-diagram')
const zoomOut = (page: Page) => seq(page).getByRole('button', { name: 'Zoom out', exact: true })
const zoomIn = (page: Page) => seq(page).getByRole('button', { name: 'Zoom in', exact: true })
const reset = (page: Page) => seq(page).getByRole('button', { name: /^Reset zoom, now \d+%$/ })
const overview = (page: Page) => seq(page).getByRole('button', { name: 'Overview', exact: true })
const readout = async (page: Page) => Number.parseInt(await reset(page).innerText(), 10)
/** The % readout says [level]% (retrying until it does). */
const expectZoom = (page: Page, level: number | string) =>
  expect(seq(page).locator('.zoom-readout')).toHaveText(`${level}%`)
const status = (page: Page) => card(page).locator('.participant-filter-status')

/** The scroll position and sideways overflow as painted (two frames: see painted in ux-helpers). */
function scrollState(page: Page) {
  return card(page)
    .locator('.seq-scroll')
    .evaluate(async (el) => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      return { top: el.scrollTop, left: el.scrollLeft, overflowX: el.scrollWidth - el.clientWidth }
    })
}

/** How many times the status line changes while [act] runs. */
async function statusChanges(page: Page, act: () => Promise<void>): Promise<string[]> {
  await card(page)
    .locator('.participant-filter-status')
    .evaluate((el) => {
      const seen: string[] = []
      ;(window as unknown as { __seen: string[] }).__seen = seen
      new MutationObserver(() => seen.push(el.textContent ?? '')).observe(el, {
        childList: true,
        characterData: true,
        subtree: true,
      })
    })
  await act()
  // Wait for the change rather than a fixed time; a second change in the same task is caught too.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __seen: string[] }).__seen.length))
    .toBeGreaterThan(0)
  return page.evaluate(() => (window as unknown as { __seen: string[] }).__seen)
}

test.describe('at 1440×900', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('the Zoom group has − , the % reset, + , Overview and 1:1, with their tooltips, and no Fit', async ({
    page,
  }) => {
    await openExample(page)
    const group = card(page).getByRole('group', { name: 'Zoom' })
    const names = await group
      .getByRole('button')
      .evaluateAll((els) => els.map((el) => [el.getAttribute('aria-label'), el.getAttribute('title')]))
    expect(names).toEqual([
      ['Zoom out', 'Zoom out (−)'],
      [`Reset zoom, now ${await readout(page)}%`, 'Reset to default zoom (0)'],
      ['Zoom in', 'Zoom in (+)'],
      ['Overview', 'Overview: whole diagram (Shift+1)'],
      ['1:1 actual size, readable', '1:1 actual size, readable (Shift+0)'],
    ])
    await expect(overview(page)).toHaveAttribute('aria-pressed', 'false')
    // 1:1 is a plain command; Overview, a mode, is pressed while on.
    await expect(group.getByRole('button', { name: '1:1 actual size, readable' })).not.toHaveAttribute('aria-pressed')
    await expect(card(page).getByRole('button', { name: /Fit/ })).toHaveCount(0)
    // The readout looks like a control: at least 12px, in the text colour.
    const readoutStyle = await reset(page).evaluate((el) => {
      const s = getComputedStyle(el)
      return { size: Number.parseFloat(s.fontSize), colour: s.color, text: getComputedStyle(document.body).color }
    })
    expect(readoutStyle.size).toBeGreaterThanOrEqual(12)
    expect(readoutStyle.colour).toBe(readoutStyle.text)
    await expect(page.locator('.diagram-hint').first()).toContainText('Zoom and overview')
    if (shots) await page.screenshot({ path: `${shots}/q-94-1440-timed-default.png` })
  })

  test('95% + gives 100%, − from 100% gives 90%, and the ends are 250% and 25%, disabled there', async ({ page }) => {
    await openExample(page)
    await expectZoom(page, '95')
    await zoomIn(page).click()
    await expectZoom(page, 100)
    await zoomOut(page).click()
    await expectZoom(page, 90)
    for (const level of [100, 110, 125, 150, 175, 200, 250]) {
      await expect(zoomIn(page)).not.toHaveAttribute('aria-disabled', 'true')
      await zoomIn(page).click()
      await expectZoom(page, level)
    }
    await expect(zoomIn(page)).toHaveAttribute('aria-disabled', 'true')
    // Pressed at the limit (Playwright waits for an enabled control, so force the click).
    await zoomIn(page).click({ force: true })
    await expectZoom(page, 250)
    for (const level of [200, 175, 150, 125, 110, 100, 90, 80, 75, 67, 50, 33, 25]) {
      await zoomOut(page).click()
      await expectZoom(page, level)
    }
    await expect(zoomOut(page)).toHaveAttribute('aria-disabled', 'true')
    await zoomOut(page).click({ force: true })
    await expectZoom(page, 25)
  })

  test('the % readout puts back the opening scale and scroll position', async ({ page }) => {
    await openExample(page)
    const opened = await scrollState(page)
    await expectZoom(page, '95')
    await zoomIn(page).click()
    await zoomIn(page).click()
    await card(page)
      .locator('.seq-scroll')
      .evaluate((el) => el.scrollTo({ left: 300, top: 0 }))
    await reset(page).click()
    await expectZoom(page, '95')
    const after = await scrollState(page)
    expect(Math.abs(after.left - opened.left)).toBeLessThanOrEqual(2)
    expect(Math.abs(after.top - opened.top)).toBeLessThanOrEqual(2)
  })

  test('Overview on Timed checkout shows the whole width at about 48%, and says so', async ({ page }) => {
    await openExample(page)
    const changes = await statusChanges(page, () => overview(page).click())
    await expect(overview(page)).toHaveAttribute('aria-pressed', 'true')
    expect((await scrollState(page)).overflowX).toBeLessThanOrEqual(0)
    const level = await readout(page)
    expect(level).toBeGreaterThanOrEqual(44)
    expect(level).toBeLessThanOrEqual(52)
    expect(changes).toEqual([`Overview, ${level}%, whole diagram`])
    // Nothing lies to the right any more, so the More lanes cue goes.
    await expect(card(page).getByRole('button', { name: 'Show more lanes to the right' })).toBeHidden()
    if (shots) await page.screenshot({ path: `${shots}/q-94-1440-timed-overview.png` })
  })

  test('Overview again, or Esc, puts back the zoom and scroll position from before', async ({ page }) => {
    await openExample(page)
    await zoomIn(page).click()
    await zoomIn(page).click()
    await expectZoom(page, 110)
    await card(page)
      .locator('.seq-scroll')
      .evaluate((el) => el.scrollTo({ left: 240, top: 0 }))
    const before = { zoom: 110, ...(await scrollState(page)) }
    for (const leave of ['button', 'Escape'] as const) {
      await overview(page).click()
      await expect(overview(page)).toHaveAttribute('aria-pressed', 'true')
      if (leave === 'button') await overview(page).click()
      else await page.keyboard.press('Escape')
      await expect(overview(page)).toHaveAttribute('aria-pressed', 'false')
      await expectZoom(page, before.zoom)
      const after = await scrollState(page)
      expect(Math.abs(after.left - before.left), leave).toBeLessThanOrEqual(2)
      expect(Math.abs(after.top - before.top), leave).toBeLessThanOrEqual(2)
    }
    await expect(status(page)).toHaveText(`Overview off, zoom ${before.zoom}%`)
  })

  test('Overview and back puts the page where it was, scrolled down the diagram', async ({ page }) => {
    await openExample(page)
    await zoomIn(page).click()
    await expectZoom(page, 100)
    // The diagram scrolls with the page: scroll the page down into it.
    const stageTop = await card(page)
      .locator('.seq-stage')
      .evaluate((el) => el.getBoundingClientRect().top + window.scrollY)
    await page.evaluate((y) => window.scrollTo(0, y), stageTop + 400)
    const where = () =>
      page.evaluate(() => ({ page: window.scrollY, diagram: document.querySelector('.seq-scroll')!.scrollTop }))
    await expect.poll(async () => (await where()).diagram).toBeGreaterThan(200)
    const before = await where()
    await overview(page).click()
    await expect(overview(page)).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Escape')
    await expect(overview(page)).toHaveAttribute('aria-pressed', 'false')
    await expectZoom(page, 100)
    await expect.poll(async () => Math.abs((await where()).diagram - before.diagram)).toBeLessThanOrEqual(2)
    expect(Math.abs((await where()).page - before.page)).toBeLessThanOrEqual(2)
  })

  test('a click in Overview goes to 1:1 centred on that spot (#120)', async ({ page }) => {
    await openExample(page)
    await overview(page).click()
    await expect(overview(page)).toHaveAttribute('aria-pressed', 'true')
    // The rows at Overview's scale, not the ones still in place until the frame paints them.
    await painted(page)
    const target = card(page).locator('button.msg-open').nth(8)
    const id = (await target.getAttribute('data-message-id'))!
    await target.scrollIntoViewIfNeeded()
    // The button covers the arrow and its label.
    const box = (await target.boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await expect(overview(page)).toHaveAttribute('aria-pressed', 'false')
    await expect(seq(page).locator('.zoom-readout')).toHaveText('100%')
    await expect(status(page)).toHaveText('Zoom 1:1, 100%')
    // It zoomed instead of opening the arrow.
    await expect(page.locator('#inspector')).toBeHidden()
    // Once the scroll has landed, the clicked arrow sits in the middle of the diagram's visible
    // part (within a quarter of its height from the centre), and across it is on screen.
    const placed = () =>
      page.evaluate((messageId) => {
        const btn = document.querySelector(`button.msg-open[data-message-id="${messageId}"]`)
        const scroll = btn?.closest<HTMLElement>('.seq-scroll')
        const header = scroll?.querySelector('.seq-sticky-header')
        if (!btn || !scroll || !header) return { offCentre: 1, across: false }
        const b = btn.getBoundingClientRect()
        const s = scroll.getBoundingClientRect()
        const top = Math.max(header.getBoundingClientRect().bottom, 0)
        const bottom = Math.min(s.bottom, innerHeight)
        return {
          offCentre: Math.abs((b.top + b.bottom) / 2 - (top + bottom) / 2) / (bottom - top),
          across: b.right > s.left && b.left < s.left + scroll.clientWidth,
        }
      }, id)
    await expect.poll(async () => (await placed()).offCentre).toBeLessThan(0.25)
    expect((await placed()).across).toBe(true)
  })

  test('Enter on a focused message in Overview goes to 1:1 on that message, as a click there does', async ({
    page,
  }) => {
    await openExample(page)
    await overview(page).click()
    const target = card(page).locator('button.msg-open').nth(5)
    const id = await target.getAttribute('data-message-id')
    await target.focus()
    await page.keyboard.press('Enter')
    await expect(overview(page)).toHaveAttribute('aria-pressed', 'false')
    await expectZoom(page, '100')
    await expect(page.locator('#inspector')).toBeHidden()
    await expect(page.locator(`button.msg-open[data-message-id="${id}"]`)).toBeInViewport()
    if (shots) await page.screenshot({ path: `${shots}/120-1440-overview-enter-1to1.png` })
  })

  test('the 4-lane scenario opens at 100%, the reset keeps it there, and Overview has nothing to do', async ({
    page,
  }) => {
    await openExample(page, DECLINED)
    await expectZoom(page, 100)
    await zoomIn(page).click()
    await expectZoom(page, 110)
    await reset(page).click()
    await expectZoom(page, 100)
    await expect(overview(page)).toHaveAttribute('aria-disabled', 'true')
    await expect(overview(page)).toHaveAttribute('title', 'Whole diagram already fits')
    if (shots) await page.screenshot({ path: `${shots}/q-94-1440-declined-default.png` })
  })

  test('each zoom change says one thing in the status line, with its context', async ({ page }) => {
    await openExample(page)
    expect(await statusChanges(page, () => zoomIn(page).click())).toEqual(['Zoom 100%'])
    expect(await statusChanges(page, () => reset(page).click())).toEqual(['Default zoom, 95%'])
  })
})

test('at 2560 wide the 4-lane scenario still opens and resets to 100%', async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1200 })
  await openExample(page, DECLINED)
  await expectZoom(page, 100)
  await zoomOut(page).click()
  await reset(page).click()
  await expectZoom(page, 100)
})

test('on the 100-participant sample at 1440, Overview stops at 10%, keeps the cue and counts the lanes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openReport(page, { report: wideReport(100, 400) })
  await overview(page).click()
  await expectZoom(page, 10)
  await expect(card(page).getByRole('button', { name: 'Show more lanes to the right' })).toBeVisible()
  // A lane is shown when its participant box is wholly inside the scrollport.
  const shown = await page.evaluate(() => {
    const scroll = document.querySelector<HTMLElement>('.seq-scroll')!
    const left = scroll.getBoundingClientRect().left
    return [...document.querySelectorAll('.seq-header-svg .participant-box')].filter((box) => {
      const b = box.getBoundingClientRect()
      return b.left >= left && b.right <= left + scroll.clientWidth
    }).length
  })
  await expect(status(page)).toHaveText(`Overview, 10%, ${shown} of 100 lanes shown`)
  await expect(status(page)).toContainText('72 of 100 lanes shown')
  if (shots) await page.screenshot({ path: `${shots}/q-94-1440-100p-overview.png` })
  // Zoomed, for comparison.
  await overview(page).click()
  await zoomIn(page).click()
  if (shots) await page.screenshot({ path: `${shots}/q-94-1440-100p-zoomed-100.png` })
  await reset(page).click()
  if (shots) await page.screenshot({ path: `${shots}/q-94-1440-100p-default.png` })
})

test('on the 100-participant sample at 1280, default, + and Overview each say what they show', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openReport(page, { report: wideReport(100, 400) })
  await expectZoom(page, '95')
  if (shots) await page.screenshot({ path: `${shots}/q-94-1280-100p-default.png` })
  await zoomIn(page).click()
  await expect(status(page)).toHaveText('Zoom 100%')
  if (shots) await page.screenshot({ path: `${shots}/q-94-1280-100p-zoomed.png` })
  await overview(page).click()
  await expectZoom(page, 10)
  await expect(status(page)).toHaveText(/^Overview, 10%, \d+ of 100 lanes shown$/)
  if (shots) await page.screenshot({ path: `${shots}/q-94-1280-100p-overview.png` })
  await page.keyboard.press('Escape')
  await expectZoom(page, 100)
})

test('lanes hidden in Overview: leaving it fits the lanes left, as the % readout does', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openReport(page, { report: wideReport(100, 400) })
  await expectZoom(page, '95')
  await overview(page).click()
  await expectZoom(page, 10)
  await card(page).locator('[data-participant-head="p01"]').dispatchEvent('contextmenu', { button: 2 })
  await page.getByRole('menuitem', { name: /^Hide all but / }).click()
  await expect(card(page).locator('.hidden-chip')).toHaveText('99 hidden')
  await expect(overview(page)).toHaveAttribute('aria-pressed', 'true')
  await overview(page).click()
  await expect(overview(page)).toHaveAttribute('aria-pressed', 'false')
  const left = await readout(page)
  await reset(page).click()
  expect(left).toBe(await readout(page))
  expect(left).toBe(100)
})

test.describe('zoom keys', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('on a focused message +, =, -, 0, Shift+1 and Esc do what the controls do', async ({ page }) => {
    await openExample(page)
    await card(page).locator('button.msg-open').first().focus()
    await page.keyboard.press('+')
    await expectZoom(page, 100)
    await page.keyboard.press('=')
    await expectZoom(page, 110)
    await page.keyboard.press('-')
    await expectZoom(page, 100)
    await page.keyboard.press('0')
    await expectZoom(page, '95')
    await page.keyboard.press('Shift+Digit1')
    await expect(overview(page)).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Shift+Digit1')
    await expect(overview(page)).toHaveAttribute('aria-pressed', 'false')
    await page.keyboard.press('Shift+Digit1')
    await page.keyboard.press('Escape')
    await expect(overview(page)).toHaveAttribute('aria-pressed', 'false')
    await expectZoom(page, '95')
  })

  test('in Find and the page search they type, and outside the diagram card they do nothing', async ({ page }) => {
    await openExample(page)
    const find = card(page).locator('[data-diagram-find]')
    await find.focus()
    await page.keyboard.type('+-0=')
    await expect(find).toHaveValue('+-0=')
    const search = page.locator('#search')
    await search.focus()
    await page.keyboard.type('+0')
    await expect(search).toHaveValue('+0')
    await search.fill('')
    await page.locator('#btn-help').focus()
    await page.keyboard.press('+')
    await page.keyboard.press('Shift+Digit1')
    await expectZoom(page, '95')
    await expect(overview(page)).toHaveAttribute('aria-pressed', 'false')
  })

  test('with single-key shortcuts off the keys do nothing, and the buttons still work', async ({ page }) => {
    await openExample(page, undefined, { storage: { 'lsd-report-single-keys': 'off' } })
    await card(page).locator('button.msg-open').first().focus()
    for (const key of ['+', '=', '-', '0', 'Shift+Digit1']) await page.keyboard.press(key)
    await expectZoom(page, '95')
    await expect(overview(page)).toHaveAttribute('aria-pressed', 'false')
    await zoomIn(page).click()
    await expectZoom(page, 100)
  })

  test('Ctrl/Cmd with +, - and 0 are left to the browser', async ({ page }) => {
    await openExample(page)
    await card(page).locator('button.msg-open').first().focus()
    const prevented = await page.evaluate(() =>
      ['=', '+', '-', '0'].flatMap((key) =>
        [{ ctrlKey: true }, { metaKey: true }].map((mods) => {
          const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods })
          document.activeElement!.dispatchEvent(ev)
          return ev.defaultPrevented
        }),
      ),
    )
    expect(prevented.every((p) => !p)).toBe(true)
    await expectZoom(page, '95')
  })

  test('the ? help lists the zoom keys', async ({ page }) => {
    await openExample(page)
    await expect(page.locator('#help')).toContainText('+/− zoom, 0 default zoom, Shift+1 overview')
  })
})

test('in a card beside the panel (under 880px) the toolbar keeps one row, Overview icon only', async ({ page }) => {
  await openFixture(page, 'dark')
  const toolbar = page.locator('.seq-toolbar').first()
  expect((await toolbar.boundingBox())!.width).toBeLessThan(880)
  await expect(toolbar.locator('.zoom-overview-label')).toBeHidden()
  await expect(toolbar.getByRole('button', { name: 'Overview' })).toBeVisible()
  // Zoom, Find and Metrics share one row, with room to spare, whatever the platform's
  // fonts: the row's controls end well inside the toolbar (CI draws on Linux, wider than macOS).
  const tops = await Promise.all(
    [
      toolbar.getByRole('button', { name: 'Zoom in' }),
      toolbar.locator('[data-diagram-find]'),
      toolbar.getByRole('button', { name: /Metrics/ }),
    ].map(async (control) => (await control.boundingBox())!),
  )
  for (const box of tops) expect(Math.abs(box.y + box.height / 2 - (tops[0].y + tops[0].height / 2))).toBeLessThan(8)
  const spare = await toolbar.evaluate((bar) => {
    const row = [...bar.children].filter((child) => child.getBoundingClientRect().width > 1)
    const used = row.reduce((sum, child) => sum + child.getBoundingClientRect().width, 0)
    const gap = Number.parseFloat(getComputedStyle(bar).columnGap) * (row.length - 1)
    const padding = Number.parseFloat(getComputedStyle(bar).paddingLeft) * 2
    return bar.clientWidth - padding - used - gap
  })
  // At least 24px to spare (about 50 on Linux at this width), not a row that only just fits.
  expect(spare).toBeGreaterThanOrEqual(24)
})

test('the zoom icons draw in the text colour in every theme', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openExample(page)
  for (const theme of THEMES) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme)
    for (const button of [zoomOut(page), zoomIn(page), overview(page)]) {
      const drawn = await iconColour(button)
      expect(drawn.stroke, theme).toBe(drawn.colour)
      expect(drawn.size, theme).toBeGreaterThanOrEqual(14)
    }
  }
})

function iconColour(button: Locator) {
  return button.evaluate((el) => {
    const svg = el.querySelector('svg')!
    const path = svg.querySelector('path')!
    return {
      stroke: getComputedStyle(path).stroke,
      colour: getComputedStyle(el).color,
      size: svg.getBoundingClientRect().width,
    }
  })
}

test.describe('forced colours', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('the icons follow the system button colour and the pressed Overview is highlighted', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' })
    await openExample(page)
    await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
    for (const button of [zoomOut(page), zoomIn(page), overview(page)]) {
      const drawn = await iconColour(button)
      expect(drawn.stroke).toBe(drawn.colour)
      expect(drawn.stroke).not.toBe('rgba(0, 0, 0, 0)')
    }
    await overview(page).click()
    const pressed = await overview(page).evaluate((el) => {
      const s = getComputedStyle(el)
      return { bg: s.backgroundColor, fg: s.color }
    })
    expect(pressed.bg).not.toBe(pressed.fg)
    if (shots) await page.screenshot({ path: `${shots}/q-94-1440-forced-colours-overview.png` })
  })
})

for (const viewport of [
  { width: 390, height: 844 },
  { width: 320, height: 640 },
]) {
  test.describe(`a ${viewport.width}px phone`, () => {
    const { userAgent, deviceScaleFactor, isMobile, hasTouch } = devices['iPhone 13']
    test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch })

    test('has all five zoom controls at 44×44 or more, without overlap, 1:1 on a row of its own at 320', async ({
      page,
    }) => {
      await openExample(page)
      const boxes = await seq(page)
        .getByRole('group', { name: 'Zoom' })
        .getByRole('button')
        .evaluateAll((els) =>
          els.map((el) => {
            const b = el.getBoundingClientRect()
            return { left: b.left, right: b.right, top: b.top, width: b.width, height: b.height }
          }),
        )
      expect(boxes).toHaveLength(5)
      for (const box of boxes) {
        expect(box.width).toBeGreaterThanOrEqual(44)
        expect(box.height).toBeGreaterThanOrEqual(44)
      }
      // −, the level, + and Overview share a row; five do not fit in 320 (#120), so 1:1 wraps under.
      for (const box of boxes.slice(0, 4)) expect(Math.abs(box.top - boxes[0].top)).toBeLessThanOrEqual(1)
      for (let i = 1; i < 4; i++) expect(boxes[i].left).toBeGreaterThanOrEqual(boxes[i - 1].right)
      const actual = boxes[4]
      if (viewport.width === 320) expect(actual.top).toBeGreaterThanOrEqual(boxes[0].top + boxes[0].height)
      else {
        expect(Math.abs(actual.top - boxes[0].top)).toBeLessThanOrEqual(1)
        expect(actual.left).toBeGreaterThanOrEqual(boxes[3].right)
      }
      // Icon only: the Overview label stays out of the way.
      await expect(seq(page).locator('.zoom-overview-label')).toBeHidden()
      if (shots) {
        await card(page)
          .locator('.seq-diagram')
          .evaluate((el) => el.scrollIntoView({ block: 'start' }))
        await page.screenshot({ path: `${shots}/q-94-${viewport.width}-phone.png` })
      }
    })
  })
}
