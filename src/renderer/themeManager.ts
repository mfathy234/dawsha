import type { ITheme } from '@xterm/xterm'
import { withAlpha } from '../shared/contrast'
import { findTheme, type Theme } from '../shared/themes'
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

const VARIABLES: Record<string, keyof Theme['app']> = {
  '--bg': 'background',
  '--sidebar': 'sidebar',
  '--surface': 'surface',
  '--raised': 'raised',
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
    minimumContrastRatio: theme.kind === 'light' ? 4.5 : 1
  }
}

function applyCss(bundle: ThemeBundle, settings: ThemeSettings): void {
  const root = document.documentElement
  for (const [variable, key] of Object.entries(VARIABLES)) {
    root.style.setProperty(variable, bundle.theme.app[key])
  }
  const term = bundle.theme.term
  root.style.setProperty('--fam-opus', term.magenta)
  root.style.setProperty('--fam-sonnet', term.cyan)
  root.style.setProperty('--fam-haiku', term.blue)
  root.style.setProperty('--fam-fable', bundle.theme.kind === 'dark' ? term.brightWhite : term.foreground)
  root.dataset.theme = bundle.theme.id
  root.dataset.kind = bundle.theme.kind
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
