import type { HighlightRule } from '../shared/highlights'
import { notifyAttribution } from '../shared/notifyContent'
import { api } from './api'
import { markNeedsYou } from './needsYou'
import { derivePanes } from './derive'
import { recordNotification } from './notificationHistory'
import { focusPaneFromNotification } from './actions'
import { store } from './state'

const BODY_MAX = 140

/** A highlight rule with a trigger matched a line: send a notification, or mark the session as needing the user. */
export function fireRuleTrigger(termId: string, rule: HighlightRule, line: string): void {
  const view = derivePanes(store.state).find((candidate) => candidate.pane.tabs.some((tab) => tab.id === termId))
  if (!view || !rule.trigger) return
  const paneId = view.pane.id
  if (rule.trigger === 'needs') {
    markNeedsYou(paneId)
    return
  }
  const body = line.trim().slice(0, BODY_MAX)
  api.notify({
    paneId,
    title: `${view.title}: "${rule.pattern}"`,
    body,
    attribution: notifyAttribution(view.project?.name, view.agent),
    sound: store.state.settings.sessionInfo.sound
  })
  recordNotification(`${view.title}: ${body}`, 'info', {
    label: 'Go to session',
    run: () => focusPaneFromNotification(paneId),
    valid: () => store.state.panes.some((pane) => pane.id === paneId)
  }, view.project?.name)
}
