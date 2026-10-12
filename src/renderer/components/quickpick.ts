import { closeQuickPick, setQuickPickMode, showView, startSession } from '../actions'
import { AGENT_NAMES } from '../../shared/agents'
import {
  filterProjects,
  moveSelection,
  pickedAgent,
  toggleAgent,
  type AgentOverrides,
  type AgentPreset
} from '../../shared/quickPick'
import type { Project } from '../../shared/types'
import { primaryModifierPressed } from '../../shared/shortcuts'
import { clear, h, icon } from '../dom'
import { ICONS } from '../icons'
import { agentMark } from './agentMark'
import { modeTabs } from './pickerTabs'
import type { AppState } from '../state'

export class QuickPickComponent {
  private root: HTMLElement | null = null
  private input: HTMLInputElement | null = null
  private list: HTMLElement | null = null
  private selected = 0
  private matches: Project[] = []
  private projects: Project[] = []
  private preset: AgentPreset = 'default'
  private overrides: AgentOverrides = {}

  constructor(private readonly anchor: () => HTMLElement) {}

  update(state: AppState): void {
    this.projects = state.settings.projects
    this.preset = state.quickPickPreset
    const wanted = state.quickPickOpen && state.quickPickMode === 'new'
    if (wanted && !this.root) this.open()
    if (!wanted && this.root) this.close(state.quickPickOpen)
  }

  private open(): void {
    const rect = this.anchor().getBoundingClientRect()
    this.input = h('input', {
      class: 'text-input',
      type: 'text',
      placeholder: 'Filter projects',
      'aria-label': 'Filter projects',
      role: 'combobox',
      'aria-expanded': 'true',
      'aria-controls': 'quickpick-list',
      autocomplete: 'off'
    })
    this.list = h('div', { class: 'quickpick-list', id: 'quickpick-list', role: 'listbox', 'aria-label': 'Start a session in' })
    this.root = h(
      'div',
      { class: 'popover quickpick', style: `left:${Math.round(rect.left)}px;top:${Math.round(rect.bottom + 2)}px` },
      modeTabs('new'),
      this.input,
      this.list,
      h('div', { class: 'popover-foot' }, navigator.platform.toLowerCase().includes('mac')
        ? 'Enter starts a session. Tab switches agent. Cmd+R resumes'
        : 'Enter starts a session. Tab switches agent. Ctrl+R resumes')
    )
    this.selected = 0
    this.overrides = {}
    this.input.addEventListener('input', () => {
      this.selected = 0
      this.renderList()
    })
    this.input.addEventListener('keydown', (event) => this.onKey(event))
    document.body.appendChild(this.root)
    document.addEventListener('pointerdown', this.outside, true)
    this.renderList()
    this.input.focus()
  }

  private readonly outside = (event: Event): void => {
    const target = event.target as Node
    if (this.root && !this.root.contains(target) && !this.anchor().contains(target)) closeQuickPick()
  }

  private close(stillOpen: boolean): void {
    document.removeEventListener('pointerdown', this.outside, true)
    this.root?.remove()
    this.root = null
    this.input = null
    this.list = null
    if (!stillOpen) this.anchor().focus()
  }

  private onKey(event: KeyboardEvent): void {
    if (primaryModifierPressed(event) && !event.shiftKey && event.key.toLowerCase() === 'r') {
      event.preventDefault()
      event.stopPropagation()
      setQuickPickMode('resume')
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      this.selected = moveSelection(this.selected, event.key === 'ArrowDown' ? 1 : -1, this.matches.length)
      this.renderList()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const choice = this.matches[this.selected]
      if (choice) void startSession(choice.id, pickedAgent(choice, this.overrides, this.preset))
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeQuickPick()
    } else if (event.key === 'Tab') {
      event.preventDefault()
      const choice = this.matches[this.selected]
      if (!choice) return
      this.overrides = toggleAgent(choice, this.overrides, this.preset)
      this.renderList()
    }
  }

  private renderList(): void {
    if (!this.list || !this.input) return
    this.matches = filterProjects(this.projects, this.input.value)
    clear(this.list)
    if (this.projects.length === 0) {
      this.list.append(
        h('p', { class: 'popover-empty' }, 'No projects yet.'),
        h('button', { class: 'btn ghost small', type: 'button', onClick: () => { closeQuickPick(); showView('projects') } }, 'Add a project')
      )
      return
    }
    if (this.matches.length === 0) {
      this.list.append(h('p', { class: 'popover-empty' }, 'No project matches.'))
      return
    }
    this.matches.forEach((project, index) => {
      const agent = pickedAgent(project, this.overrides, this.preset)
      const option = h(
        'div',
        { class: `option${index === this.selected ? ' selected' : ''}`, role: 'option', id: `qp-${index}`, 'aria-selected': String(index === this.selected) },
        icon(ICONS.folder),
        h('span', { class: 'option-name' }, project.name),
        h('span', { class: 'option-agent' }, agentMark(agent), AGENT_NAMES[agent])
      )
      option.addEventListener('click', () => void startSession(project.id, agent))
      option.addEventListener('mousemove', () => {
        if (this.selected === index) return
        this.selected = index
        this.renderList()
      })
      this.list?.append(option)
    })
    this.input.setAttribute('aria-activedescendant', `qp-${this.selected}`)
  }
}
