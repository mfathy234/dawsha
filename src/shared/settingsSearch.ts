export type SearchSectionId = string

export interface SearchSection {
  id: SearchSectionId
  label: string
  lede: string
}

/** What each section holds, so "Find in Settings" can name a section from a row's label or description without drawing it. */
export const SETTINGS_INDEX: Readonly<Record<string, readonly string[]>> = {
  general: [
    'Command palette shortcut Ctrl or Alt plus a key',
    'Sessions dim sessions you are not working in',
    'Open sessions as Terminal or Chat',
    'Saved prompts slash save',
    'Tag colours colour sessions by their tag',
    'Recap one-line summary below the title',
    'Terminal rendering sleep hidden terminals WebGL',
    'Sidebar start with the sidebar collapsed',
    'Getting started setup guide',
    'Recordings'
  ],
  appearance: [
    'Desktop app style Quiet panes Sidebar frame Warm tone',
    'Panes Classic Quiet rounded panes',
    'Frame Top bar Sidebar',
    'Tone Cool Warm neutral greys',
    'Layout when Dawsha opens Grid Board Side panel',
    'Theme choose a theme and terminal background colours',
    'Sessions grid Calm focus Mission control tiles',
    'Large session move the session I pick to the large spot'
  ],
  notifications: [
    'Session info live status line',
    'Mini window show when minimized',
    'Notifications notify when a session is done or needs you',
    'Sound play a sound with notifications',
    'Highlight lines matching rules regex colour error warning'
  ],
  agents: [
    'Claude Codex Gemini full access runs without approval prompts',
    'Installs manage the command-line agents',
    'Session presets saved from New session'
  ],
  mcp: ['MCP servers each agent is set up with'],
  import: ['Import settings file preview projects preferences', 'Export settings Browse'],
  remote: ['Remote access phone pairing link QR code Cloudflare tunnel', 'Phones devices paired', 'Phone alerts and limits'],
  updates: ['Current version', 'Automatic checks for updates', 'Status check now download install'],
  about: ['Version GitHub repository releases license', 'Data folder settings file usage history', 'Changelog what is new release notes']
}

const tokens = (query: string): string[] => query.toLocaleLowerCase().split(/\s+/).filter((word) => word !== '')

/** True when every word of the query is found in the text, in any order, ignoring case. An empty query matches everything. */
export function matchesQuery(query: string, ...texts: readonly string[]): boolean {
  const words = tokens(query)
  if (words.length === 0) return true
  const haystack = texts.join(' ').toLocaleLowerCase()
  return words.every((word) => haystack.includes(word))
}

/** The sections whose name, intro or rows match the query, in their order. */
export function sectionsMatching<T extends SearchSection>(sections: readonly T[], query: string): T[] {
  if (tokens(query).length === 0) return [...sections]
  return sections.filter((section) => matchesQuery(query, section.label, section.lede, ...(SETTINGS_INDEX[section.id] ?? [])))
}

/** Whether the section's own name or intro matches, which shows all of its rows instead of only the matching ones. */
export function sectionTitleMatches(section: SearchSection, query: string): boolean {
  return tokens(query).length > 0 && matchesQuery(query, section.label, section.lede)
}
