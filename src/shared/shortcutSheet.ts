export interface SheetEntry {
  title: string
  keys: string
  /** Extra words the search matches, such as each number of a collapsed 1–9 row. */
  terms?: string
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
    { group: 'Panes', title: 'Next terminal tab in a pane', keys: 'Ctrl+PageDown' },
    { group: 'Panes', title: 'Previous terminal tab in a pane', keys: 'Ctrl+PageUp' },
    { group: 'Views', title: 'Files: edit the open file (read only until then)', keys: 'E' },
    { group: 'Views', title: 'Files: save the open file', keys: 'Ctrl+S' },
    { group: 'Views', title: 'Files: close the open tab', keys: 'Ctrl+W' },
    { group: 'Terminal', title: 'Tab and Shift+Tab go to the agent (Claude Code mode switch, shell completion)', keys: 'Tab' }
  ]
}

const NUMBERED = /^(.*) ([1-9])$/

/** "Focus pane 1" … "Focus pane 9" on Ctrl+1 … Ctrl+9 become one row, "Focus pane 1–9" on "Ctrl+1…9". */
function collapseNumbered(entries: SheetEntry[]): SheetEntry[] {
  const out: SheetEntry[] = []
  for (let i = 0; i < entries.length; i++) {
    const head = NUMBERED.exec(entries[i].title)
    const keyBase = head && entries[i].keys.endsWith(head[2]) ? entries[i].keys.slice(0, -1) : null
    const run = [entries[i]]
    while (head && keyBase !== null && i + run.length < entries.length) {
      const next = entries[i + run.length]
      const digit = String(Number(head[2]) + run.length)
      if (next.title !== `${head[1]} ${digit}` || next.keys !== keyBase + digit) break
      run.push(next)
    }
    if (!head || run.length < 3) {
      out.push(entries[i])
      continue
    }
    const last = run[run.length - 1]
    out.push({
      title: `${head[1]} ${head[2]}–${last.title.slice(-1)}`,
      keys: `${entries[i].keys}…${last.keys.slice(-1)}`,
      terms: run.map((entry) => `${entry.title} ${entry.keys}`).join(' ')
    })
    i += run.length - 1
  }
  return out
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
  return SHEET_GROUPS.map((label) => ({ label, entries: collapseNumbered(groups.get(label) ?? []) })).filter((group) => group.entries.length > 0)
}

export function filterSheet(groups: SheetGroup[], query: string): SheetGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return groups
  return groups
    .map((group) => ({
      ...group,
      entries: group.entries.filter((entry) => {
        const haystack = `${group.label} ${entry.title} ${entry.keys} ${entry.terms ?? ''}`.toLowerCase()
        return words.every((word) => haystack.includes(word))
      })
    }))
    .filter((group) => group.entries.length > 0)
}
