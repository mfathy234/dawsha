import { agentCommands } from '../../shared/agentCommands'
import { completionToken, fileCompletionRows, rankCompletions, type CompletionItem, type CompletionToken } from '../../shared/chatComplete'
import { fuzzyMatch } from '../../shared/palette'
import { api } from '../api'
import { h } from '../dom'
import { fileIndex, recentFiles, type FileIndex } from '../files/fileIndex'
import './chatComplete.css'

interface Row { name: string; description: string; kind: string; path?: string; directory?: boolean }
const rowsByIndex = new WeakMap<FileIndex, ReturnType<typeof fileCompletionRows>>()

export class ChatComplete {
  readonly el = h('div', { class: 'chat-complete', role: 'listbox', hidden: true })
  private rows: Row[] = []
  private selected = 0
  private token: CompletionToken | null = null
  private generation = 0

  constructor(private readonly box: HTMLTextAreaElement, private readonly folder: () => string, private readonly agent: () => 'claude' | 'codex' | 'gemini') {
    box.addEventListener('blur', () => window.setTimeout(() => this.close(), 0))
  }

  isOpen(): boolean { return !this.el.hidden }

  async refresh(): Promise<void> {
    const token = completionToken(this.box.value, this.box.selectionStart)
    this.token = token
    if (!token || (token.kind === 'command' && this.agent() === 'gemini')) return this.close()
    const generation = ++this.generation
    this.selected = 0
    if (token.kind === 'command') {
      const custom = await api.chatCommands({ agent: this.agent(), folder: this.folder() })
      if (generation !== this.generation) return
      const commands: CompletionItem[] = [...agentCommands(this.agent()).map((item) => ({ ...item, kind: 'built-in' as const })), ...custom]
      this.rows = rankCompletions(commands, token.query).map((item) => ({ ...item, kind: item.kind ?? 'built-in' }))
    } else {
      const index = await fileIndex(this.folder())
      if (generation !== this.generation) return
      let all = rowsByIndex.get(index)
      if (!all) { all = fileCompletionRows(index.files); rowsByIndex.set(index, all) }
      const recents = new Set(recentFiles(this.folder()))
      this.rows = rankCompletions(all, token.query, (item) => (recents.has(item.path) ? 30 : 0) + (index.status.has(item.path) ? 15 : 0)).map((item) => ({ ...item }))
    }
    this.render(token)
  }

  handleKey(event: KeyboardEvent): boolean {
    if (!this.isOpen()) return false
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      this.selected = Math.max(0, Math.min(this.rows.length - 1, this.selected + (event.key === 'ArrowDown' ? 1 : -1)))
      if (this.token) this.render(this.token)
      return true
    }
    if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); this.pick(); return true }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); return true }
    return false
  }

  close(): void { this.el.hidden = true; this.token = null; this.generation += 1 }

  private render(token: CompletionToken): void {
    if (this.rows.length === 0) return this.close()
    this.el.hidden = false
    this.el.replaceChildren(...this.rows.map((row, index) => h('div', {
      class: `chat-complete-row${index === this.selected ? ' selected' : ''}`, role: 'option', 'aria-selected': String(index === this.selected),
      onMousedown: (event: Event) => event.preventDefault(), onClick: () => { this.selected = index; this.pick() }
    }, h('span', { class: 'chat-complete-name' }, ...this.marked(row.kind === 'file' && row.path ? row.path.slice(row.path.lastIndexOf('/') + 1) : row.name, token.query)), h('span', { class: 'chat-complete-description' }, row.description), ...(token.kind === 'command' ? [h('span', { class: 'chat-complete-kind' }, row.kind)] : []))))
    this.el.querySelector('.chat-complete-row.selected')?.scrollIntoView({ block: 'nearest' })
  }

  private marked(name: string, query: string): Node[] {
    const indexes = new Set(fuzzyMatch(query, name)?.indexes ?? [])
    return [...name].map((char, index) => indexes.has(index) ? h('mark', { class: 'qo-match' }, char) : document.createTextNode(char))
  }

  private pick(): void {
    const row = this.rows[this.selected]
    const token = this.token
    if (!row || !token) return
    const command = row.name.startsWith('/') ? row.name : `/${row.name}`
    const insert = token.kind === 'command' ? `${command} ` : row.directory ? `@${row.path}` : `@${row.path} `
    this.box.setRangeText(insert, token.start, token.end, 'end')
    this.box.dispatchEvent(new Event('input', { bubbles: true }))
    if (row.directory) void this.refresh()
    else this.close()
  }
}
