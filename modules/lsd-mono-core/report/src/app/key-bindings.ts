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
}

export interface KeyBinding {
  /** Help toast line, from 0. */
  line: number
  /** Help text; keys inside are written as <kbd>…</kbd>. */
  help: string
  /** Missing for keys handled elsewhere (diagram, Find), which are listed for help only. */
  action?: PageAction
  matches?: (e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'>, ctx: KeyContext) => boolean
}

export const KEY_BINDINGS: readonly KeyBinding[] = [
  {
    line: 0,
    help: '<kbd>/</kbd> search',
    action: 'search',
    matches: (e) => e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey)),
  },
  {
    line: 0,
    help: '<kbd>j</kbd>/<kbd>k</kbd> or <kbd>↓</kbd>/<kbd>↑</kbd> next/prev scenario',
    action: 'next',
    matches: (e, ctx) => e.key === 'j' || (e.key === 'ArrowDown' && ctx.arrows),
  },
  {
    line: 0,
    help: '',
    action: 'prev',
    matches: (e, ctx) => e.key === 'k' || (e.key === 'ArrowUp' && ctx.arrows),
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
    matches: (e) => e.key === 'd',
  },
  { line: 3, help: '<kbd>?</kbd> help', action: 'help', matches: (e) => e.key === '?' },
  { line: 3, help: '<kbd>Esc</kbd> close', action: 'close', matches: (e) => e.key === 'Escape' },
]

/** The first page action [e] triggers, or null. */
export function pageAction(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'>, ctx: KeyContext): PageAction | null {
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
