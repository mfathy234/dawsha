import { formatChanges } from '../../shared/gitChanges'
import { formatAge, formatCost, formatPercent, gaugeStage } from '../../shared/statusLine'
import { formatTokens } from '../../shared/usage'
import { modelLetter } from '../../shared/opsFeed'
import { contextLevel } from '../../shared/contextWarning'
import type { PaneInfo } from '../derive'
import { h, icon } from '../dom'
import { chargeBar } from './chargeBar'

export interface StripHandlers {
  title: string
  now: number
  onToggleAgents(): void
  onOpenChanges(): void
  bridgeInstalled: boolean
  onEnableBridge(): void
}

const ACTIVITY_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>'

function opsItems(info: PaneInfo, handlers: StripHandlers): HTMLElement[] {
  const ops = info.ops
  const items: HTMLElement[] = []
  if (ops?.plan) items.push(h('span', { class: 'info-plan', title: 'Plan progress' }, `▸ ${ops.plan.done}/${ops.plan.total}`))
  if (ops && ops.running.length > 0) {
    items.push(h('span', { class: 'info-running', title: 'Running agents' }, `${ops.running.length} running`))
    items.push(
      h(
        'span',
        { class: 'info-letters', title: 'Models of the running agents' },
        ...ops.running.map((family) => h('span', { class: `agent-letter fam-${family}` }, modelLetter(family)))
      )
    )
  }
  if (info.agent === 'shell') return items
  items.push(h('span', { class: 'spacer' }))
  const label = `${info.agentsOpen ? 'Hide' : 'Show'} activity of ${handlers.title}`
  items.push(
    h(
      'button',
      {
        class: `agents-toggle${info.agentsOpen ? ' open' : ''}`,
        type: 'button',
        'aria-label': label,
        'aria-expanded': info.agentsOpen ? 'true' : 'false',
        title: label,
        onClick: handlers.onToggleAgents
      },
      icon(ACTIVITY_ICON)
    )
  )
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
  return [...items, ...opsItems(info, handlers)]
}
