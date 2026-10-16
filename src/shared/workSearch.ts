import { agentLabel } from './agents'
import type { TicketNotes } from './ticketNotes'
import { aggregateWork, type WorkItem, type WorkReport, type WorkTicket } from './workDashboard'

/** Words may match different fields; whitespace-only queries match everything. */
function matches(query: string, fields: readonly (string | null | undefined)[]): boolean {
  const text = fields.filter(Boolean).join(' ').toLowerCase()
  return query.toLowerCase().trim().split(/\s+/).every(word => text.includes(word))
}

export function filterWorkItems(items: readonly WorkItem[], query: string, projectId: string | null = null): WorkItem[] {
  return items.filter(item => (projectId === null || item.projectId === projectId) && matches(query, [
    item.title, item.project, item.branch, item.ticket,
    item.agent === 'orchestrator' ? 'Orchestrator' : agentLabel(item.agent)
  ]))
}

/** Search after grouping so a matching session keeps the complete ticket and its time. */
export function filterWorkTickets(tickets: readonly WorkTicket[], query: string, projectId: string | null, notes: TicketNotes): WorkTicket[] {
  return tickets.filter(ticket => (projectId === null || ticket.projectId === projectId) && matches(query, [
    ticket.title, notes[ticket.key]?.name, notes[ticket.key]?.link, ticket.project, ticket.branch, ticket.ticket,
    ...ticket.items.map(item => item.title)
  ]))
}

export function filterWorkReport(report: WorkReport, query: string, projectId: string | null, now: number): WorkReport {
  return aggregateWork(filterWorkItems(report.items, query, projectId), report.period, now, report.start)
}

/** Options describe the whole period, independent of the current query and selected project. */
export function workProjectOptions(rows: readonly { projectId: string; project: string }[]): { projectId: string; project: string; count: number }[] {
  const projects = new Map<string, { projectId: string; project: string; count: number }>()
  for (const row of rows) {
    const previous = projects.get(row.projectId)
    projects.set(row.projectId, { projectId: row.projectId, project: row.project, count: (previous?.count ?? 0) + 1 })
  }
  return [...projects.values()].sort((a, b) => a.project.localeCompare(b.project) || a.projectId.localeCompare(b.projectId))
}
