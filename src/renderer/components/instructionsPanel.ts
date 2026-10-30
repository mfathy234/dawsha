import {
  INSTRUCTION_FILES,
  detectEol,
  formatSize,
  toLf,
  withEol,
  type Eol,
  type FileStamp,
  type InstructionFileName
} from '../../shared/instructions'
import type { Project } from '../../shared/types'
import { api } from '../api'
import { setInstructionsGuard } from '../instructionsActions'
import { clear, h } from '../dom'
import { store, type AppState } from '../state'
import { primaryModifierPressed } from '../../shared/shortcuts'
import { confirmDialog } from './dialogs'
import { InstructionsSharedComponent, type FileSnap } from './instructionsShared'
import { toast } from './toast'
import { selectMenu, syncSelectMenu } from './selectMenu'

interface OpenFile {
  name: InstructionFileName
  eol: Eol
  stamp: FileStamp | null
  original: string
}

const modified = (ms: number): string => new Date(ms).toLocaleString()

export class InstructionsPanelComponent {
  readonly el = h('section', { class: 'instructions-panel', 'aria-label': 'Project instructions' })
  private readonly select = h('select', { class: 'rp-project field-select instr-project', id: 'instr-project' })
  private readonly rows = h('div', { class: 'instr-files' })
  private readonly editor = h('div', { class: 'instr-editor', hidden: true })
  private readonly title = h('strong', { class: 'instr-title' })
  private readonly dirtyMark = h('span', { class: 'instr-dirty', id: 'instr-dirty' })
  private readonly area = h('textarea', {
    class: 'text-input instr-text instr-area',
    id: 'instr-editor',
    spellcheck: 'false',
    'aria-label': 'File content'
  })
  private readonly conflict = h('div', { class: 'instr-conflict', id: 'instr-conflict', role: 'alert', hidden: true })
  private readonly conflictText = h('span', {})
  private readonly saveButton = h('button', { class: 'btn primary small', type: 'button', id: 'instr-save' }, 'Save')
  private readonly revertButton = h('button', { class: 'btn ghost small', type: 'button', id: 'instr-revert' }, 'Revert')
  private readonly shared = new InstructionsSharedComponent({
    folder: () => this.project?.folder ?? null,
    isDirty: (name) => this.open?.name === name && this.isDirty(),
    onApplied: () => this.reloadAll()
  })
  private project: Project | null = null
  private open: OpenFile | null = null
  private visible = false
  private optionsSignature = ''

  constructor() {
    this.select.addEventListener('change', () => void this.switchProject(this.select.value))
    this.area.addEventListener('input', () => this.syncChrome())
    this.area.addEventListener('keydown', (event) => {
      if (primaryModifierPressed(event) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 's') {
        event.preventDefault()
        event.stopPropagation()
        void this.save(false)
      }
    })
    this.saveButton.addEventListener('click', () => void this.save(false))
    this.revertButton.addEventListener('click', () => void this.revert())
    this.conflict.append(
      this.conflictText,
      h('button', { class: 'btn small', type: 'button', id: 'instr-reload', onClick: () => void this.reloadOpen() }, 'Reload'),
      h('button', { class: 'btn small danger', type: 'button', id: 'instr-overwrite', onClick: () => void this.overwrite() }, 'Overwrite')
    )
    this.editor.append(
      h(
        'div',
        { class: 'instr-editor-head' },
        this.title,
        this.dirtyMark,
        h('span', { class: 'instr-spacer' }),
        this.revertButton,
        this.saveButton,
        h('button', { class: 'btn ghost small', type: 'button', id: 'instr-close', onClick: () => void this.closeEditor() }, 'Close')
      ),
      this.conflict,
      this.area
    )
    this.el.append(
      h('p', { class: 'lede' }, 'The instruction files your agents read from the project folder: CLAUDE.md, AGENTS.md and GEMINI.md.'),
      h('div', { class: 'instr-bar' }, h('label', { for: 'instr-project' }, 'Project'), selectMenu(this.select)),
      this.rows,
      this.editor,
      this.shared.el
    )
    setInstructionsGuard((projectId) => (projectId === this.project?.id ? Promise.resolve(true) : this.confirmDiscard()))
  }

  private isDirty(): boolean {
    return this.open !== null && this.area.value !== this.open.original
  }

  private syncChrome(): void {
    const dirty = this.isDirty()
    this.dirtyMark.textContent = dirty ? 'Unsaved changes' : this.open ? 'No changes' : ''
    this.dirtyMark.classList.toggle('on', dirty)
    this.saveButton.disabled = !dirty && this.open?.stamp !== null
    this.revertButton.disabled = !dirty
  }

  private async confirmDiscard(): Promise<boolean> {
    if (!this.open || !this.isDirty()) return true
    return confirmDialog({
      title: `Discard your edits to ${this.open.name}?`,
      body: 'You have unsaved changes. Leaving now discards them.',
      confirmLabel: `Discard edits to ${this.open.name}`
    })
  }

  update(state: AppState): void {
    const projects = state.settings.projects
    const signature = JSON.stringify(projects.map((p) => [p.id, p.name, p.folder]))
    if (signature !== this.optionsSignature) {
      this.optionsSignature = signature
      clear(this.select)
      for (const p of projects) this.select.append(h('option', { value: p.id }, p.name))
      if (this.project && !projects.some((p) => p.id === this.project?.id)) this.project = null
    }
    if (state.projectsTab !== 'instructions') {
      this.visible = false
      return
    }
    const wanted = this.wantedProject(state)
    const becameVisible = !this.visible
    this.visible = true
    if (wanted && wanted.id !== this.project?.id) void this.load(wanted)
    else if (becameVisible && this.project) void this.reloadAll()
    if (this.project) this.select.value = this.project.id
    syncSelectMenu(this.select)
  }

  private wantedProject(state: AppState): Project | null {
    const projects = state.settings.projects
    const requested = projects.find((p) => p.id === state.instructionsProject)
    if (requested) return requested
    if (this.project) return this.project
    const pane = state.panes.find((p) => p.id === state.focusedId)
    return projects.find((p) => p.id === pane?.projectId) ?? projects[0] ?? null
  }

  private async switchProject(id: string): Promise<void> {
    if (id === this.project?.id) return
    if (!(await this.confirmDiscard())) {
      this.select.value = this.project?.id ?? ''
      syncSelectMenu(this.select)
      return
    }
    store.patch({ instructionsProject: id })
  }

  private async load(project: Project): Promise<void> {
    this.project = project
    this.open = null
    this.editor.hidden = true
    this.shared.reset()
    await this.reloadAll()
  }

  private async readSnap(project: Project, name: InstructionFileName): Promise<FileSnap> {
    const read = await api.readInstruction(project.folder, name)
    if (!read.ok) return { name, kind: 'error', message: read.message }
    if (!read.exists) return { name, kind: 'missing' }
    return { name, kind: 'file', content: read.content, stamp: { mtimeMs: read.mtimeMs, size: read.size }, size: read.size }
  }

  private async reloadAll(): Promise<void> {
    const project = this.project
    if (!project) return
    const snaps = await Promise.all(INSTRUCTION_FILES.map(({ name }) => this.readSnap(project, name)))
    if (this.project?.id !== project.id) return
    this.renderRows(project, snaps)
    this.shared.setSnaps(snaps)
    if (this.open && !this.isDirty() && this.conflict.hidden) await this.openFile(this.open.name, true)
  }

  private rowActions(project: Project, snap: FileSnap): HTMLElement[] {
    if (snap.kind === 'error') return []
    const exists = snap.kind === 'file'
    const edit = h(
      'button',
      {
        class: 'btn small ghost',
        type: 'button',
        'data-edit': snap.name,
        'aria-label': `${exists ? 'Edit' : 'Create'} ${snap.name}`,
        onClick: () => void this.openFile(snap.name, false)
      },
      exists ? 'Edit' : 'Create'
    )
    if (!exists) return [edit]
    const code = h(
      'button',
      {
        class: 'btn small ghost',
        type: 'button',
        'data-open-file': snap.name,
        'aria-label': `Open ${snap.name} with default app`,
        onClick: () => void api.openInstruction(project.folder, snap.name)
      },
      'Open file'
    )
    return [edit, code]
  }

  private renderRows(project: Project, snaps: FileSnap[]): void {
    clear(this.rows)
    for (const snap of snaps) {
      const agent = INSTRUCTION_FILES.find((f) => f.name === snap.name)?.agent ?? ''
      const detail =
        snap.kind === 'file'
          ? `${formatSize(snap.size)} · modified ${modified(snap.stamp.mtimeMs)}`
          : snap.kind === 'missing'
            ? 'missing'
            : snap.message
      const status = snap.kind === 'file' ? 'exists' : snap.kind === 'missing' ? 'missing' : 'unreadable'
      this.rows.append(
        h(
          'div',
          { class: 'instr-row', 'data-file': snap.name, 'data-status': status },
          h('div', { class: 'instr-main' }, h('strong', {}, snap.name), h('span', { class: 'muted' }, agent)),
          h('span', { class: 'instr-detail muted' }, detail),
          h('div', { class: 'instr-row-actions' }, ...this.rowActions(project, snap))
        )
      )
    }
  }

  private async openFile(name: InstructionFileName, keepConflict: boolean): Promise<void> {
    const project = this.project
    if (!project) return
    if (!keepConflict && this.open?.name !== name && !(await this.confirmDiscard())) return
    const read = await api.readInstruction(project.folder, name)
    if (!read.ok) {
      toast(read.message)
      return
    }
    const content = read.exists ? read.content : ''
    this.open = {
      name,
      eol: detectEol(content),
      stamp: read.exists ? { mtimeMs: read.mtimeMs, size: read.size } : null,
      original: toLf(content)
    }
    this.area.value = this.open.original
    this.title.textContent = read.exists ? name : `${name} (new file)`
    this.conflict.hidden = true
    this.editor.hidden = false
    this.syncChrome()
  }

  private async closeEditor(): Promise<void> {
    if (!(await this.confirmDiscard())) return
    this.open = null
    this.editor.hidden = true
    this.conflict.hidden = true
  }

  private async revert(): Promise<void> {
    if (!this.open || !this.isDirty()) return
    const confirmed = await confirmDialog({
      title: `Revert ${this.open.name}?`,
      body: 'This discards your unsaved edits and restores the text you opened.',
      confirmLabel: `Revert ${this.open.name}`
    })
    if (!confirmed || !this.open) return
    this.area.value = this.open.original
    this.syncChrome()
  }

  private async save(overwrite: boolean): Promise<void> {
    const project = this.project
    const open = this.open
    if (!project || !open) return
    const content = withEol(this.area.value, open.eol)
    const result = await api.writeInstruction({ folder: project.folder, name: open.name, content, expected: open.stamp, overwrite })
    if (!result.ok) {
      if (result.reason === 'changed') {
        this.conflictText.textContent = `${open.name} changed on disk since you opened it. Your edits were not saved.`
        this.conflict.hidden = false
      } else toast(result.message)
      return
    }
    this.conflict.hidden = true
    this.open = { ...open, stamp: { mtimeMs: result.mtimeMs, size: result.size }, original: toLf(this.area.value) }
    this.syncChrome()
    toast(`Saved ${open.name}.`, 'info')
    await this.reloadAll()
  }

  private async reloadOpen(): Promise<void> {
    if (this.open) await this.openFile(this.open.name, true)
  }

  private async overwrite(): Promise<void> {
    if (!this.open) return
    const name = this.open.name
    const confirmed = await confirmDialog({
      title: `Overwrite ${name}?`,
      body: `${name} was changed on disk by something else. Saving now replaces that version with yours and the other change is lost.`,
      confirmLabel: `Overwrite ${name}`
    })
    if (confirmed) await this.save(true)
  }
}
