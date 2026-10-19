// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { bindJsonMarks, markText, marksLabel } from './json-marks'

function parts() {
  document.body.innerHTML = `<div class="json-find" hidden><span class="json-find-count"></span>
    <button data-json-step="prev"></button><button data-json-step="next"></button></div><pre></pre>`
  const box = document.querySelector<HTMLElement>('.json-find')!
  return {
    pre: document.querySelector<HTMLElement>('pre')!,
    box,
    count: box.querySelector<HTMLElement>('.json-find-count')!,
    prev: box.querySelector<HTMLButtonElement>('[data-json-step="prev"]')!,
    next: box.querySelector<HTMLButtonElement>('[data-json-step="next"]')!,
  }
}

describe('payload marks', () => {
  it('marks each match as text, so a payload cannot inject markup, and keeps the text as it was', () => {
    const { pre } = parts()
    const text = '{\n  "html": "<b>Order</b> <script>x()</script>",\n  "id": "ORDER-1"\n}'
    const { marks, total } = markText(pre, text, 'order')
    expect(total).toBe(2)
    expect(marks.map((m) => m.textContent)).toEqual(['Order', 'ORDER'])
    expect(pre.textContent).toBe(text)
    expect(pre.querySelector('b, script')).toBeNull()
  })

  it('marks at most the limit, counts the rest, and says so', () => {
    const { pre } = parts()
    const { marks, total } = markText(pre, 'a a a a a', 'a', 3)
    expect(marks).toHaveLength(3)
    expect(total).toBe(5)
    expect(marksLabel(1, 3, 5)).toBe('1 of 5 in payload, first 3 highlighted')
    expect(marksLabel(2, 5, 5)).toBe('2 of 5 in payload')
  })

  it('shows the controls only with a match, makes the first current, and steps round both ways', () => {
    const p = parts()
    const marks = bindJsonMarks(p)
    expect(marks.show('ab ab ab', 'zz')).toBe(false)
    expect(p.box.hidden).toBe(true)
    expect(p.pre.textContent).toBe('ab ab ab')
    expect(marks.show('ab ab ab', 'ab')).toBe(true)
    expect(p.box.hidden).toBe(false)
    expect(p.count.textContent).toBe('1 of 3 in payload')
    p.prev.click()
    expect(p.count.textContent).toBe('3 of 3 in payload')
    expect(p.pre.querySelectorAll('.is-current')).toHaveLength(1)
    p.next.click()
    p.next.click()
    expect(p.count.textContent).toBe('2 of 3 in payload')
    marks.hide()
    expect(p.box.hidden).toBe(true)
    p.next.click()
    expect(p.count.textContent).toBe('')
  })
})
