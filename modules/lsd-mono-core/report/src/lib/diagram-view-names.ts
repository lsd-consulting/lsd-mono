// The two views of a scenario's diagram (#105) and the words that go with each.
export type DiagramViewName = 'sequence' | 'components'

export function diagramViewHeading(view: DiagramViewName): string {
  return view === 'components' ? 'Component diagram' : 'Sequence diagram'
}

export function diagramViewHint(view: DiagramViewName): string {
  return view === 'components'
    ? 'Pick a link to list its messages'
    : 'Zoom and overview · hide participants · find labels · ↑↓ between messages'
}
