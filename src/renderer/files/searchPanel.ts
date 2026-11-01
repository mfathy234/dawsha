import { SEARCH_MAX_MATCHES, matchRanges, matcherFor, type SearchRequest, type SearchResult } from '../../shared/fileSearch'
import { h } from '../dom'
import { fileIcon } from './fileIcon'
import { LatestGate } from './asyncGuard'
import { errorNote, loadingNote } from './loadNote'
import { shouldSearch } from './searchGate'

const DEBOUNCE_MS = 300

export interface SearchHooks {
  /** The checkout to search, or null when none is open. */
  folder(): string | null
  run(folder: string, request: SearchRequest): Promise<SearchResult>
  open(path: string, line: number): void
}

const split = (path: string): { name: string; folder: string } => {
  const cut = path.lastIndexOf('/')
  return { name: path.slice(cut + 1), folder: cut < 0 ? '' : path.slice(0, cut) }
}

function highlighted(text: string, matcher: RegExp | null): (Node | string)[] {
  const ranges = matchRanges(text, matcher)
  if (ranges.length === 0) return [text]
  const parts: (Node | string)[] = []
  let at = 0
  for (const range of ranges) {
    if (range.from > at) parts.push(text.slice(at, range.from))
    parts.push(h('mark', { class: 'files-hit-mark' }, text.slice(range.from, range.to)))
    at = range.to
  }
  if (at < text.length) parts.push(text.slice(at))
  return parts
}

/** Find in files: the query, its options and the results grouped by file. */
export class SearchPanel {
  readonly el = h('div', { class: 'files-pane files-pane-search' })
  private readonly input = h('input', {
    class: 'files-search-input', id: 'files-search-input', type: 'search', placeholder: 'Search in files', 'aria-label': 'Search in files', spellcheck: 'false',
    onInput: (event: Event) => {
      if (!(event as InputEvent).isComposing) this.schedule()
    },
    onKeydown: (event: Event) => {
      const key = (event as KeyboardEvent).key
      if (key === 'Enter') {
        event.preventDefault()
        void this.run(true)
      } else if (key === 'ArrowDown') {
        event.preventDefault()
        this.results.querySelector<HTMLElement>('.files-hit')?.focus()
      }
    }
  })
  private readonly include = h('input', {
    class: 'files-search-include', id: 'files-search-include', type: 'text', placeholder: 'Files to include, e.g. *.ts, src/**', 'aria-label': 'Files to include', spellcheck: 'false',
    onInput: () => this.schedule(),
    onKeydown: (event: Event) => {
      if ((event as KeyboardEvent).key === 'Enter') {
        event.preventDefault()
        void this.run(true)
      }
    }
  })
  private readonly options = {
    matchCase: this.toggle('files-search-case', 'Aa', 'Match case'),
    wholeWord: this.toggle('files-search-word', 'ab', 'Match whole word'),
    regex: this.toggle('files-search-regex', '.*', 'Use regular expression')
  }
  private readonly summary = h('div', { class: 'files-search-summary', id: 'files-search-summary', role: 'status', 'aria-live': 'polite' })
  private readonly results = h('div', { class: 'files-search-results', id: 'files-search-results' })
  private readonly gate = new LatestGate()
  private timer: number | undefined
  private lastKey = ''

  constructor(private readonly hooks: SearchHooks) {
    this.results.addEventListener('keydown', (event) => this.onResultKey(event))
    this.el.append(
      h('div', { class: 'files-search-box' }, this.input, h('div', { class: 'files-search-opts', role: 'group', 'aria-label': 'Search options' }, this.options.matchCase, this.options.wholeWord, this.options.regex)),
      this.include, this.summary, this.results)
    this.showHint()
  }

  private toggle(id: string, text: string, label: string): HTMLButtonElement {
    return h('button', { class: 'files-search-opt', type: 'button', id, 'aria-pressed': 'false', 'aria-label': label, title: label, onClick: (event: Event) => {
      const button = event.currentTarget as HTMLButtonElement
      button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'))
      void this.run()
    } }, text)
  }

  focus(): void {
    this.input.focus()
    this.input.select()
  }

  /** The folder changed: results from another checkout do not apply. */
  reset(): void {
    this.gate.cancel()
    this.lastKey = ''
    window.clearTimeout(this.timer)
    this.results.replaceChildren()
    this.showHint()
    if (this.input.value.trim() !== '') void this.run()
  }

  private showHint(): void {
    this.summary.textContent = 'Search the files of this checkout. Ignored files are skipped.'
  }

  private request(): SearchRequest {
    const on = (button: HTMLButtonElement): boolean => button.getAttribute('aria-pressed') === 'true'
    return { query: this.input.value, matchCase: on(this.options.matchCase), wholeWord: on(this.options.wholeWord), regex: on(this.options.regex), include: this.include.value.trim() }
  }

  private schedule(): void {
    window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => void this.run(), DEBOUNCE_MS)
  }

  /** `force` searches again even for the same query: Enter does, because files may have changed since. */
  async run(force = false): Promise<void> {
    window.clearTimeout(this.timer)
    const folder = this.hooks.folder()
    const request = this.request()
    if (!folder || request.query.trim() === '') {
      this.gate.cancel()
      this.lastKey = ''
      this.results.replaceChildren()
      this.showHint()
      return
    }
    const key = JSON.stringify([folder, request])
    if (!shouldSearch(this.lastKey, key, force)) return
    this.lastKey = key
    const ticket = this.gate.begin()
    this.summary.replaceChildren(loadingNote('Searching…'))
    const result = await this.hooks.run(folder, request).catch((error: Error) => ({ ok: false as const, error: error.message }))
    if (!ticket.current()) return
    if (!result.ok) {
      this.lastKey = ''
      this.results.replaceChildren()
      this.summary.replaceChildren(errorNote("Couldn't search.", () => void this.run(), result.error))
      return
    }
    this.render(result, request)
  }

  private render(result: Extract<SearchResult, { ok: true }>, request: SearchRequest): void {
    const shown = result.files.reduce((sum, file) => sum + file.matches.length, 0)
    if (result.total === 0) {
      this.summary.textContent = 'No results.'
      this.results.replaceChildren()
      return
    }
    const files = `${result.files.length} file${result.files.length === 1 ? '' : 's'}`
    this.summary.textContent = result.truncated
      ? `Showing the first ${shown} of ${result.total >= SEARCH_MAX_MATCHES ? `at least ${result.total}` : result.total} results in ${files}. Narrow the search to see the rest.`
      : `${shown} result${shown === 1 ? '' : 's'} in ${files}`
    const matcher = matcherFor(request)
    this.results.replaceChildren(...result.files.map((file) => {
      const { name, folder } = split(file.path)
      return h('div', { class: 'files-hit-group', role: 'group', 'aria-label': `${file.path}, ${file.matches.length} results` },
        h('div', { class: 'files-hit-file', title: file.path }, fileIcon(file.path), h('span', { class: 'files-hit-name' }, name), folder ? h('span', { class: 'files-flat-dir' }, folder) : null, h('span', { class: 'files-sec-count' }, String(file.matches.length))),
        ...file.matches.map((match) => h('button', { class: 'files-hit', type: 'button', 'data-path': file.path, 'data-line': String(match.line), title: `${file.path}:${match.line}`, onClick: () => this.hooks.open(file.path, match.line) },
          h('span', { class: 'files-hit-line' }, String(match.line)), h('span', { class: 'files-hit-text' }, ...highlighted(match.text, matcher)))))
    }))
  }

  private onResultKey(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const hits = [...this.results.querySelectorAll<HTMLElement>('.files-hit')]
    const at = hits.indexOf(document.activeElement as HTMLElement)
    if (at < 0) return
    event.preventDefault()
    if (event.key === 'ArrowUp' && at === 0) this.input.focus()
    else hits[Math.min(Math.max(at + (event.key === 'ArrowDown' ? 1 : -1), 0), hits.length - 1)]?.focus()
  }
}
