import { execFileSync } from 'node:child_process'
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Sandbox } from '../e2e/helpers'
import { CLAUDE_IDS } from './resumeFixtures'

const git = (cwd: string, ...args: string[]): void => {
  execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Dana Whitfield', '-c', 'user.email=dana@acme.example', ...args], { cwd, stdio: 'ignore' })
}

const put = (root: string, files: Record<string, string>): void => {
  for (const [rel, text] of Object.entries(files)) {
    const path = join(root, ...rel.split('/'))
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text, 'utf8')
  }
}

const PACKAGE = (name: string): string => JSON.stringify({ name, version: '1.4.0', private: true, scripts: { build: 'tsc -p .', test: 'vitest run' } }, null, 2) + '\n'

const THEME_BEFORE = `import { createContext, useContext, useState, type ReactNode } from 'react'

export type Theme = 'light'

const ThemeContext = createContext<Theme>('light')

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme] = useState<Theme>('light')
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
}

export function useTheme(): Theme {
  return useContext(ThemeContext)
}
`

const THEME_AFTER = `import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { readStoredTheme, storeTheme } from '../lib/storage'

export type Theme = 'light' | 'dark'

export const THEME_ATTRIBUTE = 'data-theme'

interface ThemeValue {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeValue>({ theme: 'light', setTheme: () => undefined, toggleTheme: () => undefined })

export function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme() ?? systemTheme())

  useEffect(() => {
    document.documentElement.setAttribute(THEME_ATTRIBUTE, theme)
  }, [theme])

  const setTheme = useCallback((next: Theme) => {
    storeTheme(next)
    setThemeState(next)
  }, [])

  const toggleTheme = useCallback(() => setTheme(theme === 'dark' ? 'light' : 'dark'), [theme, setTheme])

  return <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeValue {
  return useContext(ThemeContext)
}
`

const SETTINGS_BEFORE = `import { useTheme } from '../context/theme'

export function Settings() {
  const theme = useTheme()
  return (
    <section className="settings">
      <h1>Settings</h1>
      <p>Current theme: {theme}</p>
    </section>
  )
}
`

const SETTINGS_AFTER = `import { useTheme } from '../context/theme'
import { ThemeToggle } from './ThemeToggle'

export function Settings() {
  const { theme } = useTheme()
  return (
    <section className="settings">
      <h1>Settings</h1>
      <p>Current theme: {theme}</p>
      <ThemeToggle />
    </section>
  )
}
`

const TOGGLE = `import { useTheme } from '../context/theme'

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  return (
    <button type="button" className="theme-toggle" role="switch" aria-checked={theme === 'dark'} onClick={toggleTheme}>
      {theme === 'dark' ? 'Dark mode on' : 'Dark mode off'}
    </button>
  )
}
`

const STORAGE = `import type { Theme } from '../context/theme'

const KEY = 'acme.theme'

export function readStoredTheme(): Theme | null {
  const value = window.localStorage.getItem(KEY)
  return value === 'light' || value === 'dark' ? value : null
}

export function storeTheme(theme: Theme): void {
  window.localStorage.setItem(KEY, theme)
}
`

const THEME_TEST = `import { describe, expect, it } from 'vitest'
import { readStoredTheme, storeTheme } from '../lib/storage'

describe('stored theme', () => {
  it('returns null until a theme is stored', () => {
    window.localStorage.clear()
    expect(readStoredTheme()).toBeNull()
  })

  it('keeps the last theme that was stored', () => {
    storeTheme('dark')
    expect(readStoredTheme()).toBe('dark')
  })
})
`

const LEGACY = `export const legacyDarkPalette = {
  background: '#101114',
  text: '#e8e8ea'
}
`

/** acme-web: committed baseline on main, then a feature branch with a modified, an added and a deleted file in the working tree. */
export function makeAcmeWeb(root: string): void {
  mkdirSync(root, { recursive: true })
  put(root, {
    'package.json': PACKAGE('acme-web'),
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', jsx: 'react-jsx', strict: true, outDir: 'dist' }, include: ['src'] }, null, 2) + '\n',
    'README.md': '# acme-web\n\nThe customer dashboard for Acme.\n',
    'src/index.tsx': "import { createRoot } from 'react-dom/client'\nimport { App } from './App'\n\ncreateRoot(document.getElementById('root')!).render(<App />)\n",
    'src/App.tsx': "import { ThemeProvider } from './context/theme'\nimport { Settings } from './components/Settings'\n\nexport function App() {\n  return (\n    <ThemeProvider>\n      <Settings />\n    </ThemeProvider>\n  )\n}\n",
    'src/context/theme.tsx': THEME_BEFORE,
    'src/components/Settings.tsx': SETTINGS_BEFORE,
    'src/lib/storage.ts': STORAGE,
    'src/context/theme.test.tsx': THEME_TEST,
    'src/legacy/darkPalette.ts': LEGACY
  })
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'add', '.')
  git(root, 'commit', '-q', '-m', 'Customer dashboard settings page')
  git(root, 'checkout', '-q', '-b', 'feature/dark-mode-toggle')
  put(root, { 'src/context/theme.tsx': THEME_AFTER, 'src/components/Settings.tsx': SETTINGS_AFTER, 'src/components/ThemeToggle.tsx': TOGGLE })
  git(root, 'add', 'src/components/ThemeToggle.tsx')
  git(root, 'rm', '-q', 'src/legacy/darkPalette.ts')
}

/** A small committed repo on the given branch so the sidebar can read a branch name and tag the session from it. */
export function makeRepo(root: string, name: string, branch: string, files: Record<string, string>): void {
  mkdirSync(root, { recursive: true })
  put(root, { 'package.json': PACKAGE(name), 'README.md': `# ${name}\n`, ...files })
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'add', '.')
  git(root, 'commit', '-q', '-m', 'Initial commit')
  git(root, 'checkout', '-q', '-b', branch)
}

const MINUTE = 60_000

function subagent(dir: string, id: string, description: string, ageMinutes: number, durationMinutes: number, cwd: string, final: string | null, agentType = 'general-purpose', edited: string[] = []): void {
  mkdirSync(dir, { recursive: true })
  const iso = (minutes: number): string => new Date(Date.now() - minutes * MINUTE).toISOString()
  const usage = { input_tokens: 1800, output_tokens: 2400, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
  writeFileSync(join(dir, `agent-${id}.meta.json`), JSON.stringify({ agentType, spawnDepth: 1, requestShape: 'background', model: 'sonnet', description, ...(final ? { finished: true } : {}) }))
  const first = { type: 'user', timestamp: iso(ageMinutes + durationMinutes), cwd, isSidechain: true, message: { role: 'user', content: description } }
  const content = final ? [{ type: 'text', text: final }] : [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test -- ThemeToggle' } }]
  const last = { type: 'assistant', timestamp: iso(ageMinutes), message: { id: `m-${id}`, model: 'claude-sonnet-5-5', stop_reason: final ? 'end_turn' : 'tool_use', usage, content } }
  const edits = edited.map((file, index) => ({ type: 'assistant', timestamp: iso(ageMinutes + durationMinutes / 2), message: { id: `e-${id}-${index}`, model: 'claude-sonnet-5-5', stop_reason: 'tool_use', usage, content: [{ type: 'tool_use', id: `t-${id}-${index}`, name: 'Edit', input: { file_path: join(cwd, file), old_string: 'const a = 1', new_string: 'const a = 1\nconst b = 2\nconst c = 3' } }] } }))
  const path = join(dir, `agent-${id}.jsonl`)
  writeFileSync(path, [first, ...edits, last].map((record) => JSON.stringify(record)).join('\n'))
  const when = new Date(Date.now() - ageMinutes * MINUTE)
  utimesSync(path, when, when)
}

/** Background sub-agents for the two Claude sessions, so the Agents tab lists them grouped by session. */
export function writeSubagents(sandbox: Sandbox, folderOf: (name: string) => string): void {
  const slug = (folder: string): string => folder.replace(/[^A-Za-z0-9]/g, '-')
  const web = join(sandbox.claudeHome, 'projects', slug(folderOf('acme-web')), CLAUDE_IDS['acme-web'], 'subagents')
  subagent(web, 'w1', 'Read the settings components', 36, 4, folderOf('acme-web'), 'Settings.tsx renders the page; the theme lives in context/theme.tsx.', 'Explore')
  subagent(web, 'w2', 'Persist the choice in localStorage', 8, 22, folderOf('acme-web'), 'Added readStoredTheme and storeTheme; the choice survives a reload.', 'general-purpose', ['src/lib/storage.ts', 'src/context/theme.tsx'])
  subagent(web, 'w3', 'Unit tests for ThemeToggle', 0.3, 14, folderOf('acme-web'), null)
  const apiProject = join(sandbox.claudeHome, 'projects', slug(folderOf('billing-api')))
  mkdirSync(apiProject, { recursive: true })
  const apiRecords = [{ type: 'user', timestamp: new Date(Date.now() - 200 * MINUTE).toISOString(), cwd: folderOf('billing-api'), message: { content: 'Refactor the invoice export into smaller functions.' } }, { type: 'ai-title', aiTitle: 'Refactor invoice export' }]
  writeFileSync(join(apiProject, `${CLAUDE_IDS['billing-api']}.jsonl`), apiRecords.map((record) => JSON.stringify(record)).join('\n') + '\n')
  const api = join(apiProject, CLAUDE_IDS['billing-api'], 'subagents')
  subagent(api, 'b1', 'Find every caller of exportInvoices', 150, 6, folderOf('billing-api'), 'Three callers: the CLI, the nightly job and the admin route.', 'Explore')
  subagent(api, 'b2', 'Check rounding in the invoice totals', 140, 18, folderOf('billing-api'), 'Totals now round half up to two decimals; 41 tests pass.')
}
