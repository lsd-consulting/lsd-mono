import { payloadText as shownText } from '../lib/payload-search'

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
}): JsonBody {
  const { toggle, pre, copy, current } = parts
  let pending: Promise<unknown> = Promise.resolve(undefined)
  let cached: unknown = undefined
  let ready = false
  let label = 'JSON'
  let showJson = false
  /** Set when an arrow opens: on a phone its JSON is scrolled into view once it shows. */
  let revealJson = false

  async function payloadText(): Promise<string> {
    const value = ready ? cached : await pending
    if (value === undefined) return '(no payload)'
    return shownText(value)
  }

  async function show(token: number): Promise<void> {
    let text: string
    try {
      text = await payloadText()
    } catch {
      text = '(no payload)'
    }
    if (token !== current() || !showJson) return
    pre.textContent = text
    pre.hidden = false
    toggle.setAttribute('aria-expanded', 'true')
    toggle.textContent = `Hide ${label}`
    parts.onContent?.()
    if (revealJson) {
      revealJson = false
      parts.reveal(pre)
    }
  }

  function collapse(): void {
    showJson = false
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
    },
  }
}
