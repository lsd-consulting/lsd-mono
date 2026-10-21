// What the page's listeners decide, without doing it (#99): each function reads the event and
// the state it is given and names the action, so the listeners in keys.ts, chrome.ts and nav.ts
// only carry it out, and the decisions get unit tests that run in seconds.
import type { HashRef } from '../lib/report-hash'
import type { Scenario } from '../types'
import { defaultScenarioId } from '../ui/selection'

// Page keys (keys.ts builds the router's page context from this)

/** What a key's target says about the page shortcuts, read from the DOM. */
export interface KeyTarget {
  /** A text field has focus: keys type, and Escape leaves the field. */
  typing: boolean
  /** The focus takes typed text (search, Find), not a checkbox: Escape clears it, then leaves it (#114). */
  textField: boolean
  /** That text field has text in it, so Escape clears it first. */
  fieldHasText: boolean
  /** A control with keys of its own (an arrow, a panel button, the panel, a diagram, the theme menu): page keys keep off. */
  ownKeys: boolean
  /** The arrow keys move the selection here: on the list, the page or the scenario heading. */
  arrows: boolean
  /** A button, link or slider, where Enter presses it. */
  onControl: boolean
  /** An open menu or popover with keys of its own (theme, participant actions, hidden participants): ? keeps off. */
  inMenu: boolean
}

/** Input types that take typed text. A checkbox, a button or a slider is an INPUT too, but not one. */
const TEXT_INPUTS = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number'])

/** [target] takes typed text and has a value Escape can clear: a textarea or a text-like input. */
export function isTextField(target: Element): target is HTMLInputElement | HTMLTextAreaElement {
  return (
    target.tagName === 'TEXTAREA' ||
    (target.tagName === 'INPUT' && TEXT_INPUTS.has((target as HTMLInputElement).type.toLowerCase()))
  )
}

export function keyTarget(target: HTMLElement): KeyTarget {
  const textField = isTextField(target)
  return {
    typing: target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable,
    textField,
    fieldHasText: textField && target.value !== '',
    ownKeys: Boolean(
      target.closest('button.msg-open, [data-show-metrics], #inspector, .seq-scroll, .comp-scroll, #theme-menu'),
    ),
    arrows: Boolean(
      target === target.ownerDocument.body || target.closest('#scenario-nav') || target.matches('#scenario-title'),
    ),
    onControl: Boolean(target.closest('button, a, [role="slider"]')),
    inMenu: Boolean(target.closest('[role="menu"], [role^="menuitem"], .hidden-popover')),
  }
}

// Escape in a text field (#114; keys.ts)

/**
 * Where focus goes when Escape lets go of the empty text field [field], best first; keys.ts gives
 * it to the first that takes it. Never the page body: from the diagram's Find, the diagram's
 * scrollport, so the next Escape is the diagram's (it leaves Overview); from search, the shown
 * scenario's heading, else the selected list item, else the list's first. With none of them
 * (nothing is listed), the field keeps focus.
 */
export function fieldEscapeTargets(field: Element): HTMLElement[] {
  const card = field.closest('.seq-diagram')
  if (card) return [...card.querySelectorAll<HTMLElement>('.seq-scroll')].slice(0, 1)
  const doc = field.ownerDocument
  const candidates = [
    doc.querySelector<HTMLElement>('#main .scenario-head h2'),
    doc.querySelector<HTMLElement>('#scenario-nav [aria-current="true"]'),
    doc.querySelector<HTMLElement>('#scenario-nav button'),
  ]
  return [...new Set(candidates)].filter((el): el is HTMLElement => el !== null && el !== field)
}

// Clicks in the main column (chrome.ts)

/** What a click in the main column hit, in the order the listener checks them. */
export type MainClick =
  | { kind: 'jump'; scroll: HTMLElement; y: number }
  | { kind: 'close-panel'; button: HTMLButtonElement }
  | { kind: 'metrics'; scenarioId: string | undefined; section: string | undefined; chip: number | null }
  | { kind: 'error'; scenarioId: string | undefined }
  | { kind: 'message'; hit: SVGGElement; messageId: string }
  | null

/**
 * The control a click in the main column landed on. The listener takes a section jump first,
 * then gives a click on an arrow's button to the panel (delegateMessageOpen), then the rest.
 * A Metrics button whose view is open closes it, like any expanded control.
 */
export function mainClick(target: Element | null): MainClick {
  if (!target?.closest) return null
  const jump = target.closest<HTMLButtonElement>('[data-jump-y]')
  if (jump) {
    const scroll = jump.closest('.seq-diagram')?.querySelector<HTMLElement>('.seq-scroll')
    return scroll ? { kind: 'jump', scroll, y: Number(jump.dataset.jumpY) } : null
  }
  const expanded = target.closest<HTMLButtonElement>('.panel-btn[aria-expanded="true"]')
  if (expanded) return { kind: 'close-panel', button: expanded }
  const metrics = target.closest<HTMLButtonElement>('[data-show-metrics]')
  if (metrics) {
    // A timing chip opens Metrics too; which one, so Close can give it focus back.
    const chips = [...(metrics.closest('.scenario-card')?.querySelectorAll('.timing-chip') ?? [])]
    const chip = chips.indexOf(metrics)
    return {
      kind: 'metrics',
      scenarioId: metrics.dataset.showMetrics,
      section: metrics.dataset.metricsSection,
      chip: chip >= 0 ? chip : null,
    }
  }
  const error = target.closest<HTMLButtonElement>('[data-show-error]')
  if (error) return { kind: 'error', scenarioId: error.dataset.showError }
  const hit = target.closest<SVGGElement>('.message.has-data')
  const messageId = hit?.getAttribute('data-message-id')
  return hit && messageId ? { kind: 'message', hit, messageId } : null
}

// Closing the side panel (chrome.ts)

// Opening a report on the index page (nav.ts)

/**
 * The scenario a report opens at: the one the link names when the report has it, else its first
 * failure, else its first scenario. `wanted` is the linked one, or null.
 */
export function openingScenario(
  scenarios: readonly Scenario[],
  ref: HashRef | undefined,
): { selectedId: string | null; wanted: string | null } {
  const wanted = ref?.scenarioId && scenarios.some((s) => s.id === ref.scenarioId) ? ref.scenarioId : null
  return {
    wanted,
    selectedId: wanted ?? scenarios.find((s) => s.status === 'error')?.id ?? defaultScenarioId(scenarios),
  }
}
