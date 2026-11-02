import { formatSize } from '../../shared/gitBranches'
import { folderFilesText, isHeavyFolder, type UntrackedFolder } from '../../shared/gitIgnore'
import { openContextMenu } from '../components/contextMenu'
import { h, icon } from '../dom'
import { ICONS } from '../icons'

export interface NewFolderHooks {
  /** The row was expanded or folded; the owner draws its list again. */
  toggle(path: string): void
  ignore(folder: UntrackedFolder): void
}

const expanded = new Set<string>()

export function isFolderOpen(path: string): boolean {
  return expanded.has(path)
}

/** Remembers which folded folders are open, for every list that shows them. */
export function toggleFolderOpen(path: string): void {
  if (!expanded.delete(path)) expanded.add(path)
}

export function folderSummary(folder: UntrackedFolder): string {
  return `${folderFilesText(folder.files, folder.capped)} · ${formatSize(folder.bytes, folder.capped)}`
}

/**
 * One row for a folder of new files: its name, how many files and how big (in the warning colour from 100 MB), and Add to .gitignore.
 * Opening it shows `children`, the rows of the individual files.
 */
export function newFolderRow(folder: UntrackedFolder, hooks: NewFolderHooks, children: readonly HTMLElement[]): HTMLElement {
  const open = isFolderOpen(folder.path)
  const head = h('button', {
    class: 'files-newdir-head', type: 'button', 'aria-expanded': String(open), title: `${folder.path} · ${folderSummary(folder)}`,
    onClick: () => hooks.toggle(folder.path)
  },
  icon(ICONS.chevronRight), icon(ICONS.folder), h('span', { class: 'files-newdir-name' }, folder.path),
  h('span', { class: `files-newdir-size${isHeavyFolder(folder) ? ' heavy' : ''}` }, folderSummary(folder)))
  const kebab = h('button', {
    class: 'icon-btn small files-newdir-ignore', type: 'button', 'aria-haspopup': 'menu', 'aria-label': `Actions for ${folder.path}`, title: 'Folder actions',
    onClick: () => {
      const rect = kebab.getBoundingClientRect()
      openContextMenu({
        x: rect.left, y: rect.bottom, anchor: rect, label: `Actions for ${folder.path}`, returnFocus: kebab,
        entries: [{ label: 'Add to .gitignore', detail: `${folder.path} stops being listed by git`, run: () => hooks.ignore(folder) }]
      })
    }
  }, icon(ICONS.more))
  return h('div', { class: `files-newdir${open ? ' open' : ''}`, 'data-folder': folder.path, role: 'listitem' },
    h('div', { class: 'files-newdir-line' }, head, kebab),
    open ? h('div', { class: 'files-newdir-children' }, ...children) : null)
}
