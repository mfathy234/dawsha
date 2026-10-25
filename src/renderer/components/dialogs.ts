import { h, iconButton } from '../dom'
import { ICONS } from '../icons'

export interface ConfirmOptions {
  title: string
  body: string
  confirmLabel: string
  cancelLabel?: string
  danger?: boolean
}

export interface ChoiceOption<T> {
  label: string
  value: T
  kind?: 'primary' | 'danger' | 'ghost'
}

export interface ChoiceOptions<T> {
  title: string
  body: string
  choices: ChoiceOption<T>[]
}

export interface PromptOptions {
  title: string
  label: string
  initial?: string
  hint?: string
  confirmLabel: string
  validate?: (value: string) => string | null
}

export interface Presented<T> {
  result: Promise<T>
  finish(value: T): void
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])'

let dialogCount = 0

export const nextDialogId = (): number => {
  dialogCount += 1
  return dialogCount
}

// Every dialog gets the same corner X. It is labelled Dismiss so it never competes with a dialog's own Close button.
export function addDismissButton(dialog: HTMLElement, dismiss: () => void): void {
  // A dialog with its own X in a header (Changes) marks itself so it does not get two.
  if (dialog.hasAttribute('data-own-dismiss') || dialog.querySelector(':scope > .dialog-x')) return
  dialog.classList.add('has-x')
  dialog.prepend(iconButton('Dismiss', ICONS.close, dismiss, 'small dialog-x'))
}

export function present<T>(dialog: HTMLElement, cancelValue: T, focus: HTMLElement): Presented<T> {
  const previous = document.activeElement as HTMLElement | null
  const overlay = h('div', { class: 'overlay' }, dialog)
  let finish: (value: T) => void = () => undefined
  const result = new Promise<T>((resolve) => {
    finish = (value) => {
      document.removeEventListener('keydown', onKey, true)
      overlay.remove()
      previous?.focus()
      resolve(value)
    }
  })
  const onKey = (event: KeyboardEvent): void => {
    const overlays = document.querySelectorAll('.overlay')
    if (overlays[overlays.length - 1] !== overlay) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      finish(cancelValue)
    } else if (event.key === 'Tab') {
      const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (items.length === 0) return
      event.preventDefault()
      const step = event.shiftKey ? -1 : 1
      const at = items.indexOf(document.activeElement as HTMLElement)
      items[(at + step + items.length) % items.length].focus()
    } else if (event.key === 'Enter' && document.activeElement instanceof HTMLButtonElement) {
      event.stopPropagation()
    }
  }
  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) finish(cancelValue)
  })
  addDismissButton(dialog, () => finish(cancelValue))
  document.addEventListener('keydown', onKey, true)
  document.body.appendChild(overlay)
  focus.focus()
  return { result, finish }
}

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  const id = nextDialogId()
  const titleId = `dlg-title-${id}`
  const bodyId = `dlg-body-${id}`
  const cancel = h('button', { class: 'btn ghost', type: 'button' }, options.cancelLabel ?? 'Cancel')
  const confirm = h(
    'button',
    { class: `btn ${options.danger === false ? 'primary' : 'danger'}`, type: 'button', 'data-confirm': '' },
    options.confirmLabel
  )
  const dialog = h(
    'div',
    { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': titleId, 'aria-describedby': bodyId },
    h('h2', { id: titleId }, options.title),
    h('p', { id: bodyId }, options.body),
    h('div', { class: 'dialog-actions' }, cancel, confirm)
  )
  const shown = present(dialog, false, cancel)
  cancel.addEventListener('click', () => shown.finish(false))
  confirm.addEventListener('click', () => shown.finish(true))
  return shown.result
}

export function choiceDialog<T>(options: ChoiceOptions<T>): Promise<T | null> {
  const id = nextDialogId()
  const titleId = `dlg-title-${id}`
  const bodyId = `dlg-body-${id}`
  const cancel = h('button', { class: 'btn ghost', type: 'button' }, 'Cancel')
  const dialog = h(
    'div',
    { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': titleId, 'aria-describedby': bodyId },
    h('h2', { id: titleId }, options.title),
    h('p', { id: bodyId }, options.body)
  )
  const actions = h('div', { class: 'dialog-actions' }, cancel)
  const shown = present<T | null>(dialog, null, cancel)
  for (const choice of options.choices) {
    const kind = choice.kind ?? 'ghost'
    const button = h('button', { class: `btn ${kind}`, type: 'button' }, choice.label)
    button.addEventListener('click', () => shown.finish(choice.value))
    actions.append(button)
  }
  cancel.addEventListener('click', () => shown.finish(null))
  dialog.append(actions)
  return shown.result
}

export function promptDialog(options: PromptOptions): Promise<string | null> {
  const id = nextDialogId()
  const titleId = `dlg-title-${id}`
  const inputId = `dlg-input-${id}`
  const input = h('input', {
    class: 'text-input',
    id: inputId,
    type: 'text',
    value: options.initial ?? '',
    autocomplete: 'off',
    spellcheck: 'false',
    'aria-describedby': `dlg-error-${id}`
  })
  const error = h('p', { class: 'field-error', id: `dlg-error-${id}`, role: 'alert', hidden: true })
  const cancel = h('button', { class: 'btn ghost', type: 'button' }, 'Cancel')
  const confirm = h('button', { class: 'btn primary', type: 'button', 'data-confirm': '' }, options.confirmLabel)
  const dialog = h(
    'div',
    { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    h('h2', { id: titleId }, options.title),
    h('label', { for: inputId, class: 'dialog-label' }, options.label),
    input,
    error,
    options.hint ? h('p', { class: 'dialog-hint' }, options.hint) : null,
    h('div', { class: 'dialog-actions' }, cancel, confirm)
  )
  const shown = present<string | null>(dialog, null, input)
  input.select()
  const submit = (): void => {
    const problem = options.validate?.(input.value) ?? null
    error.textContent = problem ?? ''
    error.hidden = problem === null
    input.classList.toggle('invalid', problem !== null)
    if (problem === null) shown.finish(input.value.trim())
  }
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    event.stopPropagation()
    submit()
  })
  cancel.addEventListener('click', () => shown.finish(null))
  confirm.addEventListener('click', submit)
  return shown.result
}
