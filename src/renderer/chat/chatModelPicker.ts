import { MODEL_FOOT, MODEL_LOCKED_TIP, choosesInPicker, currentChoice, effortCommand, effortLevels, modelChoices, modelCommand, modelLine, modelSetText, type ModelChoice } from '../../shared/chatModels'
import type { TabAgent } from '../../shared/types'
import { h, icon } from '../dom'
import { ICONS } from '../icons'
import { closeChatPopover, openChatPopover } from './chatPopover'

export interface PickerHost {
  /** Types the agent's own command. */
  command(text: string): void
  /** A quiet row in the thread, for a change the agent printed no row for. */
  announce(text: string): void
}

export interface PickerState {
  agent: TabAgent
  /** The model's name as the agent reports it, e.g. "Opus 5.5". */
  model: string | null
  /** The session is working: the change would only apply after this reply. */
  locked: boolean
  sessionKey: string
}

const effortKey = (sessionKey: string): string => `chat-effort:${sessionKey}`

function readEffort(sessionKey: string): string | null {
  try {
    return localStorage.getItem(effortKey(sessionKey)) || null
  } catch (error) {
    console.warn('Could not read the effort.', error)
    return null
  }
}

function saveEffort(sessionKey: string, level: string): void {
  try {
    localStorage.setItem(effortKey(sessionKey), level)
  } catch (error) {
    console.warn('Could not save the effort.', error)
  }
}

/** The model and effort at the left of the chat box, and the short menu they open. */
export class ModelPicker {
  readonly el = h('button', { class: 'chat-pick', type: 'button', hidden: true, 'aria-haspopup': 'dialog', 'aria-expanded': 'false' })
  private readonly label = h('span', { class: 'chat-pick-text' })
  private state: PickerState | null = null
  private effort: string | null = null
  private session = ''

  constructor(private readonly host: PickerHost) {
    this.el.append(this.label, icon(ICONS.chevronDown))
    this.el.addEventListener('click', () => this.open())
  }

  update(state: PickerState | null): void {
    this.state = state
    this.el.hidden = state === null
    if (!state) return
    if (state.sessionKey !== this.session) {
      this.session = state.sessionKey
      this.effort = readEffort(state.sessionKey)
    }
    this.label.textContent = modelLine(state.model, this.effort)
    this.el.disabled = state.locked
    this.el.title = state.locked ? MODEL_LOCKED_TIP : 'Model and effort'
    this.el.setAttribute('aria-label', `${state.locked ? `${MODEL_LOCKED_TIP}. ` : ''}Model and effort: ${this.label.textContent}`)
  }

  private open(): void {
    const state = this.state
    if (!state || state.locked) return
    const body: Node[] = choosesInPicker(state.agent) ? this.codexBody(state) : this.claudeBody(state)
    openChatPopover(this.el, 'Model and effort', [...body, h('div', { class: 'chat-pop-foot' }, MODEL_FOOT)], 'left')
  }

  private claudeBody(state: PickerState): Node[] {
    const here = currentChoice(state.agent, state.model)
    return [
      h('div', { class: 'chat-pop-head' }, 'Model'),
      ...modelChoices(state.agent).map((choice) => this.modelRow(state, choice, choice.id === here?.id)),
      h('div', { class: 'chat-pop-sep' }),
      h('div', { class: 'chat-pop-head' }, 'Effort'),
      this.effortTabs(state, here)
    ]
  }

  private codexBody(state: PickerState): Node[] {
    return [
      h('div', { class: 'chat-pop-head' }, 'Model'),
      h('button', { class: 'chat-pop-item selected', type: 'button', role: 'menuitemradio', 'aria-checked': 'true', onClick: () => this.pickInAgent(state) }, h('span', {}, state.model ?? 'Current model'), h('span', { class: 'chat-pop-quiet' }, 'current')),
      h('button', { class: 'chat-pop-item', type: 'button', onClick: () => this.pickInAgent(state) }, h('span', {}, 'Choose model and reasoning'), h('span', { class: 'chat-pop-quiet', dir: 'ltr' }, '/model'))
    ]
  }

  private modelRow(state: PickerState, choice: ModelChoice, selected: boolean): HTMLElement {
    return h(
      'button',
      { class: `chat-pop-item${selected ? ' selected' : ''}`, type: 'button', role: 'menuitemradio', 'aria-checked': String(selected), onClick: () => this.chooseModel(state, choice) },
      h('span', {}, choice.label),
      choice.hint ? h('span', { class: 'chat-pop-quiet' }, choice.hint) : null,
      selected ? icon(ICONS.check) : null
    )
  }

  private effortTabs(state: PickerState, here: ModelChoice | null): HTMLElement {
    const tabs = effortLevels(state.agent).map((level) =>
      h('button', { class: `chat-pop-tab${level === this.effort ? ' on' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(level === this.effort), onClick: () => this.chooseEffort(state, here, level) }, level)
    )
    return h('div', { class: 'chat-pop-tabs', role: 'radiogroup', 'aria-label': 'Effort' }, ...tabs)
  }

  private chooseModel(state: PickerState, choice: ModelChoice): void {
    closeChatPopover()
    this.host.command(modelCommand(state.agent, choice.id))
    this.host.announce(modelSetText(choice.label, this.effort))
  }

  private chooseEffort(state: PickerState, here: ModelChoice | null, level: string): void {
    closeChatPopover()
    this.effort = level
    saveEffort(state.sessionKey, level)
    this.host.command(effortCommand(state.agent, level))
    this.host.announce(modelSetText(here?.label ?? state.model ?? 'Model', level))
    this.update(state)
  }

  /** Codex has no argument form: its own picker opens, and chat draws it. */
  private pickInAgent(state: PickerState): void {
    closeChatPopover()
    this.host.command(modelCommand(state.agent, ''))
  }
}
