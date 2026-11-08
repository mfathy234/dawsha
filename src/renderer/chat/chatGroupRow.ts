import { groupKey, groupLabel, type ToolGroup } from '../../shared/chatGroups'
import { turnTimings, workedLabel, type TurnTiming } from '../../shared/chatTiming'
import type { ChatItem } from '../../shared/chatLog'
import { h, icon } from '../dom'
import { ICONS } from '../icons'
import './chatExtras.css'

/** One line for a run of reads and searches; opening it lists the individual rows, which the caller draws. */
export function groupRow(group: ToolGroup, opened: boolean, rows: readonly HTMLElement[], flip: (key: string) => void): HTMLElement[] {
  const key = groupKey(group.id)
  const head = h(
    'button',
    { class: 'chat-tool chat-group', type: 'button', 'aria-expanded': String(opened), 'data-group': group.id, onClick: () => flip(key) },
    icon(opened ? ICONS.chevronDown : ICONS.chevronRight),
    h('span', {}, groupLabel(group))
  )
  return opened ? [head, h('div', { class: 'chat-group-body' }, ...rows)] : [head]
}

/** The reply each finished turn's "Worked 2m 14s · 9 tools" line belongs under. */
export const workedByReply = (items: readonly ChatItem[]): ReadonlyMap<string, TurnTiming> => new Map(turnTimings(items).map((timing) => [timing.replyId, timing]))

/** The quiet line under a reply when there is no summary card to hold it. */
export const workedLine = (timing: TurnTiming): HTMLElement => h('p', { class: 'chat-quiet chat-worked', 'data-worked': '' }, workedLabel(timing))
