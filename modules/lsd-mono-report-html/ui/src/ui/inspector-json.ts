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

type JsonBodyParts = {
  toggle: HTMLButtonElement
  pre: HTMLElement
  copy: HTMLButtonElement
  current: () => number
  onContent?: () => void
  reveal: (content: HTMLElement) => void
  /** Find's matches in the JSON, and the folded query to mark ('' for none). */
  marks?: JsonMarks
  query?: () => string
}

type JsonBodyState = {
  parts: JsonBodyParts
  pending: Promise<unknown>
  cached: unknown
  ready: boolean
  label: string
  showJson: boolean
  revealJson: boolean
  shown: string | null
}

/** Put [text] in the pre with Find's matches marked. Whether anything matched (and is on screen). */
function fill(state: JsonBodyState, text: string): boolean {
  state.shown = text
  const query = state.parts.query?.() ?? ''
  if (query && state.parts.marks) return state.parts.marks.show(text, query)
  state.parts.marks?.hide()
  state.parts.pre.textContent = text
  return false
}

async function payloadText(state: JsonBodyState): Promise<string> {
  const value = state.ready ? state.cached : await state.pending
  if (value === undefined) return '(no payload)'
  return displayText(value)
}

async function show(state: JsonBodyState, token: number): Promise<void> {
  let text: string
  try {
    text = await payloadText(state)
  } catch {
    text = '(no payload)'
  }
  if (token !== state.parts.current() || !state.showJson) return
  state.parts.pre.hidden = false
  const marked = fill(state, text)
  state.parts.toggle.setAttribute('aria-expanded', 'true')
  state.parts.toggle.textContent = `Hide ${state.label}`
  state.parts.onContent?.()
  if (state.revealJson) {
    state.revealJson = false
    // A match is already brought on screen; otherwise show the start of the JSON.
    if (!marked) state.parts.reveal(state.parts.pre)
  }
}

function collapse(state: JsonBodyState): void {
  state.showJson = false
  state.shown = null
  state.parts.marks?.hide()
  state.parts.pre.hidden = true
  state.parts.pre.textContent = ''
  state.parts.toggle.setAttribute('aria-expanded', 'false')
  state.parts.toggle.textContent = `Show ${state.label}`
  state.parts.onContent?.()
}

async function copyPayload(state: JsonBodyState): Promise<void> {
  try {
    await navigator.clipboard.writeText(await payloadText(state))
    state.parts.copy.textContent = 'Copied'
    setTimeout(() => {
      state.parts.copy.textContent = 'Copy'
    }, 1200)
  } catch {
    /* clipboard may be unavailable; the payload is still in the panel */
  }
}

/**
 * The panel's JSON body: the Show/Hide toggle, the pre, and Copy.
 * [current] is the open view's token, so a payload that settles after the view changed is dropped.
 */
export function bindJsonBody(parts: JsonBodyParts): JsonBody {
  const state: JsonBodyState = {
    parts,
    pending: Promise.resolve(undefined),
    cached: undefined,
    ready: false,
    label: 'JSON',
    showJson: false,
    revealJson: false,
    shown: null,
  }

  parts.toggle.addEventListener('click', () => {
    if (parts.toggle.getAttribute('aria-expanded') === 'true') {
      collapse(state)
      return
    }
    state.showJson = true
    void show(state, parts.current())
  })

  parts.copy.addEventListener('click', () => void copyPayload(state))

  return {
    reset(next) {
      state.label = next
      state.ready = false
      state.cached = undefined
      state.showJson = true
      state.revealJson = false
      state.shown = null
      parts.marks?.hide()
      parts.pre.hidden = true
      parts.pre.textContent = ''
      parts.toggle.hidden = false
      parts.toggle.setAttribute('aria-expanded', 'false')
      parts.toggle.textContent = `Show ${state.label}`
    },
    revealWhenShown() {
      state.revealJson = true
    },
    load(value, token, onError) {
      state.pending = value
      void value.then(
        (settled) => {
          if (token !== parts.current()) return
          state.cached = settled
          state.ready = true
          void show(state, token)
        },
        () => {
          if (token !== parts.current()) return
          state.cached = undefined
          state.ready = true
          onError?.()
          void show(state, token)
        },
      )
    },
    loaded(value, token) {
      state.pending = Promise.resolve(value)
      state.cached = value
      state.ready = true
      void show(state, token)
    },
    none() {
      state.showJson = false
      parts.toggle.hidden = true
      state.pending = Promise.resolve(undefined)
      state.cached = undefined
      state.ready = true
    },
    stop() {
      state.showJson = false
      state.shown = null
      parts.marks?.hide()
    },
    refreshMarks() {
      if (state.shown !== null && !parts.pre.hidden) fill(state, state.shown)
    },
  }
}
