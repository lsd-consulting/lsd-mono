// The media conditions the report reacts to, in one place. The CSS uses only these two widths:
//   STACKED_MAX_PX (860, and 861 as its min-width counterpart): the side panel stacks under the report.
//   PHONE_MAX_PX (560): the phone layout (top bar, toolbar, chips, waterfall rows).
// styles/breakpoints.test.ts fails on any other width in an @media rule.

/** At and below this width the side panel stacks under the report at full width (app.css). */
export const STACKED_MAX_PX = 860

function matches(query: string): boolean {
  return typeof matchMedia === 'function' && matchMedia(query).matches
}

export function prefersReducedMotion(): boolean {
  return matches('(prefers-reduced-motion: reduce)')
}

/** How to scroll: a jump when the user asks for reduced motion, else smooth. */
export function scrollBehavior(): 'auto' | 'smooth' {
  return prefersReducedMotion() ? 'auto' : 'smooth'
}

/** The narrow layout, where the side panel sits inline below the report. */
export function isStacked(): boolean {
  return matches(`(max-width: ${STACKED_MAX_PX}px)`)
}

/** At and below this width the top bar and the diagram toolbar wrap, and only their last row sticks (app.css, diagram.css). */
export const PHONE_MAX_PX = 560

/** The phone layout. */
export function isPhone(): boolean {
  return matches(`(max-width: ${PHONE_MAX_PX}px)`)
}

/** A touch screen as the main pointer (a phone or tablet). */
export function isCoarsePointer(): boolean {
  return matches('(pointer: coarse)')
}
