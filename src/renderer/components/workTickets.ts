import { setTicketNote, type TicketNote, type TicketNotes } from '../../shared/ticketNotes'
import { WORK_LABELS, WORK_NOUNS, WORK_TYPES, workTickets, type WorkItem, type WorkReport, type WorkTicket } from '../../shared/workDashboard'
import { filterWorkTickets } from '../../shared/workSearch'
import { saveSettings } from '../actions'
import { api } from '../api'
import { h } from '../dom'
import { countLine } from './countLine'
import { store } from '../state'

/** Tickets are never plain conversations: only the types that changed something. */
const TICKET_TYPES = WORK_TYPES.filter((t) => t !== 'conversation')

export interface TicketsContext {
  notes: TicketNotes
  query: string
  projectId: string | null
  window: { start: number; end: number }
  duration: (ms: number) => string
  /** One session or run row, opened on click; reused from the Sessions tab. */
  renderItem: (item: WorkItem) => HTMLElement
  setProject: (projectId: string | null) => void
  rerender: () => void
}

/** The Tickets tab of the Work view: one row per branch or run, with the user's own name and link. */
export class TicketsPanel {
  private editing: string | null = null
  private focusEditor = false
  private error: string | null = null
  /** What the user typed, kept when search, filters or an error redraw the form. */
  private draft: TicketNote | null = null

  render(report: WorkReport, ctx: TicketsContext): HTMLElement[] {
    const all = workTickets(report.items, ctx.window.start, ctx.window.end)
    const searched = filterWorkTickets(all, ctx.query, null, ctx.notes)
    const tickets = filterWorkTickets(searched, '', ctx.projectId, ctx.notes)
    return [this.tiles(tickets), this.projects(searched, ctx), this.list(tickets, ctx),
      h('p', { class: 'usage-local muted' }, 'One ticket per branch in a project (or per orchestrator run), however many sessions it took. Chats on main or develop are not tickets. Give a ticket your own name or a link with Edit.')]
  }

  private tiles(tickets: WorkTicket[]): HTMLElement {
    const parts = TICKET_TYPES.map((type) => ({ id: `work-tickets-${type}`, count: tickets.filter((t) => t.type === type).length, ...WORK_NOUNS[type] }))
    return countLine([...parts, { id: 'work-tickets-total', count: tickets.length, one: 'ticket', many: 'tickets' }], 'Tickets summary')
  }

  private projects(tickets: WorkTicket[], ctx: TicketsContext): HTMLElement {
    const rows = [...new Set(tickets.map((t) => t.projectId))].map((projectId) => {
      const own = tickets.filter((t) => t.projectId === projectId)
      return { projectId, project: own[0].project, own, time: own.reduce((sum, t) => sum + t.activeMs, 0) }
    }).sort((a, b) => b.own.length - a.own.length || a.project.localeCompare(b.project))
    return h('section', { class: 'usage-panel work-projects', 'aria-label': 'Tickets per project' }, h('h2', {}, 'Per project'),
      h('div', { class: 'work-table-scroll' }, h('table', { class: 'usage-table', id: 'work-tickets-by-project' },
        h('thead', {}, h('tr', {}, ...['Project', ...TICKET_TYPES.map((t) => WORK_LABELS[t]), 'Tickets', 'Time spent'].map((text, i) => h('th', { scope: 'col', class: i ? 'num' : '' }, text)))),
        h('tbody', {}, ...rows.map((row) => h('tr', { 'data-project': row.projectId },
          h('td', {}, h('button', { class: 'usage-sort', type: 'button', 'aria-label': `Filter by ${row.project}`, 'aria-pressed': String(ctx.projectId === row.projectId), onClick: () => ctx.setProject(ctx.projectId === row.projectId ? null : row.projectId) }, row.project)),
          ...TICKET_TYPES.map((t) => h('td', { class: 'num' }, String(row.own.filter((x) => x.type === t).length))),
          h('td', { class: 'num' }, String(row.own.length)), h('td', { class: 'num' }, ctx.duration(row.time))))))))
  }

  private list(tickets: WorkTicket[], ctx: TicketsContext): HTMLElement {
    return h('section', { class: 'usage-panel', 'aria-label': 'Tickets' },
      h('div', { class: 'usage-panel-head' }, h('h2', {}, `Tickets · ${tickets.length}`),
        ctx.projectId ? h('button', { class: 'btn ghost', type: 'button', onClick: () => ctx.setProject(null) }, 'All projects') : null),
      tickets.length === 0
        ? h('p', { class: 'usage-empty', role: 'status' }, ctx.query.trim()
          ? `No matches for “${ctx.query.trim()}”. Clear the search to see more work.`
          : ctx.projectId ? 'No tickets for this project in this period.' : 'No tickets in this period. Work on a feature or fix branch, or an orchestrator run, shows up here.')
        : h('ul', { class: 'work-tickets' }, ...tickets.map((t) => this.ticket(t, ctx))))
  }

  private ticket(ticket: WorkTicket, ctx: TicketsContext): HTMLElement {
    const note = ctx.notes[ticket.key]
    const sessions = ticket.items.length
    const link = note?.link
      ? h('a', { class: 'work-ticket-link', href: note.link, title: note.link, onClick: (event: Event) => { event.preventDefault(); void api.openExternal(note.link) } }, 'Open link ↗')
      : null
    return h('li', { class: 'work-ticket-row', 'data-ticket': ticket.key },
      h('div', { class: 'work-ticket-head' },
        h('strong', { class: 'work-ticket-name' }, note?.name || ticket.title),
        h('span', { class: `work-chip work-${ticket.type}` }, WORK_LABELS[ticket.type]),
        !ctx.projectId ? h('span', { class: 'work-project-chip' }, ticket.project) : null,
        ticket.ticket ? h('span', { class: 'work-ticket' }, ticket.ticket) : null,
        link,
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn small ghost', type: 'button', 'aria-expanded': String(this.editing === ticket.key), onClick: () => { this.editing = this.editing === ticket.key ? null : ticket.key; this.focusEditor = this.editing !== null; this.error = null; this.draft = null; ctx.rerender() } }, 'Edit')),
      h('p', { class: 'work-item-meta' }, ticket.project, ' · ', ticket.branch ?? 'Orchestrator run', ' · ', `${sessions} ${sessions === 1 ? 'session' : 'sessions'}`, ' · ',
        new Date(ticket.lastAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }), ' · ', ctx.duration(ticket.activeMs)),
      this.editing === ticket.key ? this.form(ticket, note, ctx) : null,
      h('details', { class: 'work-ticket-sessions' }, h('summary', {}, sessions === 1 ? 'Show the session' : `Show the ${sessions} sessions`),
        h('ul', { class: 'work-items' }, ...ticket.items.map((item) => ctx.renderItem(item)))))
  }

  private form(ticket: WorkTicket, note: TicketNote | undefined, ctx: TicketsContext): HTMLElement {
    const typed = this.draft ?? note
    const name = h('input', { class: 'text-input', type: 'text', value: typed?.name ?? '', placeholder: ticket.title, maxlength: 120, 'aria-label': 'Ticket name' })
    // Plain text: the browser's URL field silently refuses links typed without https://, which are added on save.
    const link = h('input', { class: 'text-input', type: 'text', inputmode: 'url', spellcheck: false, value: typed?.link ?? '', placeholder: 'https://… (issue, work item or PR)', 'aria-label': 'Ticket link' })
    const keepDraft = (): void => { this.draft = { name: name.value, link: link.value } }
    name.addEventListener('input', keepDraft)
    link.addEventListener('input', keepDraft)
    const save = (next: TicketNote): void => {
      try {
        const notes = setTicketNote(ctx.notes, ticket.key, next)
        this.editing = null
        this.error = null
        this.draft = null
        // Shown at once, then saved, as other settings are.
        store.set((state) => ({ ...state, settings: { ...state.settings, ticketNotes: notes } }))
        void saveSettings({ ticketNotes: notes })
      } catch (error) {
        this.error = (error as Error).message
        this.draft = next
      }
      ctx.rerender()
    }
    const form = h('form', { class: 'work-ticket-form', 'aria-label': `Edit ${ticket.title}` },
      h('label', {}, h('span', {}, 'Name'), name),
      h('label', {}, h('span', {}, 'Link'), link),
      this.error ? h('p', { class: 'field-error', role: 'alert' }, this.error) : null,
      h('div', { class: 'work-ticket-actions' },
        note ? h('button', { class: 'btn ghost', type: 'button', onClick: () => save({ name: '', link: '' }) }, 'Clear') : null,
        h('button', { class: 'btn ghost', type: 'button', onClick: () => { this.editing = null; this.error = null; this.draft = null; ctx.rerender() } }, 'Cancel'),
        h('button', { class: 'btn primary', type: 'submit' }, 'Save')))
    form.addEventListener('submit', (event) => { event.preventDefault(); save({ name: name.value, link: link.value }) })
    if (this.focusEditor) {
      this.focusEditor = false
      queueMicrotask(() => name.focus())
    }
    return form
  }
}
