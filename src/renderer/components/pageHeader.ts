import { h } from '../dom'

export interface PageHeaderOptions {
  title: string
  subtitle?: string
  actions?: HTMLElement | HTMLElement[] | null
}

/** The shared title row used by top-level workspace pages. */
export function pageHeader({ title, subtitle, actions }: PageHeaderOptions): HTMLElement {
  const actionNodes = actions ? (Array.isArray(actions) ? actions : [actions]) : []
  return h(
    'header',
    { class: 'page-header' },
    h('div', { class: 'page-header-copy' }, h('h1', { class: 'page-title' }, title), subtitle !== undefined ? h('p', { class: 'page-subtitle' }, subtitle) : null),
    actionNodes.length ? h('div', { class: 'page-header-actions' }, ...actionNodes) : null
  )
}
