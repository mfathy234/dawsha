import { luminance } from './contrast'

export interface AppColors {
  background: string
  sidebar: string
  surface: string
  raised: string
  border: string
  text: string
  muted: string
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
  kind: 'dark' | 'light'
  // 'cards' draws each pane as a rounded card with its terminal inset in a darker well.
  style?: 'cards'
  app: AppColors
  term: TermColors
}

export const DEFAULT_THEME_ID = 'grid-dark'

export const THEMES: Theme[] = [
  {
    id: 'grid-dark',
    name: 'Dawsha',
    kind: 'dark',
    app: {
      background: '#0c0e12',
      sidebar: '#0e1116',
      surface: '#11141a',
      raised: '#161b23',
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
      background: '#11141a',
      foreground: '#d6dae3',
      cursor: '#34d399',
      cursorAccent: '#11141a',
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
    style: 'cards',
    app: {
      background: '#0a0c10',
      sidebar: '#0d1015',
      surface: '#151922',
      raised: '#1b202b',
      border: '#232a36',
      text: '#d9dee8',
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
      background: '#0b0d12',
      foreground: '#d9dee8',
      cursor: '#34d399',
      cursorAccent: '#0b0d12',
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
    style: 'cards',
    app: {
      background: '#0f0f0f',
      sidebar: '#131313',
      surface: '#1b1b1b',
      raised: '#222222',
      border: '#2d2d2d',
      text: '#e6e6e6',
      muted: '#9b9b9b',
      accent: '#3ddc97',
      onAccent: '#062a1b',
      busy: '#f2b44c',
      idle: '#9b9b9b',
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
    style: 'cards',
    app: {
      background: '#eef1f0',
      sidebar: '#e8ecea',
      surface: '#fafbfb',
      raised: '#ffffff',
      border: '#d8dedb',
      text: '#16201b',
      muted: '#56625c',
      accent: '#087049',
      onAccent: '#ffffff',
      busy: '#975800',
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
      muted: '#9ca6ba',
      accent: '#88c0d0',
      onAccent: '#1d2430',
      busy: '#ebcb8b',
      idle: '#9ca6ba',
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
      exited: '#cf222e',
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
      white: '#6e7781',
      brightBlack: '#57606a',
      brightRed: '#a40e26',
      brightGreen: '#1a7f37',
      brightYellow: '#633c01',
      brightBlue: '#218bff',
      brightMagenta: '#a475f9',
      brightCyan: '#3192aa',
      brightWhite: '#8c959f'
    }
  }
]

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

// Daylight is a light app with a dark terminal, so terminal behaviour follows the terminal's own background.
export const hasLightTerminal = (theme: Theme): boolean => luminance(theme.term.background) > 0.4

export const findTheme = (id: string): Theme => THEMES.find((t) => t.id === resolveThemeId(id)) ?? THEMES[0]
