import { api } from '../api'
import { h } from '../dom'
import { toast } from '../components/toast'
import type { CursorInfo, EditorTheme, FileEditor } from './editor'
import type { DiffStat } from './diffStat'
import type { OutlineItem } from './outline'

type EditorModule = typeof import('./editor')
type StatModule = typeof import('./diffStat')

let editorModule: Promise<EditorModule> | null = null
let statModule: Promise<StatModule> | null = null

/** The CodeMirror bundle loads the first time a file is opened, so startup stays as fast as before. */
export function loadEditorModule(): Promise<EditorModule> {
  editorModule ??= import('./editor')
  return editorModule
}

const loadStatModule = (): Promise<StatModule> => (statModule ??= import('./diffStat'))

export type DocStatus = 'idle' | 'loading' | 'ready' | 'binary' | 'large' | 'missing'

export interface DocHooks {
  theme(): EditorTheme
  isChanged(path: string): boolean
  /** Something the view shows changed: dirty, mode, conflict, status. */
  changed(doc: FileDoc): void
  /** The first edit pins a preview tab. */
  edited(doc: FileDoc): void
  cursor(doc: FileDoc, info: CursorInfo): void
  outlineChanged(doc: FileDoc): void
}

export type SaveOutcome = 'saved' | 'conflict' | 'failed'

/** One open file: its editor, the text last seen on disk and the edit / changes / conflict state. Lives as long as its tab. */
export class FileDoc {
  readonly host = h('div', { class: 'files-editor', hidden: true })
  status: DocStatus = 'idle'
  message = ''
  editor: FileEditor | null = null
  mtimeMs = 0
  savedText = ''
  dirty = false
  editing = false
  changes = false
  conflict = false
  deleted = false
  stat: DiffStat | null = null
  newFile = false
  private loading: Promise<void> | null = null
  private outlineTimer: number | undefined

  constructor(readonly folder: string, readonly path: string, private readonly hooks: DocHooks) {}

  ensureLoaded(): Promise<void> {
    if (this.status !== 'idle') return this.loading ?? Promise.resolve()
    this.status = 'loading'
    this.loading = this.load().finally(() => {
      this.loading = null
      this.hooks.changed(this)
    })
    return this.loading
  }

  private async load(): Promise<void> {
    const [result, module] = await Promise.all([api.projectFile(this.folder, this.path).catch((error: Error) => ({ ok: false as const, error: error.message })), loadEditorModule()])
    if (!result.ok) {
      if (await this.openDeleted(module, result.error)) return
      this.status = 'missing'
      this.message = result.error
      return
    }
    if (result.text === null) {
      this.status = result.reason === 'large' ? 'large' : 'binary'
      this.message = result.reason === 'large' ? 'This file is larger than 1 MB, so it is not shown here.' : 'This is a binary file, so it is not shown here.'
      return
    }
    this.mtimeMs = result.mtimeMs
    this.savedText = result.text
    this.mount(module, result.text, true)
    this.status = 'ready'
    void this.refreshStat()
  }

  private async openDeleted(module: EditorModule, error: string): Promise<boolean> {
    if (!/no longer exists/.test(error)) return false
    const result = await api.fileAgainstBase(this.folder, this.path).catch(() => null)
    if (!result?.ok || !result.deleted) return false
    this.deleted = true
    this.mount(module, '', true)
    this.editor?.showChanges(result.base)
    this.changes = true
    this.stat = { added: 0, removed: result.base?.split('\n').length ?? 0 }
    this.status = 'ready'
    return true
  }

  private mount(module: EditorModule, text: string, readOnly: boolean): void {
    const editor = module.createEditor(this.host, { text, path: this.path, readOnly, theme: this.hooks.theme() })
    editor.onDirty(() => {
      const dirty = editor.getText() !== this.savedText
      if (dirty && !this.dirty) this.hooks.edited(this)
      this.dirty = dirty
      this.hooks.changed(this)
      this.scheduleOutline()
    })
    editor.onCursor((info) => this.hooks.cursor(this, info))
    editor.onLanguage(() => this.hooks.outlineChanged(this))
    this.editor = editor
  }

  private scheduleOutline(): void {
    window.clearTimeout(this.outlineTimer)
    this.outlineTimer = window.setTimeout(() => this.hooks.outlineChanged(this), 400)
  }

  outline(): OutlineItem[] {
    return this.editor?.outline() ?? []
  }

  get canEdit(): boolean {
    return this.status === 'ready' && !this.deleted
  }

  startEdit(): void {
    if (!this.canEdit || !this.editor) return
    this.editing = true
    this.editor.setReadOnly(false)
    this.editor.focus()
    this.hooks.changed(this)
  }

  stopEdit(): void {
    if (!this.editor) return
    this.editing = false
    this.editor.setReadOnly(true)
    this.hooks.changed(this)
  }

  /** The Changes toggle: shows the diff against main over the same editor buffer, or returns to the file. Edits are kept either way. */
  async toggleChanges(): Promise<void> {
    const editor = this.editor
    if (!editor || this.deleted) return
    if (this.changes) {
      editor.showFile()
      this.changes = false
      this.hooks.changed(this)
      return
    }
    const result = await api.fileAgainstBase(this.folder, this.path).catch((error: Error) => ({ ok: false as const, error: error.message }))
    if (!result.ok) {
      toast(result.error)
      return
    }
    if (result.reason === 'large') toast('The version on main is too large to compare, so everything shows as added.', 'info')
    editor.showChanges(result.base)
    this.changes = true
    this.hooks.changed(this)
  }

  /** Lines added and removed against main for the status bar; only asked for files git reports as changed. */
  async refreshStat(): Promise<void> {
    if (!this.editor || this.deleted) return
    if (!this.hooks.isChanged(this.path)) {
      if (this.stat !== null) {
        this.stat = null
        this.hooks.changed(this)
      }
      return
    }
    const result = await api.fileAgainstBase(this.folder, this.path).catch(() => null)
    if (!result?.ok || !this.editor) return
    const { diffStat } = await loadStatModule()
    this.newFile = result.base === null
    this.stat = diffStat(result.base, this.savedText)
    this.hooks.changed(this)
  }

  async save(): Promise<SaveOutcome> {
    const editor = this.editor
    if (!editor || !this.dirty) return 'saved'
    const text = editor.getText()
    const result = await api.writeProjectFile(this.folder, this.path, text, this.mtimeMs).catch((error: Error) => ({ ok: false as const, error: error.message }))
    return this.afterWrite(result, text)
  }

  private afterWrite(result: Awaited<ReturnType<typeof api.writeProjectFile>>, text: string): SaveOutcome {
    if (result.ok) {
      this.mtimeMs = result.mtimeMs
      this.savedText = text
      this.dirty = this.editor ? this.editor.getText() !== text : false
      this.conflict = false
      this.hooks.changed(this)
      void this.refreshStat()
      return 'saved'
    }
    if (result.conflict) {
      this.conflict = true
      this.hooks.changed(this)
      return 'conflict'
    }
    toast(result.error)
    return 'failed'
  }

  /** "Keep mine": writes the buffer over whatever is on disk now. */
  async overwrite(): Promise<SaveOutcome> {
    const editor = this.editor
    if (!editor) return 'failed'
    const current = await api.projectFile(this.folder, this.path).catch(() => null)
    if (!current?.ok) {
      toast(current?.error ?? 'Could not read the file on disk.')
      return 'failed'
    }
    const text = editor.getText()
    const result = await api.writeProjectFile(this.folder, this.path, text, current.mtimeMs).catch((error: Error) => ({ ok: false as const, error: error.message }))
    return this.afterWrite(result, text)
  }

  /** "Reload theirs": takes the disk version and drops the buffer's edits. */
  async reload(): Promise<void> {
    const result = await api.projectFile(this.folder, this.path).catch(() => null)
    if (!result?.ok || result.text === null || !this.editor) {
      toast(result?.ok === false ? result.error : 'Could not reload the file.')
      return
    }
    this.editor.setText(result.text)
    this.mtimeMs = result.mtimeMs
    this.savedText = result.text
    this.dirty = false
    this.conflict = false
    this.hooks.changed(this)
    this.hooks.outlineChanged(this)
    void this.refreshStat()
  }

  /** After a file watcher event: a clean buffer follows the disk quietly, an edited one raises the conflict bar. */
  async checkDisk(): Promise<void> {
    if (this.status !== 'ready' || this.deleted || !this.editor) return
    const result = await api.projectFile(this.folder, this.path).catch(() => null)
    if (!result?.ok || result.text === null || result.mtimeMs === this.mtimeMs) return
    if (this.dirty) {
      if (!this.conflict) {
        this.conflict = true
        this.hooks.changed(this)
      }
      return
    }
    this.editor.setText(result.text)
    this.mtimeMs = result.mtimeMs
    this.savedText = result.text
    this.hooks.outlineChanged(this)
    void this.refreshStat()
    this.hooks.changed(this)
  }

  setTheme(theme: EditorTheme): void {
    this.editor?.setTheme(theme)
  }

  show(visible: boolean): void {
    this.host.hidden = !visible
  }

  destroy(): void {
    window.clearTimeout(this.outlineTimer)
    this.editor?.destroy()
    this.editor = null
    this.host.remove()
  }
}
