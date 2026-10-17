import type { TicketNotes } from './ticketNotes'
import { activeMs, WORK_LABELS, workTickets, type WorkReport } from './workDashboard'
import { filterWorkItems, filterWorkTickets } from './workSearch'

interface SummaryOptions {
  now: number
  periodLabel: string
  mode?: 'sessions' | 'tickets'
  query?: string
  projectId?: string | null
  notes?: TicketNotes
}

const duration = (ms: number): string => {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
const count = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** Standup text for the current tab and filters; no transcript contents leave the view. */
export function formatWorkSummary(report: WorkReport, options: SummaryOptions): string {
  const { now, periodLabel, mode = 'sessions', query = '', projectId = null, notes = {} } = options
  const end = Math.min(report.end, now)
  const items = mode === 'sessions' ? filterWorkItems(report.items, query, projectId) : report.items
  const tickets = filterWorkTickets(workTickets(items, report.start, end), mode === 'tickets' ? query : '', projectId, notes)
  const ticketItems = new Set(tickets.flatMap(ticket => ticket.items.map(item => item.id)))
  const conversations = mode === 'tickets' ? [] : items.filter(item => !ticketItems.has(item.id))
  const projects = new Map([...tickets, ...conversations].map(row => [row.projectId, row.project]))
  const startDate = new Date(report.start)
  const date = (at: number, opts: Intl.DateTimeFormatOptions): string => new Date(at).toLocaleDateString('en-US', opts)
  const short = { month: 'short', day: 'numeric' } as const
  const range = report.period === 'today' ? date(report.start, { weekday: 'short', ...short })
    : report.period === 'month' ? startDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : `${date(report.start, short)} – ${date(report.end - 1, short)}`
  const lines = [`Work · ${range}${range === periodLabel ? '' : ` (${periodLabel})`}`]
  let total = 0
  for (const { projectId: id, project: name } of report.projects.filter(project => projects.has(project.projectId))) {
    lines.push('', name)
    for (const ticket of tickets.filter(ticket => ticket.projectId === id)) {
      const note = notes[ticket.key]
      lines.push(`- ${WORK_LABELS[ticket.type]}${ticket.ticket ? ` ${ticket.ticket}` : ''} ${note?.name || ticket.title}${ticket.branch ? ` (${ticket.branch})` : ''} · ${duration(ticket.activeMs)}${ticket.items.length > 1 ? ` · ${count(ticket.items.length, 'session')}` : ''}`)
      if (note?.link) lines.push(`  ${note.link}`)
      total += ticket.activeMs
    }
    const chats = conversations.filter(item => item.projectId === id)
    if (chats.length) {
      const time = chats.reduce((sum, item) => sum + activeMs(item, report.start, end), 0)
      total += time
      lines.push(`- ${count(chats.length, 'conversation')} · ${duration(time)}`)
    }
  }
  lines.push('', `Total: ${count(tickets.length, 'ticket')}, ${count(conversations.length, 'conversation')} · ${duration(total)}`)
  return lines.join('\n')
}
