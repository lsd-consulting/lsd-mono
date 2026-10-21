import { expect, test, type Page } from '@playwright/test'
import { openReport } from './open-report'
import { timedReport } from './timed-sample'
import { INSPECTOR_NARROW_PX } from '../src/ui/inspector-width'

// #90a: opening the Timing view widens the side panel at once. With the 160 ms glide, every
// frame of it narrowed the diagram beside it, and each narrower diagram was refit and repainted:
// three or four long tasks after every open, at any report size. Motion is on here (the other
// checks turn it off), because that is where the glide ran.

test.use({ viewport: { width: 1440, height: 900 } })

// Each call carries a body, so its arrow opens in the side panel.
const report = timedReport(100, (step) => ({ path: step.path }))

/**
 * Frames to watch after a change: well past the 160 ms glide (about 10 frames), so every width it
 * would have set is seen. Counted in frames rather than slept for (#110).
 */
const AFTER_GLIDE_FRAMES = 40
const scenarioId = report.scenarios[0].id

async function openWithMotion(page: Page) {
  await openReport(page, { report, media: { reducedMotion: 'no-preference' } })
  await expect(page.locator(`#card-${scenarioId} .timing-chip`).first()).toBeVisible()
}

/** A message arrow in the diagram, drawn once the diagram is on screen. */
async function firstArrow(page: Page) {
  await page.locator(`#card-${scenarioId} .seq-scroll`).scrollIntoViewIfNeeded()
  const arrow = page.locator(`#card-${scenarioId} .seq-scroll button.msg-open`).first()
  await expect(arrow).toBeVisible()
  return arrow
}

/** Click the Wall-clock chip and record every width the diagram's scrollport takes until well past the glide. */
async function openTiming(page: Page) {
  return page.evaluate(
    async ({ id, after }) => {
      const scrollport = document.querySelector<HTMLElement>(`#card-${id} .seq-scroll`)!
      const shell = document.querySelector<HTMLElement>('.shell')!
      const widths: number[] = []
      const observer = new ResizeObserver(([entry]) => widths.push(Math.round(entry.contentRect.width)))
      observer.observe(scrollport)
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      // The observer's first notification is the width before the click.
      const before = widths.at(-1)
      widths.length = 0
      document.querySelector<HTMLElement>(`#card-${id} .timing-chip`)!.click()
      // Right after the click, before any frame: the computed width is already the final one.
      const atClick = getComputedStyle(shell).getPropertyValue('--inspector-w').trim()
      const set = shell.style.getPropertyValue('--inspector-w').trim()
      await new Promise((r) => {
        const tick = (left: number): void => void (left ? requestAnimationFrame(() => tick(left - 1)) : r(null))
        tick(after)
      })
      observer.disconnect()
      return { widths, before, atClick, set }
    },
    { id: scenarioId, after: AFTER_GLIDE_FRAMES },
  )
}

test('the Timing view widens the panel at once, so the diagram is resized once', async ({ page }) => {
  await openWithMotion(page)
  const { widths, before, atClick, set } = await openTiming(page)
  expect(parseFloat(set)).toBeGreaterThan(INSPECTOR_NARROW_PX)
  expect(atClick).toBe(set)
  expect(widths, `scrollport widths after the open: ${widths.join(', ')}`).toHaveLength(1)
  // The one width is a resize, not the observer's first notice of the width it already had.
  expect(widths[0]).not.toBe(before)
})

test('opening a message after Timing sets the saved width at once too', async ({ page }) => {
  await openWithMotion(page)
  await openTiming(page)
  await firstArrow(page)
  const back = await page.evaluate(
    async ({ id, after }) => {
      const scrollport = document.querySelector<HTMLElement>(`#card-${id} .seq-scroll`)!
      const widths: number[] = []
      const observer = new ResizeObserver(([entry]) => widths.push(Math.round(entry.contentRect.width)))
      observer.observe(scrollport)
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      // The observer's first notification is the width before the click.
      const before = widths.at(-1)
      widths.length = 0
      document.querySelector<HTMLElement>(`#card-${id} .seq-scroll button.msg-open`)!.click()
      await new Promise((r) => {
        const tick = (left: number): void => void (left ? requestAnimationFrame(() => tick(left - 1)) : r(null))
        tick(after)
      })
      observer.disconnect()
      return {
        widths,
        before,
        panel: getComputedStyle(document.querySelector('.shell')!).getPropertyValue('--inspector-w').trim(),
      }
    },
    { id: scenarioId, after: AFTER_GLIDE_FRAMES },
  )
  expect(back.panel).toBe(`${INSPECTOR_NARROW_PX}px`)
  expect(back.widths, `scrollport widths after the message opens: ${back.widths.join(', ')}`).toHaveLength(1)
  expect(back.widths[0]).not.toBe(back.before)
})

test('Expand and Shrink still glide: a person asked for that width', async ({ page }) => {
  await openWithMotion(page)
  await (await firstArrow(page)).click()
  await expect(page.locator('#inspector')).toBeVisible()
  const glide = await page.evaluate(
    async ({ after }) => {
      const shell = document.querySelector<HTMLElement>('.shell')!
      const button = document.querySelector<HTMLElement>('#inspector-json-expand')!
      const now = () => parseFloat(getComputedStyle(shell).getPropertyValue('--inspector-w'))
      // The computed width on every frame after a click, well past the 160 ms glide. Any frame
      // between the two ends shows a glide, however slow the runner.
      const press = async () => {
        const from = now()
        button.click()
        const target = parseFloat(shell.style.getPropertyValue('--inspector-w'))
        const frames: number[] = []
        await new Promise((r) => {
          const tick = (left: number): void =>
            void (left ? requestAnimationFrame(() => (frames.push(now()), tick(left - 1))) : r(null))
          tick(after)
        })
        return { label: button.textContent, from, target, frames }
      }
      const expand = await press()
      const shrink = await press()
      return { expand, shrink }
    },
    { after: AFTER_GLIDE_FRAMES },
  )
  const between = (g: { from: number; target: number; frames: number[] }) =>
    g.frames.filter((w) => w > Math.min(g.from, g.target) && w < Math.max(g.from, g.target))
  expect(glide.expand.label).toBe('Shrink')
  expect(glide.expand.from).toBe(INSPECTOR_NARROW_PX)
  expect(glide.expand.target).toBeGreaterThan(INSPECTOR_NARROW_PX)
  expect(between(glide.expand), `widths: ${glide.expand.frames.join(', ')}`).not.toHaveLength(0)
  expect(glide.expand.frames.at(-1)).toBe(glide.expand.target)
  expect(glide.shrink.label).toBe('Expand')
  expect(glide.shrink.from).toBe(glide.expand.target)
  expect(glide.shrink.target).toBe(INSPECTOR_NARROW_PX)
  expect(between(glide.shrink), `widths: ${glide.shrink.frames.join(', ')}`).not.toHaveLength(0)
  expect(glide.shrink.frames.at(-1)).toBe(INSPECTOR_NARROW_PX)
})
