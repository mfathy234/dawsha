import type { ITheme } from '@xterm/xterm'
import { contrastRatio, shadowRgb, withAlpha } from '../shared/contrast'
import { findTheme, hasLightTerminal, type Theme } from '../shared/themes'
import { EDITOR_COLORS } from '../shared/syntaxPalette'
import { needsColours } from '../shared/themeLadder'
import type { ThemeSettings } from '../shared/types'

export interface ThemeBundle {
  theme: Theme
  xterm: ITheme
  hostBackground: string
  imageActive: boolean
  minimumContrastRatio: number
}

type Listener = (bundle: ThemeBundle) => void

const listeners = new Set<Listener>()
let current: ThemeBundle = buildBundle({ id: 'grid-dark', image: { enabled: false, path: null, dim: 60, blur: 0 } })
let imageVersion = 0

const VARIABLES: Record<string, Exclude<keyof Theme['app'], 'faint' | 'done'>> = {
  '--bg': 'background',
  '--canvas': 'background',
  '--sidebar': 'sidebar',
  '--chrome': 'sidebar',
  '--surface': 'surface',
  '--pane': 'surface',
  '--raised': 'raised',
  '--surface-pop': 'overlay',
  '--overlay': 'overlay',
  '--well': 'well',
  '--border': 'border',
  '--text': 'text',
  '--muted': 'muted',
  '--accent': 'accent',
  '--on-accent': 'onAccent',
  '--busy': 'busy',
  '--idle': 'idle',
  '--exited': 'exited',
  '--danger': 'danger',
  '--on-danger': 'onDanger'
}

function buildBundle(settings: ThemeSettings): ThemeBundle {
  const theme = findTheme(settings.id)
  const { image } = settings
  const imageActive = image.enabled && image.path !== null
  const background = imageActive ? withAlpha(theme.term.background, image.dim / 100) : theme.term.background
  return {
    theme,
    xterm: { ...theme.term, background },
    hostBackground: imageActive ? 'transparent' : theme.term.background,
    imageActive,
    minimumContrastRatio: hasLightTerminal(theme) ? 4.5 : 1
  }
}

function applyCss(bundle: ThemeBundle, settings: ThemeSettings): void {
  const root = document.documentElement
  for (const [variable, key] of Object.entries(VARIABLES)) {
    root.style.setProperty(variable, bundle.theme.app[key])
  }
  for (const [variable, value] of [['--faint', bundle.theme.app.faint], ['--done', bundle.theme.app.done]] as const) {
    if (value !== undefined) root.style.setProperty(variable, value)
    else root.style.removeProperty(variable)
  }
  const light = bundle.theme.kind === 'light'
  const app = bundle.theme.app
  const needs = needsColours(bundle.theme.kind)
  const text2 = [app.background, app.sidebar, app.surface, app.raised, app.overlay].every((surface) => contrastRatio(app.muted, surface) >= 4.5) ? app.muted : app.text
  const semantic: Record<string, string> = {
    '--text-2': text2,
    '--text-3': text2,
    '--line': `color-mix(in srgb, ${app.border} ${light ? '75%' : '82%'}, transparent)`,
    '--line-strong': `color-mix(in srgb, ${app.border} ${light ? '100%' : '100%'}, transparent)`,
    '--st-working': light ? '#1a5cb0' : '#72b4ff',
    '--st-needs': needs.text,
    '--st-done': app.done ?? app.accent,
    '--st-idle': app.muted,
    '--st-error': app.danger,
    '--on-needs-fill': '#111827',
    '--ag-claude-bg': light ? '#b94b25' : '#d97757',
    '--ag-claude-fg': light ? '#ffffff' : '#1d0f09',
    '--ag-codex-bg': light ? '#2b3340' : '#cfd5e1',
    '--ag-codex-fg': light ? '#f1f3f7' : '#11151c',
    '--ag-gemini-bg': light ? '#6544d4' : '#a78bfa',
    '--ag-gemini-fg': light ? '#ffffff' : '#180f33',
    '--accent-ink': light ? app.accent : `color-mix(in srgb, ${app.accent} 84%, white)`,
    '--focus': light ? app.accent : `color-mix(in srgb, ${app.accent} 72%, white)`,
    '--danger-fill': app.danger,
    '--on-danger-fill': app.onDanger,
    '--scrim': light ? 'rgb(21 27 35 / .38)' : 'rgb(5 7 10 / .62)',
    '--e1': `0 1px 2px rgb(var(--shadow-rgb) / .22), 0 0 0 1px var(--line)`,
    '--e2': `0 8px 24px rgb(var(--shadow-rgb) / .32), 0 0 0 1px var(--line-strong)`,
    '--e3': `0 24px 64px rgb(var(--shadow-rgb) / .46), 0 0 0 1px var(--line-strong)`
  }
  for (const [variable, value] of Object.entries(semantic)) root.style.setProperty(variable, value)
  const term = bundle.theme.term
  root.style.setProperty('--fam-opus', term.magenta)
  root.style.setProperty('--fam-sonnet', term.cyan)
  root.style.setProperty('--fam-haiku', term.blue)
  root.style.setProperty('--fam-fable', bundle.theme.kind === 'dark' ? term.brightWhite : term.foreground)
  root.style.setProperty('--shadow-rgb', shadowRgb(bundle.theme.app.background, bundle.theme.app.text, bundle.theme.kind))
  root.style.setProperty('--needs-ring', needs.fill)
  root.style.setProperty('--needs', needs.text)
  root.style.setProperty('--needs-ink', needs.text)
  root.style.setProperty('--editor-bg', EDITOR_COLORS[bundle.theme.kind].background)
  root.dataset.theme = bundle.theme.id
  root.dataset.kind = bundle.theme.kind
  root.style.setProperty('--term-bg', term.background)
  root.classList.toggle('has-image', bundle.imageActive)
  root.style.setProperty('--image-blur', `${settings.image.blur}px`)
  const url = bundle.imageActive ? `url("dawsha-image://current/?v=${imageVersion}")` : 'none'
  root.style.setProperty('--image-url', url)
}

export function applyTheme(settings: ThemeSettings, imageChanged = false): ThemeBundle {
  if (imageChanged) imageVersion += 1
  current = buildBundle(settings)
  applyCss(current, settings)
  for (const listener of listeners) listener(current)
  return current
}

export const currentBundle = (): ThemeBundle => current

export function onThemeChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
