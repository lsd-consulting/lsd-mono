// The two views of a scenario's diagram (#105) and the words that go with each.
export type DiagramViewName = 'sequence' | 'components'

export function diagramViewHeading(view: DiagramViewName): string {
  return view === 'components' ? 'Component diagram' : 'Sequence diagram'
}

export function diagramViewHint(view: DiagramViewName): string {
  return view === 'components'
    ? 'Zoom and overview (a click there zooms in) · links list their messages'
    : 'Zoom and overview · hide participants · find labels · ↑↓ between messages'
}
