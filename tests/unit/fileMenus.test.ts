import { describe, expect, it } from 'vitest'
import { absolutePath, pathForms, relativeInside, tabMenu, terminalMenu, treeMenu, treeShortcut, type FileMenuEntry } from '../../src/shared/fileMenus'

const ids = (entries: FileMenuEntry[]): string[] => entries.map((entry) => (entry === 'separator' ? '-' : entry.id))
const find = (entries: FileMenuEntry[], id: string) => entries.find((entry) => entry !== 'separator' && entry.id === id)

describe('menu item lists', () => {
  it('offers separated Delete only on tree menus', () => {
    for (const kind of ['file', 'folder'] as const) expect(ids(treeMenu(kind)).slice(-2)).toEqual(['-', 'delete'])
    expect(ids(terminalMenu(true))).not.toContain('delete')
  })
  it('lists the tree file items in the approved order with their keys', () => {
    const entries = treeMenu('file')
    expect(ids(entries)).toEqual(['open', 'open-new-tab', 'add-prompt', '-', 'copy-path', 'copy-relative', '-', 'open-code', 'reveal', 'show-changes', '-', 'delete'])
    expect(entries.map((entry) => (entry === 'separator' ? '' : entry.label))).toEqual([
      'Open', 'Open in new tab', 'Add to prompt', '', 'Copy path', 'Copy relative path', '', 'Open in VS Code', 'Reveal in File Explorer', 'Show changes', '', 'Delete…'
    ])
    expect(find(entries, 'open')).toMatchObject({ keys: 'Enter' })
    expect(find(entries, 'open-new-tab')).toMatchObject({ keys: 'Ctrl+click' })
    expect(find(entries, 'add-prompt')).toMatchObject({ keys: 'Alt+Enter' })
  })

  it('gives folders the subset that makes sense', () => {
    expect(ids(treeMenu('folder', false))).toEqual(['toggle', '-', 'copy-path', 'copy-relative', '-', 'reveal', '-', 'delete'])
    expect(find(treeMenu('folder', false), 'toggle')).toMatchObject({ label: 'Expand' })
    expect(find(treeMenu('folder', true), 'toggle')).toMatchObject({ label: 'Collapse' })
  })

  it('lists the tab items and disables the closes that have nothing to close', () => {
    expect(ids(tabMenu(0, 3))).toEqual(['close', 'close-others', 'close-right', '-', 'copy-path', 'copy-relative', '-', 'reveal', 'open-code'])
    expect(find(tabMenu(2, 3), 'close-right')).toMatchObject({ disabled: true })
    expect(find(tabMenu(0, 3), 'close-right')).not.toHaveProperty('disabled')
    expect(find(tabMenu(0, 1), 'close-others')).toMatchObject({ disabled: true })
  })

  it('lists the terminal path items and disables what needs the file to be in the project', () => {
    expect(find(terminalMenu(true), 'open-files-new-tab')).toMatchObject({ keys: 'Ctrl+click' })
    expect(ids(terminalMenu(true))).toEqual(['open-files', 'open-files-new-tab', 'open-code', '-', 'copy-path', 'copy-relative'])
    const outside = terminalMenu(false)
    expect(['open-files', 'open-files-new-tab', 'open-code', 'copy-relative'].every((id) => (find(outside, id) as { disabled?: boolean }).disabled === true)).toBe(true)
    expect(find(outside, 'copy-path')).not.toHaveProperty('disabled')
  })
})

describe('treeShortcut', () => {
  const key = (k: string, extra: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...extra })

  it('maps the keys shown in the menu', () => {
    expect(treeShortcut(key('Enter', { altKey: true }))).toBe('add-prompt')
    expect(treeShortcut(key('Enter', { ctrlKey: true }))).toBe('open-code')
    expect(treeShortcut(key('C', { altKey: true, shiftKey: true }))).toBe('copy-path')
    expect(treeShortcut(key('C', { altKey: true, shiftKey: true, ctrlKey: true }))).toBe('copy-relative')
    expect(treeShortcut(key('R', { altKey: true, shiftKey: true }))).toBe('reveal')
    expect(treeShortcut(key('Enter'))).toBeNull()
    expect(treeShortcut(key('c', { ctrlKey: true }))).toBeNull()
  })
})

describe('paths', () => {
  it('joins with the separator the folder uses', () => {
    expect(absolutePath('C:\\work\\acme', 'src/a.ts')).toBe('C:\\work\\acme\\src\\a.ts')
    expect(absolutePath('/home/me/acme/', 'src/a.ts')).toBe('/home/me/acme/src/a.ts')
  })

  it('finds the path below the folder, ignoring slash style and Windows case, and refuses outsiders', () => {
    expect(relativeInside('C:\\work\\acme', 'C:\\work\\acme\\src\\invoices\\totals.ts')).toBe('src/invoices/totals.ts')
    expect(relativeInside('C:\\Work\\Acme', 'c:/work/acme/README.md')).toBe('README.md')
    expect(relativeInside('/home/me/acme', '/home/me/acme/src/a.ts')).toBe('src/a.ts')
    expect(relativeInside('/home/me/acme', '/home/me/ACME/src/a.ts')).toBeNull()
    expect(relativeInside('/home/me/acme', '/home/me/acme-two/a.ts')).toBeNull()
    expect(relativeInside('/home/me/acme', '/home/me/acme')).toBeNull()
    expect(relativeInside('C:\\work\\acme', 'C:\\notes.md')).toBeNull()
  })

  it('builds both copy forms for a project that lives below the repository root', () => {
    expect(pathForms('/repo/packages/web', 'packages/web', 'packages/web/src/a.ts')).toEqual({ absolute: '/repo/packages/web/src/a.ts', relative: 'src/a.ts' })
    expect(pathForms('/repo', '', 'src/a.ts')).toEqual({ absolute: '/repo/src/a.ts', relative: 'src/a.ts' })
  })
})
