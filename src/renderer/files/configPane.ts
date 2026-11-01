import { api } from '../api'
import { buildScopes, resolveRow, type ConfigFile, type ConfigRow, type ConfigScope, type ConfigSource } from '../../shared/configFiles'
import { toast } from '../components/toast'
import { h } from '../dom'
import type { PanelExtra } from './bottomPanel'
import './filesTools.css'

export interface ConfigHooks {
  /** The checkout the panel is showing, or null when there is none. */
  folder(): string | null
  /** Open a file of the checkout (relative to its folder) at a line. */
  open(path: string, line: number): void
}

const BASE = ''
const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)
const where = (source: ConfigSource): string => `${baseName(source.path)}${source.profile ? ` (${source.profile})` : ''}:${source.line}`
const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

/** The Config tab: every setting from appsettings, launch settings and .env files, with the file that wins in each environment. Read-only. */
export class ConfigPane implements PanelExtra {
  readonly id = 'config'
  readonly label = 'Config'
  readonly el = h('div', { class: 'files-config', id: 'files-config', role: 'tabpanel', hidden: true })
  private files: ConfigFile[] = []
  private scopes: ConfigScope[] = []
  private message = 'Reading config files...'
  private loadedFolder: string | null = null
  private environment = BASE
  private filter = ''
  private readonly revealed = new Map<string, string>()
  private token = 0

  constructor(private readonly hooks: ConfigHooks) {
    this.render()
  }

  activate(active: boolean): void {
    if (!active) {
      this.revealed.clear()
      return
    }
    const folder = this.hooks.folder()
    if (folder !== this.loadedFolder) void this.load()
  }

  private async load(): Promise<void> {
    const folder = this.hooks.folder()
    const token = ++this.token
    this.loadedFolder = folder
    this.revealed.clear()
    if (!folder) {
      this.message = 'Open a project to see its config files.'
      this.files = []
      this.scopes = []
      this.render()
      return
    }
    this.message = 'Reading config files...'
    this.render()
    const report = await api.tools.readConfig(folder)
    if (token !== this.token) return
    this.files = report.ok ? report.files : []
    this.scopes = buildScopes(this.files)
    this.message = report.ok ? (this.files.length === 0 ? 'No appsettings, launchSettings or .env files in this project.' : '') : report.error
    this.pickEnvironment()
    this.render()
  }

  private environments(): string[] {
    return [...new Set(this.scopes.flatMap((scope) => scope.environments))].sort((a, b) => a.localeCompare(b))
  }

  private pickEnvironment(): void {
    const all = this.environments()
    if (all.some((name) => name.toLowerCase() === this.environment.toLowerCase())) return
    this.environment = all.find((name) => /^dev/i.test(name)) ?? BASE
  }

  private render(): void {
    const broken = this.files.filter((file) => file.error !== null)
    const settings = this.files.reduce((total, file) => total + file.entries.length, 0)
    const summary = this.files.length === 0 ? '' : `${plural(settings, 'setting')} in ${plural(this.files.length, 'file')}`
    this.el.replaceChildren(
      h('div', { class: 'files-tool-head' },
        h('span', { class: 'files-tool-summary', id: 'files-config-summary' }, summary),
        this.files.length > 0 ? this.controls() : null),
      ...(this.message ? [h('p', { class: 'files-side-empty', id: 'files-config-message' }, this.message)] : []),
      ...broken.map((file) => this.brokenRow(file)),
      h('div', { class: 'files-config-list', role: 'list' }, ...this.scopes.flatMap((scope) => this.scopeRows(scope))))
  }

  private controls(): HTMLElement {
    const names = this.environments()
    const select = h('select', { class: 'files-tool-select', id: 'files-config-env', 'aria-label': 'Environment', onChange: () => {
      this.environment = select.value
      this.render()
    } },
    h('option', { value: BASE }, 'Base files only'),
    ...names.map((name) => h('option', { value: name }, name)))
    select.value = this.environment
    const filter = h('input', { class: 'files-tool-input', id: 'files-config-filter', type: 'search', placeholder: 'Filter keys', 'aria-label': 'Filter keys', value: this.filter, onInput: () => {
      this.filter = filter.value
      this.renderList()
    } })
    return h('div', { class: 'files-tool-controls' }, filter, names.length > 0 ? select : null)
  }

  private renderList(): void {
    const list = this.el.querySelector('.files-config-list')
    if (list) list.replaceChildren(...this.scopes.flatMap((scope) => this.scopeRows(scope)))
  }

  private brokenRow(file: ConfigFile): HTMLElement {
    return h('button', { class: 'files-config-broken', type: 'button', 'data-path': file.path, onClick: () => this.hooks.open(file.path, 1) },
      h('span', { class: 'files-config-broken-file' }, file.path), h('span', { class: 'files-config-broken-why' }, file.error))
  }

  private scopeRows(scope: ConfigScope): HTMLElement[] {
    const environment = this.environment === BASE ? null : this.environment
    const needle = this.filter.trim().toLowerCase()
    const rows = scope.rows.filter((row) => needle === '' || row.key.toLowerCase().includes(needle))
    const shown = rows.map((row) => this.row(row, environment)).filter((el): el is HTMLElement => el !== null)
    if (shown.length === 0) return []
    const heading = this.scopes.length > 1 ? [h('div', { class: 'files-tool-group', role: 'presentation' }, scope.dir || 'Project root')] : []
    return [...heading, ...shown]
  }

  private row(row: ConfigRow, environment: string | null): HTMLElement | null {
    const { winner, overridden } = resolveRow(row, environment)
    if (!winner) return null
    const open = h('button', { class: 'files-config-open', type: 'button', 'data-key': row.key, 'data-source': winner.path, title: `${winner.path}, line ${winner.line}`, onClick: () => this.hooks.open(winner.path, winner.line) },
      h('span', { class: 'files-config-key' }, row.key))
    const source = h('span', { class: 'files-config-source' }, where(winner))
    open.append(source)
    const note = overridden.length > 0 ? h('span', { class: 'files-config-over' }, `Overrides ${[...new Set(overridden.map((item) => baseName(item.path)))].join(', ')}`) : null
    return h('div', { class: 'files-config-row', role: 'listitem' }, open, this.value(winner), note)
  }

  private value(source: ConfigSource): HTMLElement {
    const id = `${source.path}|${source.line}`
    const shown = this.revealed.get(id)
    if (!source.masked) return h('span', { class: 'files-config-value', title: source.value ?? '' }, source.value ?? '')
    if (shown !== undefined) {
      return h('button', { class: 'files-config-value revealed', type: 'button', title: 'Click to hide', onClick: () => this.hide(id) }, shown)
    }
    return h('button', { class: 'files-config-value masked', type: 'button', 'aria-label': 'Hidden value. Click to show.', title: 'Hidden. Click to show.', onClick: () => void this.reveal(source, id) }, '••••••••')
  }

  private hide(id: string): void {
    this.revealed.delete(id)
    this.renderList()
  }

  private async reveal(source: ConfigSource, id: string): Promise<void> {
    const folder = this.hooks.folder()
    const row = this.files.find((file) => file.path === source.path)?.entries.find((entry) => entry.line === source.line)
    if (!folder || !row) return
    const result = await api.tools.revealConfig({ folder, path: source.path, key: row.key, line: source.line })
    if (result.ok) this.revealed.set(id, result.value)
    else toast(result.error, 'info')
    this.renderList()
  }
}
