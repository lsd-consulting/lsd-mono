import { expect, test } from '@playwright/test'
import { expectStable, frames, requestsFlushed } from './ux-helpers'

// #110: the waits that replace fixed sleeps. Each one waits for the page, not for wall-clock time,
// so a slow worker waits longer instead of asserting too soon.

test.beforeEach(async ({ page }) => {
  await page.setContent('<p id="out">0</p>')
})

test('frames waits for that many animation frames', async ({ page }) => {
  await page.evaluate(() => {
    const w = window as unknown as { ticks: number }
    w.ticks = 0
    const tick = () => {
      w.ticks++
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  const before = await page.evaluate(() => (window as unknown as { ticks: number }).ticks)
  await frames(page, 4)
  const after = await page.evaluate(() => (window as unknown as { ticks: number }).ticks)
  expect(after - before).toBeGreaterThanOrEqual(4)
})

test('expectStable reads on while the value moves, and returns where it settles', async ({ page }) => {
  // A value that changes for 20 frames, as a smooth scroll or a late refit does: a short fixed
  // sleep would read it mid-way.
  await page.evaluate(() => {
    let left = 20
    const step = () => {
      document.getElementById('out')!.textContent = String(20 - left)
      if (--left >= 0) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })
  const settled = await expectStable(page, () => page.locator('#out').textContent())
  expect(settled).toBe('20')
})

test('expectStable fails on a value that never settles', async ({ page }) => {
  await page.evaluate(() => {
    const step = () => {
      const out = document.getElementById('out')!
      out.textContent = String(Number(out.textContent) + 1)
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })
  await expect(expectStable(page, () => page.locator('#out').textContent(), { timeout: 300 })).rejects.toThrow(
    /not stable after 300ms/,
  )
})

test('requestsFlushed returns once every earlier request has reached the route', async ({ page }) => {
  const seen: string[] = []
  await page.route('https://ping.invalid/**', async (route) => {
    seen.push(route.request().url())
    await route.abort()
  })
  // A request the page has started but the route has not seen yet, as on a busy worker.
  await page.evaluate(() => {
    void fetch('https://ping.invalid/stray', { mode: 'no-cors' }).catch(() => {})
  })
  await requestsFlushed(page, () => seen, 'https://ping.invalid/sentinel')
  expect(seen).toEqual(['https://ping.invalid/stray', 'https://ping.invalid/sentinel'])
})
