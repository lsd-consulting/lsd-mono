import { expect, test } from '@playwright/test'
import type { Report } from '../src/types'
import { openReport } from './open-report'
import { uxFixture } from './ux-fixture'
import { endPrint, formatViolations, seriousViolations, startPrint } from './ux-helpers'

// #72: the JUnit extension writes the test method's source as a Key facts entry of several lines.
// It keeps its line breaks and indentation, stays inside the card (scrolling in its own box),
// can be scrolled from the keyboard, and the card still passes axe.
const source = [
  '@Test',
  'fun `places an order`(scenario: LsdScenario) {',
  '    // given a <basket>',
  '    val basket = basketWith("lamp-01")',
  ...Array.from(
    { length: 40 },
    (_, i) => `    step${i}(basket, "a long argument that runs past the card's width on purpose ${i}")`,
  ),
  '}',
].join('\n')

const report: Report = {
  ...uxFixture,
  scenarios: [
    {
      ...uxFixture.scenarios[0],
      facts: [
        { key: 'orderId', value: 'ord_ux' },
        { key: 'Test source', value: source },
      ],
    },
  ],
}

test('a test source fact keeps its lines, stays in the card and passes axe', async ({ page }) => {
  await openReport(page, { report, path: '/' })
  const pre = page.locator('.kv dd.kv-block pre')
  await expect(pre).toHaveCount(1)
  expect(await pre.textContent()).toBe(source)
  await expect(pre).toHaveAttribute('tabindex', '0')
  await expect(pre).toHaveAttribute('aria-label', 'Test source')
  // The one-line fact is untouched.
  await expect(page.locator('.kv dd:not(.kv-block)')).toHaveText('ord_ux')

  const boxes = await page.evaluate(() => {
    const card = document.querySelector<HTMLElement>('.scenario-card')!.getBoundingClientRect()
    const block = document.querySelector<HTMLElement>('.kv-block pre')!
    const box = block.getBoundingClientRect()
    return {
      inside: box.left >= card.left && box.right <= card.right,
      scrollsAcross: block.scrollWidth > block.clientWidth,
      scrollsDown: block.scrollHeight > block.clientHeight,
      whiteSpace: getComputedStyle(block).whiteSpace,
    }
  })
  expect(boxes).toEqual({ inside: true, scrollsAcross: true, scrollsDown: true, whiteSpace: 'pre' })

  const violations = await seriousViolations(page)
  expect(violations, formatViolations(violations)).toEqual([])
})

test('a test source fact prints in full, wrapped, with no scroll box', async ({ page }) => {
  await openReport(page, { report, path: '/' })
  await startPrint(page)
  const printed = await page.locator('.kv-block pre').evaluate((pre) => ({
    whole: pre.scrollHeight <= pre.clientHeight + 1 && pre.scrollWidth <= pre.clientWidth + 1,
    whiteSpace: getComputedStyle(pre).whiteSpace,
  }))
  expect(printed).toEqual({ whole: true, whiteSpace: 'pre-wrap' })
  await endPrint(page)
})
