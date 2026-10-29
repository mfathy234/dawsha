import { AGENT_NAMES } from '../../shared/agents'
import { formatClock } from '../../shared/timeline'
import { SEARCH_HITS_SHOWN, type SearchHit, type SessionHits } from '../../shared/timelineSearch'
import type { ResumeSession } from '../../shared/types'
import { h } from '../dom'
import { agentMark } from './agentMark'

const KIND_WORDS: Record<string, string> = {
  prompt: 'Prompt',
  reply: 'Reply',
  read: 'Read',
  edit: 'Edit',
  command: 'Command',
  test: 'Test',
  error: 'Error',
  approval: 'Approval',
  state: 'State'
}

const dateOf = (at: number): string => new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

export interface ResultHandlers {
  open(session: ResumeSession, hit: SearchHit | undefined): void
}

function hitRow(group: SessionHits<ResumeSession>, hit: SearchHit, handlers: ResultHandlers): HTMLElement {
  const snippet = hit.snippet.map((part) => (part.match ? h('mark', { class: 'tl-hit' }, part.text) : part.text))
  return h(
    'button',
    {
      class: 'tl-result-hit',
      type: 'button',
      'aria-label': `${KIND_WORDS[hit.kind] ?? hit.kind} at ${formatClock(hit.at)} in ${group.session.title}`,
      onClick: () => handlers.open(group.session, hit)
    },
    h('span', { class: 'tl-time' }, formatClock(hit.at)),
    h('span', { class: 'tl-result-kind' }, KIND_WORDS[hit.kind] ?? hit.kind),
    h('span', { class: 'tl-result-snippet' }, ...snippet)
  )
}

/** One block per session: its title and details, up to three matching events, and how many more there are. */
export function resultGroups(groups: readonly SessionHits<ResumeSession>[], projectName: (id: string) => string, handlers: ResultHandlers): HTMLElement[] {
  return groups.map((group) => {
    const { session } = group
    const meta = [projectName(session.projectId), AGENT_NAMES[session.agent], dateOf(session.startedAt || session.modifiedAt)].filter(Boolean).join(' · ')
    const more = group.total - Math.min(group.hits.length, SEARCH_HITS_SHOWN)
    return h(
      'section',
      { class: 'tl-result', 'aria-label': session.title },
      h(
        'button',
        { class: 'tl-result-head', type: 'button', 'aria-label': `Open ${session.title}`, onClick: () => handlers.open(session, group.hits[0]) },
        h('b', {}, session.title),
        h('span', { class: 'tl-result-meta' }, agentMark(session.agent), meta)
      ),
      ...group.hits.map((hit) => hitRow(group, hit, handlers)),
      more > 0
        ? h(
            'button',
            { class: 'tl-result-more', type: 'button', onClick: () => handlers.open(session, group.hits[0]) },
            `${more} more in this session`
          )
        : null
    )
  })
}
