import type { AgentEditEvent } from '../../shared/codeNavExtras'
import type { SearchRequest } from '../../shared/fileSearch'
import { toProjectPath, toRepoPath } from '../../shared/projectPaths'
import { api } from '../api'
import { askAgent } from './askFlow'
import { openCallPanel } from './callPanel'
import { ChangeTools } from './changeTools'
import { renameSymbol, replaceInFiles } from './editFlow'
import type { FileDoc } from './fileDoc'
import { followTarget, mayFollow } from './followAgent'
import type { HoverTip } from './hoverTip'
import { openJumpPick } from './jumpPick'
import { staleNote, staleRows } from './staleList'
import type { ToolsHost } from './toolsHost'

const FOLLOW_DELAY_MS = 350
const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

/** The second-wave tools of Files: hover, ask an agent, rename, replace, call hierarchy, unupdated callers, follow the agent, and the Changes gutters. */
export class CodeTools {
  readonly changes: ChangeTools
  private following = false
  private followTimer: number | undefined
  private followSkipped = false

  constructor(private readonly host: ToolsHost) {
    this.changes = new ChangeTools(host)
    api.onAgentEdits((event) => this.onAgentEdit(event))
  }

  get follows(): boolean {
    return this.following
  }

  toggleFollow(): void {
    this.following = !this.following
    this.followSkipped = false
    window.clearTimeout(this.followTimer)
    this.host.say(this.following ? 'Following the agent. Files it edits open here with the changes shown.' : 'No longer following the agent.')
  }

  private onAgentEdit(event: AgentEditEvent): void {
    const path = followTarget(event, this.host.folder(), this.following)
    if (!path) return
    window.clearTimeout(this.followTimer)
    this.followTimer = window.setTimeout(() => {
      if (!this.following) return
      if (mayFollow(this.host.active())) this.host.followTo(path)
      else if (!this.followSkipped) {
        this.followSkipped = true
        this.host.say(`${baseName(path)} changed. Not switching while you have unsaved edits.`)
      }
    }, FOLLOW_DELAY_MS)
  }

  async hover(doc: FileDoc, pos: number): Promise<HoverTip | null> {
    const folder = this.host.folder()
    const editor = doc.editor
    if (!folder || !editor || doc.status !== 'ready') return null
    const found = editor.identifierAt(pos)
    if (!found) return null
    const line = editor.view.state.doc.lineAt(pos)
    const result = await api.hover(folder, {
      path: toProjectPath(this.host.prefix(), doc.path), symbol: found.name, line: line.number, column: pos - line.from + 1, unsavedText: doc.dirty ? doc.text() : undefined
    }).catch(() => null)
    if (!result?.ok) return null
    return { display: result.display, documentation: result.documentation, byName: result.engine === 'name' }
  }

  ask(): Promise<void> {
    return askAgent(this.host)
  }

  rename(): Promise<void> {
    return renameSymbol(this.host)
  }

  replace(search: SearchRequest, replacement: string): Promise<void> {
    return replaceInFiles(this.host, search, replacement)
  }

  calls(): void {
    const doc = this.host.active()
    const editor = doc?.editor
    const folder = this.host.folder()
    if (!doc || !editor || !folder) return
    const found = editor.identifierAt(editor.cursorPos())
    if (!found) return this.host.say('Put the cursor on a name first, then open the call hierarchy.')
    const cursor = editor.cursor()
    const path = toProjectPath(this.host.prefix(), doc.path)
    openCallPanel(this.host.overlay(), {
      symbol: found.name,
      load: (direction) => api.callHierarchy(folder, { direction, path, symbol: found.name, line: cursor.line, column: cursor.col, unsavedText: doc.dirty ? doc.text() : undefined }),
      open: (hit) => void this.host.openAt(toRepoPath(this.host.prefix(), hit.path), hit.line),
      restoreFocus: () => editor.focus()
    })
  }

  /** Callers and implementations of the symbols the agents changed that the agents did not touch. */
  async stale(): Promise<void> {
    const folder = this.host.folder()
    if (!folder) return
    this.host.say('Looking for callers the agent did not update…')
    const result = await api.staleCallers(folder).catch((error: Error) => ({ ok: false as const, error: error.message }))
    if (!result.ok) return this.host.warn(result.error)
    const rows = staleRows(result.symbols)
    const note = staleNote(result)
    const prefix = this.host.prefix()
    openJumpPick(this.host.overlay(), {
      ariaLabel: 'Callers not updated', placeholder: 'Callers and implementations the agent did not update', restoreFocus: () => this.host.active()?.editor?.focus(),
      items: (query) => {
        const needle = query.trim().toLowerCase()
        const shown = rows.filter((row) => needle === '' || `${row.hit.path} ${row.hit.preview}`.toLowerCase().includes(needle))
        return [
          ...(note && needle === '' ? [{ id: 'note', label: note, run: () => undefined }] : []),
          ...shown.map((row) => ({
            id: row.id, group: row.group, label: row.hit.preview || row.hit.path, detail: `${row.kind === 'implementation' ? 'implements, ' : ''}${baseName(row.hit.path)}:${row.hit.line}`,
            run: () => void this.host.openAt(toRepoPath(prefix, row.hit.path), row.hit.line)
          }))
        ]
      },
      empty: () => (rows.length === 0 ? 'The agents have not left any callers behind. Nothing to update.' : 'Nothing matches that.')
    })
  }
}
