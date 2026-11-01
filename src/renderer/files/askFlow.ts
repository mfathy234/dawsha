import { toProjectPath } from '../../shared/projectPaths'
import type { CodeNavHit } from '../../shared/codeNav'
import { openContextMenu } from '../components/contextMenu'
import { toast } from '../components/toast'
import { insertIntoSession } from './filesActions'
import { askMessage } from './askAgent'
import { requestCodeNav } from './codeNavApi'
import type { ToolsHost } from './toolsHost'

const REFERENCES_WAIT_MS = 4000

const wait = <T>(ms: number, value: T): Promise<T> => new Promise((resolve) => window.setTimeout(() => resolve(value), ms))

/** The one session to send to: the only live one, or whichever the user picks from a menu at (x, y). */
export function chooseSession(host: ToolsHost, label: string, at: { x: number; y: number }, send: (paneId: string, title: string) => void): void {
  const sessions = host.sessions()
  if (sessions.length === 0) return toast('Open a session first.', 'info')
  if (sessions.length === 1) return send(sessions[0].paneId, sessions[0].title)
  openContextMenu({
    x: at.x, y: at.y, label, returnFocus: () => host.active()?.editor?.focus(),
    entries: [{ heading: 'Send to session' }, ...sessions.map((session) => ({ label: session.title, run: () => send(session.paneId, session.title) }))]
  })
}

async function referencesOf(host: ToolsHost, symbol: string | null, line: number, column: number, path: string): Promise<{ hits: CodeNavHit[]; byName: boolean }> {
  const folder = host.folder()
  if (!folder || !symbol) return { hits: [], byName: false }
  const answer = await Promise.race([requestCodeNav(folder, { kind: 'references', path, symbol, line, column }), wait(REFERENCES_WAIT_MS, null)])
  return answer?.ok ? { hits: answer.hits, byName: answer.engine === 'name' } : { hits: [], byName: false }
}

/** Ask an agent about the code under the caret: the selection or the name, its file and lines, and where it is used. */
export async function askAgent(host: ToolsHost): Promise<void> {
  const doc = host.active()
  const editor = doc?.editor
  if (!doc || !editor) return
  const cursor = editor.cursor()
  const found = editor.identifierAt(editor.cursorPos())
  const selection = editor.selectedText()
  const path = toProjectPath(host.prefix(), doc.path)
  const box = (editor.view.dom as HTMLElement).getBoundingClientRect()
  host.say('Collecting where this is used…')
  const refs = await referencesOf(host, found?.name ?? null, cursor.line, cursor.col, path)
  const startLine = selection === '' ? cursor.line : cursor.startLine
  const endLine = selection === '' ? cursor.line : cursor.endLine
  const text = selection === '' ? editor.view.state.doc.line(cursor.line).text : selection
  const message = askMessage({ path, startLine, endLine, symbol: found?.name ?? null, selection: text, references: refs.hits, referencesByName: refs.byName })
  chooseSession(host, 'Ask an agent', { x: box.left + 80, y: box.top + 80 }, (paneId, title) => {
    if (insertIntoSession(paneId, message)) toast(`Added the question to ${title}. Type what you want to know, then press Enter there.`, 'info')
  })
}
