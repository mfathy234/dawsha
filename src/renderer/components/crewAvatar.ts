import { AVATAR_BADGES, AVATAR_LABELS, type AvatarState } from '../../shared/crewLive'
import type { CrewColour } from '../../shared/crew'
import { h } from '../dom'
import type { PaneView } from '../derive'
import type { AppState } from '../state'
import { agentMark } from './agentMark'
import './crewAvatar.css'

export interface AvatarIdentity {
  name: string
  role?: string
  initials: string
  colour: CrewColour
  lead?: boolean
}

/** A member's avatar. The state is also a badge glyph and a label, so colour and motion are never the only signal. */
export function crewAvatar(identity: AvatarIdentity, state: AvatarState = 'idle', size = 28): HTMLElement {
  const label = AVATAR_LABELS[state]
  const badge = AVATAR_BADGES[state]
  return h(
    'span',
    {
      class: `crew-av${identity.lead ? ' lead' : ''}`,
      style: `--c:var(--id-${identity.colour});--size:${size}px`,
      'data-state': state,
      'data-member': identity.name,
      role: 'img',
      'aria-label': `${identity.name}, ${label}`,
      title: `${identity.name}${identity.role ? ` · ${identity.role}` : ''} · ${label}`
    },
    identity.initials,
    h('span', { class: 'crew-av-badge', 'aria-hidden': 'true' }, badge)
  )
}

/** The mark of a pane in a header or a row: the member's avatar with the small agent mark beside it, else the agent mark. */
export function identityMark(view: Pick<PaneView, 'pane' | 'agent' | 'crew'>, size = 22): HTMLElement | null {
  if (!view.crew) return agentMark(view.agent)
  const small = agentMark(view.agent, 'crew-agent')
  return h('span', { class: 'crew-id' }, crewAvatar(view.crew.identity, view.crew.state, size), small)
}

export function crewSignature(view: Pick<PaneView, 'crew'>): string {
  return view.crew ? `${view.crew.identity.runId}:${view.crew.state}:${view.crew.identity.name}` : ''
}

export const crewStateOf = (state: AppState, paneId: string): AvatarState => state.crewStates[paneId] ?? 'idle'
