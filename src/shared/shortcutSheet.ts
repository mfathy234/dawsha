export interface SheetEntry {
  title: string
  keys: string
}

export interface SheetGroup {
  label: string
  entries: SheetEntry[]
}

export interface SheetCommand {
  id: string
  title: string
  shortcut?: string
}

export const SHEET_GROUPS = ['Sessions', 'Panes', 'Terminal', 'Views', 'Dictation', 'General'] as const

export function sheetGroupFor(id: string): (typeof SHEET_GROUPS)[number] {
  if (id.startsWith('session.')) return 'Sessions'
  if (id.startsWith('terminal.') || id === 'pane.find') return 'Terminal'
  if (id.startsWith('pane.') || id.startsWith('git.')) return 'Panes'
  if (id.startsWith('dictation.')) return 'Dictation'
  if (id.startsWith('view.') || id.startsWith('app.')) return 'Views'
  return 'General'
}

// Keys that work without being a palette command: the palette itself, the zoom keys, the Esc rules.
export function fixedEntries(paletteKeys: string, mod: string): Array<SheetEntry & { group: (typeof SHEET_GROUPS)[number] }> {
  return [
    { group: 'General', title: 'Open the command palette', keys: paletteKeys },
    { group: 'Terminal', title: 'Zoom the pane text in', keys: `${mod}+=` },
    { group: 'Terminal', title: 'Zoom the pane text out', keys: `${mod}+-` },
    { group: 'Terminal', title: 'Reset the pane text size', keys: `${mod}+0` },
    { group: 'Terminal', title: 'Interrupt the agent (Esc stays in the terminal, also in full mode)', keys: 'Esc' },
    { group: 'Panes', title: 'Leave full mode when focus is outside the terminal', keys: 'Esc' },
    { group: 'Panes', title: 'Next terminal tab in a pane', keys: 'Tab' }
  ]
}

export function buildSheet(commands: SheetCommand[], fixed: ReturnType<typeof fixedEntries>): SheetGroup[] {
  const seen = new Set<string>()
  const groups = new Map<string, SheetEntry[]>(SHEET_GROUPS.map((label) => [label, []]))
  const add = (group: string, entry: SheetEntry): void => {
    const key = `${group}|${entry.keys}|${entry.title}`
    if (seen.has(key)) return
    seen.add(key)
    groups.get(group)?.push(entry)
  }
  for (const command of commands) {
    if (command.shortcut) add(sheetGroupFor(command.id), { title: command.title, keys: command.shortcut })
  }
  for (const { group, ...entry } of fixed) add(group, entry)
  return SHEET_GROUPS.map((label) => ({ label, entries: groups.get(label) ?? [] })).filter((group) => group.entries.length > 0)
}

export function filterSheet(groups: SheetGroup[], query: string): SheetGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return groups
  return groups
    .map((group) => ({
      ...group,
      entries: group.entries.filter((entry) => {
        const haystack = `${group.label} ${entry.title} ${entry.keys}`.toLowerCase()
        return words.every((word) => haystack.includes(word))
      })
    }))
    .filter((group) => group.entries.length > 0)
}
