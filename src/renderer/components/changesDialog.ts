import {
  SUBJECT_HINT_LENGTH,
  discardMessage,
  firstLine,
  statusLetter,
  type GitDiffResult,
  type GitFileEntry,
  type RepoStatus,
  type SessionBaseline
} from '../../shared/gitStatus'
import { addedLines, gapBefore, parseUnifiedDiff, splitRows, type Hunk, type Range, type Side, type SplitRow } from '../../shared/diffView'
import { primaryModifierPressed } from '../../shared/shortcuts'
import { api } from '../api'
import { clear, h, icon } from '../dom'
import { ICONS } from '../icons'
import { confirmDialog, nextDialogId, present } from './dialogs'
import { toast } from './toast'

export interface ChangesOptions {
  folder: string
  title: string
  // Where the pane's active session started, so the view can show only what changed since.
  baseline?: SessionBaseline
  sessionTitle?: string
  onChanged(): void
}

type Tab = 'changes' | 'files'
type Layout = 'split' | 'unified'
type Scope = 'all' | 'session'

interface Gap {
  key: string
  from: number
  to: number
  offset: number
}

const LAYOUT_KEY = 'dawsha.diffLayout'
const MAX_DIFF_ROWS = 4000
const MAX_FILE_LINES = 5000
const MAX_FILTER_HITS = 300

function savedLayout(): Layout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'unified' ? 'unified' : 'split'
  } catch {
    return 'split'
  }
}

function saveLayout(layout: Layout): void {
  try {
    localStorage.setItem(LAYOUT_KEY, layout)
  } catch {
    // Remembering the layout is a convenience only.
  }
}

export function fileState(file: GitFileEntry): { label: string; tone: 'new' | 'mod' | 'del' | 'conflict' } {
  if (file.conflicted) return { label: 'Conflict', tone: 'conflict' }
  const letter = statusLetter(file)
  if (letter === 'U' || letter === 'A') return { label: 'New', tone: 'new' }
  if (letter === 'D') return { label: 'Deleted', tone: 'del' }
  if (letter === 'R') return { label: 'Renamed', tone: 'mod' }
  if (letter === 'C') return { label: 'Copied', tone: 'new' }
  return { label: 'Modified', tone: 'mod' }
}

function stateChip(file: GitFileEntry, extra = ''): HTMLElement {
  const state = fileState(file)
  return h('span', { class: `changes-state tone-${state.tone}${extra}` }, state.label)
}

function splitPath(path: string): { dir: string; name: string } {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? { dir: '', name: path } : { dir: path.slice(0, slash + 1), name: path.slice(slash + 1) }
}

function counts(added: number | null, removed: number | null, untracked = false): HTMLElement {
  if (added === null && removed === null) return h('span', { class: 'changes-counts muted' }, untracked ? 'new' : 'binary')
  return h('span', { class: 'changes-counts' }, h('span', { class: 'add' }, `+${added ?? 0}`), ' ', h('span', { class: 'del' }, `−${removed ?? 0}`))
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function fileLines(text: string): string[] {
  const lines = text.split('\n').map((line) => line.replace(/\r$/, ''))
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

function marked(text: string, marks: Range[], kind: string): Node[] {
  if (marks.length === 0) return [document.createTextNode(text)]
  const out: Node[] = []
  let at = 0
  for (const [start, end] of marks) {
    if (start > at) out.push(document.createTextNode(text.slice(at, start)))
    out.push(h('mark', { class: kind }, text.slice(start, end)))
    at = end
  }
  if (at < text.length) out.push(document.createTextNode(text.slice(at)))
  return out
}

function splitCells(side: Side | null): HTMLElement[] {
  if (!side) return [h('td', { class: 'dv-no dv-blank' }), h('td', { class: 'dv-code dv-blank' })]
  return [
    h('td', { class: `dv-no ${side.kind}` }, String(side.no)),
    h('td', { class: `dv-code ${side.kind}` }, ...marked(side.text, side.marks, side.kind))
  ]
}

function unifiedRow(side: Side, old: number | null, now: number | null): HTMLElement {
  return h(
    'tr',
    { class: `dv-${side.kind}` },
    h('td', { class: `dv-no ${side.kind}` }, old === null ? '' : String(old)),
    h('td', { class: `dv-no ${side.kind}` }, now === null ? '' : String(now)),
    h('td', { class: `dv-code ${side.kind}` }, ...marked(side.text, side.marks, side.kind))
  )
}

// Removed lines come first, then the added ones, the way a unified diff reads.
function unifiedRows(rows: SplitRow[]): HTMLElement[] {
  const out: HTMLElement[] = []
  let removed: Side[] = []
  let added: Side[] = []
  const flush = (): void => {
    for (const side of removed) out.push(unifiedRow(side, side.no, null))
    for (const side of added) out.push(unifiedRow(side, null, side.no))
    removed = []
    added = []
  }
  for (const row of rows) {
    if (row.left?.kind === 'context' && row.right) {
      flush()
      out.push(unifiedRow(row.right, row.left.no, row.right.no))
      continue
    }
    if (row.left) removed.push(row.left)
    if (row.right) added.push(row.right)
  }
  flush()
  return out
}

function gapsOf(hunks: Hunk[], total: number | null): Map<number, Gap> {
  const gaps = new Map<number, Gap>()
  hunks.forEach((hunk, index) => {
    const gap = gapBefore(hunks, index)
    if (gap) gaps.set(index, { key: `g${index}`, ...gap, offset: hunk.oldStart - hunk.newStart })
  })
  const last = hunks[hunks.length - 1]
  if (last && total !== null) {
    const from = last.newStart + last.newCount
    if (total >= from) gaps.set(hunks.length, { key: 'end', from, to: total, offset: last.oldStart + last.oldCount - from })
  }
  return gaps
}

interface TreeDir {
  name: string
  path: string
  dirs: Map<string, TreeDir>
  files: string[]
}

function buildTree(paths: string[]): TreeDir {
  const root: TreeDir = { name: '', path: '', dirs: new Map(), files: [] }
  for (const path of paths) {
    const parts = path.split('/')
    let node = root
    for (const part of parts.slice(0, -1)) {
      let next = node.dirs.get(part)
      if (!next) {
        next = { name: part, path: node.path ? `${node.path}/${part}` : part, dirs: new Map(), files: [] }
        node.dirs.set(part, next)
      }
      node = next
    }
    node.files.push(path)
  }
  return root
}

function ancestors(path: string): string[] {
  const parts = path.split('/')
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'))
}

export function openChangesDialog(options: ChangesOptions): Promise<void> {
  const id = nextDialogId()
  const baseline = options.baseline
  let tab: Tab = 'changes'
  let layout: Layout = savedLayout()
  let scope: Scope = 'all'
  let status: RepoStatus | null = null
  let allFiles: GitFileEntry[] = []
  let sessionSince: number | null = null
  let fellBack = false
  let busy = false
  let current: string | null = null
  let loadToken = 0
  const unchecked = new Set<string>()
  const diffs = new Map<string, GitDiffResult>()
  const texts = new Map<string, string[] | null>()
  const expanded = new Map<string, Set<string>>()

  let projectList: string[] | null = null
  let truncated = false
  let tree: TreeDir | null = null
  const openDirs = new Set<string>()
  let viewing: string | null = null
  let viewToken = 0

  // Header
  const changesTab = h('button', { class: 'changes-tab', type: 'button', role: 'tab', 'aria-selected': 'true' }) as HTMLButtonElement
  const filesTab = h('button', { class: 'changes-tab', type: 'button', role: 'tab', 'aria-selected': 'false' }) as HTMLButtonElement
  const branchLine = h('span', { class: 'changes-branch' })
  const totals = h('span', { class: 'changes-totals' })
  const splitButton = h('button', { class: 'seg-btn', type: 'button' }, 'Side by side') as HTMLButtonElement
  const unifiedButton = h('button', { class: 'seg-btn', type: 'button' }, 'Unified') as HTMLButtonElement
  const layoutSeg = h('div', { class: 'changes-seg', role: 'group', 'aria-label': 'Diff layout' }, splitButton, unifiedButton)
  const allButton = h('button', { class: 'seg-btn', type: 'button' }, 'All changes') as HTMLButtonElement
  const sessionButton = h('button', { class: 'seg-btn', type: 'button' }, 'This session') as HTMLButtonElement
  const scopeSeg = h('div', { class: 'changes-seg', role: 'group', 'aria-label': 'Which changes', hidden: !baseline }, allButton, sessionButton)
  const close = h('button', { class: 'cbtn quiet', type: 'button' }, 'Close') as HTMLButtonElement
  const head = h(
    'div',
    { class: 'changes-head' },
    h('div', { class: 'changes-tabs', role: 'tablist', 'aria-label': 'View' }, changesTab, filesTab),
    h('span', { class: 'changes-ctx' }, h('b', {}, options.title), ' ', branchLine),
    totals,
    h('span', { class: 'spacer' }),
    layoutSeg,
    scopeSeg,
    close
  )
  const sinceBar = h('div', { class: 'changes-since', hidden: true })

  // Changes: file list and commit
  const selectAll = h('input', { type: 'checkbox', id: `chg-all-${id}`, 'aria-label': 'Select all files' }) as HTMLInputElement
  const selectedText = h('span', { class: 'changes-picked' })
  const list = h('div', { class: 'changes-list', role: 'list', 'aria-label': 'Changed files' })
  const area = h('textarea', {
    class: 'changes-message',
    id: `chg-msg-${id}`,
    rows: '3',
    spellcheck: 'false',
    placeholder: 'Commit message',
    'aria-label': 'Commit message'
  }) as HTMLTextAreaElement
  const hint = h('span', { class: 'changes-subject' })
  const error = h('pre', { class: 'changes-error', role: 'alert', hidden: true })
  const discard = h('button', { class: 'cbtn danger', type: 'button', 'data-discard': '' }, 'Discard…') as HTMLButtonElement
  const commit = h('button', { class: 'cbtn', type: 'button', 'data-commit': '' }, 'Commit') as HTMLButtonElement
  const commitPush = h('button', { class: 'cbtn primary', type: 'button', 'data-commit-push': '', hidden: true }, 'Commit and push') as HTMLButtonElement
  const side = h(
    'aside',
    { class: 'changes-side' },
    h('div', { class: 'changes-select' }, selectAll, h('label', { for: `chg-all-${id}` }, 'Changed files'), h('span', { class: 'spacer' }), selectedText),
    list,
    h(
      'div',
      { class: 'changes-commit' },
      h('div', { class: 'changes-message-wrap' }, area, hint),
      error,
      h('div', { class: 'changes-actions' }, discard, h('span', { class: 'spacer' }), commit, commitPush)
    )
  )

  // Changes: the selected file's diff
  const fileHead = h('div', { class: 'changes-file-head' })
  const prev = h('button', { class: 'cbtn', type: 'button' }, 'Previous') as HTMLButtonElement
  const next = h('button', { class: 'cbtn', type: 'button' }, 'Next') as HTMLButtonElement
  const openEditor = h('button', { class: 'cbtn', type: 'button' }, 'Open in editor') as HTMLButtonElement
  const revert = h('button', { class: 'cbtn quiet', type: 'button' }, 'Revert file') as HTMLButtonElement
  const columns = h('div', { class: 'changes-columns' })
  const diffArea = h('div', { class: 'changes-diff', tabindex: '-1' })
  const main = h(
    'section',
    { class: 'changes-main' },
    h('div', { class: 'changes-file-bar' }, fileHead, h('span', { class: 'spacer' }), prev, next, openEditor, revert),
    columns,
    diffArea,
    h('div', { class: 'changes-hint' }, 'J and K move between files. Space selects the file for the commit.')
  )
  const changesBody = h('div', { class: 'changes-body' }, side, main)

  // Files: project tree and a read-only file view
  const filter = h('input', { class: 'files-filter', type: 'search', placeholder: 'Find a file by name', 'aria-label': 'Find a file by name' }) as HTMLInputElement
  const treeBox = h('div', { class: 'files-tree', role: 'tree', 'aria-label': 'Project files' })
  const treeFoot = h('div', { class: 'files-foot' })
  const viewHead = h('div', { class: 'changes-file-head' })
  const showChanges = h('button', { class: 'cbtn', type: 'button', hidden: true }, 'Show changes') as HTMLButtonElement
  const copyPath = h('button', { class: 'cbtn', type: 'button', disabled: true }, 'Copy path') as HTMLButtonElement
  const openViewed = h('button', { class: 'cbtn', type: 'button', disabled: true }, 'Open in editor') as HTMLButtonElement
  const viewArea = h('div', { class: 'changes-diff files-view' })
  const filesBody = h(
    'div',
    { class: 'changes-body', hidden: true },
    h('aside', { class: 'changes-side' }, h('div', { class: 'files-search' }, icon(ICONS.search), filter), treeBox, treeFoot),
    h(
      'section',
      { class: 'changes-main' },
      h('div', { class: 'changes-file-bar' }, viewHead, h('span', { class: 'spacer' }), showChanges, copyPath, openViewed),
      viewArea,
      h('div', { class: 'changes-hint' }, 'Read only. Lines changed since the last commit are tinted green.')
    )
  )

  const dialog = h(
    'div',
    { class: 'dialog changes-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Changes in ${options.title}`, tabindex: '-1' },
    head,
    sinceBar,
    changesBody,
    filesBody
  )
  const shown = present<void>(dialog, undefined, dialog)

  const files = (): GitFileEntry[] => status?.files ?? []
  const selected = (): GitFileEntry[] => files().filter((file) => !unchecked.has(file.path))
  const currentFile = (): GitFileEntry | undefined => files().find((file) => file.path === current)
  const showError = (text: string | null): void => {
    error.hidden = text === null
    error.textContent = text ?? ''
  }

  const syncHeader = (): void => {
    changesTab.replaceChildren('Changes ', h('span', { class: 'changes-tab-count' }, String(files().length)))
    filesTab.replaceChildren('Files ', h('span', { class: 'changes-tab-count' }, projectList ? String(projectList.length) : '…'))
    changesTab.setAttribute('aria-selected', String(tab === 'changes'))
    filesTab.setAttribute('aria-selected', String(tab === 'files'))
    changesBody.hidden = tab !== 'changes'
    filesBody.hidden = tab !== 'files'
    layoutSeg.hidden = tab !== 'changes'
    scopeSeg.hidden = !baseline || tab !== 'changes'
    totals.hidden = tab !== 'changes'
    splitButton.setAttribute('aria-pressed', String(layout === 'split'))
    unifiedButton.setAttribute('aria-pressed', String(layout === 'unified'))
    allButton.setAttribute('aria-pressed', String(scope === 'all'))
    sessionButton.setAttribute('aria-pressed', String(scope === 'session'))
    let added = 0
    let removed = 0
    for (const file of files()) {
      added += file.added ?? 0
      removed += file.removed ?? 0
    }
    const count = files().length
    totals.replaceChildren(`${count} ${count === 1 ? 'file' : 'files'} `, h('span', { class: 'add' }, `+${added}`), ' ', h('span', { class: 'del' }, `−${removed}`))
    sinceBar.hidden = tab !== 'changes' || scope !== 'session'
    if (scope === 'session') {
      const name = options.sessionTitle ? `“${options.sessionTitle}”` : 'this session'
      sinceBar.replaceChildren(
        h('b', {}, 'This session'),
        h(
          'span',
          {},
          fellBack
            ? 'The starting point of this session is no longer in git, so every uncommitted change is shown.'
            : `Only what changed after ${name} started at ${clock(sessionSince ?? baseline?.at ?? Date.now())}.`
        )
      )
    }
  }

  const syncControls = (): void => {
    const picked = selected().length
    const total = files().length
    selectAll.checked = total > 0 && picked === total
    selectAll.indeterminate = picked > 0 && picked < total
    selectAll.disabled = busy || total === 0
    selectedText.textContent = total === 0 ? '' : `${picked} of ${total} selected`
    const noneChecked = picked === 0
    discard.disabled = busy || noneChecked
    commit.disabled = busy || noneChecked
    commitPush.disabled = busy || noneChecked
    close.disabled = busy
    const index = files().findIndex((file) => file.path === current)
    prev.disabled = index <= 0
    next.disabled = index < 0 || index >= total - 1
    openEditor.disabled = !currentFile() || fileState(currentFile() as GitFileEntry).tone === 'del'
    revert.disabled = busy || !currentFile()
    const subject = firstLine(area.value)
    hint.textContent = `${subject.length} of ${SUBJECT_HINT_LENGTH} characters`
    hint.classList.toggle('over', subject.length > SUBJECT_HINT_LENGTH)
    hint.title = 'First line of the message; 72 characters or fewer reads best in git log'
  }

  const renderBranch = (): void => {
    if (!status) return
    const parts = [status.branch ?? 'detached HEAD']
    if (status.upstream) parts.push(`${status.upstream} · ${status.ahead} ahead, ${status.behind} behind`)
    else parts.push('no upstream')
    branchLine.textContent = `on ${parts.join(' · ')}`
    commitPush.hidden = !status.upstream
  }

  const pick = (path: string): void => {
    current = path
    renderList()
    void renderDiff()
  }

  const toggleChecked = (path: string): void => {
    if (unchecked.has(path)) unchecked.delete(path)
    else unchecked.add(path)
    renderList()
  }

  const row = (file: GitFileEntry): HTMLElement => {
    const box = h('input', { type: 'checkbox', 'aria-label': file.path, 'data-path': file.path }) as HTMLInputElement
    box.checked = !unchecked.has(file.path)
    box.disabled = busy
    box.addEventListener('change', () => toggleChecked(file.path))
    const { dir, name } = splitPath(file.path)
    const label = file.origPath ? `${file.origPath} → ${file.path}` : file.path
    const choose = h(
      'button',
      { class: 'changes-pick', type: 'button', title: label, 'aria-current': file.path === current ? 'true' : undefined },
      stateChip(file),
      h('span', { class: 'changes-name' }, h('span', { class: 'changes-file' }, name), dir ? h('span', { class: 'changes-dir' }, dir) : null),
      counts(file.added, file.removed, file.untracked)
    )
    choose.addEventListener('click', () => pick(file.path))
    return h('div', { class: `changes-row${file.path === current ? ' current' : ''}`, role: 'listitem', 'data-path': file.path }, box, choose)
  }

  function renderList(): void {
    if (!status) return
    if (files().length === 0) {
      const empty = scope === 'session' ? 'Nothing changed since this session started.' : 'Working tree clean. Nothing to commit.'
      list.replaceChildren(h('p', { class: 'changes-empty' }, empty))
    } else list.replaceChildren(...files().map(row))
    syncHeader()
    syncControls()
  }

  const diffFor = async (path: string): Promise<GitDiffResult> => {
    const key = `${scope}:${path}`
    const cached = diffs.get(key)
    if (cached) return cached
    const result =
      scope === 'session' && baseline
        ? await api.gitDiffSince(options.folder, path, baseline)
        : await api.gitDiff(options.folder, path)
    diffs.set(key, result)
    return result
  }

  const textFor = async (path: string): Promise<string[] | null> => {
    if (texts.has(path)) return texts.get(path) ?? null
    const result = await api.projectFile(options.folder, path).catch(() => null)
    const lines = result?.ok && result.text !== null ? fileLines(result.text) : null
    texts.set(path, lines)
    return lines
  }

  const note = (text: string): HTMLElement => h('p', { class: 'changes-note' }, text)

  function renderColumns(): void {
    const before = scope === 'session' ? 'when this session started' : 'last commit'
    columns.hidden = layout !== 'split' || !currentFile()
    columns.replaceChildren(
      h('div', {}, h('b', {}, 'Before'), `, ${before}`),
      h('div', {}, h('b', {}, 'After'), ', your working copy')
    )
  }

  async function renderDiff(): Promise<void> {
    const token = ++loadToken
    const file = currentFile()
    renderColumns()
    syncControls()
    if (!file) {
      fileHead.replaceChildren()
      diffArea.replaceChildren(files().length === 0 ? note(scope === 'session' ? 'Nothing changed since this session started.' : 'Nothing to review.') : note('Pick a file to see its changes.'))
      return
    }
    const { dir, name } = splitPath(file.path)
    fileHead.replaceChildren(
      stateChip(file),
      h('span', { class: 'changes-path' }, dir ? h('span', { class: 'changes-dir' }, dir) : null, name),
      counts(file.added, file.removed, file.untracked)
    )
    const [result, lines] = await Promise.all([diffFor(file.path), textFor(file.path)])
    if (token !== loadToken) return
    if (!result.ok) {
      diffArea.replaceChildren(note(result.error))
      return
    }
    const hunks = parseUnifiedDiff(result.text)
    if (hunks.length === 0) {
      const binary = /^Binary |\nBinary files |^Binary files /.test(result.text) || (file.added === null && file.removed === null)
      diffArea.replaceChildren(note(binary ? 'Binary or very large file. There is no text to compare.' : 'No line changes. Only the file mode or name changed.'))
      return
    }
    const open = expanded.get(`${scope}:${file.path}`) ?? new Set<string>()
    const gaps = gapsOf(hunks, lines ? lines.length : null)
    const split = layout === 'split'
    const table = h('table', { class: `dv-table ${split ? 'dv-split' : 'dv-unified'}`, 'data-diff': file.path })
    const body = h('tbody', {})
    table.append(
      split
        ? h('colgroup', {}, h('col', { class: 'dv-col-no' }), h('col', {}), h('col', { class: 'dv-col-no' }), h('col', {}))
        : h('colgroup', {}, h('col', { class: 'dv-col-no' }), h('col', { class: 'dv-col-no' }), h('col', {})),
      body
    )
    let rendered = 0
    const contextRow = (lineNo: number, offset: number, text: string): HTMLElement => {
      const side: Side = { no: lineNo, text, kind: 'context', marks: [] }
      if (!split) return unifiedRow(side, lineNo + offset, lineNo)
      return h('tr', {}, ...splitCells({ ...side, no: lineNo + offset }), ...splitCells(side))
    }
    const addGap = (gap: Gap | undefined): void => {
      if (!gap || !lines) return
      if (open.has(gap.key)) {
        for (let lineNo = gap.from; lineNo <= gap.to && rendered < MAX_DIFF_ROWS; lineNo += 1, rendered += 1) {
          body.append(contextRow(lineNo, gap.offset, lines[lineNo - 1] ?? ''))
        }
        return
      }
      const count = gap.to - gap.from + 1
      const fold = h('button', { class: 'dv-fold', type: 'button' }, `Show ${count} unchanged ${count === 1 ? 'line' : 'lines'}`)
      fold.addEventListener('click', () => {
        open.add(gap.key)
        expanded.set(`${scope}:${file.path}`, open)
        void renderDiff()
      })
      body.append(h('tr', { class: 'dv-gap' }, h('td', { colspan: split ? '4' : '3' }, fold)))
    }
    for (let index = 0; index < hunks.length && rendered < MAX_DIFF_ROWS; index += 1) {
      addGap(gaps.get(index))
      const rows = splitRows(hunks[index])
      if (split) for (const pair of rows) body.append(h('tr', {}, ...splitCells(pair.left), ...splitCells(pair.right)))
      else body.append(...unifiedRows(rows))
      rendered += rows.length
    }
    if (rendered < MAX_DIFF_ROWS) addGap(gaps.get(hunks.length))
    diffArea.replaceChildren(table)
    if (rendered >= MAX_DIFF_ROWS) diffArea.append(note('This diff is too long to show in full. Open the file in your editor to see the rest.'))
  }

  const refresh = async (): Promise<void> => {
    const full = await api.gitStatus(options.folder).catch((error: Error) => ({ ok: false as const, error: error.message }))
    if (!full.ok) {
      showError(full.error)
      return
    }
    allFiles = full.status.files
    let picked = full.status
    if (scope === 'session' && baseline) {
      const since = await api.gitSessionStatus(options.folder, baseline).catch((error: Error) => ({ ok: false as const, error: error.message }))
      if (!since.ok) {
        showError(since.error)
        return
      }
      picked = since.status
      sessionSince = since.since
      fellBack = since.fellBack
    }
    status = picked
    const listed = new Set(status.files.map((file) => file.path))
    for (const path of [...unchecked]) if (!allFiles.some((file) => file.path === path)) unchecked.delete(path)
    if (!current || !listed.has(current)) current = status.files[0]?.path ?? null
    diffs.clear()
    texts.clear()
    renderBranch()
    renderList()
    await renderDiff()
    if (tree) renderTree()
  }

  const setBusy = (value: boolean): void => {
    busy = value
    renderList()
  }

  const runCommit = async (push: boolean): Promise<void> => {
    showError(null)
    if (area.value.trim() === '') {
      showError('Enter a commit message.')
      area.focus()
      return
    }
    setBusy(true)
    try {
      const paths = selected().map((file) => file.path)
      const result = await api.gitCommit({ folder: options.folder, paths, message: area.value, push })
      if (result.ok) {
        area.value = ''
        toast(`Committed ${result.hash}${result.pushed ? ' and pushed' : ''}`, 'info')
      } else {
        showError(result.error)
        if (result.committed) area.value = ''
      }
      await refresh()
    } catch (error) {
      showError(`Commit failed: ${(error as Error).message}`)
    } finally {
      setBusy(false)
      options.onChanged()
    }
  }

  const discardFiles = async (picked: GitFileEntry[]): Promise<void> => {
    showError(null)
    const paths = picked.map((file) => file.path)
    const message = discardMessage(paths, picked.filter((file) => file.untracked).map((file) => file.path))
    const confirmed = await confirmDialog({ title: message.title, body: message.body, confirmLabel: message.label })
    if (!confirmed) return
    setBusy(true)
    try {
      const result = await api.gitDiscard({ folder: options.folder, paths })
      if (result.ok) toast(paths.length === 1 ? `Discarded ${paths[0]}` : `Discarded ${paths.length} files`, 'info')
      else showError(result.error)
      await refresh()
    } catch (error) {
      showError(`Discard failed: ${(error as Error).message}`)
    } finally {
      setBusy(false)
      options.onChanged()
    }
  }

  const move = (step: number): void => {
    const list = files()
    const index = list.findIndex((file) => file.path === current)
    const target = list[Math.min(list.length - 1, Math.max(0, index + step))]
    if (target && target.path !== current) pick(target.path)
  }

  const openInEditor = (path: string, line?: number): void => {
    if (status) void api.openFile(status.root, line ? { path, line } : { path })
  }

  const firstChangedLine = (path: string): number | undefined => {
    const result = diffs.get(`${scope}:${path}`)
    if (!result?.ok) return undefined
    for (const hunk of parseUnifiedDiff(result.text)) for (const line of hunk.lines) if (line.kind === 'add' && line.newNo) return line.newNo
    return undefined
  }

  // Files tab

  const changedEntry = (path: string): GitFileEntry | undefined => allFiles.find((file) => file.path === path)

  const loadProject = async (): Promise<void> => {
    const result = await api.projectFiles(options.folder).catch((error: Error) => ({ ok: false as const, error: error.message }))
    if (!result.ok) {
      projectList = []
      treeFoot.textContent = result.error
      syncHeader()
      return
    }
    projectList = result.files
    truncated = result.truncated
    tree = buildTree(projectList)
    for (const file of allFiles) for (const dir of ancestors(file.path)) openDirs.add(dir)
    syncHeader()
    renderTree()
  }

  const treeRow = (depth: number, content: (Node | null)[], node: { path: string; dir: boolean; open?: boolean }): HTMLElement => {
    const row = h(
      'button',
      {
        class: `files-node${node.dir ? ' dir' : ''}${!node.dir && node.path === viewing ? ' current' : ''}`,
        type: 'button',
        role: 'treeitem',
        'aria-expanded': node.dir ? String(node.open === true) : undefined,
        'aria-selected': !node.dir ? String(node.path === viewing) : undefined,
        'data-path': node.path,
        style: `padding-left:${8 + depth * 16}px`
      },
      ...content
    )
    row.addEventListener('click', () => {
      if (!node.dir) {
        void viewFile(node.path)
        return
      }
      if (openDirs.has(node.path)) openDirs.delete(node.path)
      else openDirs.add(node.path)
      renderTree()
    })
    return row
  }

  const fileTag = (path: string): HTMLElement | null => {
    const entry = changedEntry(path)
    return entry ? stateChip(entry, ' files-tag') : null
  }

  function renderTree(): void {
    if (!tree || !projectList) return
    const query = filter.value.trim().toLowerCase()
    const rows: HTMLElement[] = []
    if (query) {
      const hits = projectList.filter((path) => path.toLowerCase().includes(query))
      for (const path of hits.slice(0, MAX_FILTER_HITS)) {
        const { dir, name } = splitPath(path)
        rows.push(
          treeRow(0, [icon(ICONS.file), h('span', { class: 'files-name' }, name, dir ? h('span', { class: 'changes-dir' }, ` ${dir}`) : null), fileTag(path)], {
            path,
            dir: false
          })
        )
      }
      if (hits.length === 0) rows.push(h('p', { class: 'changes-empty' }, 'No file matches.'))
      if (hits.length > MAX_FILTER_HITS) rows.push(h('p', { class: 'changes-empty' }, `Showing ${MAX_FILTER_HITS} of ${hits.length} matches.`))
    } else {
      const walk = (node: TreeDir, depth: number): void => {
        for (const dir of [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name))) {
          const open = openDirs.has(dir.path)
          rows.push(treeRow(depth, [icon(open ? ICONS.chevronDown : ICONS.chevronRight), icon(ICONS.folder), h('span', { class: 'files-name' }, dir.name)], { path: dir.path, dir: true, open }))
          if (open) walk(dir, depth + 1)
        }
        for (const path of node.files) {
          rows.push(treeRow(depth, [h('span', { class: 'files-indent' }), icon(ICONS.file), h('span', { class: 'files-name' }, splitPath(path).name), fileTag(path)], { path, dir: false }))
        }
      }
      walk(tree, 0)
      if (projectList.length === 0) rows.push(h('p', { class: 'changes-empty' }, 'No files in this project yet.'))
    }
    treeBox.replaceChildren(...rows)
    treeFoot.textContent = truncated
      ? `Showing the first ${projectList.length} files. Files ignored by git are hidden.`
      : 'Files ignored by git (node_modules, build output) are hidden. Changed files are marked.'
  }

  async function viewFile(path: string): Promise<void> {
    const token = ++viewToken
    viewing = path
    renderTree()
    const entry = changedEntry(path)
    const { dir, name } = splitPath(path)
    const meta = h('span', { class: 'files-meta' })
    viewHead.replaceChildren(h('span', { class: 'changes-path' }, dir ? h('span', { class: 'changes-dir' }, dir) : null, name), ...(entry ? [stateChip(entry)] : []), meta)
    showChanges.hidden = !entry
    copyPath.disabled = false
    openViewed.disabled = false
    viewArea.replaceChildren(note('Loading…'))
    const [result, diff] = await Promise.all([
      api.projectFile(options.folder, path).catch((error: Error) => ({ ok: false as const, error: error.message })),
      entry ? api.gitDiff(options.folder, path).catch(() => null) : Promise.resolve(null)
    ])
    if (token !== viewToken) return
    if (!result.ok) {
      viewArea.replaceChildren(note(result.error))
      return
    }
    if (result.text === null) {
      meta.textContent = formatSize(result.size)
      viewArea.replaceChildren(
        note(result.reason === 'binary' ? 'This is a binary file, so there is no text to show.' : 'This file is larger than 1 MB, so it is not shown here. Open it in your editor.')
      )
      return
    }
    const lines = fileLines(result.text)
    meta.textContent = `${lines.length} ${lines.length === 1 ? 'line' : 'lines'} · ${formatSize(result.size)}`
    const changed = diff?.ok ? addedLines(diff.text) : new Set<number>()
    const body = h('tbody', {})
    lines.slice(0, MAX_FILE_LINES).forEach((text, index) => {
      const tint = changed.has(index + 1) ? 'add' : 'context'
      body.append(h('tr', {}, h('td', { class: `dv-no ${tint}` }, String(index + 1)), h('td', { class: `dv-code ${tint}` }, text)))
    })
    viewArea.replaceChildren(h('table', { class: 'dv-table dv-file', 'data-file': path }, h('colgroup', {}, h('col', { class: 'dv-col-no' }), h('col', {})), body))
    if (lines.length > MAX_FILE_LINES) viewArea.append(note(`Showing the first ${MAX_FILE_LINES} of ${lines.length} lines.`))
  }

  const setTab = (value: Tab): void => {
    tab = value
    syncHeader()
    if (tab === 'files') filter.focus()
  }

  const setScope = (value: Scope): void => {
    if (scope === value) return
    scope = value
    current = null
    void refresh()
  }

  const setLayout = (value: Layout): void => {
    layout = value
    saveLayout(value)
    syncHeader()
    void renderDiff()
  }

  changesTab.addEventListener('click', () => setTab('changes'))
  filesTab.addEventListener('click', () => setTab('files'))
  splitButton.addEventListener('click', () => setLayout('split'))
  unifiedButton.addEventListener('click', () => setLayout('unified'))
  allButton.addEventListener('click', () => setScope('all'))
  sessionButton.addEventListener('click', () => setScope('session'))
  prev.addEventListener('click', () => move(-1))
  next.addEventListener('click', () => move(1))
  openEditor.addEventListener('click', () => {
    if (current) openInEditor(current, firstChangedLine(current))
  })
  revert.addEventListener('click', () => {
    const file = currentFile()
    if (file) void discardFiles([file])
  })
  showChanges.addEventListener('click', () => {
    if (!viewing) return
    const path = viewing
    if (!files().some((file) => file.path === path) && scope === 'session') {
      scope = 'all'
      current = path
      setTab('changes')
      void refresh()
      return
    }
    setTab('changes')
    pick(path)
  })
  copyPath.addEventListener('click', () => {
    if (!viewing) return
    void api.writeClipboard(viewing).then(
      () => toast('Path copied', 'info'),
      () => toast('Could not copy the path.')
    )
  })
  openViewed.addEventListener('click', () => {
    if (viewing) openInEditor(viewing)
  })
  filter.addEventListener('input', () => renderTree())
  selectAll.addEventListener('change', () => {
    if (selectAll.checked) for (const file of files()) unchecked.delete(file.path)
    else for (const file of files()) unchecked.add(file.path)
    renderList()
  })
  area.addEventListener('input', () => {
    showError(null)
    syncControls()
  })
  area.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && primaryModifierPressed(event) && !busy && selected().length > 0) {
      event.preventDefault()
      void runCommit(false)
    }
  })
  dialog.addEventListener('keydown', (event) => {
    if (tab !== 'changes' || event.ctrlKey || event.metaKey || event.altKey) return
    const target = event.target as HTMLElement
    if (target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && target.type !== 'checkbox')) return
    const key = event.key.toLowerCase()
    if (key === 'j' || key === 'k') {
      event.preventDefault()
      move(key === 'j' ? 1 : -1)
      list.querySelector<HTMLElement>('.changes-row.current .changes-pick')?.focus()
    } else if (event.key === ' ' && current && !busy && (target === dialog || target.classList.contains('changes-pick') || target === diffArea)) {
      event.preventDefault()
      toggleChecked(current)
      list.querySelector<HTMLElement>('.changes-row.current .changes-pick')?.focus()
    }
  })
  close.addEventListener('click', () => shown.finish())
  commit.addEventListener('click', () => void runCommit(false))
  commitPush.addEventListener('click', () => void runCommit(true))
  discard.addEventListener('click', () => void discardFiles(selected()))
  clear(diffArea)
  syncHeader()
  syncControls()
  void refresh().then(() => loadProject())
  return shown.result
}
