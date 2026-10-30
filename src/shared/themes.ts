import { luminance } from './contrast'
import { ladderFor, type ThemeKind } from './themeLadder'

export interface AppColors {
  // The surface ladder, darkest to lightest in dark themes: canvas, chrome, pane, raised, overlay, plus the recessed well.
  background: string
  sidebar: string
  surface: string
  raised: string
  overlay: string
  well: string
  border: string
  text: string
  muted: string
  // Optional roles: tertiary text, and the colour of a finished state (falls back to the accent).
  faint?: string
  done?: string
  accent: string
  onAccent: string
  busy: string
  idle: string
  exited: string
  danger: string
  onDanger: string
}

export interface TermColors {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

export interface Theme {
  id: string
  name: string
  kind: ThemeKind
  app: AppColors
  term: TermColors
}

export const DEFAULT_THEME_ID = 'grid-dark'

// A theme that names its own overlay and well keeps its surfaces exactly; any other gets the ladder derived from its pane colour.
type RawTheme = Omit<Theme, 'app'> & { app: Omit<AppColors, 'overlay' | 'well'> & Partial<Pick<AppColors, 'overlay' | 'well'>> }

const RAW_THEMES: RawTheme[] = [
  {
    id: 'grid-dark',
    name: 'Dawsha',
    kind: 'dark',
    app: {
      background: '#07090c',
      sidebar: '#0f1217',
      surface: '#161a22',
      raised: '#1d222c',
      overlay: '#252b37',
      well: '#0d1015',
      border: '#232833',
      text: '#d6dae3',
      muted: '#8a93a6',
      accent: '#34d399',
      onAccent: '#06281c',
      busy: '#f5b54a',
      idle: '#8a93a6',
      exited: '#f87171',
      danger: '#f87171',
      onDanger: '#2a0b0b'
    },
    term: {
      background: '#0d1015',
      foreground: '#d6dae3',
      cursor: '#34d399',
      cursorAccent: '#0d1015',
      selectionBackground: '#2b3a4f',
      black: '#232833',
      red: '#f87171',
      green: '#34d399',
      yellow: '#f5b54a',
      blue: '#60a5fa',
      magenta: '#c084fc',
      cyan: '#22d3ee',
      white: '#d6dae3',
      brightBlack: '#5b6478',
      brightRed: '#fca5a5',
      brightGreen: '#6ee7b7',
      brightYellow: '#fcd34d',
      brightBlue: '#93c5fd',
      brightMagenta: '#d8b4fe',
      brightCyan: '#67e8f9',
      brightWhite: '#f3f4f6'
    }
  },
  {
    id: 'dawsha-cards',
    name: 'Dawsha Cards',
    kind: 'dark',
    app: {
      background: '#0c0e13',
      sidebar: '#11141a',
      surface: '#181c24',
      raised: '#222731',
      overlay: '#2b313d',
      well: '#14171e',
      border: '#232a36',
      text: '#d4d9e2',
      muted: '#9ba4b6',
      faint: '#6e778a',
      done: '#86c5a8',
      accent: '#34d399',
      onAccent: '#06281c',
      busy: '#f5b54a',
      idle: '#8a93a6',
      exited: '#f87171',
      danger: '#f87171',
      onDanger: '#2a0b0b'
    },
    term: {
      background: '#14171e',
      foreground: '#d4d9e2',
      cursor: '#34d399',
      cursorAccent: '#14171e',
      selectionBackground: '#2b3a4f',
      black: '#232833',
      red: '#f87171',
      green: '#34d399',
      yellow: '#f5b54a',
      blue: '#60a5fa',
      magenta: '#c084fc',
      cyan: '#22d3ee',
      white: '#d6dae3',
      brightBlack: '#5b6475',
      brightRed: '#fca5a5',
      brightGreen: '#6ee7b7',
      brightYellow: '#fcd34d',
      brightBlue: '#93c5fd',
      brightMagenta: '#d8b4fe',
      brightCyan: '#67e8f9',
      brightWhite: '#f3f4f6'
    }
  },
  {
    id: 'graphite-cards',
    name: 'Graphite Cards',
    kind: 'dark',
    app: {
      background: '#0f0f0f',
      sidebar: '#131313',
      surface: '#1b1b1b',
      raised: '#222222',
      border: '#2d2d2d',
      text: '#e6e6e6',
      muted: '#a3a3a3',
      accent: '#3ddc97',
      onAccent: '#062a1b',
      busy: '#f2b44c',
      idle: '#a3a3a3',
      exited: '#f47272',
      danger: '#f47272',
      onDanger: '#2a0b0b'
    },
    term: {
      background: '#0d0d0d',
      foreground: '#e6e6e6',
      cursor: '#3ddc97',
      cursorAccent: '#0d0d0d',
      selectionBackground: '#3a3a3a',
      black: '#232833',
      red: '#f87171',
      green: '#34d399',
      yellow: '#f5b54a',
      blue: '#60a5fa',
      magenta: '#c084fc',
      cyan: '#22d3ee',
      white: '#d6dae3',
      brightBlack: '#5b6475',
      brightRed: '#fca5a5',
      brightGreen: '#6ee7b7',
      brightYellow: '#fcd34d',
      brightBlue: '#93c5fd',
      brightMagenta: '#d8b4fe',
      brightCyan: '#67e8f9',
      brightWhite: '#f3f4f6'
    }
  },
  {
    id: 'dawsha-daylight',
    name: 'Dawsha Daylight',
    kind: 'light',
    app: {
      background: '#e2e6e4',
      sidebar: '#edf0ee',
      surface: '#ffffff',
      raised: '#ffffff',
      overlay: '#ffffff',
      well: '#f6f8f7',
      border: '#d3d9d6',
      text: '#16201b',
      muted: '#56625c',
      accent: '#087049',
      onAccent: '#ffffff',
      busy: '#8a5a00',
      idle: '#56625c',
      exited: '#b42323',
      danger: '#b42323',
      onDanger: '#ffffff'
    },
    term: {
      background: '#f6f8f7',
      foreground: '#1b2027',
      cursor: '#0a8f62',
      cursorAccent: '#f6f8f7',
      selectionBackground: '#bfe3d3',
      black: '#1b2027',
      red: '#c4262e',
      green: '#116329',
      yellow: '#6b4300',
      blue: '#0a58c2',
      magenta: '#7a3fc4',
      cyan: '#17707a',
      white: '#46505c',
      brightBlack: '#1a212b',
      brightRed: '#a40e26',
      brightGreen: '#0f6b3a',
      brightYellow: '#7a4d00',
      brightBlue: '#1a6fd6',
      brightMagenta: '#8f4fe0',
      brightCyan: '#1b7c83',
      brightWhite: '#566377'
    }
  },
  {
    id: 'dawsha-daylight-dark',
    name: 'Dawsha Daylight, dark terminal',
    kind: 'light',
    app: {
      background: '#e2e6e4',
      sidebar: '#edf0ee',
      surface: '#ffffff',
      raised: '#ffffff',
      overlay: '#ffffff',
      well: '#f6f8f7',
      border: '#d3d9d6',
      text: '#16201b',
      muted: '#56625c',
      accent: '#087049',
      onAccent: '#ffffff',
      busy: '#8a5a00',
      idle: '#56625c',
      exited: '#b42323',
      danger: '#b42323',
      onDanger: '#ffffff'
    },
    term: {
      background: '#16191f',
      foreground: '#d9dee8',
      cursor: '#34d399',
      cursorAccent: '#16191f',
      selectionBackground: '#2b3a4f',
      black: '#232833',
      red: '#f87171',
      green: '#34d399',
      yellow: '#f5b54a',
      blue: '#60a5fa',
      magenta: '#c084fc',
      cyan: '#22d3ee',
      white: '#d6dae3',
      brightBlack: '#5b6475',
      brightRed: '#fca5a5',
      brightGreen: '#6ee7b7',
      brightYellow: '#fcd34d',
      brightBlue: '#93c5fd',
      brightMagenta: '#d8b4fe',
      brightCyan: '#67e8f9',
      brightWhite: '#f3f4f6'
    }
  },
  {
    id: 'nord',
    name: 'Nord',
    kind: 'dark',
    app: {
      background: '#272c36',
      sidebar: '#2b303b',
      surface: '#2e3440',
      raised: '#3b4252',
      border: '#434c5e',
      text: '#d8dee9',
      muted: '#b8c0d0',
      accent: '#88c0d0',
      onAccent: '#1d2430',
      busy: '#ebcb8b',
      idle: '#b8c0d0',
      exited: '#d98a93',
      danger: '#e0808a',
      onDanger: '#1d2430'
    },
    term: {
      background: '#2e3440',
      foreground: '#d8dee9',
      cursor: '#d8dee9',
      cursorAccent: '#2e3440',
      selectionBackground: '#434c5e',
      black: '#3b4252',
      red: '#bf616a',
      green: '#a3be8c',
      yellow: '#ebcb8b',
      blue: '#81a1c1',
      magenta: '#b48ead',
      cyan: '#88c0d0',
      white: '#e5e9f0',
      brightBlack: '#4c566a',
      brightRed: '#bf616a',
      brightGreen: '#a3be8c',
      brightYellow: '#ebcb8b',
      brightBlue: '#81a1c1',
      brightMagenta: '#b48ead',
      brightCyan: '#8fbcbb',
      brightWhite: '#eceff4'
    }
  },
  {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    kind: 'dark',
    app: {
      background: '#11111b',
      sidebar: '#181825',
      surface: '#1e1e2e',
      raised: '#313244',
      border: '#313244',
      text: '#cdd6f4',
      muted: '#a6adc8',
      accent: '#cba6f7',
      onAccent: '#1e1e2e',
      busy: '#f9e2af',
      idle: '#a6adc8',
      exited: '#f38ba8',
      danger: '#f38ba8',
      onDanger: '#1e1e2e'
    },
    term: {
      background: '#1e1e2e',
      foreground: '#cdd6f4',
      cursor: '#f5e0dc',
      cursorAccent: '#1e1e2e',
      selectionBackground: '#45475a',
      black: '#45475a',
      red: '#f38ba8',
      green: '#a6e3a1',
      yellow: '#f9e2af',
      blue: '#89b4fa',
      magenta: '#f5c2e7',
      cyan: '#94e2d5',
      white: '#bac2de',
      brightBlack: '#585b70',
      brightRed: '#f38ba8',
      brightGreen: '#a6e3a1',
      brightYellow: '#f9e2af',
      brightBlue: '#89b4fa',
      brightMagenta: '#f5c2e7',
      brightCyan: '#94e2d5',
      brightWhite: '#a6adc8'
    }
  },
  {
    id: 'github-light',
    name: 'GitHub Light',
    kind: 'light',
    app: {
      background: '#f6f8fa',
      sidebar: '#f6f8fa',
      surface: '#ffffff',
      raised: '#eef1f4',
      border: '#d0d7de',
      text: '#24292f',
      muted: '#57606a',
      accent: '#0a60c8',
      onAccent: '#ffffff',
      busy: '#8a5a00',
      idle: '#57606a',
      exited: '#c41f2b',
      danger: '#cf222e',
      onDanger: '#ffffff'
    },
    term: {
      background: '#ffffff',
      foreground: '#24292f',
      cursor: '#0969da',
      cursorAccent: '#ffffff',
      selectionBackground: '#b6d6f7',
      black: '#24292f',
      red: '#cf222e',
      green: '#116329',
      yellow: '#4d2d00',
      blue: '#0969da',
      magenta: '#8250df',
      cyan: '#1b7c83',
      white: '#57606a',
      brightBlack: '#1f2328',
      brightRed: '#a40e26',
      brightGreen: '#1a7f37',
      brightYellow: '#633c01',
      brightBlue: '#0969da',
      brightMagenta: '#7043a0',
      brightCyan: '#14616d',
      brightWhite: '#57606a'
    }
  }
]

const matchesKind = (raw: RawTheme): boolean => (luminance(raw.term.background) > 0.4) === (raw.kind === 'light')

function withLadder(raw: RawTheme): Theme {
  const { app, term } = raw
  const ladder = ladderFor(raw.kind, app.surface, app.sidebar)
  const fixed = app.well !== undefined
  const surfaces = fixed
    ? { background: app.background, sidebar: app.sidebar, surface: app.surface, raised: app.raised, overlay: app.overlay ?? ladder.overlay, well: app.well ?? ladder.well }
    : { background: ladder.canvas, sidebar: ladder.chrome, surface: ladder.pane, raised: ladder.raised, overlay: ladder.overlay, well: ladder.well }
  // A terminal of the app's own kind is the well itself, so text and ground stay one surface; a deliberate dark terminal in a light app keeps its colour.
  const terminal = matchesKind(raw) ? { ...term, background: surfaces.well, cursorAccent: surfaces.well } : term
  return { ...raw, app: { ...app, ...surfaces }, term: terminal }
}

export const THEMES: Theme[] = RAW_THEMES.map(withLadder)

// Themes removed in 0.5 and the closest current theme for anyone who had picked one.
const RETIRED_THEMES: Record<string, string> = {
  'tokyo-night': 'dawsha-cards',
  'solarized-dark': 'graphite-cards',
  'gruvbox-dark': 'graphite-cards',
  'solarized-light': 'dawsha-daylight'
}

export function resolveThemeId(id: string): string {
  const current = RETIRED_THEMES[id] ?? id
  return THEMES.some((t) => t.id === current) ? current : DEFAULT_THEME_ID
}

// The terminal's own background decides: Daylight, dark terminal is a light app around a dark terminal.
export const hasLightTerminal = (theme: Theme): boolean => luminance(theme.term.background) > 0.4

export const findTheme = (id: string): Theme => THEMES.find((t) => t.id === resolveThemeId(id)) ?? THEMES[0]
