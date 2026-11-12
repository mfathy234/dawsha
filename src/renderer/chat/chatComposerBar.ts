import { AGENT_NAMES } from '../../shared/agents'
import { contextReading } from '../../shared/chatContext'
import { canPickModel } from '../../shared/chatModels'
import type { AgentKind } from '../../shared/types'
import { h } from '../dom'
import { ContextMeter, ContextNote } from './chatContextMeter'
import { ModelPicker } from './chatModelPicker'
import './chatBar.css'

export interface ComposerBarInput {
  agent: AgentKind
  sessionId: string | null
  /** The session's name, for the clear confirm. */
  title: string
  /** The model as the agent reports it, e.g. "Opus 5.5". */
  model: string | null
  contextPercent: number | null
  contextTokens: number | null
  contextWindow: number | null
  /** The agent is working: the model cannot change until the reply ends. */
  working: boolean
}

export interface ComposerBarHost {
  command(text: string): void
  announce(text: string): void
}

/** The row under the text in the chat box (model and effort, context, send) and the note above the box. */
export class ComposerBar {
  readonly el: HTMLElement
  readonly note: HTMLElement
  private readonly picker: ModelPicker
  private readonly meter: ContextMeter
  private readonly contextNote: ContextNote

  constructor(host: ComposerBarHost, send: HTMLElement) {
    this.picker = new ModelPicker(host)
    this.meter = new ContextMeter(host)
    this.contextNote = new ContextNote(host)
    this.note = this.contextNote.el
    this.el = h('div', { class: 'chat-box-bar' }, this.picker.el, h('span', { class: 'chat-box-spacer' }), this.meter.el, send)
  }

  update(input: ComposerBarInput): void {
    const key = `${input.agent}:${input.sessionId ?? ''}`
    const reading = contextReading({ agent: input.agent, percent: input.contextPercent, tokens: input.contextTokens, window: input.contextWindow })
    this.meter.update(reading, input.title)
    this.contextNote.update(reading, AGENT_NAMES[input.agent], key)
    this.picker.update(canPickModel(input.agent) ? { agent: input.agent, model: input.model, locked: input.working, sessionKey: key } : null)
  }
}
