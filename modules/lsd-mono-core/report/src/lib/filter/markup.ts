import type { Participant } from '../../types'
import { escapeAttr, escapeHtml } from '../escape'
import { isCoarsePointer } from '../media'

// The participant filter's markup and pure helpers (#8, #101), built from plain data.
/**
 * Participant filter (#8). Each participant header offers Hide (×) and More (⋯)
 * buttons, shown on hover, keyboard focus, or a tap on touch screens. There is
 * one set of them, moved onto the header in use (#62), so a 100-participant
 * header is not ten nodes per participant.
 * The toolbar shows a chip only while something is hidden; it opens a list of
 * the hidden participants. Right-click, long-press, ⋯, or the context-menu key
 * on a header offers "Hide all but this one".
 *
 * Markup is built here from plain data; the diagram owns the hidden set and
 * redraws through [FilterHost].
 */

/** One header slot, in display pixels inside the sticky header. */
export interface HeadSlot {
  id: string
  name: string
  /** Shape kind, for the slot's tooltip ("Customer, actor"). */
  typeLabel: string
  left: number
  width: number
  /** Left of the button pill inside the slot: centred on the lifeline, kept inside the header. */
  pillX: number
}

/** Drawn width of the Hide and More pill (two 24 px buttons, gap, padding, border). */
export const PILL_W = 54
/** The pill on a touch screen: two 44 px buttons (TOUCH_HIT_CSS), as participant-filter.css draws it there (touch-sizes.test.ts keeps them in step). */
export const PILL_W_TOUCH = 94

export function participantName(p: Participant): string {
  return p.alias ?? p.name
}

/** Hidden participants in diagram order. */
export function hiddenInOrder(participants: Participant[], hidden: ReadonlySet<string>): Participant[] {
  return participants.filter((p) => hidden.has(p.id))
}

/** The hidden set for "Hide all but this one". */
export function allBut(participants: Participant[], keep: string): Set<string> {
  return new Set(participants.filter((p) => p.id !== keep).map((p) => p.id))
}

function hiddenChipText(count: number): string {
  return `${count} hidden`
}

/**
 * Header slots split the header at the midpoints between lifelines, so every
 * point of the header belongs to exactly one participant. The outer slots reach
 * the header's edges.
 */
export function headSlots(
  visible: { id: string; name: string; typeLabel: string; x: number }[],
  headerWidth: number,
): HeadSlot[] {
  const pillW = isCoarsePointer() ? PILL_W_TOUCH : PILL_W
  return visible.map((p, i) => {
    const prev = visible[i - 1]
    const next = visible[i + 1]
    const left = prev ? (prev.x + p.x) / 2 : 0
    const right = next ? (p.x + next.x) / 2 : headerWidth
    // A pill past the header's edge would widen the scroll area and undo a fit.
    const pillLeft = Math.max(0, Math.min(p.x - pillW / 2, headerWidth - pillW))
    return {
      id: p.id,
      name: p.name,
      typeLabel: p.typeLabel,
      left,
      width: Math.max(0, right - left),
      pillX: pillLeft - left,
    }
  })
}

/**
 * The header's slots, and the one set of action buttons on the slot named by [focusKey] (or
 * the first). That set is the row's roving tab stop: the button named by [focusKey] (or Hide)
 * has tabindex 0. head-actions.ts moves it onto whichever header is in use.
 */
export function headActionsHtml(slots: HeadSlot[], height: number, focusKey: string | null): string {
  if (!slots.length) return ''
  const keys = slots.flatMap((s) => [`hide:${s.id}`, `more:${s.id}`])
  const active = focusKey && keys.includes(focusKey) ? focusKey : keys[0]
  const [kind, ...rest] = active.split(':')
  const activeId = rest.join(':')
  const heads = slots
    .map((s) => {
      const actions = s.id === activeId ? headActionButtonsHtml(s.id, s.name, kind === 'more' ? 'more' : 'hide') : ''
      return `<div class="participant-head" data-participant-head="${escapeAttr(s.id)}" data-name="${escapeAttr(s.name)}" title="${escapeAttr(`${s.name}, ${s.typeLabel}`)}" style="${headSlotStyle(s, height)}">${actions}</div>`
    })
    .join('')
  const compact = isCompactHeader(height) ? ' data-compact' : ''
  return `<div class="participant-heads" role="toolbar" aria-label="Participants: ← and → move between Hide and More buttons, Shift+F10 for more actions"${compact}>${heads}</div>`
}

/** A header slot's place and size, as its style attribute: what a zoom changes. */
export function headSlotStyle(slot: HeadSlot, height: number): string {
  return `left:${round(slot.left)}px;width:${round(slot.width)}px;height:${round(height)}px;--pill-x:${round(slot.pillX)}px`
}

/**
 * A header drawn small (a fitted wide diagram, a phone) puts the buttons under it, so they do not
 * cover the name of the participant they act on.
 */
export function isCompactHeader(height: number): boolean {
  return height < COMPACT_HEADER_PX
}

/** Hide and More for participant [id], with the tab stop on [tabStop]. */
export function headActionButtonsHtml(id: string, name: string, tabStop: 'hide' | 'more'): string {
  const attrId = escapeAttr(id)
  const attrName = escapeAttr(name)
  const tab = (kind: string) => (kind === tabStop ? '0' : '-1')
  return `<span class="participant-head-actions"><button type="button" class="participant-hide" data-hide-participant="${attrId}" aria-label="Hide ${attrName}" aria-keyshortcuts="Shift+F10" tabindex="${tab('hide')}">${CROSS_SVG}</button><button type="button" class="participant-more" data-participant-menu="${attrId}" aria-label="More actions for ${attrName}" aria-haspopup="menu" aria-expanded="false" tabindex="${tab('more')}">${DOTS_SVG}</button></span>`
}

/** Below this drawn header height the buttons sit under the header, not on it. */
export const COMPACT_HEADER_PX = 44

/** Chip and its popover. Empty while nothing is hidden, so the toolbar shows nothing. */
export function hiddenFilterHtml(scenarioId: string, hidden: Participant[], open: boolean): string {
  if (!hidden.length) return ''
  const popId = `hidden-pop-${escapeAttr(scenarioId)}`
  const items = hidden
    .map((p) => {
      const name = participantName(p)
      return `<li><span class="hidden-name">${escapeHtml(name)}</span><button type="button" data-show-participant="${escapeAttr(p.id)}" aria-label="Show ${escapeAttr(name)}">Show</button></li>`
    })
    .join('')
  const text = hiddenChipText(hidden.length)
  return `<button type="button" class="hidden-chip" data-hidden-chip aria-haspopup="dialog" aria-expanded="${open}" aria-controls="${popId}" aria-label="${escapeAttr(`${text} participant${hidden.length === 1 ? '' : 's'}`)}">${escapeHtml(text)}</button><div class="hidden-popover" id="${popId}" role="dialog" aria-label="Hidden participants"${open ? '' : ' hidden'}><ul>${items}</ul><button type="button" class="hidden-show-all" data-show-all>Show all</button></div>`
}

export interface MenuState {
  name: string
  /** False when this is the only participant still shown. */
  canHideOthers: boolean
  anyHidden: boolean
}

/** Context menu for one participant. Disabled items stay in the list, marked aria-disabled. */
export function participantMenuHtml(state: MenuState): string {
  const item = (action: string, label: string, enabled: boolean) =>
    `<button type="button" role="menuitem" tabindex="-1" data-menu-action="${escapeAttr(action)}"${enabled ? '' : ' aria-disabled="true"'}>${escapeHtml(label)}</button>`
  return [
    item('only', `Hide all but ${state.name}`, state.canHideOthers),
    item('hide', `Hide ${state.name}`, true),
    item('show-all', 'Show all', state.anyHidden),
  ].join('')
}

/** Live-region text after a change. */
export function filterStatusText(change: string, hiddenCount: number): string {
  return hiddenCount ? `${change}. ${hiddenChipText(hiddenCount)}.` : `${change}. All participants shown.`
}

const CROSS_SVG =
  '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false"><path d="M2.5 2.5 L9.5 9.5 M9.5 2.5 L2.5 9.5"/></svg>'
const DOTS_SVG =
  '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false"><circle cx="2" cy="6" r="1.3"/><circle cx="6" cy="6" r="1.3"/><circle cx="10" cy="6" r="1.3"/></svg>'

function round(n: number): number {
  return Math.round(n * 10) / 10
}

/** What the diagram does when the filter changes the hidden set. */
export interface FilterHost {
  participants: () => Participant[]
  hidden: () => ReadonlySet<string>
  /** Replace the hidden set and redraw the header, rows, chip and fit. */
  setHidden: (next: Set<string>) => void
}
