import type { CommitDetails, CommitFileChange } from '../../shared/commitDetails'
import type { FileCommit } from '../../shared/filePreview'
import { parseUnifiedDiff, splitRows, type Side, type SplitRow } from '../../shared/diffView'
import { api } from '../api'
import { h } from '../dom'
import { present } from '../components/dialogs'
import { toast } from '../components/toast'

const MAX_ROWS = 4000
const layoutKey = 'dawsha.diffLayout'
type Layout = 'split' | 'unified'
const relative = (at: number): string => {
  const seconds = Math.max(0, Math.floor((Date.now() - at) / 1000))
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`
  return `${Math.floor(seconds / 86400)} days ago`
}
const stamp = (at: number): string => `${new Date(at).toLocaleString()} (${relative(at)})`
const textCell = (kind: string, text: string): HTMLElement => h('td', { class: `dv-code ${kind}` }, text)
function rowCells(side: Side | null): HTMLElement[] {
  return side ? [h('td', { class: `dv-no ${side.kind}` }, String(side.no)), textCell(side.kind, side.text)] : [h('td', { class: 'dv-no dv-blank' }), h('td', { class: 'dv-code dv-blank' })]
}
function rowsFor(hunkRows: SplitRow[]): HTMLElement[] {
  const out: HTMLElement[] = []
  for (const row of hunkRows) {
    if (row.left?.kind === 'context' && row.right) out.push(h('tr', { class: 'dv-context' }, h('td', { class: 'dv-no' }, String(row.left.no)), h('td', { class: 'dv-no' }, String(row.right.no)), textCell('context', row.right.text)))
    else {
      if (row.left) out.push(h('tr', { class: 'dv-del' }, h('td', { class: 'dv-no del' }, String(row.left.no)), h('td', { class: 'dv-no' }), textCell('del', `−${row.left.text}`)))
      if (row.right) out.push(h('tr', { class: 'dv-add' }, h('td', { class: 'dv-no' }), h('td', { class: 'dv-no add' }, String(row.right.no)), textCell('add', `+${row.right.text}`)))
    }
  }
  return out
}

function splitPane(rows: SplitRow[], side: 'left' | 'right'): HTMLElement {
  const scroller = h('div', { class: 'commit-details-split-pane' })
  const tableRows = rows.map((row) => {
    const line = row[side]
    const kind = line?.kind === 'del' ? 'dv-del' : line?.kind === 'add' ? 'dv-add' : line?.kind === 'context' ? 'dv-context' : ''
    return h('tr', { class: kind }, ...rowCells(line))
  })
  scroller.append(h('table', { class: 'dv-table dv-unified' }, h('tbody', {}, ...tableRows)))
  return scroller
}

export async function openCommitDetails(folder: string, commit: FileCommit, preferredPath: string | null): Promise<void> {
  const closeButton = h('button', { class: 'btn secondary small', type: 'button' }, 'Close') as HTMLButtonElement
  const title = h('h2', { class: 'commit-details-title', title: commit.subject }, commit.subject)
  const head = h('header', { class: 'commit-details-head' }, h('button', { class: 'btn ghost small', type: 'button', 'aria-label': 'Back to Activity', onClick: () => shown.finish(undefined) }, '← Activity'), title, closeButton)
  const meta = h('div', { class: 'commit-details-meta' }, 'Loading commit details…')
  const message = h('pre', { class: 'commit-details-message' })
  const files = h('nav', { class: 'commit-details-files', 'aria-label': 'Changed files' })
  const diffArea = h('div', { class: 'changes-diff files-view diff commit-details-diff', tabindex: '-1' })
  const preview = h('pre', { class: 'commit-details-preview', hidden: true })
  const fileTitle = h('strong', { class: 'commit-details-file-title' })
  let layout: Layout = (() => { try { return localStorage.getItem(layoutKey) === 'unified' ? 'unified' : 'split' } catch { return 'split' } })()
  let selectedPath = preferredPath
  let fullDiff = false
  const split = h('button', { type: 'button', 'aria-pressed': String(layout === 'split') }, 'Side by side')
  const unified = h('button', { type: 'button', 'aria-pressed': String(layout === 'unified') }, 'Inline')
  const layoutToggle = h('div', { class: 'segmented commit-details-layout', role: 'group', 'aria-label': 'Diff layout' }, unified, split)
  const openFile = h('button', { class: 'btn secondary small', type: 'button', disabled: true }, 'Open file at this commit') as HTMLButtonElement
  const showFull = h('button', { class: 'btn ghost small', type: 'button', hidden: true }, 'Show full diff')
  const body = h('div', { class: 'commit-details-body' }, h('section', { class: 'commit-details-summary' }, meta, message), h('aside', { class: 'commit-details-file-list' }, h('div', { class: 'commit-details-file-heading' }, 'Changed files'), files), h('section', { class: 'commit-details-file-view' }, h('div', { class: 'commit-details-file-bar' }, fileTitle, h('span', { class: 'spacer' }), layoutToggle, showFull, openFile), diffArea, preview))
  const dialog = h('div', { class: 'dialog commit-details-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Commit details', 'data-own-dismiss': '', tabindex: '-1' }, head, body)
  const shown = present<void>(dialog, undefined, dialog)
  const fileCache = new Map<string, { diff: string; text: string | null; truncated: boolean; binary: boolean }>()
  const renderDiff = (): void => {
    if (!selectedPath) { diffArea.replaceChildren(h('p', { class: 'files-side-empty' }, 'Select a file to see its diff.')); return }
    const loaded = fileCache.get(selectedPath)
    if (!loaded) { diffArea.replaceChildren(h('p', { class: 'files-side-empty' }, 'Loading diff…')); return }
    diffArea.hidden = false
    preview.hidden = true
    showFull.hidden = !loaded.truncated || fullDiff
    openFile.disabled = loaded.text === null
    if (loaded.binary || !loaded.diff) { diffArea.replaceChildren(h('p', { class: 'files-side-empty' }, loaded.binary ? 'Binary file; no text diff is available.' : 'No line changes.')); return }
    const hunks = parseUnifiedDiff(loaded.diff)
    if (layout === 'split') {
      const allRows = hunks.flatMap((hunk) => splitRows(hunk))
      const visibleRows = fullDiff ? allRows : allRows.slice(0, MAX_ROWS)
      const left = splitPane(visibleRows, 'left')
      const right = splitPane(visibleRows, 'right')
      let syncing = false
      const sync = (source: HTMLElement, target: HTMLElement): void => {
        if (syncing) return
        syncing = true
        target.scrollLeft = source.scrollLeft
        syncing = false
      }
      left.addEventListener('scroll', () => sync(left, right), { passive: true })
      right.addEventListener('scroll', () => sync(right, left), { passive: true })
      diffArea.replaceChildren(h('div', { class: 'commit-details-split' }, left, right))
      if (loaded.truncated || (!fullDiff && allRows.length > MAX_ROWS)) diffArea.append(h('p', { class: 'commit-details-truncated' }, 'This diff is shortened to keep the view responsive.'))
    } else {
      const allRows = hunks.flatMap((hunk) => rowsFor(splitRows(hunk)))
      const visibleRows = fullDiff ? allRows : allRows.slice(0, MAX_ROWS)
      diffArea.replaceChildren(h('table', { class: 'dv-table dv-unified' }, h('tbody', {}, ...visibleRows)))
      if (loaded.truncated || (!fullDiff && allRows.length > MAX_ROWS)) diffArea.append(h('p', { class: 'commit-details-truncated' }, 'This diff is shortened to keep the view responsive.'))
    }
  }
  const selectFile = async (file: CommitFileChange): Promise<void> => {
    selectedPath = file.path
    layoutToggle.hidden = file.status === 'A' || file.status === 'D'
    layout = layoutToggle.hidden ? 'unified' : (() => { try { return localStorage.getItem(layoutKey) === 'unified' ? 'unified' : 'split' } catch { return 'split' } })()
    split.setAttribute('aria-pressed', String(layout === 'split'))
    unified.setAttribute('aria-pressed', String(layout === 'unified'))
    fullDiff = false
    for (const button of files.querySelectorAll<HTMLButtonElement>('.commit-details-file')) button.setAttribute('aria-current', String(button.dataset.path === file.path))
    fileTitle.textContent = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path
    preview.hidden = true
    diffArea.hidden = false
    renderDiff()
    if (fileCache.has(file.path)) return
    const path = file.path
    const result = await api.fileCommitFile(folder, commit.hash, path).catch(() => null)
    if (!result?.ok) { diffArea.replaceChildren(h('p', { class: 'files-side-empty' }, result?.error ?? 'Could not read this file diff.')); return }
    fileCache.set(path, result)
    renderDiff()
  }
  closeButton.addEventListener('click', () => shown.finish(undefined))
  split.addEventListener('click', () => { if (layoutToggle.hidden) return; layout = 'split'; split.setAttribute('aria-pressed', 'true'); unified.setAttribute('aria-pressed', 'false'); try { localStorage.setItem(layoutKey, layout) } catch {} ; renderDiff() })
  unified.addEventListener('click', () => { if (layoutToggle.hidden) return; layout = 'unified'; split.setAttribute('aria-pressed', 'false'); unified.setAttribute('aria-pressed', 'true'); try { localStorage.setItem(layoutKey, layout) } catch {} ; renderDiff() })
  showFull.addEventListener('click', () => {
    fullDiff = true
    const path = selectedPath
    if (path) void api.fileCommitFile(folder, commit.hash, path, true).then((result) => {
      if (result.ok) fileCache.set(path, result)
      renderDiff()
    }).catch(() => renderDiff())
  })
  openFile.addEventListener('click', () => {
    const text = selectedPath ? fileCache.get(selectedPath)?.text : null
    if (text === null || text === undefined) { toast('This file is binary or too large to preview.'); return }
    preview.hidden = false
    preview.textContent = text
    diffArea.hidden = true
  })
  void api.fileCommitDetails(folder, commit.hash).then((result) => {
    if (!result.ok) { meta.textContent = result.error; return }
    const details: CommitDetails = result.details
    const selected = details.files.find((file) => file.path === preferredPath)
    const ordered = selected ? [selected, ...details.files.filter((file) => file !== selected)] : details.files
    const definition = (label: string, value: Node | string): HTMLElement => h('div', { class: 'commit-details-definition' }, h('dt', {}, label), h('dd', {}, value))
    meta.replaceChildren(h('dl', { class: 'commit-details-definitions' },
      definition('Author', `${details.author} <${details.email}>`),
      ...(details.committer !== details.author || details.committerEmail !== details.email ? [definition('Committer', `${details.committer} <${details.committerEmail}> · ${stamp(details.committerAt)}`)] : []),
      definition('Date', stamp(details.authorAt)),
      definition('Parents', details.parents.length ? details.parents.join(', ') : 'None'),
      definition('Refs', details.refs.length ? details.refs.join(', ') : 'None'),
      h('div', { class: 'commit-details-definition' }, h('dt', {}, 'Hash'), h('dd', { class: 'commit-details-hash' }, h('code', {}, details.hash), h('button', { class: 'btn secondary small', type: 'button', onClick: () => void api.writeClipboard(details.hash).then(() => toast('Commit hash copied', 'info'), () => toast('Could not copy the commit hash.')) }, 'Copy')))))
    title.textContent = details.subject
    title.title = details.subject
    message.textContent = details.subject + (details.body ? `\n\n${details.body}` : '')
    files.replaceChildren(h('div', { class: 'commit-details-total' }, `${ordered.length} files · +${details.added} −${details.removed}`), ...ordered.map((file) => h('button', { class: 'commit-details-file', type: 'button', 'data-path': file.path, title: file.oldPath ? `${file.oldPath} → ${file.path}` : file.path, onClick: () => void selectFile(file) }, h('span', { class: `commit-details-status status-${file.status}` }, file.status), h('span', { class: 'commit-details-path' }, file.oldPath ? `${file.oldPath} → ${file.path}` : file.path), h('span', { class: 'commit-details-counts' }, file.added === null ? 'binary' : `+${file.added} −${file.removed ?? 0}`))))
    if (ordered.length) void selectFile(ordered[0])
  }).catch(() => { meta.textContent = 'Could not read this commit.' })
  await shown.result
}
