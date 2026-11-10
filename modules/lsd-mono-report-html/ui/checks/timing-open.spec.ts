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
  const glide = await page.evaluate(async () => {
    const shell = document.querySelector<HTMLElement>('.shell')!
    const button = document.querySelector<HTMLElement>('#inspector-json-expand')!
    const property = '--inspector-w'
    const now = () => parseFloat(getComputedStyle(shell).getPropertyValue(property))
    // Scrub the CSS transition to its midpoint instead of sampling rAF frames. A busy runner
    // can skip every intermediate frame of the 160 ms glide (seeing only the start and end),
    // which is what failed on main; the Web Animations timeline does not depend on that.
    const press = async () => {
      const from = now()
      const mid = await new Promise<number>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          shell.removeEventListener('transitionrun', onRun)
          reject(new Error(`no ${property} transition started`))
        }, 1000)
        const onRun = (event: TransitionEvent) => {
          if (event.propertyName !== property) return
          window.clearTimeout(timer)
          shell.removeEventListener('transitionrun', onRun)
          const trans = shell
            .getAnimations()
            .find((a): a is CSSTransition => a instanceof CSSTransition && a.transitionProperty === property)
          const effect = trans?.effect
          if (!trans || !effect) {
            reject(new Error(`no ${property} CSSTransition after transitionrun`))
            return
          }
          const duration = effect.getComputedTiming().duration
          const ms = typeof duration === 'number' ? duration : Number.parseFloat(String(duration))
          if (!Number.isFinite(ms) || ms <= 0) {
            reject(new Error(`unexpected ${property} duration: ${String(duration)}`))
            return
          }
          trans.pause()
          trans.currentTime = ms / 2
          const width = now()
          trans.play()
          void trans.finished.then(() => resolve(width), reject)
        }
        shell.addEventListener('transitionrun', onRun)
        button.click()
      })
      return {
        label: button.textContent,
        from,
        target: parseFloat(shell.style.getPropertyValue(property)),
        mid,
        end: now(),
      }
    }
    const expand = await press()
    const shrink = await press()
    return { expand, shrink }
  })
  expect(glide.expand.label).toBe('Shrink')
  expect(glide.expand.from).toBe(INSPECTOR_NARROW_PX)
  expect(glide.expand.target).toBeGreaterThan(INSPECTOR_NARROW_PX)
  expect(
    glide.expand.mid,
    `expand midpoint ${glide.expand.mid} should sit between ${glide.expand.from} and ${glide.expand.target}`,
  ).toBeGreaterThan(glide.expand.from)
  expect(glide.expand.mid).toBeLessThan(glide.expand.target)
  expect(glide.expand.end).toBe(glide.expand.target)
  expect(glide.shrink.label).toBe('Expand')
  expect(glide.shrink.from).toBe(glide.expand.target)
  expect(glide.shrink.target).toBe(INSPECTOR_NARROW_PX)
  expect(
    glide.shrink.mid,
    `shrink midpoint ${glide.shrink.mid} should sit between ${glide.shrink.target} and ${glide.shrink.from}`,
  ).toBeLessThan(glide.shrink.from)
  expect(glide.shrink.mid).toBeGreaterThan(glide.shrink.target)
  expect(glide.shrink.end).toBe(INSPECTOR_NARROW_PX)
})
