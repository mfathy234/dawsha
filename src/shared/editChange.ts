/** A block of text an edit wrote, to be found again in the file. */
export interface EditPiece {
  text: string
  /** Lines around the block in a patch, to tell identical blocks apart. */
  before?: string
  after?: string
  /** Every occurrence was replaced (replace_all). */
  all?: boolean
}

/** What an edit tool call wrote: its new text, kept so the lines it produced can be found later. */
export interface EditChange {
  pieces: EditPiece[]
  /** The pieces are the whole file (a write or a new file). */
  whole?: boolean
  /** The file was deleted. */
  deleted?: boolean
}

/** Text beyond this is not kept, so the edit is estimated instead. */
export const CHANGE_MAX_CHARS = 20_000

const CONTEXT_LINES = 2

const str = (value: unknown): string => (typeof value === 'string' ? value : '')
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const capped = (change: EditChange): EditChange | undefined => (change.pieces.reduce((sum, piece) => sum + piece.text.length + (piece.before?.length ?? 0) + (piece.after?.length ?? 0), 0) > CHANGE_MAX_CHARS ? undefined : change)

/** The change an Edit, MultiEdit, Write or similar tool call makes, from its input. */
export function changeFromEdit(name: string, input: Record<string, unknown>): EditChange | undefined {
  const content = input.content ?? input.file_text
  if (typeof content === 'string' && (name === 'write' || name.startsWith('write') || name === 'create_file' || name.includes('replace_editor'))) {
    return capped({ pieces: content === '' ? [] : [{ text: content }], whole: true })
  }
  const all = input.replace_all === true
  const piece = (source: Record<string, unknown>): EditPiece[] => {
    const text = str(source.new_string ?? source.newString ?? source.new_str ?? source.new_source)
    return text === '' ? [] : [all ? { text, all } : { text }]
  }
  const list = Array.isArray(input.edits) ? input.edits.filter(isRecord) : [input]
  return capped({ pieces: list.flatMap(piece) })
}

/** One change per file of an apply_patch body, in the order parsePatch lists the files. */
export function changeFromPatch(patch: string): Array<EditChange | undefined> {
  const out: Array<EditChange | undefined> = []
  let mode: 'update' | 'add' | 'delete' | null = null
  let pieces: EditPiece[] = []
  let added: string[] = []
  let context: string[] = []
  let run: { lines: string[]; before: string[] } | null = null
  let after: string[] | null = null

  const closeRun = (): void => {
    if (run && run.lines.length > 0) {
      pieces.push({ text: run.lines.join('\n'), before: run.before.join('\n'), after: (after ?? []).join('\n') })
    }
    run = null
    after = null
  }
  const closeFile = (): void => {
    closeRun()
    if (mode === 'add') out.push(capped({ pieces: added.length > 0 ? [{ text: added.join('\n') }] : [], whole: true }))
    else if (mode === 'delete') out.push({ pieces: [], deleted: true })
    else if (mode === 'update') out.push(capped({ pieces }))
    mode = null
    pieces = []
    added = []
    context = []
  }

  for (const line of patch.split(/\r?\n/)) {
    const header = /^\*\*\* (Update|Add|Delete) File:\s*(.+)$/.exec(line)
    if (header) {
      closeFile()
      mode = header[1].toLowerCase() as 'update' | 'add' | 'delete'
      continue
    }
    if (mode === null || line.startsWith('*** ')) continue
    if (mode === 'add') {
      if (line.startsWith('+')) added.push(line.slice(1))
      continue
    }
    if (mode !== 'update') continue
    if (line.startsWith('@@')) {
      closeRun()
      context = []
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      if (!run) run = { lines: [], before: context.slice(-CONTEXT_LINES) }
      else if (after !== null) {
        closeRun()
        run = { lines: [], before: context.slice(-CONTEXT_LINES) }
      }
      run.lines.push(line.slice(1))
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      if (run && after !== null) closeRun()
      if (!run) run = { lines: [], before: context.slice(-CONTEXT_LINES) }
    } else {
      const text = line.startsWith(' ') ? line.slice(1) : line
      if (run) {
        after = [...(after ?? []), text].slice(0, CONTEXT_LINES)
        context = [...context, text]
      } else context = [...context, text]
    }
  }
  closeFile()
  return out
}
