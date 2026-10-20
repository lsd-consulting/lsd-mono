// Every keyboard shortcut in one table (#102). The router (router.ts) runs a binding's handler
// when it matches, scope by scope; the help toast and the single-keys label are drawn from the
// same entries. So a key cannot be handled without being listed, or listed without being handled.
import { zoomKeyAction } from './zoom-key-map'
import { findStepKey } from '../diagram/search-reveal'

/**
 * Who a key goes to, innermost first. The menu and the participant header keep their own
 * listeners for their own widget (arrows along a menu, along a header row) and stop the keys
 * they use; their entries here are for the help and the conflict test. The router takes the
 * rest, in ROUTED_SCOPES order: the keyboard help, a transient dialog like a menu (#112), then
 * the side panel, a diagram and the page.
 */
export type KeyScope = 'menu' | 'header' | 'dialog' | 'panel' | 'diagram' | 'page'
export const KEY_SCOPES: readonly KeyScope[] = ['menu', 'header', 'dialog', 'panel', 'diagram', 'page']
export type RoutedScope = 'dialog' | 'panel' | 'diagram' | 'page'
export const ROUTED_SCOPES: readonly RoutedScope[] = ['dialog', 'panel', 'diagram', 'page']

export interface KeyEvent {
  key: string
  code?: string
  shiftKey?: boolean
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  /** Held down: the key auto-repeats. */
  repeat?: boolean
}

/** The page: the scenario list, the toolbar, the help. */
export interface PageKeyContext {
  /** A text field has focus: keys type, and Escape leaves the field. */
  typing: boolean
  /** A control with keys of its own (an arrow, a panel button, the panel, a diagram, the theme menu): page keys keep off. */
  ownKeys: boolean
  /** Arrows act here: the page, the scenario list or the scenario heading. */
  arrows: boolean
  /** A button, link or slider has focus, so Enter presses it instead. */
  onControl: boolean
  /** An open menu or popover with keys of its own: ? keeps off, so one transient opens at a time. */
  inMenu: boolean
  /** A scenario is shown, so Enter has a diagram to go to. */
  hasScenario: boolean
  /** The one-character shortcuts (/ j k d ? + − 0 Shift+1) are on. A person can turn them off (WCAG 2.1.4). */
  singleKeys: boolean
}

/** The keyboard help. */
export interface DialogKeyContext {
  open: boolean
}

export interface PanelKeyContext {
  open: boolean
}

/** Where in a diagram card a key was pressed, and the card's state. */
export interface DiagramKeyContext {
  /**
   * find: the card's Find field. arrow: a message's button in the scrollport. scrollport: the
   * scrollport itself. link: another message drawn as a link. card: anything else in the card
   * that is not a text field or a menu (the toolbar, the participant header).
   */
  on: 'find' | 'arrow' | 'scrollport' | 'link' | 'card'
  /** The card's diagram is mounted, so the zoom keys work. */
  zoomable: boolean
  overview: boolean
  panelOpen: boolean
  singleKeys: boolean
  /** The focused message's id (arrow or link), if it has one. */
  messageId: string | null
  /** The card's scrollport. */
  scrollport: HTMLElement | null
  target: HTMLElement
}

/** The two widget scopes have no state of their own here. */
export type WidgetKeyContext = Record<string, never>

export interface ScopeContexts {
  menu: WidgetKeyContext
  header: WidgetKeyContext
  dialog: DialogKeyContext
  panel: PanelKeyContext
  diagram: DiagramKeyContext
  page: PageKeyContext
}

/** The help text of a binding. [kbdHtml] gives a binding's keys by id, so each key is written once. */
type Help = string | ((kbdHtml: (id: string) => string) => string)

interface Binding<S extends KeyScope> {
  id: string
  scope: S
  /** Help toast line, from 0. */
  line?: number
  /** Help text; keys inside are written as <kbd>…</kbd>. Missing: not in the help. */
  help?: Help
  /** This binding's keys as <kbd>…</kbd>, for help text that names them. */
  kbd?: string
  /** A one-character shortcut, which the single-keys switch turns off; listed in its label. */
  single?: boolean
  /** Missing for a note in the help that is not a key. */
  matches?: (e: KeyEvent, ctx: ScopeContexts[S]) => boolean
}

export type KeyBinding = { [S in KeyScope]: Binding<S> }[KeyScope]

const noMods = (e: KeyEvent) => !e.metaKey && !e.ctrlKey && !e.altKey

/**
 * Escape that closes one layer: one press, not held down (a held Escape would close the help, the
 * panel and Overview in turn), and without Ctrl, Cmd or Alt, like leaving Overview.
 */
const closingEscape = (e: KeyEvent) => e.key === 'Escape' && noMods(e) && !e.repeat

/** A key typed alone: no Ctrl, Cmd or Alt. These are the shortcuts the toggle switches off. */
function alone(e: KeyEvent, ctx: { singleKeys: boolean }, key: string): boolean {
  return ctx.singleKeys && e.key === key && noMods(e)
}

/** Page keys other than Escape keep off text fields and controls with keys of their own. */
const free = (c: PageKeyContext) => !c.typing && !c.ownKeys

const onMessages = (c: DiagramKeyContext) => c.on === 'arrow' || c.on === 'scrollport'
const zoomsHere = (c: DiagramKeyContext) => c.zoomable && c.on !== 'find'
const zoomKey = (e: KeyEvent, c: DiagramKeyContext) =>
  zoomsHere(c)
    ? zoomKeyAction(event(e), { singleKeys: c.singleKeys, overview: c.overview, panelOpen: c.panelOpen })
    : null
/** In Overview, Enter on a message zooms to it instead of opening it. */
const zoomsToMessage = (e: KeyEvent, c: DiagramKeyContext) =>
  c.on === 'arrow' && c.zoomable && c.overview && c.messageId !== null && e.key === 'Enter' && !e.shiftKey && noMods(e)
const activates = (e: KeyEvent) => e.key === 'Enter' || e.key === ' '

/** The full event shape the diagram's key readers take. */
function event(e: KeyEvent) {
  return {
    key: e.key,
    code: e.code ?? '',
    shiftKey: Boolean(e.shiftKey),
    metaKey: Boolean(e.metaKey),
    ctrlKey: Boolean(e.ctrlKey),
    altKey: Boolean(e.altKey),
    repeat: Boolean(e.repeat),
  }
}

export const KEY_BINDINGS: readonly KeyBinding[] = [
  // The side panel.
  { id: 'close-panel', scope: 'panel', matches: (e, c) => closingEscape(e) && c.open },

  // A diagram card.
  {
    id: 'move',
    scope: 'diagram',
    line: 1,
    help: 'In a diagram, <kbd>↑</kbd>/<kbd>↓</kbd> move between messages',
    matches: (e, c) => onMessages(c) && (e.key === 'ArrowUp' || e.key === 'ArrowDown'),
  },
  {
    id: 'open',
    scope: 'diagram',
    line: 1,
    help: '<kbd>Enter</kbd> opens the side panel',
    matches: (e, c) => onMessages(c) && activates(e) && !zoomsToMessage(e, c),
  },
  // The participant menu and the theme menu (their own listeners). Here, after a diagram's
  // Enter, so the help lists the header keys after the diagram's.
  {
    id: 'menu-move',
    scope: 'menu',
    matches: (e) => ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key),
  },
  { id: 'menu-close', scope: 'menu', matches: (e) => e.key === 'Escape' || e.key === 'Tab' },
  // A participant header's Hide and More (head-actions.ts).
  {
    id: 'header-move',
    scope: 'header',
    line: 1,
    help: 'In participant headers, <kbd>←</kbd>/<kbd>→</kbd> move between Hide and More, <kbd>Shift</kbd>+<kbd>F10</kbd> more actions',
    matches: (e) => ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key),
  },
  {
    id: 'header-menu',
    scope: 'header',
    matches: (e) => e.key === 'ContextMenu' || (e.key === 'F10' && Boolean(e.shiftKey)),
  },
  { id: 'header-hide', scope: 'header', matches: (e) => e.key === 'Delete' || e.key === 'Backspace' },

  { id: 'open-link', scope: 'diagram', matches: (e, c) => c.on === 'link' && activates(e) },
  { id: 'zoom-to-message', scope: 'diagram', matches: (e, c) => zoomsToMessage(e, c) },
  {
    id: 'find-step',
    scope: 'diagram',
    line: 2,
    help: 'In Find, <kbd>Enter</kbd>/<kbd>Shift</kbd>+<kbd>Enter</kbd> (or <kbd>F3</kbd>) next/previous match',
    matches: (e, c) => c.on === 'find' && findStepKey(event(e)) !== null,
  },
  {
    id: 'find-payloads',
    scope: 'diagram',
    line: 2,
    help: 'Find also searches payloads (<b>{}</b> in the field turns that off)',
  },
  {
    id: 'zoom-in',
    scope: 'diagram',
    line: 4,
    kbd: '<kbd>+</kbd>',
    single: true,
    help: (kbdHtml) =>
      `In a diagram, ${kbdHtml('zoom-in')}/${kbdHtml('zoom-out')} zoom, ${kbdHtml('zoom-reset')} default zoom, ${kbdHtml('overview')} overview (${kbdHtml('leave-overview')} leaves it)`,
    matches: (e, c) => zoomKey(e, c) === 'in',
  },
  { id: 'zoom-out', scope: 'diagram', kbd: '<kbd>−</kbd>', single: true, matches: (e, c) => zoomKey(e, c) === 'out' },
  {
    id: 'zoom-reset',
    scope: 'diagram',
    kbd: '<kbd>0</kbd>',
    single: true,
    matches: (e, c) => zoomKey(e, c) === 'reset',
  },
  {
    id: 'overview',
    scope: 'diagram',
    kbd: '<kbd>Shift</kbd>+<kbd>1</kbd>',
    single: true,
    matches: (e, c) => zoomKey(e, c) === 'overview',
  },
  { id: 'leave-overview', scope: 'diagram', kbd: '<kbd>Esc</kbd>', matches: (e, c) => zoomKey(e, c) === 'leave' },
  {
    id: 'scroll-sideways',
    scope: 'diagram',
    line: 4,
    help: 'In a wide diagram, <kbd>Shift</kbd>+<kbd>←</kbd>/<kbd>→</kbd> scroll a screen sideways, <kbd>Home</kbd>/<kbd>End</kbd> go to its edges',
    matches: (e, c) =>
      onMessages(c) &&
      noMods(e) &&
      (e.shiftKey ? e.key === 'ArrowLeft' || e.key === 'ArrowRight' : e.key === 'Home' || e.key === 'End'),
  },

  // The page.
  {
    id: 'search',
    scope: 'page',
    line: 0,
    kbd: '<kbd>/</kbd>',
    single: true,
    help: (kbdHtml) => `${kbdHtml('search')} search`,
    matches: (e, c) => free(c) && (alone(e, c, '/') || (e.key === 'k' && Boolean(e.metaKey || e.ctrlKey))),
  },
  {
    id: 'next',
    scope: 'page',
    line: 0,
    kbd: '<kbd>j</kbd>',
    single: true,
    help: (kbdHtml) => `${kbdHtml('next')}/${kbdHtml('prev')} or <kbd>↓</kbd>/<kbd>↑</kbd> next/prev scenario`,
    matches: (e, c) => free(c) && (alone(e, c, 'j') || (e.key === 'ArrowDown' && c.arrows)),
  },
  {
    id: 'prev',
    scope: 'page',
    kbd: '<kbd>k</kbd>',
    single: true,
    matches: (e, c) => free(c) && (alone(e, c, 'k') || (e.key === 'ArrowUp' && c.arrows)),
  },
  {
    id: 'diagram',
    scope: 'page',
    line: 0,
    help: '<kbd>Enter</kbd> go to its diagram',
    matches: (e, c) => free(c) && e.key === 'Enter' && !c.onControl && c.hasScenario,
  },
  {
    id: 'theme',
    scope: 'page',
    line: 3,
    kbd: '<kbd>d</kbd>',
    single: true,
    help: (kbdHtml) => `${kbdHtml('theme')} theme (Auto follows the OS, light, dark, high contrast)`,
    matches: (e, c) => free(c) && alone(e, c, 'd'),
  },
  {
    id: 'help',
    scope: 'page',
    line: 3,
    kbd: '<kbd>?</kbd>',
    single: true,
    help: (kbdHtml) => `${kbdHtml('help')} help`,
    // From anywhere, an arrow and the side panel too: only text fields and open menus keep it.
    matches: (e, c) => !c.typing && !c.inMenu && alone(e, c, '?'),
  },
  // Escape closes the innermost open thing: a menu, the help, the side panel, Overview. It is
  // listed here so the help shows it after ?. Then a text field lets go.
  {
    id: 'close-help',
    scope: 'dialog',
    line: 3,
    help: '<kbd>Esc</kbd> close',
    matches: (e, c) => closingEscape(e) && c.open,
  },
  { id: 'blur', scope: 'page', matches: (e, c) => e.key === 'Escape' && c.typing },
]

/** The binding with [id]. Throws for an id the table does not have. */
export function bindingById(id: string): KeyBinding {
  const binding = KEY_BINDINGS.find((b) => b.id === id)
  if (!binding) throw new Error(`no key binding ${id}`)
  return binding
}

/** The bindings in [scope] that [e] matches, in table order. */
export function matchingBindings<S extends KeyScope>(scope: S, e: KeyEvent, ctx: ScopeContexts[S]): KeyBinding[] {
  return KEY_BINDINGS.filter((b) => b.scope === scope && (b as Binding<S>).matches?.(e, ctx) === true)
}

const kbdOf = (id: string) => {
  const kbd = bindingById(id).kbd
  if (!kbd) throw new Error(`key binding ${id} has no kbd`)
  return kbd
}

/** The help toast's lines, joined with <br/>. */
export function keyHelpHtml(): string {
  const lines: string[][] = []
  for (const binding of KEY_BINDINGS) {
    if (!binding.help || binding.line === undefined) continue
    const text = typeof binding.help === 'string' ? binding.help : binding.help(kbdOf)
    ;(lines[binding.line] ??= []).push(text)
  }
  return lines
    .filter(Boolean)
    .map((parts) => parts.join(' · '))
    .join('<br/>\n      ')
}

/** The single-keys switch's label: the page's one-character keys, then a diagram's. */
export function singleKeysLabelHtml(): string {
  const singles = (scope: KeyScope) =>
    KEY_BINDINGS.filter((b) => b.scope === scope && b.single)
      .map((b) => kbdOf(b.id))
      .join(' ')
  return `Single-key shortcuts (${singles('page')}, and ${singles('diagram')} in a diagram)`
}
