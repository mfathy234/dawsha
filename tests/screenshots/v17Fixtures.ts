import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
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
