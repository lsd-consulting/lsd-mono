/**
 * The scenario that was open when a search began (#162). Search still shows the first match as
 * you type; clearing the search (emptying the box, Esc, or the × button) goes back to this one.
 * Choosing a scenario yourself while searching keeps your choice instead.
 */
let origin: string | null = null

/** Called on every change of the query, with the query before and after and the scenario now open. */
export function searchOriginAfter(before: string, after: string, openId: string | null): string | null {
  const was = before.trim() !== ''
  const is = after.trim() !== ''
  if (!was && is) origin = openId
  if (was && !is) {
    const back = origin
    origin = null
    return back
  }
  return null
}

/** A scenario chosen by hand while searching replaces the one to go back to. */
export function forgetSearchOrigin(): void {
  origin = null
}
