import { supportsEffort } from '../../../shared/orch/launch'
import { sanitizeOrchSettings, type OrchProfile, type OrchSettings } from '../../../shared/orch/profiles'
import type { EditResult } from '../../../shared/orch/settingsEdit'
import { saveSettings } from '../../actions'
import { h } from '../../dom'
import { store } from '../../state'
import { selectMenu } from '../selectMenu'
import { toast } from '../toast'
import { modelBadge } from './orchUi'

export const current = (): OrchSettings => store.state.settings.orchestrator

export function persist(next: OrchSettings): void {
  const orchestrator = sanitizeOrchSettings(next)
  store.set((s) => ({ ...s, settings: { ...s.settings, orchestrator } }))
  void saveSettings({ orchestrator })
}

export function applyEdit(result: EditResult): boolean {
  if (!result.ok) {
    toast(result.error)
    return false
  }
  persist(result.settings)
  return true
}

export function field(label: string, id: string, control: HTMLElement, hint?: string): HTMLElement {
  return h('div', { class: 'orch-set-field' }, h('label', { for: id }, label), control, hint ? h('p', { class: 'orch-set-hint' }, hint) : null)
}

export function textInput(id: string, value: string, onCommit: (value: string) => void, options: { disabled?: boolean; placeholder?: string; mono?: boolean } = {}): HTMLInputElement {
  const input = h('input', {
    class: `text-input${options.mono ? ' mono' : ''}`,
    id,
    type: 'text',
    placeholder: options.placeholder,
    disabled: options.disabled === true
  })
  input.value = value
  input.addEventListener('change', () => onCommit(input.value))
  return input
}

export function numberInput(id: string, value: number | null, min: number, max: number | null, onCommit: (value: number | null) => void): HTMLInputElement {
  const input = h('input', { class: 'text-input orch-set-number', id, type: 'number', min, max: max ?? undefined, step: 'any', inputmode: 'decimal' })
  input.value = value === null ? '' : String(value)
  input.addEventListener('change', () => {
    const raw = input.value.trim()
    onCommit(raw === '' ? null : Number(raw))
  })
  return input
}

export function selectInput(id: string, options: { value: string; label: string; disabled?: boolean }[], value: string, onChange: (value: string) => void, disabled = false): HTMLElement {
  const select = h('select', { class: 'text-input', id, disabled })
  for (const option of options) select.append(h('option', { value: option.value, selected: option.value === value, disabled: option.disabled === true }, option.label))
  select.addEventListener('change', () => onChange(select.value))
  return selectMenu(select)
}

export function checkbox(id: string, label: string, checked: boolean, disabled: boolean, onChange: (value: boolean) => void): HTMLElement {
  const input = h('input', { type: 'checkbox', id, disabled })
  input.checked = checked
  input.addEventListener('change', () => onChange(input.checked))
  return h('label', { class: 'check', for: id }, input, label)
}

export function button(id: string, label: string, onClick: () => void, options: { danger?: boolean; disabled?: boolean; title?: string } = {}): HTMLElement {
  return h(
    'button',
    { class: `btn small ${options.danger ? 'danger' : 'ghost'}`, type: 'button', id, disabled: options.disabled === true, title: options.title, onClick },
    label
  )
}

export const modelCell = (p: OrchProfile): HTMLElement => modelBadge(p.local ? 'codex-local' : p.runner, p.model || 'default')

export const effortLabel = (p: OrchProfile): string => (p.effort ? p.effort : supportsEffort(p.runner) ? 'default' : 'n/a')
