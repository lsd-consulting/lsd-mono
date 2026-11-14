// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindJsonBody } from './inspector-json'

/** The toggle, pre and Copy button, a view token the test moves on, and what the body asked for. */
function setup(query = '') {
  document.body.innerHTML = '<button id="toggle"></button><pre hidden></pre><button id="copy">Copy</button>'
  const toggle = document.querySelector<HTMLButtonElement>('#toggle')!
  const pre = document.querySelector<HTMLElement>('pre')!
  const copy = document.querySelector<HTMLButtonElement>('#copy')!
  const view = { token: 1, query, contents: 0, revealed: [] as HTMLElement[], shown: [] as string[], hides: 0 }
  const body = bindJsonBody({
    toggle,
    pre,
    copy,
    current: () => view.token,
    onContent: () => {
      view.contents += 1
    },
    reveal: (content) => view.revealed.push(content),
    marks: {
      show: (text, q) => {
        view.shown.push(`${q}:${text}`)
        pre.textContent = text
        return text.includes(q)
      },
      hide: () => {
        view.hides += 1
      },
    },
    query: () => view.query,
  })
  return { toggle, pre, copy, view, body }
}

/** Let settled promises run their callbacks (show awaits the payload, then the text). */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

function stubClipboard(): { copied: string[] } {
  const record = { copied: [] as string[] }
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (value: string) => {
        record.copied.push(value)
      },
    },
  })
  return record
}

afterEach(() => {
  vi.useRealTimers()
})

describe('bindJsonBody', () => {
  it('reset hides the JSON and shows the toggle with the view label, collapsed', () => {
    const { toggle, pre, view, body } = setup()
    pre.hidden = false
    pre.textContent = 'old'
    toggle.hidden = true
    body.reset('stack')
    expect(pre.hidden).toBe(true)
    expect(pre.textContent).toBe('')
    expect(toggle.hidden).toBe(false)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.textContent).toBe('Show stack')
    expect(view.hides).toBe(1)
  })

  it('load shows the payload once it settles for the open view, expanded with a Hide label', async () => {
    const { toggle, pre, view, body } = setup()
    body.reset('JSON')
    body.load(Promise.resolve({ id: 'ord_1' }), 1)
    await settle()
    expect(pre.hidden).toBe(false)
    expect(pre.textContent).toContain('ord_1')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toggle.textContent).toBe('Hide JSON')
    expect(view.contents).toBe(1)
  })

  it('load drops a payload that settles after another view opened', async () => {
    const { pre, view, body } = setup()
    body.reset('JSON')
    let resolve: (value: unknown) => void = () => {}
    body.load(
      new Promise((r) => {
        resolve = r
      }),
      1,
    )
    view.token = 2
    resolve({ id: 'stale' })
    await settle()
    expect(pre.hidden).toBe(true)
    expect(pre.textContent).toBe('')
  })

  it("Copy gives the open view's payload, not one that settles late for a view already left", async () => {
    const { copy, view, body } = setup()
    const clipboard = stubClipboard()
    body.reset('JSON')
    let resolveStale: (value: unknown) => void = () => {}
    body.load(
      new Promise((r) => {
        resolveStale = r
      }),
      1,
    )
    view.token = 2
    body.reset('JSON')
    body.load(Promise.resolve({ id: 'new' }), 2)
    await settle()
    resolveStale({ id: 'stale' })
    await settle()
    copy.click()
    await settle()
    expect(clipboard.copied).toHaveLength(1)
    expect(clipboard.copied[0]).toContain('new')
    expect(clipboard.copied[0]).not.toContain('stale')
  })

  it("Copy during the next view's load waits for its payload, not the last view's", async () => {
    const { copy, view, body } = setup()
    const clipboard = stubClipboard()
    body.reset('JSON')
    body.loaded({ id: 'old' }, 1)
    await settle()
    view.token = 2
    body.reset('JSON')
    let resolve: (value: unknown) => void = () => {}
    body.load(
      new Promise((r) => {
        resolve = r
      }),
      2,
    )
    copy.click()
    resolve({ id: 'new' })
    await settle()
    expect(clipboard.copied).toHaveLength(1)
    expect(clipboard.copied[0]).toContain('new')
    expect(clipboard.copied[0]).not.toContain('old')
  })

  it('load runs onError and shows "(no payload)" when the payload fails, only for the open view', async () => {
    const { pre, view, body } = setup()
    body.reset('JSON')
    const onError = vi.fn()
    body.load(Promise.reject(new Error('gone')), 1, onError)
    await settle()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(pre.textContent).toBe('(no payload)')

    body.reset('JSON')
    const late = vi.fn()
    let reject: (reason: unknown) => void = () => {}
    body.load(
      new Promise((_, r) => {
        reject = r
      }),
      1,
      late,
    )
    view.token = 2
    reject(new Error('gone'))
    await settle()
    expect(late).not.toHaveBeenCalled()
  })

  it('loaded shows a value already in hand', async () => {
    const { pre, body } = setup()
    body.reset('stack')
    body.loaded('at Order.place', 1)
    await settle()
    expect(pre.textContent).toBe('at Order.place')
  })

  it('none hides the toggle and Copy gives "(no payload)"', async () => {
    const { toggle, copy, body } = setup()
    const clipboard = stubClipboard()
    body.reset('JSON')
    body.none()
    expect(toggle.hidden).toBe(true)
    copy.click()
    await settle()
    expect(clipboard.copied).toEqual(['(no payload)'])
  })

  it('Copy copies the payload text and says Copied for a moment', async () => {
    vi.useFakeTimers()
    const { copy, body } = setup()
    const clipboard = stubClipboard()
    body.reset('JSON')
    body.loaded({ id: 'ord_1' }, 1)
    copy.click()
    await settle()
    expect(clipboard.copied).toHaveLength(1)
    expect(clipboard.copied[0]).toContain('ord_1')
    expect(copy.textContent).toBe('Copied')
    vi.advanceTimersByTime(1200)
    expect(copy.textContent).toBe('Copy')
  })

  it('the toggle hides the shown JSON, and shows it again', async () => {
    const { toggle, pre, body } = setup()
    body.reset('JSON')
    body.loaded({ id: 'ord_1' }, 1)
    await settle()
    toggle.click()
    expect(pre.hidden).toBe(true)
    expect(pre.textContent).toBe('')
    expect(toggle.textContent).toBe('Show JSON')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    toggle.click()
    await settle()
    expect(pre.hidden).toBe(false)
    expect(pre.textContent).toContain('ord_1')
  })

  it('stop keeps a payload that settles later off screen', async () => {
    const { pre, view, body } = setup()
    body.reset('JSON')
    body.stop()
    expect(view.hides).toBe(2)
    body.loaded({ id: 'ord_1' }, 1)
    await settle()
    expect(pre.hidden).toBe(true)
  })

  it("revealWhenShown reveals the JSON's start once, unless Find already brought a match on screen", async () => {
    const plain = setup()
    plain.body.reset('JSON')
    plain.body.revealWhenShown()
    plain.body.loaded({ id: 'ord_1' }, 1)
    await settle()
    expect(plain.view.revealed).toEqual([plain.pre])
    plain.body.loaded({ id: 'ord_2' }, 1)
    await settle()
    expect(plain.view.revealed).toHaveLength(1)

    const found = setup('ord_1')
    found.body.reset('JSON')
    found.body.revealWhenShown()
    found.body.loaded({ id: 'ord_1' }, 1)
    await settle()
    expect(found.view.revealed).toEqual([])
  })

  it('reset drops a reveal asked for by the view before', async () => {
    const { view, body } = setup()
    body.reset('JSON')
    body.revealWhenShown()
    view.token = 2
    body.reset('JSON')
    body.loaded({ id: 'ord_2' }, 2)
    await settle()
    expect(view.revealed).toEqual([])
  })

  it('stop forgets the shown JSON, so refreshMarks does not mark it again', async () => {
    const { view, body } = setup('ord')
    body.reset('JSON')
    body.loaded({ id: 'ord_1' }, 1)
    await settle()
    expect(view.shown).toHaveLength(1)
    body.stop()
    body.refreshMarks()
    expect(view.shown).toHaveLength(1)
  })

  it('refreshMarks re-marks the shown JSON for the new query, and does nothing while it is hidden', async () => {
    const { toggle, view, body } = setup('ord')
    body.reset('JSON')
    body.loaded({ id: 'ord_1' }, 1)
    await settle()
    expect(view.shown).toHaveLength(1)
    view.query = 'id'
    body.refreshMarks()
    expect(view.shown).toHaveLength(2)
    expect(view.shown[1]).toMatch(/^id:/)
    toggle.click()
    body.refreshMarks()
    expect(view.shown).toHaveLength(2)
  })
})
