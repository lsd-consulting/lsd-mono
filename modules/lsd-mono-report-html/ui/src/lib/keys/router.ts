// The one document keydown listener for the page, the side panel and the diagrams (#102).
// Handlers register against KEY_BINDINGS entries. A key goes to the routed scopes in order
// (side panel, diagram, page); in each, the binding it matches runs its handler. A handler that
// returns false did not use the key, and the key goes on. Otherwise the key is used: its default
// is prevented and nothing else runs. A key a widget has already used (defaultPrevented) is left
// alone, so one key does one thing.
import {
  bindingById,
  KEY_BINDINGS,
  matchingBindings,
  ROUTED_SCOPES,
  type RoutedScope,
  type ScopeContexts,
} from './bindings'

export type KeyHandler<S extends RoutedScope> = (e: KeyboardEvent, ctx: ScopeContexts[S]) => boolean | void

/** The routed scopes' state for a key; a scope that does not apply (focus outside any diagram) is null. */
export type KeyContexts = { [S in RoutedScope]: ScopeContexts[S] | null }

export interface KeyRouter {
  /** Run [handler] for the binding [id] in [scope]. Each binding takes one handler. */
  on<S extends RoutedScope>(scope: S, id: string, handler: KeyHandler<S>): void
  /** Route one key. True when a handler used it. */
  dispatch(e: KeyboardEvent): boolean
  /** Ids of routed bindings with keys that have no handler yet. */
  unhandled(): string[]
  /** Listen on [doc]. */
  listen(doc: Document): void
}

export function createKeyRouter(read: (e: KeyboardEvent) => KeyContexts): KeyRouter {
  const handlers = new Map<string, KeyHandler<RoutedScope>>()

  function dispatch(e: KeyboardEvent): boolean {
    if (e.defaultPrevented) return false
    const contexts = read(e)
    for (const scope of ROUTED_SCOPES) {
      const ctx = contexts[scope]
      if (!ctx) continue
      for (const binding of matchingBindings(scope, e, ctx)) {
        const handler = handlers.get(binding.id)
        if (!handler || handler(e, ctx) === false) continue
        e.preventDefault()
        return true
      }
    }
    return false
  }

  return {
    on(scope, id, handler) {
      const binding = bindingById(id)
      if (binding.scope !== scope) throw new Error(`key binding ${id} is in ${binding.scope}, not ${scope}`)
      if (!binding.matches) throw new Error(`key binding ${id} is a help note, with no keys`)
      if (handlers.has(id)) throw new Error(`key binding ${id} already has a handler`)
      handlers.set(id, handler as KeyHandler<RoutedScope>)
    },
    dispatch,
    // Help notes have no keys and take no handler.
    unhandled: () =>
      KEY_BINDINGS.filter(
        (b) => ROUTED_SCOPES.includes(b.scope as RoutedScope) && b.matches && !handlers.has(b.id),
      ).map((b) => b.id),
    listen(doc) {
      doc.addEventListener('keydown', (e) => dispatch(e))
    },
  }
}
