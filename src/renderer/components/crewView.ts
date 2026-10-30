import { crewMembers } from '../../shared/crewBuiltins'
import { blankMember, matchesQuery, modelLabel, type CrewMember, type CrewRun } from '../../shared/crew'
import { AVATAR_LABELS, formatCost, formatSpan, type AvatarState } from '../../shared/crewLive'
import { formatAge } from '../../shared/statusLine'
import { openResumePicker, focusPane } from '../actions'
import {
  addMembers,
  duplicateById,
  memberById,
  removeMember,
  runsOf,
  setBuiltinHidden,
  updateMember
} from '../crewActions'
import { acknowledgeRun, memberStateNow, paneOfRun } from '../crewLive'
import { clear, h } from '../dom'
import { store, type AppState } from '../state'
import { confirmDialog } from './dialogs'
import { crewAvatar } from './crewAvatar'
import { agentMark } from './agentMark'
import { openImportDialog, openRunDialog } from './crewDialogs'
import { CrewGoalsPage } from './crewGoals'
import { buildLeadSettings } from './crewLeadSettings'
import { buildSetup, refreshPreview } from './crewSetup'
import { toast } from './toast'
import './crew.css'
import './agents.css'
import { pageHeader } from './pageHeader'

type Tab = 'setup' | 'runs' | 'live'

const LEAD_NOTE = 'Give her a goal; she picks who works on it'

function stateWord(state: AvatarState): string {
  return AVATAR_LABELS[state]
}

export class CrewViewComponent {
  readonly el = h('main', { class: 'crew-view', 'aria-label': 'Agents' })
  private readonly count = h('span', { class: 'crew-count' })
  private readonly list = h('div', { class: 'crew-list', role: 'listbox', 'aria-label': 'Agents' })
  private readonly head = h('div', { class: 'crew-detail-head' })
  private readonly tabs = h('div', { class: 'crew-tabs', role: 'tablist' })
  private readonly body = h('div', { class: 'crew-detail-body' })
  private readonly detail = h('section', { class: 'crew-detail', 'aria-label': 'Member' }, this.head, this.tabs, this.body)
  private readonly roster = h('div', { class: 'crew-roster' })
  private readonly leadLine = h('div', { class: 'crew-lead-line' })
  private readonly pageBody = h('div', { class: 'crew-body' }, this.roster, this.detail)
  private mode: 'roster' | 'detail' = 'roster'
  private rosterScroll = 0
  private readonly search = h('input', {
    class: 'text-input crew-search',
    type: 'search',
    placeholder: 'Search by name, role or job',
    'aria-label': 'Search agents',
    onInput: () => this.refresh(store.state, true)
  })
  private selectedId = 'maya'
  private tab: Tab = 'setup'
  private readonly goals = new CrewGoalsPage()
  private listSig = ''
  private headSig = ''
  private bodySig = ''
  private shownLinked = ''

  constructor() {
    this.el.append(
      pageHeader({ title: 'Agents', subtitle: 'A roster for the agents you can run.', actions: [this.count, this.search, h('button', { class: 'btn', type: 'button', id: 'crew-import', onClick: () => void this.importMembers() }, 'Import…'), h('button', { class: 'btn primary', type: 'button', id: 'crew-new', onClick: () => this.newMember() }, '+ New agent')] }),
      this.pageBody
    )
    this.roster.append(this.goals.el, this.leadLine, this.list)
  }

  update(state: AppState): void {
    this.refresh(state, false)
  }

  private members(state: AppState): CrewMember[] {
    return crewMembers(state.settings.crew)
  }

  private selected(state: AppState): CrewMember {
    const all = this.members(state)
    return all.find((member) => member.id === this.selectedId) ?? all[0]
  }

  private refresh(state: AppState, force: boolean): void {
    const all = this.members(state)
    const query = this.search.value
    const stateOf = (member: CrewMember): AvatarState => memberStateNow(state, member.id)
    const lastRun = (member: CrewMember): number => runsOf(member.id)[0]?.startedAt ?? 0
    const selected = this.selected(state)
    const listSig = JSON.stringify([
      query,
      selected.id,
      all.map((m) => [m.id, m.name, m.role, m.initials, m.colour, m.hidden, stateOf(m), lastRun(m), Math.floor(state.now / 60_000)])
    ])
    if (force || listSig !== this.listSig) {
      this.listSig = listSig
      this.renderList(all, query, state, selected.id)
    }
    this.count.textContent = `${all.filter((m) => !m.hidden).length} agents · ${all.filter((m) => m.builtin).length} built in`
    this.roster.hidden = this.mode !== 'roster'
    this.detail.hidden = this.mode !== 'detail'
    if (this.mode === 'roster' && !force) this.goals.update(state)
    const headSig = JSON.stringify([selected.id, selected.name, selected.role, selected.initials, selected.colour, selected.builtin, selected.hidden, stateOf(selected), selected.description, selected.source, this.tab])
    if (force || headSig !== this.headSig) {
      this.headSig = headSig
      this.renderHead(selected, state)
    }
    const runs = state.settings.crewRuns.filter((run) => run.memberId === selected.id)
    const bodySig = JSON.stringify([selected.id, this.tab, this.tab === 'runs' ? runs : '', selected.hidden])
    if (force || bodySig !== this.bodySig) {
      this.bodySig = bodySig
      this.renderBody(selected, runs, state)
    }
    if (selected.source.linked && this.shownLinked !== selected.id) {
      this.shownLinked = selected.id
      void this.reread(selected)
    }
  }

  private async reread(member: CrewMember): Promise<void> {
    const { refreshLinked } = await import('../crewActions')
    const fresh = await refreshLinked(member)
    if (fresh !== member) this.bodySig = ''
  }

  private select(id: string): void {
    this.openDetail(id, 'setup')
  }

  private openDetail(id: string, tab: Tab): void {
    this.rosterScroll = this.pageBody.scrollTop
    this.selectedId = id
    this.tab = tab
    this.mode = 'detail'
    this.pageBody.scrollTop = 0
    this.refresh(store.state, true)
  }

  private showRoster(): void {
    this.mode = 'roster'
    this.refresh(store.state, true)
    this.goals.update(store.state)
    this.pageBody.scrollTop = this.rosterScroll
    requestAnimationFrame(() => { this.pageBody.scrollTop = this.rosterScroll })
  }

  private renderList(all: CrewMember[], query: string, state: AppState, selectedId: string): void {
    clear(this.list)
    const shown = all.filter((member) => matchesQuery(member, query))
    const lead = shown.find((member) => member.lead && !member.hidden)
    this.leadLine.replaceChildren(...(lead ? [this.item(lead, state, lead.id === selectedId)] : []))
    const sections: { title: string; members: CrewMember[]; count: boolean }[] = [
      { title: 'Your agents', members: shown.filter((m) => !m.builtin), count: true },
      { title: 'Built in', members: shown.filter((m) => m.builtin && !m.lead && !m.hidden), count: true },
      { title: 'Hidden', members: shown.filter((m) => m.builtin && m.hidden), count: true }
    ]
    for (const section of sections) {
      if (section.title === 'Hidden' && section.members.length === 0) continue
      if (section.title === 'Your agents' && section.members.length === 0 && query === '') {
        this.list.append(h('div', { class: 'crew-sec' }, h('span', {}, 'Your agents'), h('span', {}, '0')))
        this.list.append(h('p', { class: 'crew-empty-note' }, 'Make one with New agent, import your agent files, or turn a skill into one from the Skills page.'))
        continue
      }
      if (section.members.length === 0) continue
      if (section.title) this.list.append(h('div', { class: 'crew-sec' }, h('span', {}, section.title), section.count ? h('span', {}, String(section.members.length)) : null))
      for (const member of section.members) this.list.append(this.item(member, state, member.id === selectedId))
    }
    if (shown.length === 0) this.list.append(h('p', { class: 'crew-empty-note' }, 'No agent matches that search.'))
    this.list.append(h('button', { class: 'crew-card-new', type: 'button', onClick: () => this.newMember() }, h('span', { class: 'crew-card-plus', 'aria-hidden': 'true' }, '+'), h('span', { class: 'crew-card-title' }, 'New agent'), h('span', { class: 'crew-muted' }, 'or import a file')))
  }

  private metaLine(member: CrewMember, state: AppState): Node {
    const live = memberStateNow(state, member.id)
    if (member.lead && live === 'idle') return h('span', { class: 'crew-muted' }, LEAD_NOTE)
    if (live !== 'idle') {
      const run = this.liveTitle(state, member.id)
      return h('span', {}, h('span', { class: `crew-state state-${live === 'needs' ? 'needs' : live === 'working' ? 'working' : live === 'done' ? 'done' : 'failed'}` }, live === 'working' ? 'Running' : stateWord(live)), run ? h('span', { class: 'crew-muted' }, ` · ${run}`) : null)
    }
    const last = runsOf(member.id)[0]
    return h('span', { class: 'crew-muted' }, last ? `Last job ${formatAge(Math.max(0, state.now - last.startedAt))} ago` : 'Never run')
  }

  private liveTitle(state: AppState, memberId: string): string {
    const pane = state.panes.find((p) => p.tabs.some((t) => t.crew?.memberId === memberId))
    const tab = pane?.tabs.find((t) => t.crew?.memberId === memberId)
    return tab?.name?.split(' · ').slice(1).join(' · ') ?? ''
  }

  private item(member: CrewMember, state: AppState, selected: boolean): HTMLElement {
    const live = memberStateNow(state, member.id)
    const running = live === 'working'
    const startedRun = state.settings.crewRuns.find((run) => run.memberId === member.id && run.outcome === 'running')
    const elapsed = running && startedRun ? formatSpan(Math.max(0, state.now - startedRun.startedAt)) : ''
    const action = member.lead || member.hidden
      ? h('span', {})
      : running
        ? h('button', { class: 'btn small crew-viewbtn', type: 'button', 'aria-label': `View ${member.name}`, onClick: (event: Event) => { event.stopPropagation(); this.openDetail(member.id, 'live') } }, 'View')
        : h('button', { class: 'btn small crew-runbtn', type: 'button', 'aria-label': `Run ${member.name}`, onClick: (event: Event) => { event.stopPropagation(); void openRunDialog(member) } }, 'Run')
    const item = h(
      'div',
      {
        class: `crew-item${member.lead ? ' lead-item' : ''}${selected ? ' sel' : ''}${member.hidden ? ' is-hidden' : ''}${running ? ' is-running' : ''}`,
        role: 'option',
        'aria-selected': String(selected),
        tabindex: '0',
        'data-member': member.id
      },
      h('span', { class: 'crew-card-top' },
        crewAvatar(member, live, 40),
        h('span', { class: 'crew-id' },
          h('span', { class: 'crew-nm' }, h('b', {}, member.name), h('span', { class: 'crew-role' }, ` · ${member.role}`))
        ),
        member.builtin ? h('span', { class: 'crew-badge' }, 'Built in') : h('span', {})
      ),
      member.description ? h('span', { class: 'crew-purpose' }, member.description) : h('span', {}),
      h('span', { class: 'crew-card-model' }, agentMark(member.runner), h('span', {}, modelLabel(member.runner, member.model))),
      h('span', { class: 'crew-foot' },
        h('span', { class: 'crew-meta' }, this.metaLine(member, state), elapsed ? h('span', { class: 'crew-muted' }, ` · ${elapsed}`) : null),
        action
      )
    )
    item.addEventListener('click', () => this.select(member.id))
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        this.select(member.id)
      }
    })
    return item
  }

  private renderHead(member: CrewMember, state: AppState): void {
    clear(this.head)
    const live = memberStateNow(state, member.id)
    const actions: HTMLElement[] = []
    if (member.builtin) {
      actions.push(h('button', { class: 'btn', type: 'button', id: 'crew-duplicate', onClick: () => this.duplicate(member) }, 'Duplicate to customise'))
      if (!member.lead) actions.push(h('button', { class: 'btn', type: 'button', id: 'crew-hide', onClick: () => this.hide(member) }, member.hidden ? 'Show again' : 'Hide'))
    } else {
      actions.push(h('button', { class: 'btn', type: 'button', id: 'crew-duplicate', onClick: () => this.duplicate(member) }, 'Duplicate'))
      actions.push(h('button', { class: 'btn', type: 'button', id: 'crew-delete', onClick: () => void this.remove(member) }, 'Delete…'))
    }
    if (!member.lead && !member.hidden) actions.push(h('button', { class: 'btn primary', type: 'button', id: 'crew-run-main', onClick: () => void openRunDialog(member) }, 'Run'))
    const source = member.source.kind === 'dawsha' ? null : h('div', { class: 'crew-src' }, `${member.source.linked ? 'Linked to' : 'Imported from'} ${member.source.path}${member.source.linked ? ' · edits stay in sync' : ''}`)
    this.head.append(
      h('nav', { class: 'crew-crumb', 'aria-label': 'Breadcrumb' }, h('button', { class: 'crew-crumb-link', type: 'button', onClick: () => this.showRoster() }, 'Agents'), h('span', { class: 'crew-crumb-sep', 'aria-hidden': 'true' }, '›'), h('span', {}, member.name)),
      h(
        'div',
        { class: 'crew-dh' },
        crewAvatar(member, live, 48),
        h(
          'div',
          { class: 'crew-dh-text' },
          h('h2', {}, member.name),
          h('div', { class: 'crew-muted' }, `${member.role}${member.builtin ? ' · built in' : ''}${member.hidden ? ' · hidden' : ''}`),
          live !== 'idle' ? h('div', { class: 'crew-state-line' }, stateWord(live)) : null
        ),
        h('span', { class: 'crew-spacer' }),
        ...actions
      ),
      ...(member.description ? [h('p', { class: 'crew-desc' }, member.description)] : []),
      ...(source ? [source] : [])
    )
    clear(this.tabs)
    const tabs: [Tab, string][] = member.lead
      ? [['setup', 'How she leads']]
      : [['setup', 'Setup'], ['runs', `Runs ${runsOf(member.id).length}`], ...(live !== 'idle' ? [['live', 'Live'] as [Tab, string]] : [])]
    for (const [id, label] of tabs) {
      const button = h('button', { class: 'crew-tab', type: 'button', role: 'tab', 'aria-selected': String(this.tab === id), 'data-tab': id }, label)
      button.addEventListener('click', () => {
        this.tab = id
        this.refresh(store.state, true)
      })
      this.tabs.append(button)
    }
  }

  private renderBody(member: CrewMember, runs: CrewRun[], state: AppState): void {
    clear(this.body)
    if (member.lead) {
      this.body.append(buildLeadSettings(member, () => this.duplicate(member)))
      return
    }
    if (this.tab === 'runs') {
      this.body.append(this.runsPage(runs, state))
      return
    }
    if (this.tab === 'live') {
      this.body.append(this.liveBody(member, state))
      return
    }
    this.body.append(buildSetup(member, this.handlers(member)))
  }

  private liveBody(member: CrewMember, state: AppState): HTMLElement {
    const run = state.settings.crewRuns.find((item) => item.memberId === member.id && item.outcome === 'running')
    if (!run) return h('div', { class: 'crew-empty' }, 'Nothing is running for this agent.')
    const pane = paneOfRun(run.id)
    const doing = this.liveTitle(state, member.id) || 'Working on the job'
    return h('div', { class: 'crew-live', 'data-live-run': run.id },
      h('p', { class: 'crew-live-line' }, `${memberStateNow(state, member.id) === 'working' ? 'Running' : stateWord(memberStateNow(state, member.id))} · ${doing} · ${formatSpan(Math.max(0, state.now - run.startedAt))}`),
      h('p', { class: 'crew-muted' }, `${run.projectName} · ${run.title}`),
      pane ? h('button', { class: 'btn primary', type: 'button', id: 'crew-live-go', onClick: () => { acknowledgeRun(run.id, pane.id); focusPane(pane.id) } }, 'Go to session') : null
    )
  }

  private runsPage(runs: CrewRun[], state: AppState): HTMLElement {
    if (runs.length === 0) return h('div', { class: 'crew-empty' }, 'No runs yet.')
    const wrap = h('div', { class: 'crew-runs', role: 'list' })
    for (const run of runs) {
      const live = paneOfRun(run.id)
      const word = run.outcome === 'running' ? (live ? 'Running' : 'Closed') : run.outcome === 'done' ? 'Done' : run.outcome === 'failed' ? 'Failed' : 'Closed'
      const span = run.endedAt ? formatSpan(run.endedAt - run.startedAt) : live ? formatSpan(state.now - run.startedAt) : ''
      const row = h(
        'button',
        { class: 'crew-runrow', type: 'button', role: 'listitem', 'data-run': run.id, title: live ? 'Go to its pane' : 'Open its sessions' },
        h('span', { class: `crew-outcome out-${run.outcome}` }, word),
        h('span', { class: 'crew-run-title' }, run.title),
        h('span', { class: 'crew-run-cell' }, `${run.runner === 'claude' ? 'Claude' : run.runner === 'codex' ? 'Codex' : 'Gemini'} · ${modelLabel(run.runner, run.model)}`),
        h('span', { class: 'crew-run-cell' }, run.projectName),
        h('span', { class: 'crew-run-cell' }, `${formatAge(Math.max(0, state.now - run.startedAt))} ago`),
        h('span', { class: 'crew-run-cell' }, span),
        h('span', { class: 'crew-run-cell' }, formatCost(run.costUsd))
      )
      row.addEventListener('click', () => {
        if (live) {
          acknowledgeRun(run.id, live.id)
          focusPane(live.id)
        } else openResumePicker(run.projectId)
      })
      wrap.append(row)
    }
    return wrap
  }

  private handlers(member: CrewMember) {
    let current = member
    return {
      current: () => current,
      change: (patch: Partial<CrewMember>) => {
        current = { ...current, ...patch }
        updateMember(member.id, patch)
        this.listSig = ''
        this.headSig = ''
        const root = this.body.querySelector<HTMLElement>('.crew-form')
        if (root) refreshPreview(root, current)
      },
      rebuild: () => {
        this.bodySig = ''
        const fresh = memberById(member.id)
        if (fresh) this.renderBody(fresh, [], store.state)
      }
    }
  }

  private newMember(): void {
    const blank = blankMember(this.members(store.state), 'New agent')
    const [saved] = addMembers([blank])
    this.openDetail(saved.id, 'setup')
    this.body.querySelector<HTMLInputElement>('input[aria-label="Name"]')?.select()
  }

  private duplicate(member: CrewMember): void {
    const copy = duplicateById(member.id)
    if (!copy) return
    this.openDetail(copy.id, 'setup')
    toast(`${member.name} was copied as ${copy.name}. The copy can be edited.`, 'info')
  }

  private hide(member: CrewMember): void {
    setBuiltinHidden(member.id, !member.hidden)
    this.refresh(store.state, true)
  }

  private async remove(member: CrewMember): Promise<void> {
    const confirmed = await confirmDialog({
      title: `Delete ${member.name}?`,
      body: `${member.name} is removed from Dawsha with the run history. ${member.source.kind === 'dawsha' ? '' : 'The file it came from stays on disk.'}`.trim(),
      confirmLabel: `Delete ${member.name}`
    })
    if (!confirmed) return
    removeMember(member.id)
    store.set((s) => ({ ...s, settings: { ...s.settings, crewRuns: s.settings.crewRuns.filter((run) => run.memberId !== member.id) } }))
    void import('../actions').then(({ saveSettings }) => saveSettings({ crewRuns: store.state.settings.crewRuns }))
    this.selectedId = 'maya'
    this.mode = 'roster'
    this.refresh(store.state, true)
  }

  private async importMembers(): Promise<void> {
    const added = await openImportDialog()
    if (added.length === 0) return
    this.openDetail(added[0].id, 'setup')
    toast(`${added.length === 1 ? added[0].name : `${added.length} members`} was added to your agents.`, 'info')
  }
}
