import { expect, test } from '@playwright/test'
import { openExample } from './example-report'

// The logo and the report's version link to the lsd-mono repository (src/ui/repo-link.ts): the
// first stop on Tab, with a visible ring, and printed as plain text.

const REPO = 'https://github.com/lsd-consulting/lsd-mono'

test('the logo is the first Tab stop and shows a focus ring', async ({ page }) => {
  await openExample(page)
  await page.keyboard.press('Tab')
  const logo = page.getByRole('link', { name: 'Living Sequence Diagrams: lsd-mono on GitHub' })
  await expect(logo).toBeFocused()
  await expect(logo).toHaveAttribute('href', REPO)
  const outline = await logo.evaluate((el) => getComputedStyle(el).outlineStyle)
  expect(outline).toBe('solid')
})

test('the version is a link and Tab reaches it', async ({ page }) => {
  await openExample(page)
  const version = page.locator('.report-hero a.generator-link')
  await expect(version).toHaveAttribute('href', REPO)
  await expect(version).toHaveAttribute('target', '_blank')
  await version.focus()
  await expect(version).toBeFocused()
  expect(await version.evaluate((el) => (el as HTMLElement).tabIndex)).toBe(0)
})

test('the version prints as plain text', async ({ page }) => {
  await openExample(page, undefined, { media: { media: 'print', reducedMotion: 'reduce' } })
  const version = page.locator('.report-hero a.generator-link')
  const style = await version.evaluate((el) => {
    const cs = getComputedStyle(el)
    const parent = getComputedStyle(el.parentElement!)
    return { decoration: cs.textDecorationLine, same: cs.color === parent.color }
  })
  expect(style).toEqual({ decoration: 'none', same: true })
})
