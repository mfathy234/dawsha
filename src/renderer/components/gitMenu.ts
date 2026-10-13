import { h, icon, placeNearAnchor } from '../dom'
import { applyStashPane, fetchPane, pullPane, stashPane, switchBranchPane } from '../gitQuickActions'
import { ICONS } from '../icons'

let open: { root: HTMLElement; close: () => void } | null = null

export function closeBranchMenu(): void {
  open?.close()
}

export function openBranchMenu(paneId: string, anchor: HTMLElement): void {
  const wasOpen = open !== null
  closeBranchMenu()
  if (wasOpen) return
  const run = (action: (id: string) => Promise<void>): void => {
    closeBranchMenu()
    void action(paneId)
  }
  const item = (label: string, svg: string, action: (id: string) => Promise<void>, id: string): HTMLElement =>
    h(
      'button',
      { class: 'menu-item menu-item-icon', type: 'button', role: 'menuitem', 'data-git': id, onClick: () => run(action) },
      h('span', { class: 'menu-icon', 'aria-hidden': 'true' }, icon(svg)),
      h('span', { class: 'menu-label' }, label)
    )
  const rect = anchor.getBoundingClientRect()
  const root = h(
    'div',
    {
      class: 'popover menu floating branch-menu',
      role: 'menu',
      'aria-label': 'Git actions',
      style: `left:${Math.round(rect.left)}px;top:${Math.round(rect.bottom + 4)}px`
    },
    item('Pull', ICONS.download, pullPane, 'pull'),
    item('Switch branch…', ICONS.branch, switchBranchPane, 'switch'),
    item('Stash changes', ICONS.commit, stashPane, 'stash'),
    item('Apply last stash', ICONS.history, applyStashPane, 'stash-pop'),
    item('Fetch', ICONS.download, fetchPane, 'fetch')
  )
  const outside = (event: Event): void => {
    if (!root.contains(event.target as Node) && !anchor.contains(event.target as Node)) closeBranchMenu()
  }
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    closeBranchMenu()
    anchor.focus()
  }
  const close = (): void => {
    document.removeEventListener('pointerdown', outside, true)
    document.removeEventListener('keydown', onKey, true)
    root.remove()
    open = null
  }
  document.body.appendChild(root)
  placeNearAnchor(root, anchor)
  document.addEventListener('pointerdown', outside, true)
  document.addEventListener('keydown', onKey, true)
  open = { root, close }
  root.querySelector<HTMLElement>('.menu-item')?.focus()
}
