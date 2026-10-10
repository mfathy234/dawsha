import {
  INSTRUCTION_FILES,
  applySharedBlock,
  readSharedBlock,
  type FileStamp,
  type InstructionFileName
} from '../../shared/instructions'
import { api } from '../api'
import { clear, h } from '../dom'
import { toast } from './toast'

export type FileSnap =
  | { name: InstructionFileName; kind: 'file'; content: string; stamp: FileStamp; size: number }
  | { name: InstructionFileName; kind: 'missing' }
  | { name: InstructionFileName; kind: 'error'; message: string }

export interface SharedHost {
  folder: () => string | null
  isDirty: (name: InstructionFileName) => boolean
  onApplied: () => Promise<void>
}

type Plan = { name: InstructionFileName; text: string; stamp: FileStamp | null }
type PreviewLine = { name: string; text: string; error: boolean }

export class InstructionsSharedComponent {
  readonly el = h('section', { class: 'instr-shared', 'aria-label': 'Shared instructions' })
  private readonly text = h('textarea', {
    class: 'text-input instr-text',
    id: 'instr-shared-text',
    rows: '6',
    spellcheck: 'false',
    'aria-label': 'Shared instructions text'
  })
  private readonly creates = new Map<InstructionFileName, HTMLInputElement>()
  private readonly createRows = new Map<InstructionFileName, HTMLElement>()
  private readonly preview = h('ul', { class: 'instr-preview', id: 'instr-preview' })
  private readonly apply = h('button', { class: 'btn primary small', type: 'button', id: 'instr-apply' }, 'Apply to all files')
  private snaps: FileSnap[] = []
  private touched = false
  private plans: Plan[] = []

  constructor(private readonly host: SharedHost) {
    this.text.addEventListener('input', () => {
      this.touched = true
      this.refresh()
    })
    this.apply.addEventListener('click', () => void this.run())
    const boxes = INSTRUCTION_FILES.map(({ name }) => {
      const box = h('input', { type: 'checkbox', id: `instr-create-${name}`, 'data-create': name })
      box.addEventListener('change', () => this.refresh())
      this.creates.set(name, box)
      const row = h('label', { class: 'instr-create' }, box, `Create ${name}`)
      this.createRows.set(name, row)
      return row
    })
    this.el.append(
      h('h2', { class: 'instr-h' }, 'Shared instructions'),
      h(
        'p',
        { class: 'muted' },
        'Write it once. Dawsha keeps it between dawsha:shared markers in each file; text outside the markers is never touched.'
      ),
      this.text,
      h('div', { class: 'instr-creates' }, ...boxes),
      this.preview,
      h('div', { class: 'instr-actions' }, this.apply)
    )
  }

  reset(): void {
    this.touched = false
    this.text.value = ''
    for (const box of this.creates.values()) box.checked = false
  }

  setSnaps(snaps: FileSnap[]): void {
    this.snaps = snaps
    if (!this.touched) {
      const found = snaps.map((s) => (s.kind === 'file' ? readSharedBlock(s.content) : null)).find((c) => c !== null)
      this.text.value = found ?? ''
    }
    for (const snap of snaps) {
      const row = this.createRows.get(snap.name)
      if (row) row.hidden = snap.kind !== 'missing'
    }
    this.refresh()
  }

  private planFor(snap: FileSnap, shared: string): { plan?: Plan; line: PreviewLine } {
    const name = snap.name
    if (snap.kind === 'error') return { line: { name, text: snap.message, error: true } }
    if (snap.kind === 'missing') {
      if (!this.creates.get(name)?.checked) return { line: { name, text: 'missing, will not be created', error: false } }
      const created = applySharedBlock('', shared)
      return {
        plan: created.ok ? { name, text: created.text, stamp: null } : undefined,
        line: { name, text: 'will be created', error: false }
      }
    }
    const result = applySharedBlock(snap.content, shared)
    if (!result.ok) return { line: { name, text: result.message, error: true } }
    if (!result.changed) return { line: { name, text: 'already up to date', error: false } }
    return { plan: { name, text: result.text, stamp: snap.stamp }, line: { name, text: 'will be updated', error: false } }
  }

  private refresh(): void {
    const shared = this.text.value
    const empty = shared.trim() === ''
    const planned = this.snaps.map((snap) => this.planFor(snap, shared))
    this.plans = planned.flatMap((p) => (p.plan ? [p.plan] : []))
    clear(this.preview)
    for (const { line } of planned) {
      const text = empty && !line.error ? 'nothing to apply, the shared text is empty' : line.text
      this.preview.append(
        h('li', { class: line.error ? 'instr-error' : '', 'data-preview': line.name }, h('strong', {}, line.name), ` ${text}`)
      )
    }
    const blocked = planned.some((p) => p.line.error)
    this.apply.disabled = empty || blocked || this.plans.length === 0
  }

  private async run(): Promise<void> {
    const folder = this.host.folder()
    if (!folder || this.plans.length === 0) return
    const dirty = this.plans.find((plan) => this.host.isDirty(plan.name))
    if (dirty) {
      toast(`Save or revert your edits to ${dirty.name} first.`)
      return
    }
    let done = 0
    for (const plan of this.plans) {
      const result = await api.writeInstruction({ folder, name: plan.name, content: plan.text, expected: plan.stamp, overwrite: false })
      if (!result.ok) {
        toast(`${plan.name} was not updated: ${result.message}`)
        break
      }
      done += 1
    }
    for (const box of this.creates.values()) box.checked = false
    await this.host.onApplied()
    if (done > 0) toast(`Shared instructions written to ${done} ${done === 1 ? 'file' : 'files'}.`, 'info')
  }
}
