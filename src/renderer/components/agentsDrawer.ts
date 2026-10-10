import { drawerRow, verdictTone, type DrawerRow, type OpsSnapshot } from '../../shared/opsFeed'
import type { ProcessActivity } from '../../shared/processActivity'
import { h } from '../dom'

function rowElement(row: DrawerRow): HTMLElement {
  const main = h(
    'div',
    { class: `drawer-row status-${row.status}` },
    h('span', { class: 'drawer-marker' }, row.marker),
    h('span', { class: 'drawer-desc' }, row.description),
    h('span', { class: `drawer-model fam-${row.family ?? 'other'}` }, row.modelLabel),
    h('span', { class: 'drawer-elapsed' }, row.elapsed),
    h('span', { class: 'drawer-tokens' }, row.tokens)
  )
  return h('div', { class: 'drawer-item', 'data-agent-id': row.id }, main, row.detail ? h('div', { class: 'drawer-detail' }, row.detail) : null)
}

function advisorElement(snapshot: OpsSnapshot): HTMLElement | null {
  const advisor = snapshot.advisor
  if (!advisor) return null
  const verdict =
    advisor.status === 'running' || !advisor.verdict
      ? h('span', { class: 'verdict tone-muted' }, 'reviewing')
      : h('span', { class: `verdict tone-${verdictTone(advisor.verdict)}` }, advisor.verdict)
  return h(
    'div',
    { class: 'drawer-advisor' },
    h('span', { class: 'advisor-label' }, 'Advisor on the plan'),
    verdict,
    advisor.note ? h('span', { class: 'advisor-note' }, advisor.note) : null
  )
}

export class AgentsDrawer {
  readonly el: HTMLElement
  private readonly processes = h('div', { class: 'drawer-processes' })
  private readonly rows = h('div', { class: 'drawer-rows' })
  private readonly footer = h('div', { class: 'drawer-footer' })
  private signature = ''

  constructor() {
    this.el = h('div', { class: 'agents-drawer', role: 'region', hidden: true }, this.processes, this.rows, this.footer)
  }

  update(snapshot: OpsSnapshot | null, activity: ProcessActivity[], open: boolean, title: string, now: number): void {
    this.el.hidden = !open
    if (this.el.hidden) return
    this.el.setAttribute('aria-label', `Activity of ${title}`)
    const rows = snapshot?.agents.map((agent) => drawerRow(agent, now)) ?? []
    const signature = JSON.stringify([rows, snapshot?.advisor, activity])
    if (signature === this.signature) return
    this.signature = signature
    const knownPids = new Set(activity.map((item) => item.pid))
    this.processes.replaceChildren(
      h('h3', { class: 'drawer-section-title' }, 'Processes'),
      ...(activity.length > 0
        ? activity.map((item) => h('div', { class: 'process-item' },
            h('span', { class: 'process-kind' }, knownPids.has(item.parentPid ?? -1) ? '↳' : '●'),
            h('span', { class: 'process-name' }, item.name),
            h('span', { class: 'process-pid' }, `PID ${item.pid}`)))
        : [h('div', { class: 'drawer-empty' }, 'No background processes detected yet.')])
    )
    this.rows.hidden = snapshot === null
    this.rows.replaceChildren(...(snapshot ? [h('h3', { class: 'drawer-section-title' }, 'Agent tasks'), ...(rows.length > 0 ? rows.map(rowElement) : [h('div', { class: 'drawer-empty' }, 'No agent tasks reported.')])] : []))
    const advisor = snapshot ? advisorElement(snapshot) : null
    this.footer.hidden = advisor === null
    this.footer.replaceChildren(...(advisor ? [advisor] : []))
  }
}
