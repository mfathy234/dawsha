import type { FileCommit } from '../../shared/filePreview'
import type { InspectorTab } from '../../shared/filesLayout'
import { ago } from '../../shared/fileActivity'
import { formatClock } from '../../shared/timeline'
import { h } from '../dom'
import type { OutlineItem } from './outline'
import { orderSessions, type TouchingSession } from './sessionTouch'

export interface InspectorHooks {
  tab(tab: InspectorTab): void
  jump(item: OutlineItem): void
  focusSession(paneId: string): void
}

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

/** The right panel: the outline of the file, and the agents and commits that touched it. */
export class Inspector {
  readonly el = h('aside', { class: 'files-side', id: 'files-side', 'aria-label': 'About this file' })
  private readonly outlineTab = h('button', { class: 'files-side-tab', type: 'button', role: 'tab', id: 'files-tab-outline', onClick: () => this.hooks.tab('outline') }, 'Outline')
  private readonly activityTab = h('button', { class: 'files-side-tab', type: 'button', role: 'tab', id: 'files-tab-activity', onClick: () => this.hooks.tab('activity') }, 'Activity')
  private readonly outlineList = h('div', { class: 'files-side-list', id: 'files-outline', role: 'tabpanel', 'aria-labelledby': 'files-tab-outline' })
  private readonly activity = h('div', { class: 'files-side-list', id: 'files-activity', role: 'tabpanel', 'aria-labelledby': 'files-tab-activity' })
  private tab: InspectorTab = 'outline'

  constructor(private readonly hooks: InspectorHooks) {
    const tabs = h('div', { class: 'files-side-tabs', role: 'tablist', 'aria-label': 'Inspector' }, this.outlineTab, this.activityTab)
    tabs.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      const next = this.tab === 'outline' ? 'activity' : 'outline'
      this.hooks.tab(next)
      ;(next === 'outline' ? this.outlineTab : this.activityTab).focus()
    })
    this.el.append(tabs, this.outlineList, this.activity)
    this.setTab('outline')
  }

  setTab(tab: InspectorTab): void {
    this.tab = tab
    for (const [name, button, panel] of [['outline', this.outlineTab, this.outlineList], ['activity', this.activityTab, this.activity]] as const) {
      button.setAttribute('aria-selected', String(tab === name))
      button.tabIndex = tab === name ? 0 : -1
      panel.hidden = tab !== name
    }
  }

  renderOutline(items: readonly OutlineItem[], hasFile: boolean): void {
    if (items.length === 0) {
      this.outlineList.replaceChildren(h('p', { class: 'files-side-empty' }, hasFile ? 'Nothing to outline in this file.' : 'Open a file to see its outline.'))
      return
    }
    this.outlineList.replaceChildren(...items.map((item) => h('button', {
      class: `files-side-row outline k-${item.kind}`, type: 'button', style: `padding-left:${10 + item.depth * 12}px`, title: `Line ${item.line}`, onClick: () => this.hooks.jump(item)
    }, h('span', { class: 'files-side-name' }, item.name), h('span', { class: 'files-side-meta' }, String(item.line)))))
  }

  renderActivity(hasFile: boolean, sessions: readonly TouchingSession[], commits: readonly FileCommit[] | null): void {
    if (!hasFile) {
      this.activity.replaceChildren(h('p', { class: 'files-side-empty' }, 'Open a file to see who touched it.'))
      return
    }
    const ordered = orderSessions(sessions)
    const out: HTMLElement[] = [h('h2', { class: 'files-side-heading' }, 'Agents and sessions')]
    if (ordered.length === 0) out.push(h('p', { class: 'files-side-empty' }, 'No open session has read or edited this file.'))
    for (const session of ordered) {
      const last = session.records.reduce((latest, record) => Math.max(latest, record.at), 0)
      const parts = [session.live ? 'Live' : 'Closed', session.edits > 0 ? plural(session.edits, 'edit') : null, session.reads > 0 ? plural(session.reads, 'read') : null, last > 0 ? formatClock(last) : null]
      out.push(h('button', { class: 'files-side-row activity', type: 'button', title: session.title, onClick: () => this.hooks.focusSession(session.paneId) },
        h('span', { class: 'files-side-name' }, session.title), h('span', { class: 'files-side-meta' }, parts.filter(Boolean).join(' · '))))
    }
    out.push(h('h2', { class: 'files-side-heading' }, 'Recent commits'))
    if (commits === null) out.push(h('p', { class: 'files-side-empty' }, 'Loading…'))
    else if (commits.length === 0) out.push(h('p', { class: 'files-side-empty' }, 'No commits touch this file yet.'))
    else {
      for (const commit of commits) {
        out.push(h('div', { class: 'files-side-row commit', title: `${commit.short} ${commit.subject}\n${commit.author}` },
          h('span', { class: 'files-side-name' }, commit.subject), h('span', { class: 'files-side-meta' }, `${commit.short} · ${ago(commit.at)}`)))
      }
    }
    this.activity.replaceChildren(...out)
  }
}
