// What the page's listeners decide, without doing it (#99): each function reads the event and
// the state it is given and names the action, so the listeners in keys.ts, chrome.ts and nav.ts
// only carry it out, and the decisions get unit tests that run in seconds.
import { focusTargetAfterClose } from '../lib/diagram-a11y'
import type { HashRef } from '../lib/report-hash'
import { findStepKey } from '../lib/diagram/search-reveal'
import type { Scenario } from '../types'
import type { InspectorInvoker } from '../ui/inspector'
import { defaultScenarioId } from '../ui/selection'
import { pageAction, type PageAction } from './key-bindings'

// Page keys (keys.ts)

/** What a key's target says about the page shortcuts, read from the DOM. */
export interface KeyTarget {
  /** A text field has focus: keys type, and Escape leaves the field. */
  typing: boolean
  /** A control with keys of its own (an arrow, a panel button, the panel, a diagram): page keys keep off. */
  ownKeys: boolean
  /** The arrow keys move the selection here: on the list, the page or the scenario heading. */
  arrows: boolean
  /** A button, link or slider, where Enter presses it. */
  onControl: boolean
}

export function keyTarget(target: HTMLElement): KeyTarget {
  return {
    typing: target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable,
    ownKeys: Boolean(
      target.closest('button.msg-open, [data-show-components], [data-show-metrics], #inspector, .seq-scroll'),
    ),
    arrows: Boolean(
      target === target.ownerDocument.body || target.closest('#scenario-nav') || target.matches('#scenario-title'),
    ),
    onControl: Boolean(target.closest('button, a, [role="slider"]')),
  }
}

/** The page state a page key depends on. */
export interface PageKeyState {
  inspectorOpen: boolean
  helpOpen: boolean
  hasScenario: boolean
  singleKeys: boolean
}

/** What a page key does: close the help, leave a text field, run a page action, or nothing. */
export type PageKeyIntent = 'close-help' | 'blur' | Exclude<PageAction, 'close'> | null

export function pageKeyIntent(
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'> & { altKey?: boolean },
  target: KeyTarget,
  state: PageKeyState,
): PageKeyIntent {
  if (e.key === 'Escape') {
    // The side panel closes itself first; then the help; then a text field lets go.
    if (state.inspectorOpen) return null
    if (state.helpOpen) return 'close-help'
    return target.typing ? 'blur' : null
  }
  if (target.typing || target.ownKeys) return null
  const action = pageAction(e, {
    arrows: target.arrows,
    onControl: target.onControl,
    hasScenario: state.hasScenario,
    singleKeys: state.singleKeys,
  })
  return !action || action === 'close' ? null : action
}

// Clicks in the main column (chrome.ts)

/** What a click in the main column hit, in the order the listener checks them. */
export type MainClick =
  | { kind: 'jump'; scroll: HTMLElement; y: number }
  | { kind: 'close-panel'; button: HTMLButtonElement }
  | { kind: 'components'; scenarioId: string | undefined }
  | { kind: 'metrics'; scenarioId: string | undefined; section: string | undefined; chip: number | null }
  | { kind: 'error'; scenarioId: string | undefined }
  | { kind: 'message'; hit: SVGGElement; messageId: string }
  | null

/**
 * The control a click in the main column landed on. The listener takes a section jump first,
 * then gives a click on an arrow's button to the panel (delegateMessageOpen), then the rest.
 * A Metrics or Component diagram button whose view is open closes it, like any expanded control.
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
  const components = target.closest<HTMLButtonElement>('[data-show-components]')
  if (components) return { kind: 'components', scenarioId: components.dataset.showComponents }
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

// Keys in the main column (chrome.ts), after the zoom keys

export type MainKey =
  | { kind: 'find-step'; input: HTMLInputElement; step: 1 | -1 }
  | { kind: 'diagram'; scroll: HTMLElement; openBtn: HTMLButtonElement | null }
  | { kind: 'open-message'; hit: SVGGElement; messageId: string | null }
  | null

/**
 * Where a key in the main column goes: a step key in a diagram's Find box steps the matches;
 * a key on a diagram or one of its arrows moves along the arrows; Enter or Space on an arrow
 * drawn as a link opens it.
 */
export function mainKey(
  ev: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey'>,
  target: Element | null,
): MainKey {
  const step = target?.matches('[data-diagram-find]') ? findStepKey(ev) : null
  if (step) return { kind: 'find-step', input: target as HTMLInputElement, step }
  const scroll = target?.closest?.<HTMLElement>('.seq-scroll')
  const openBtn = target?.closest?.<HTMLButtonElement>('button.msg-open') ?? null
  if (scroll && (openBtn || target === scroll)) return { kind: 'diagram', scroll, openBtn }
  const hit = target?.closest?.<SVGGElement>('.message.has-data')
  if (!hit || (ev.key !== 'Enter' && ev.key !== ' ')) return null
  return { kind: 'open-message', hit, messageId: hit.getAttribute('data-message-id') }
}

// Closing the side panel (chrome.ts)

/** Where focus goes when the side panel closes. */
export type CloseFocus =
  | { kind: 'none' }
  /** Back to the scenario card's toolbar button, or to the timing chip [chip] when one opened Metrics. */
  | { kind: 'button'; scenarioId: string; selector: string; chip: number | null }
  | { kind: 'message'; scenarioId: string; messageId: string }

export function closeFocus(
  opened: InspectorInvoker | null,
  switchingScenario: boolean,
  metricsChip: number | null,
): CloseFocus {
  // Another scenario is about to show: it decides focus.
  if (switchingScenario) return { kind: 'none' }
  if (opened?.kind === 'components' || opened?.kind === 'metrics') {
    const metrics = opened.kind === 'metrics'
    return {
      kind: 'button',
      scenarioId: opened.scenarioId,
      selector: `.seq-toolbar ${metrics ? '[data-show-metrics]' : '[data-show-components]'}`,
      chip: metrics ? metricsChip : null,
    }
  }
  const messageId = focusTargetAfterClose(opened?.messageId ?? null)
  if (!messageId || !opened?.scenarioId) return { kind: 'none' }
  return { kind: 'message', scenarioId: opened.scenarioId, messageId }
}

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
