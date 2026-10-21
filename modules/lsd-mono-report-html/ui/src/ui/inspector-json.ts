import { payloadText as displayText } from '../lib/payload-search'
import type { JsonMarks } from './json-marks'

export interface JsonBody {
  /** A new view opened: JSON (or stack) hidden, toggle reading "Show [label]". */
  reset: (label: string) => void
  /** On a phone, scroll the JSON into view the first time it shows. */
  revealWhenShown: () => void
  /** The payload for view [token]. Shown once it settles; [onError] runs if it fails. */
  load: (value: Promise<unknown>, token: number, onError?: () => void) => void
  /** A payload already in hand, such as an error's stack. */
  loaded: (value: unknown, token: number) => void
  /** The view has no JSON: no toggle, and Copy gives "(no payload)". */
  none: () => void
  /** Stop showing: the panel closed or a view without JSON opened. */
  stop: () => void
  /** Find's query changed: mark its matches in the JSON shown, or clear them. */
  refreshMarks: () => void
}

/**
 * The panel's JSON body: the Show/Hide toggle, the pre, and Copy.
 * [current] is the open view's token, so a payload that settles after the view changed is dropped.
 */
export function bindJsonBody(parts: {
  toggle: HTMLButtonElement
  pre: HTMLElement
  copy: HTMLButtonElement
  current: () => number
  onContent?: () => void
  reveal: (content: HTMLElement) => void
  /** Find's matches in the JSON, and the folded query to mark ('' for none). */
  marks?: JsonMarks
  query?: () => string
}): JsonBody {
  const { toggle, pre, copy, current } = parts
  let pending: Promise<unknown> = Promise.resolve(undefined)
  let cached: unknown = undefined
  let ready = false
  let label = 'JSON'
  let showJson = false
  /** Set when an arrow opens: on a phone its JSON is scrolled into view once it shows. */
  let revealJson = false
  /** The text in the pre while it shows, so Find's marks can be redrawn on it. */
  let shown: string | null = null

  /** Put [text] in the pre with Find's matches marked. Whether anything matched (and is on screen). */
  function fill(text: string): boolean {
    shown = text
    const query = parts.query?.() ?? ''
    if (query && parts.marks) return parts.marks.show(text, query)
    parts.marks?.hide()
    pre.textContent = text
    return false
  }

  async function payloadText(): Promise<string> {
    const value = ready ? cached : await pending
    if (value === undefined) return '(no payload)'
    return displayText(value)
  }

  async function show(token: number): Promise<void> {
    let text: string
    try {
      text = await payloadText()
    } catch {
      text = '(no payload)'
    }
    if (token !== current() || !showJson) return
    pre.hidden = false
    const marked = fill(text)
    toggle.setAttribute('aria-expanded', 'true')
    toggle.textContent = `Hide ${label}`
    parts.onContent?.()
    if (revealJson) {
      revealJson = false
      // A match is already brought on screen; otherwise show the start of the JSON.
      if (!marked) parts.reveal(pre)
    }
  }

  function collapse(): void {
    showJson = false
    shown = null
    parts.marks?.hide()
    pre.hidden = true
    pre.textContent = ''
    toggle.setAttribute('aria-expanded', 'false')
    toggle.textContent = `Show ${label}`
    parts.onContent?.()
  }

  toggle.addEventListener('click', () => {
    if (toggle.getAttribute('aria-expanded') === 'true') {
      collapse()
      return
    }
    showJson = true
    void show(current())
  })

  const copyPayload = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(await payloadText())
      copy.textContent = 'Copied'
      setTimeout(() => {
        copy.textContent = 'Copy'
      }, 1200)
    } catch {
      /* clipboard may be unavailable; the payload is still in the panel */
    }
  }
  copy.addEventListener('click', () => void copyPayload())

  return {
    reset(next) {
      label = next
      ready = false
      cached = undefined
      showJson = true
      revealJson = false
      shown = null
      parts.marks?.hide()
      pre.hidden = true
      pre.textContent = ''
      toggle.hidden = false
      toggle.setAttribute('aria-expanded', 'false')
      toggle.textContent = `Show ${label}`
    },
    revealWhenShown() {
      revealJson = true
    },
    load(value, token, onError) {
      pending = value
      void value.then(
        (settled) => {
          if (token !== current()) return
          cached = settled
          ready = true
          void show(token)
        },
        () => {
          if (token !== current()) return
          cached = undefined
          ready = true
          onError?.()
          void show(token)
        },
      )
    },
    loaded(value, token) {
      pending = Promise.resolve(value)
      cached = value
      ready = true
      void show(token)
    },
    none() {
      showJson = false
      toggle.hidden = true
      pending = Promise.resolve(undefined)
      cached = undefined
      ready = true
    },
    stop() {
      showJson = false
      shown = null
      parts.marks?.hide()
    },
    refreshMarks() {
      if (shown !== null && !pre.hidden) fill(shown)
    },
  }
}
