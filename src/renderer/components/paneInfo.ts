import { formatChanges } from '../../shared/gitChanges'
import { formatAge, formatCost, formatPercent, gaugeStage } from '../../shared/statusLine'
import { formatTokens } from '../../shared/usage'
import { modelLetter } from '../../shared/opsFeed'
import { contextLevel } from '../../shared/contextWarning'
import type { PaneInfo } from '../derive'
import { h } from '../dom'
import { chargeBar } from './chargeBar'

export interface StripHandlers {
  title: string
  now: number
  onReviewFiles(): void
  onShowAgents(sessionId: string): void
  onOpenChanges(): void
  bridgeInstalled: boolean
  onEnableBridge(): void
}

function opsItems(info: PaneInfo, handlers: StripHandlers): HTMLElement[] {
  const ops = info.ops
  const items: HTMLElement[] = []
  if (ops?.plan) items.push(h('span', { class: 'info-plan', title: 'Plan progress' }, `▸ ${ops.plan.done}/${ops.plan.total}`))
  if (ops && ops.running.length > 0) {
    items.push(h('button', { class: 'link-quiet info-running', type: 'button', title: 'Show these agents in the Agents view', onClick: () => handlers.onShowAgents(ops.sessionId) }, `${ops.running.length} running`))
    items.push(
      h(
        'span',
        { class: 'info-letters', title: 'Models of the running agents' },
        ...ops.running.map((family) => h('span', { class: `agent-letter fam-${family}` }, modelLetter(family)))
      )
    )
  }
  return items
}

export function paneInfoStrip(info: PaneInfo, handlers: StripHandlers): HTMLElement[] {
  const items: HTMLElement[] = []
  if (info.model) {
    items.push(h('span', { class: `info-model fam-${info.model.family}`, title: 'Model' }, info.model.label))
  }
  if (info.contextPercent !== null) {
    items.push(
      h(
        'span', { class: 'info-context' },
        h('span', { class: 'info-label' }, 'ctx '),
        h('span',
          { class: `info-gauge stage-${gaugeStage(info.contextPercent)} ctx-${contextLevel(info.contextPercent)}`, title: 'Context window used' },
          chargeBar(info.contextPercent),
          formatPercent(info.contextPercent)
        )
      )
    )
  } else if (info.agent === 'claude') {
    items.push(
      handlers.bridgeInstalled
        ? h('span', { class: 'info-context unavailable', title: 'Waiting for Claude Code to report. Send a prompt and the context bar appears here.' }, 'ctx waiting')
        : h(
            'button',
            {
              class: 'link-quiet info-enable-bridge',
              type: 'button',
              title: 'Show context use and limits for Claude sessions. Asks before changing ~/.claude/settings.json.',
              onClick: handlers.onEnableBridge
            },
            'Turn on live info'
          )
    )
  }
  if (info.elapsed !== null) items.push(h('span', { class: 'info-elapsed', title: 'Session time' }, info.elapsed))
  if (info.tokens !== null) items.push(h('span', { class: 'info-tokens', title: 'Session tokens' }, `${formatTokens(info.tokens)} tokens`))
  if (info.costUsd !== null) items.push(h('span', { class: 'info-cost', title: 'Session cost' }, formatCost(info.costUsd)))
  if (info.changes) {
    const content =
      info.changes.files === 0
        ? [formatChanges(info.changes)]
        : [
            h('span', { class: 'add' }, `+${info.changes.added}`),
            ' ',
            h('span', { class: 'del' }, `−${info.changes.removed}`),
            h('span', { class: 'info-files' }, ` · ${info.changes.files} file${info.changes.files === 1 ? '' : 's'}`)
          ]
    items.push(
      h(
        'button',
        {
          class: 'info-changes',
          type: 'button',
          title: 'Review and commit changes',
          'aria-label': 'Review and commit changes',
          onClick: handlers.onOpenChanges
        },
        ...content
      )
    )
  }
  if (info.ageMs !== null) items.push(h('span', { class: 'info-age', title: 'Last activity' }, `${formatAge(info.ageMs)} ago`))
  if (info.agent === 'gemini' && info.geminiTools.length > 0) {
    const last = info.geminiTools[info.geminiTools.length - 1]
    items.push(h('span', { class: 'info-gemini-tool', title: `Last Gemini tool recorded at ${new Date(last.at).toLocaleTimeString()}` }, `tool ${last.name}`))
  }
  const ops = opsItems(info, handlers)
  const files = info.changes?.files ?? 0
  const review =
    files > 0 && info.agent !== 'shell'
      ? [h('span', { class: 'spacer' }), h('button', { class: 'link-quiet info-review', type: 'button', title: 'Review what this session changed', onClick: handlers.onReviewFiles }, `Review ${files} file${files === 1 ? '' : 's'}`)]
      : []
  return [...items, ...ops, ...review]
}
