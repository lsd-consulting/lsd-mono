/** What the search's live region says (#162): "2 of 5 scenarios", or "5 scenarios" once cleared. */
export function searchStatusText(shown: number, total: number, searching: boolean): string {
  const noun = total === 1 ? 'scenario' : 'scenarios'
  return searching ? `${shown} of ${total} ${noun}` : `${total} ${noun}`
}
