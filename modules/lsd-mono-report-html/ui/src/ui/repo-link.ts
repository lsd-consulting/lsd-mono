// The report's own links to the lsd-mono repository: the logo in the top bar and the version in
// the hero. Plain links, so they need nothing loaded and work in the offline single-file report;
// they open in a new tab so the report stays where it was.
import { escapeAttr } from '../lib/escape'

export const REPO_URL = 'https://github.com/lsd-consulting/lsd-mono'
export const REPO_LINK_NAME = 'lsd-mono on GitHub'

/** The attributes of a link to the repository, named [name] for screen readers. */
export function repoLinkAttrsHtml(name: string = REPO_LINK_NAME): string {
  return `href="${REPO_URL}" target="_blank" rel="noopener noreferrer" title="${escapeAttr(REPO_LINK_NAME)}" aria-label="${escapeAttr(name)}"`
}
