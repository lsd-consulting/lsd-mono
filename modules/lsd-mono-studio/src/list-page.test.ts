// The report list page (public/index.html), run in jsdom against an in-memory fake of the API.
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

interface Entry {
  id: string
  title: string
  importedAt: string
}

interface Call {
  method: string
  url: string
  body?: string
}

const HTML = await readFile(new URL('../public/index.html', import.meta.url), 'utf8')
const SAMPLE = '{"resourceSpans":[]}'

function entry(id: string, title: string, importedAt = '2026-10-31T21:00:00.000Z'): Entry {
  return { id, title, importedAt }
}

// The page's format, the report UI's (formatGeneratedAt), in the time zone the tests run in.
const shown = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  })
const AT = shown('2026-10-31T21:00:00.000Z')

const json = (value: unknown): Response => new Response(JSON.stringify(value), { status: 200 })

/** What the next import answers. */
interface ImportAnswer {
  status: number
  body: string
}

async function openPage(initial: Entry[], importAnswer?: ImportAnswer | (() => Promise<Response>)) {
  let reports = [...initial]
  const calls: Call[] = []
  // What the next confirmation dialog answers: 'delete' or 'cancel'.
  const answer = { next: 'delete' }
  const fakeFetch = (url: string, init: RequestInit = {}): Promise<Response> => {
    const method = init.method ?? 'GET'
    calls.push({ method, url, body: typeof init.body === 'string' ? init.body : undefined })
    if (method === 'GET' && url === '/api/reports') return Promise.resolve(json(reports))
    if (method === 'GET' && url === '/samples/sample-trace.json') return Promise.resolve(new Response(SAMPLE))
    if (method === 'DELETE') {
      const id = decodeURIComponent(url.split('/').pop() ?? '')
      reports = reports.filter((report) => report.id !== id)
      return Promise.resolve(new Response(null, { status: 204 }))
    }
    if (method === 'POST' && url === '/api/reports/bulk-delete') {
      const { ids } = JSON.parse(init.body as string) as { ids: string[] }
      const deleted = ids.filter((id) => reports.some((report) => report.id === id))
      reports = reports.filter((report) => !ids.includes(report.id))
      return Promise.resolve(json({ deleted, notFound: ids.filter((id) => !deleted.includes(id)) }))
    }
    if (method === 'POST' && url === '/api/reports/import' && importAnswer) {
      return typeof importAnswer === 'function'
        ? importAnswer()
        : Promise.resolve(new Response(importAnswer.body, { status: importAnswer.status }))
    }
    return Promise.resolve(new Response('unexpected', { status: 500 }))
  }
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    beforeParse(window) {
      Object.assign(window, { fetch: fakeFetch })
      // jsdom has <dialog> but not showModal: open it, then answer like a user clicking a button.
      const proto = window.HTMLDialogElement.prototype
      proto.showModal = function (this: HTMLDialogElement) {
        this.open = true
        queueMicrotask(() => {
          this.open = false
          this.returnValue = answer.next
          this.dispatchEvent(new window.Event('close'))
        })
      }
    },
  })
  const window = dom.window as unknown as Window & { lsdReady: Promise<void> }
  await window.lsdReady
  const doc = window.document
  const settle = () => new Promise((resolve) => setTimeout(resolve, 10))
  const byId = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T
  const titles = () => [...doc.querySelectorAll('#reports a')].map((link) => link.textContent)
  const change = (box: HTMLInputElement, checked: boolean) => {
    box.checked = checked
    box.dispatchEvent(new dom.window.Event('change'))
  }
  const pick = (index: number) => {
    const box = doc.querySelectorAll<HTMLInputElement>('#reports input[type=checkbox]')[index]
    change(box, !box.checked)
  }
  // jsdom cannot set a file input's files, so stand one in for the picker.
  const chooseFile = (text: string) => {
    Object.defineProperty(byId('import-file'), 'files', { value: [{ text: () => Promise.resolve(text) }] })
  }
  return { doc, calls, answer, settle, byId, titles, pick, change, chooseFile }
}

describe('report list page', () => {
  it('lists reports with a link to open each one', async () => {
    const page = await openPage([entry('a', 'Checkout'), entry('b/c', 'Payments')])
    expect(page.titles()).toEqual(['Checkout', 'Payments'])
    expect(page.doc.querySelectorAll('#reports a')[1].getAttribute('href')).toBe('/reports/b%2Fc')
    expect(page.byId('empty').hidden).toBe(true)
    expect(page.byId('toolbar').hidden).toBe(false)
  })

  it('shows reports titles as text, never markup', async () => {
    const page = await openPage([entry('a', '<img src=x onerror=alert(1)>')])
    expect(page.doc.querySelector('#reports img')).toBeNull()
    expect(page.titles()).toEqual(['<img src=x onerror=alert(1)>'])
  })

  it('shows an empty state and hides the bulk controls when there are no reports', async () => {
    const page = await openPage([])
    expect(page.byId('empty').hidden).toBe(false)
    expect(page.byId('empty').textContent).toContain('No reports yet')
    expect(page.byId('toolbar').hidden).toBe(true)
  })

  it('labels every checkbox and delete button with its report', async () => {
    const page = await openPage([entry('a', 'Checkout')])
    expect(page.doc.querySelector('#reports input')?.getAttribute('aria-label')).toBe(`Select Checkout, imported ${AT}`)
    expect(page.doc.querySelector('#reports button')?.getAttribute('aria-label')).toBe(
      `Delete Checkout, imported ${AT}`,
    )
    expect(page.doc.querySelector('#reports time')?.textContent).toBe(`Imported ${AT}`)
  })

  it('tells same-title reports apart by when they were imported', async () => {
    const later = '2026-10-31T21:05:00.000Z'
    const page = await openPage([entry('a', 'Checkout'), entry('b', 'Checkout', later)])
    const labels = [...page.doc.querySelectorAll('#reports button')].map((b) => b.getAttribute('aria-label'))
    expect(labels).toEqual([`Delete Checkout, imported ${AT}`, `Delete Checkout, imported ${shown(later)}`])
    expect(new Set(labels).size).toBe(2)
  })

  it('says what LSD Studio is for under its heading', async () => {
    const page = await openPage([])
    const intro = page.byId('intro')
    expect(intro.tagName).toBe('P')
    expect(intro.closest('header')?.querySelector('h1')?.textContent).toBe('LSD Studio')
    expect(intro.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Your local home for sequence diagrams: import LSD reports or OpenTelemetry traces, keep them on this machine, and open any of them as a diagram.',
    )
  })

  it('says it is local only', async () => {
    const page = await openPage([])
    expect(page.doc.querySelector('header .local')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Local only Reports are stored on this machine. Nothing is uploaded.',
    )
  })

  it('confirms, deletes one report, refreshes and says so', async () => {
    const page = await openPage([entry('a', 'Checkout'), entry('b', 'Payments')])
    page.doc.querySelector<HTMLButtonElement>('#reports button')?.click()
    await page.settle()
    expect(page.byId('confirm-message').textContent).toBe(
      `"Checkout", imported ${AT}, will be deleted. This cannot be undone.`,
    )
    expect(page.byId('confirm-list').hidden).toBe(true)
    expect(page.calls).toContainEqual({ method: 'DELETE', url: '/api/reports/a', body: undefined })
    expect(page.titles()).toEqual(['Payments'])
    expect(page.byId('list-status').textContent).toBe('Deleted "Checkout".')
  })

  it('deletes nothing when the confirmation is cancelled', async () => {
    const page = await openPage([entry('a', 'Checkout')])
    page.answer.next = 'cancel'
    const button = page.doc.querySelector<HTMLButtonElement>('#reports button')
    button?.click()
    await page.settle()
    expect(page.calls.filter((call) => call.method !== 'GET')).toEqual([])
    expect(page.titles()).toEqual(['Checkout'])
    expect(page.doc.activeElement).toBe(button)
  })

  it('enables bulk delete only with a selection and counts it', async () => {
    const page = await openPage([entry('a', 'A'), entry('b', 'B'), entry('c', 'C')])
    const bulk = page.byId<HTMLButtonElement>('bulk-delete')
    const all = page.byId<HTMLInputElement>('select-all')
    expect(bulk.disabled).toBe(true)
    page.pick(0)
    expect(bulk.disabled).toBe(false)
    expect(bulk.textContent).toBe('Delete selected (1)')
    expect(all.indeterminate).toBe(true)
    page.pick(1)
    page.pick(2)
    expect(all.checked).toBe(true)
    expect(all.indeterminate).toBe(false)
  })

  it('lists the first five titles in the bulk confirmation, then how many more', async () => {
    const page = await openPage(['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((t) => entry(t, t)))
    page.change(page.byId<HTMLInputElement>('select-all'), true)
    page.answer.next = 'cancel'
    page.byId('bulk-delete').click()
    await page.settle()
    expect([...page.byId('confirm-list').children].map((li) => li.textContent)).toEqual([
      ...['A', 'B', 'C', 'D', 'E'].map((t) => `${t}, imported ${AT}`),
      'and 2 more',
    ])
    expect(page.byId('confirm-list').hidden).toBe(false)
  })

  it('says why bulk delete is disabled, in a way screen readers hear', async () => {
    const page = await openPage([entry('a', 'A')])
    const bulk = page.byId<HTMLButtonElement>('bulk-delete')
    expect(bulk.getAttribute('aria-describedby')).toBe('bulk-hint')
    expect(page.byId('bulk-hint').textContent).toBe('Select reports first')
    expect(page.byId('bulk-hint').hidden).toBe(false)
    page.pick(0)
    expect(page.byId('bulk-hint').hidden).toBe(true)
  })

  it('shows a refused import as a plain reason and a short list, as an alert with focus', async () => {
    const errors = Array.from({ length: 7 }, (_, i) => `/scenarios/${i}: must be object`)
    const page = await openPage([], { status: 422, body: JSON.stringify({ error: 'Not a valid LSD report', errors }) })
    page.chooseFile('{}')
    page.byId('import').click()
    await page.settle()
    const alert = page.byId('import-error')
    expect(alert.getAttribute('role')).toBe('alert')
    expect(alert.querySelector('p')?.textContent).toBe('Not a valid LSD report.')
    expect([...alert.querySelectorAll('li')].map((li) => li.textContent)).toEqual([...errors.slice(0, 5), 'and 2 more'])
    expect(alert.textContent).not.toContain('{')
    expect(page.doc.activeElement).toBe(alert)
    expect(page.byId('import-status').textContent).toBe('')
  })

  it('shows a plain-text refusal as it is, with no list', async () => {
    const page = await openPage([], { status: 415, body: 'Not an LSD report or OTLP JSON' })
    page.chooseFile('x')
    page.byId('import').click()
    await page.settle()
    expect(page.byId('import-error').textContent).toBe('Not an LSD report or OTLP JSON')
    expect(page.byId('import-error').querySelector('ul')).toBeNull()
  })

  it('says so when the server cannot be reached or answers nothing', async () => {
    const down = await openPage([], () => Promise.reject(new TypeError('fetch failed')))
    down.chooseFile('{}')
    down.byId('import').click()
    await down.settle()
    expect(down.byId('import-error').textContent).toBe('Could not reach LSD Studio. Is it still running?')
    const empty = await openPage([], { status: 502, body: '' })
    empty.chooseFile('{}')
    empty.byId('import').click()
    await empty.settle()
    expect(empty.byId('import-error').textContent).toBe('The import failed (502).')
  })

  it('announces a successful import politely, and is busy while importing so it cannot run twice', async () => {
    let finish: (response: Response) => void = () => undefined
    const page = await openPage([], () => new Promise((resolve) => (finish = resolve)))
    page.chooseFile('{}')
    const button = page.byId<HTMLButtonElement>('import')
    button.click()
    await page.settle()
    expect(button.disabled).toBe(true)
    expect(button.textContent).toBe('Importing…')
    button.click()
    finish(json({ id: 'a', title: 'Checkout', importedAt: '2026-10-31T21:00:00.000Z' }))
    await page.settle()
    expect(page.calls.filter((call) => call.url === '/api/reports/import')).toHaveLength(1)
    expect(button.disabled).toBe(false)
    expect(button.textContent).toBe('Import')
    expect(page.byId('import-status').getAttribute('role')).toBe('status')
    expect(page.byId('import-status').textContent).toBe('Imported "Checkout".')
    expect(page.byId('import-error').textContent).toBe('')
  })

  it('offers the sample trace from the empty state and imports it like a chosen file', async () => {
    let finish: (response: Response) => void = () => undefined
    const page = await openPage([], () => new Promise((resolve) => (finish = resolve)))
    const button = page.byId<HTMLButtonElement>('try-sample')
    expect(page.byId('empty').hidden).toBe(false)
    expect(button.textContent).toBe('Try a sample')
    button.click()
    await page.settle()
    expect(button.disabled).toBe(true)
    button.click()
    finish(json({ id: 's', title: 'POST /orders (trace 5a3c1e0b)', importedAt: '2026-10-31T21:00:00.000Z' }))
    await page.settle()
    const imports = page.calls.filter((call) => call.url === '/api/reports/import')
    expect(imports).toEqual([{ method: 'POST', url: '/api/reports/import', body: SAMPLE }])
    expect(button.disabled).toBe(false)
    expect(button.textContent).toBe('Try a sample')
    expect(page.byId('import-status').textContent).toBe('Imported "POST /orders (trace 5a3c1e0b)".')
  })

  it('shows a refused sample import like any other', async () => {
    const page = await openPage([], { status: 422, body: JSON.stringify({ error: 'Not valid', errors: ['/x'] }) })
    page.byId('try-sample').click()
    await page.settle()
    expect(page.byId('import-error').textContent).toContain('Not valid.')
  })

  it('does nothing on import with no file chosen', async () => {
    const page = await openPage([])
    page.byId('import').click()
    await page.settle()
    expect(page.calls.filter((call) => call.method === 'POST')).toEqual([])
  })

  it('selects and clears everything with select all', async () => {
    const page = await openPage([entry('a', 'A'), entry('b', 'B')])
    const all = page.byId<HTMLInputElement>('select-all')
    page.change(all, true)
    expect(page.byId('bulk-delete').textContent).toBe('Delete selected (2)')
    page.change(all, false)
    expect(page.byId<HTMLButtonElement>('bulk-delete').disabled).toBe(true)
  })

  it('confirms with a count, bulk deletes the selection, refreshes and says so', async () => {
    const page = await openPage([entry('a', 'A'), entry('b', 'B'), entry('c', 'C')])
    page.pick(0)
    page.pick(2)
    page.byId('bulk-delete').click()
    await page.settle()
    expect(page.byId('confirm-message').textContent).toBe('2 reports will be deleted. This cannot be undone.')
    expect([...page.byId('confirm-list').children].map((li) => li.textContent)).toEqual([
      `A, imported ${AT}`,
      `C, imported ${AT}`,
    ])
    expect(page.calls).toContainEqual({ method: 'POST', url: '/api/reports/bulk-delete', body: '{"ids":["a","c"]}' })
    expect(page.titles()).toEqual(['B'])
    expect(page.byId('list-status').textContent).toBe('Deleted 2 reports.')
    expect(page.byId<HTMLButtonElement>('bulk-delete').disabled).toBe(true)
  })

  it('shows the empty state once the last report is deleted', async () => {
    const page = await openPage([entry('a', 'A')])
    page.pick(0)
    page.byId('bulk-delete').click()
    await page.settle()
    expect(page.byId('confirm-message').textContent).toBe('1 report will be deleted. This cannot be undone.')
    expect(page.byId('list-status').textContent).toBe('Deleted 1 report.')
    expect(page.byId('empty').hidden).toBe(false)
    expect(page.byId('toolbar').hidden).toBe(true)
  })

  it('uses an accessible modal dialog for the confirmation', async () => {
    const page = await openPage([])
    const dialog = page.byId('confirm')
    expect(dialog.tagName).toBe('DIALOG')
    expect(dialog.getAttribute('aria-labelledby')).toBe('confirm-title')
    expect(dialog.getAttribute('aria-describedby')).toBe('confirm-message')
    expect(page.doc.querySelector('#confirm [autofocus]')?.textContent).toBe('Cancel')
    expect(page.byId('list-status').getAttribute('role')).toBe('status')
  })
})
