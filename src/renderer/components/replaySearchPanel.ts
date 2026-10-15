import type { CastEvent } from '../../shared/cast'
import { formatDuration } from '../../shared/recordings'
import { searchRecording, SEARCH_LIMIT, type SearchIndex, type SearchMatch } from '../../shared/replaySearch'
import { clear, h } from '../dom'

const SEARCH_DELAY_MS = 180

export interface ReplaySearchHost {
  jump(eventIndex: number, query: string): void
}

function snippet(match: SearchMatch, query: string): (Node | string)[] {
  const at = match.line.toLowerCase().indexOf(query.toLowerCase())
  if (at < 0) return [match.line]
  return [match.line.slice(0, at), h('mark', {}, match.line.slice(at, at + query.length)), match.line.slice(at + query.length)]
}

export class ReplaySearchPanel {
  readonly el: HTMLElement
  private readonly input = h('input', {
    class: 'text-input replay-search-input',
    id: 'replay-search',
    type: 'search',
    placeholder: 'Find text in this recording',
    'aria-label': 'Search in the recording',
    autocomplete: 'off',
    spellcheck: 'false'
  })
  private readonly count = h('p', { class: 'replay-search-count', role: 'status', 'aria-live': 'polite' })
  private readonly list = h('div', { class: 'replay-results', role: 'listbox', 'aria-label': 'Matches' })
  private index: SearchIndex | null = null
  private events: CastEvent[] = []
  private matches: SearchMatch[] = []
  private query = ''
  private current = -1
  private timer: number | undefined

  constructor(private readonly host: ReplaySearchHost) {
    this.el = h('div', { class: 'replay-card replay-search' },
      h('h2', { class: 'replay-card-title' }, 'Search the recording'),
      this.input,
      this.count,
      this.list
    )
    this.input.addEventListener('input', () => {
      window.clearTimeout(this.timer)
      this.timer = window.setTimeout(() => this.run(), SEARCH_DELAY_MS)
    })
    this.input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      window.clearTimeout(this.timer)
      if (this.query !== this.input.value.trim()) this.run()
      this.step(event.shiftKey ? -1 : 1)
    })
  }

  attach(index: SearchIndex, events: CastEvent[]): void {
    this.reset()
    this.index = index
    this.events = events
  }

  reset(): void {
    window.clearTimeout(this.timer)
    this.index = null
    this.events = []
    this.matches = []
    this.query = ''
    this.current = -1
    this.input.value = ''
    this.count.textContent = ''
    clear(this.list)
  }

  clear(): void {
    this.input.value = ''
    this.run()
  }

  private run(): void {
    this.query = this.input.value.trim()
    this.current = -1
    this.matches = this.index && this.query ? searchRecording(this.index, this.events, this.query) : []
    this.renderList()
  }

  private step(direction: 1 | -1): void {
    if (this.matches.length === 0) return
    const next = (this.current + direction + this.matches.length) % this.matches.length
    this.choose(next)
  }

  private choose(position: number): void {
    const match = this.matches[position]
    if (!match) return
    this.current = position
    this.markCurrent()
    this.host.jump(match.eventIndex, this.query)
  }

  private markCurrent(): void {
    this.list.querySelectorAll('.replay-result').forEach((row, position) => {
      const on = position === this.current
      row.classList.toggle('selected', on)
      row.setAttribute('aria-selected', String(on))
      if (on) row.scrollIntoView({ block: 'nearest' })
    })
  }

  private renderList(): void {
    clear(this.list)
    if (!this.query) {
      this.count.textContent = ''
      return
    }
    const capped = this.matches.length >= SEARCH_LIMIT
    this.count.textContent = this.matches.length === 0
      ? 'No matches in this recording.'
      : `${this.matches.length}${capped ? '+' : ''} ${this.matches.length === 1 ? 'match' : 'matches'}. Enter jumps to the next.`
    this.matches.forEach((match, position) => {
      const row = h('button', {
        class: 'replay-result',
        type: 'button',
        role: 'option',
        'aria-selected': 'false',
        'data-time': match.t.toFixed(3),
        onClick: () => this.choose(position)
      },
      h('span', { class: 'replay-result-time mono' }, formatDuration(match.t)),
      h('span', { class: 'replay-result-text' }, ...snippet(match, this.query)))
      this.list.append(row)
    })
  }
}
