// Page-wide shortcuts in one table. It drives both onKey (keys.ts) and the help toast,
// so a key cannot be handled without being listed, or listed without being handled.

export type PageAction = 'search' | 'next' | 'prev' | 'diagram' | 'theme' | 'help' | 'close'

export interface KeyContext {
  /** Arrows act here: the page, the scenario list or the scenario heading. */
  arrows: boolean
  /** A button, link or slider has focus, so Enter presses it instead. */
  onControl: boolean
  /** A scenario is shown, so Enter has a diagram to go to. */
  hasScenario: boolean
  /** The one-character shortcuts (/ j k d ?) are on. A person can turn them off (WCAG 2.1.4). */
  singleKeys: boolean
}

type KeyEvent = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'> & { altKey?: boolean }

export interface KeyBinding {
  /** Help toast line, from 0. */
  line: number
  /** Help text; keys inside are written as <kbd>…</kbd>. */
  help: string
  /** Missing for keys handled elsewhere (diagram, Find), which are listed for help only. */
  action?: PageAction
  matches?: (e: KeyEvent, ctx: KeyContext) => boolean
}

/** A key typed alone: no Ctrl, Cmd or Alt. These are the shortcuts the toggle switches off. */
function alone(e: KeyEvent, ctx: KeyContext, key: string): boolean {
  return ctx.singleKeys && e.key === key && !e.metaKey && !e.ctrlKey && !e.altKey
}

export const KEY_BINDINGS: readonly KeyBinding[] = [
  {
    line: 0,
    help: '<kbd>/</kbd> search',
    action: 'search',
    matches: (e, ctx) => alone(e, ctx, '/') || (e.key === 'k' && (e.metaKey || e.ctrlKey)),
  },
  {
    line: 0,
    help: '<kbd>j</kbd>/<kbd>k</kbd> or <kbd>↓</kbd>/<kbd>↑</kbd> next/prev scenario',
    action: 'next',
    matches: (e, ctx) => alone(e, ctx, 'j') || (e.key === 'ArrowDown' && ctx.arrows),
  },
  {
    line: 0,
    help: '',
    action: 'prev',
    matches: (e, ctx) => alone(e, ctx, 'k') || (e.key === 'ArrowUp' && ctx.arrows),
  },
  {
    line: 0,
    help: '<kbd>Enter</kbd> go to its diagram',
    action: 'diagram',
    matches: (e, ctx) => e.key === 'Enter' && !ctx.onControl && ctx.hasScenario,
  },
  { line: 1, help: 'In a diagram, <kbd>↑</kbd>/<kbd>↓</kbd> move between messages' },
  { line: 1, help: '<kbd>Enter</kbd> opens the side panel' },
  {
    line: 2,
    help: 'In Find, <kbd>Enter</kbd>/<kbd>Shift</kbd>+<kbd>Enter</kbd> (or <kbd>F3</kbd>) next/previous match',
  },
  { line: 2, help: 'Find also searches payloads (<b>{}</b> in the field turns that off)' },
  {
    line: 3,
    help: '<kbd>d</kbd> theme (Auto follows the OS, dark, light, high contrast)',
    action: 'theme',
    matches: (e, ctx) => alone(e, ctx, 'd'),
  },
  { line: 3, help: '<kbd>?</kbd> help', action: 'help', matches: (e, ctx) => alone(e, ctx, '?') },
  { line: 3, help: '<kbd>Esc</kbd> close', action: 'close', matches: (e) => e.key === 'Escape' },
]

/** The first page action [e] triggers, or null. */
export function pageAction(e: KeyEvent, ctx: KeyContext): PageAction | null {
  for (const binding of KEY_BINDINGS) {
    if (binding.action && binding.matches?.(e, ctx)) return binding.action
  }
  return null
}

/** The help toast's lines, joined with <br/>. */
export function keyHelpHtml(): string {
  const lines: string[][] = []
  for (const binding of KEY_BINDINGS) {
    if (!binding.help) continue
    ;(lines[binding.line] ??= []).push(binding.help)
  }
  return lines.map((parts) => parts.join(' · ')).join('<br/>\n      ')
}
