import { moveSelection } from '../../shared/quickPick'
import { quickOpen as rankFiles } from '../../shared/fileTree'
import { fuzzyMatch } from '../../shared/palette'
import { api } from '../api'
import { h, icon } from '../dom'
import { ICONS } from '../icons'
import { addToPrompt, filesTarget, openInFiles, openInVsCode, type FilesTarget } from '../files/filesActions'
import { fileIndex, recentFiles, type FileIndex } from '../files/fileIndex'
import { store } from '../state'
import { popupDismissButton } from './popupDismiss'
import './quickOpen.css'

const PREVIEW_LINES = 200
const PREVIEW_DELAY_MS = 70

interface Session {
  overlay: HTMLElement
  input: HTMLInputElement
  list: HTMLElement
  preview: HTMLElement
  previewTitle: HTMLElement
  previous: HTMLElement | null
  target: FilesTarget
  index: FileIndex
  results: string[]
  selected: number
  token: number
  previewToken: number
  previewTimer: number | undefined
}

let session: Session | null = null

const hint = (key: string, label: string): HTMLElement => h('span', { class: 'qo-hint' }, h('span', { class: 'qo-kbd' }, key), ` ${label}`)

function marked(text: string, indexes: Set<number>, offset: number): (Node | string)[] {
  const parts: (Node | string)[] = []
  let run = ''
  let on = false
  const flush = (): void => {
    if (run) parts.push(on ? h('mark', { class: 'qo-match' }, run) : run)
    run = ''
  }
  for (const [position, char] of [...text].entries()) {
    const now = indexes.has(position + offset)
    if (now !== on) flush()
    on = now
    run += char
  }
  flush()
  return parts
}

export const quickOpenShowing = (): boolean => session !== null

export function toggleQuickOpen(): void {
  if (session) closeQuickOpen(true)
  else void openQuickOpen()
}

export async function openQuickOpen(): Promise<void> {
  if (session) return
  const target = filesTarget()
  const projects = store.state.settings.projects
  const input = h('input', { class: 'qo-input', id: 'quick-open-input', type: 'text', placeholder: 'Find a file by name or path', 'aria-label': 'Quick open', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'quick-open-list', autocomplete: 'off', spellcheck: 'false' })
  const list = h('div', { class: 'qo-list', id: 'quick-open-list', role: 'listbox', 'aria-label': 'Files' })
  const previewTitle = h('div', { class: 'qo-preview-title' })
  const preview = h('pre', { class: 'qo-preview', id: 'quick-open-preview' })
  const projectSelect = h('select', { class: 'qo-project', id: 'quick-open-project', 'aria-label': 'Project' }, ...projects.map((project) => h('option', { value: project.id }, project.name)))
  const overlay = h('div', { class: 'overlay qo-overlay' },
    h('div', { class: 'qo', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Quick open' },
      h('div', { class: 'qo-head' }, icon(ICONS.search), input, projectSelect, popupDismissButton(() => closeQuickOpen(true))),
      h('div', { class: 'qo-body' }, list, h('div', { class: 'qo-right' }, previewTitle, preview)),
      h('div', { class: 'qo-foot' }, hint('Enter', 'open'), hint('Alt+Enter', 'add to prompt'), hint('Ctrl+Enter', 'VS Code'), hint('Up Down', 'move'), hint('Esc', 'close'))))
  const state: Session = {
    overlay, input, list, preview, previewTitle, previous: document.activeElement as HTMLElement | null,
    target: target ?? { projectId: '', folder: '' }, index: { files: [], status: new Map() }, results: [], selected: 0, token: 0, previewToken: 0, previewTimer: undefined
  }
  session = state
  if (target) projectSelect.value = target.projectId
  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) closeQuickOpen(true)
  })
  input.addEventListener('input', () => {
    state.selected = 0
    render(state)
  })
  input.addEventListener('keydown', (event) => onKey(state, event))
  projectSelect.addEventListener('change', () => {
    const project = projects.find((p) => p.id === projectSelect.value)
    if (!project) return
    void api.unwatchFiles(state.target.folder)
    state.target = { projectId: project.id, folder: project.folder }
    state.index = { files: [], status: new Map() }
    void load(state)
    input.focus()
  })
  document.body.appendChild(overlay)
  input.focus()
  render(state)
  if (target) await load(state)
}

export function closeQuickOpen(restoreFocus: boolean): void {
  const current = session
  if (!current) return
  session = null
  window.clearTimeout(current.previewTimer)
  if (current.target.folder) void api.unwatchFiles(current.target.folder)
  current.overlay.remove()
  if (restoreFocus) requestAnimationFrame(() => current.previous?.focus())
}

async function load(state: Session): Promise<void> {
  const token = ++state.token
  const folder = state.target.folder
  if (!folder) return
  void api.watchFiles(folder)
  const index = await fileIndex(folder)
  if (session !== state || token !== state.token) return
  state.index = index
  state.selected = 0
  render(state)
}

const currentPath = (state: Session): string | null => state.results[state.selected] ?? null

function render(state: Session): void {
  const query = state.input.value.trim()
  state.results = rankFiles(state.index.files, query, recentFiles(state.target.folder))
  state.selected = Math.min(state.selected, Math.max(0, state.results.length - 1))
  if (state.results.length === 0) {
    const text = !state.target.folder ? 'Add a project to find its files.' : state.index.files.length === 0 ? 'Loading files…' : 'No file matches that.'
    state.list.replaceChildren(h('p', { class: 'qo-empty' }, text))
    showPreview(state)
    return
  }
  state.list.replaceChildren(...state.results.map((path, position) => row(state, path, position, query)))
  highlightRow(state, state.selected)
}

function row(state: Session, path: string, position: number, query: string): HTMLElement {
  const slash = path.lastIndexOf('/')
  const name = path.slice(slash + 1)
  const dir = slash >= 0 ? path.slice(0, slash) : ''
  const indexes = new Set(query ? fuzzyMatch(query, path)?.indexes ?? [] : [])
  const letter = state.index.status.get(path)
  return h('div', {
    class: 'qo-row', role: 'option', id: `qo-row-${position}`, 'aria-selected': 'false', 'data-path': path,
    onMousedown: (event: Event) => event.preventDefault(),
    onClick: () => {
      state.selected = position
      choose(state, 'open')
    }
  },
  h('span', { class: 'qo-name' }, ...marked(name, indexes, slash + 1)),
  h('span', { class: 'qo-dir' }, ...marked(dir, indexes, 0)),
  ...(letter ? [h('span', { class: `qo-badge b-${letter === 'U' ? 'A' : letter}` }, letter === 'U' ? 'A' : letter)] : []))
}

function highlightRow(state: Session, index: number): void {
  state.selected = index
  state.list.querySelectorAll('.qo-row').forEach((element, position) => {
    const on = position === index
    element.classList.toggle('selected', on)
    element.setAttribute('aria-selected', String(on))
    if (on) element.scrollIntoView({ block: 'nearest' })
  })
  state.input.setAttribute('aria-activedescendant', `qo-row-${index}`)
  showPreview(state)
}

function showPreview(state: Session): void {
  window.clearTimeout(state.previewTimer)
  const path = currentPath(state)
  if (!path) {
    state.previewTitle.textContent = ''
    state.preview.textContent = ''
    return
  }
  const token = ++state.previewToken
  state.previewTimer = window.setTimeout(async () => {
    const result = await api.projectFile(state.target.folder, path).catch(() => null)
    if (session !== state || token !== state.previewToken) return
    state.previewTitle.textContent = path
    if (!result?.ok) state.preview.textContent = state.index.status.get(path) === 'D' ? 'This file was deleted.' : 'This file cannot be shown.'
    else if (result.text === null) state.preview.textContent = result.reason === 'large' ? 'This file is too large to preview.' : result.reason === 'encoding' ? 'This file is not UTF-8.' : 'This is a binary file.'
    else state.preview.textContent = result.text.split('\n').slice(0, PREVIEW_LINES).join('\n')
  }, PREVIEW_DELAY_MS)
}

function choose(state: Session, how: 'open' | 'prompt' | 'code'): void {
  const path = currentPath(state)
  if (!path) return
  const target = state.target
  if (how === 'prompt') {
    if (!addToPrompt(path)) return
    closeQuickOpen(false)
    return
  }
  closeQuickOpen(how === 'code')
  if (how === 'code') openInVsCode(target.folder, path)
  else openInFiles(target, path, { pin: false })
}

function onKey(state: Session, event: KeyboardEvent): void {
  const ctrl = event.ctrlKey || event.metaKey
  if (event.key === 'Escape' || (ctrl && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'p')) {
    event.preventDefault()
    event.stopPropagation()
    closeQuickOpen(true)
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    highlightRow(state, moveSelection(state.selected, event.key === 'ArrowDown' ? 1 : -1, state.results.length))
  } else if (event.key === 'Enter') {
    event.preventDefault()
    event.stopPropagation()
    choose(state, event.altKey ? 'prompt' : ctrl ? 'code' : 'open')
  }
}
