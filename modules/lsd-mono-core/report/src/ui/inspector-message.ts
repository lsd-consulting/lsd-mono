// The side panel's message and error views (#103): a message's pills and its JSON payload,
// loaded when it is deferred; an error's headline, message and stack.
import type { MessageEvent } from '../types'
import { focusTargetAfterClose } from '../lib/diagram-a11y'
import { errorMetaHtml, messageMetaHtml } from './inspector-views'
import { NO_FOCUS_RETURN, type PanelShell, type PanelView } from './inspector-view'

export interface MessageView extends PanelView {
  open: (scenarioId: string, message: MessageEvent, focus: boolean) => void
}

export function bindMessageView(
  shell: PanelShell,
  loadPayload: (scenarioId: string, messageId: string) => Promise<unknown>,
): MessageView {
  const view: MessageView = {
    open(scenarioId, message, focus) {
      const token = shell.begin(view, { scenarioId, messageId: message.id, kind: 'message' }, 'JSON', focus)
      shell.json.revealWhenShown()
      shell.title.textContent = message.label
      shell.meta.innerHTML = messageMetaHtml(scenarioId, message)
      const payload = message.payloadId ? loadPayload(scenarioId, message.id) : Promise.resolve(message.data)
      shell.json.load(payload, token, () => {
        shell.lead.hidden = false
        shell.lead.textContent = 'Could not load the payload.'
      })
    },
    close() {},
    // Back to the arrow that opened it.
    focusReturn(invoker) {
      const messageId = focusTargetAfterClose(invoker?.messageId ?? null)
      if (!messageId || !invoker?.scenarioId) return NO_FOCUS_RETURN
      return { kind: 'message', scenarioId: invoker.scenarioId, messageId }
    },
  }
  return view
}

export interface ErrorView extends PanelView {
  open: (error: { status: string; headline: string; message: string; stack?: string }) => void
}

export function bindErrorView(shell: PanelShell): ErrorView {
  const view: ErrorView = {
    open(error) {
      const token = shell.begin(view, null, 'stack')
      shell.title.textContent = error.headline
      shell.meta.innerHTML = errorMetaHtml(error)
      shell.lead.hidden = false
      shell.lead.textContent = error.message
      if (error.stack) shell.json.loaded(error.stack, token)
      else shell.json.none()
    },
    close() {},
    // An error has no invoker; the scenario keeps focus where it is.
    focusReturn: () => NO_FOCUS_RETURN,
  }
  return view
}
