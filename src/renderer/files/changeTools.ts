import type { Extension } from '@codemirror/state'
import type { AgentFileTouch, HunkRequest, LineSessionsResult } from '../../shared/codeNavExtras'
import { api } from '../api'
import { focusPane } from '../actions'
import { derivePanes } from '../derive'
import { openContextMenu } from '../components/contextMenu'
import { confirmDialog } from '../components/dialogs'
import { toast } from '../components/toast'
import { store } from '../state'
import { timelineRequest } from '../timelineActions'
import { changePreview, lineSpan, type Hunk } from './changeHunks'
import { changeGutter } from './changeGutter'
import type { FileDoc } from './fileDoc'
import { lineTouchGutter } from './lineTouchGutter'
import { touchedLines } from './lineTouch'
import type { ToolsHost } from './toolsHost'

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

/** The open pane that runs this session, or null when it has been closed. */
export function paneForSession(sessionId: string): string | null {
  const view = derivePanes(store.state).find((candidate) => candidate.agent !== 'shell' && timelineRequest(candidate.pane.id)?.sessionId === sessionId)
  return view?.pane.id ?? null
}

const request = (doc: FileDoc, hunk: Hunk): HunkRequest => ({
  path: doc.path, oldStart: hunk.oldStart, oldLines: hunk.oldLines, newStart: hunk.newStart, newLines: hunk.newLines, expectedMtime: doc.mtimeMs, expectedHunk: hunk.text
})

/** Stage or revert one change from the Changes gutter, and show which agent session changed each line. */
export class ChangeTools {
  private readonly touches = new WeakMap<FileDoc, { key: string; result: LineSessionsResult | null }>()

  constructor(private readonly host: ToolsHost) {}

  private touchKey(doc: FileDoc): string {
    return `${doc.mtimeMs}|${doc.stat?.added}|${doc.stat?.removed}`
  }

  /** Changes when the gutters would draw something different, so the view redraws them only then. */
  signature(doc: FileDoc): string {
    const touched = this.touches.get(doc)
    return `${doc.dirty}|${doc.newFile}|${doc.mtimeMs}|${touched?.key}|${touched?.result?.ok ? touched.result.lines.length : 'x'}`
  }

  /** Loads who changed the lines of a file the first time its changes are shown, and again after the file changes. */
  load(doc: FileDoc): void {
    const folder = this.host.folder()
    const key = this.touchKey(doc)
    if (!folder || !doc.changes || this.touches.get(doc)?.key === key) return
    this.touches.set(doc, { key, result: null })
    void api.lineSessions(folder, doc.path).catch((): LineSessionsResult => ({ ok: false, error: 'The session log could not be read.' })).then((result) => {
      if (this.touches.get(doc)?.key !== key) return
      this.touches.set(doc, { key, result })
      this.host.refreshAnnotations()
    })
  }

  result(doc: FileDoc): LineSessionsResult | null {
    return this.touches.get(doc)?.result ?? null
  }

  /** The session log marks only the lines the timeline blame has not placed: blame knows the line, the log knows the file. */
  extensions(doc: FileDoc, placed: ReadonlyMap<number, unknown>): Extension[] {
    const out: Extension[] = []
    const lines = new Map([...touchedLines(this.result(doc))].filter(([line]) => !placed.has(line)))
    if (lines.size > 0) out.push(lineTouchGutter(lines, { open: (touch) => this.openSession(touch) }))
    out.push(changeGutter({ open: (hunk, anchor) => this.menu(doc, hunk, anchor) }))
    return out
  }

  private openSession(touch: AgentFileTouch): void {
    const paneId = paneForSession(touch.sessionId)
    if (paneId) focusPane(paneId)
    else toast('That session is not open any more.', 'info')
  }

  private menu(doc: FileDoc, hunk: Hunk, anchor: DOMRect): void {
    const span = lineSpan(hunk)
    const saved = !doc.dirty
    const detail = saved ? undefined : 'Save the file first'
    openContextMenu({
      x: anchor.right, y: anchor.bottom, anchor, label: `Change at ${span}`, returnFocus: () => doc.editor?.focus(),
      entries: [
        { heading: `Change at ${span}` },
        { label: 'Stage this change', disabled: !saved, detail, run: () => void this.stage(doc, hunk) },
        { label: 'Revert this change…', disabled: !saved, detail, run: () => void this.revert(doc, hunk) }
      ]
    })
  }

  private async stage(doc: FileDoc, hunk: Hunk): Promise<void> {
    const folder = this.host.folder()
    if (!folder) return
    const result = await api.stageChange(folder, request(doc, hunk)).catch((error: Error) => ({ ok: false as const, error: error.message }))
    if (result.ok) toast(`Staged ${lineSpan(hunk)} of ${baseName(doc.path)}`, 'info')
    else toast(result.error)
  }

  private async revert(doc: FileDoc, hunk: Hunk): Promise<void> {
    const folder = this.host.folder()
    if (!folder) return
    const name = baseName(doc.path)
    const span = lineSpan(hunk)
    const confirmed = await confirmDialog({
      title: `Revert the change at ${span} in ${name}?`,
      body: `${doc.path}\n${doc.newFile ? 'This file is not on main yet, so these lines are removed:' : `${hunk.added} added and ${hunk.removed} removed lines go back to the version on main:`}\n${changePreview(hunk)}\nThis cannot be undone.`,
      confirmLabel: `Revert ${span} in ${name}`
    })
    if (!confirmed) return
    const result = await api.revertChange(folder, request(doc, hunk)).catch((error: Error) => ({ ok: false as const, error: error.message }))
    if (!result.ok) return toast(result.error)
    toast(`Reverted ${span} of ${name}`, 'info')
    this.host.changedOnDisk([doc.path])
  }
}
