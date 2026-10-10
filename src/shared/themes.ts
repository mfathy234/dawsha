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
    id: 'tokyo-night',
    name: 'Tokyo Night',
    kind: 'dark',
    app: {
      background: '#16161e',
      sidebar: '#181821',
      surface: '#1a1b26',
      raised: '#292e42',
      border: '#292e42',
      text: '#c0caf5',
      muted: '#8089b3',
      accent: '#7aa2f7',
      onAccent: '#10131f',
      busy: '#e0af68',
      idle: '#8089b3',
      exited: '#f7768e',
      danger: '#f7768e',
      onDanger: '#1a0b10'
    },
    term: {
      background: '#1a1b26',
      foreground: '#c0caf5',
      cursor: '#c0caf5',
      cursorAccent: '#1a1b26',
      selectionBackground: '#283457',
      black: '#15161e',
      red: '#f7768e',
      green: '#9ece6a',
      yellow: '#e0af68',
      blue: '#7aa2f7',
      magenta: '#bb9af7',
      cyan: '#7dcfff',
      white: '#a9b1d6',
      brightBlack: '#414868',
      brightRed: '#f7768e',
      brightGreen: '#9ece6a',
      brightYellow: '#e0af68',
      brightBlue: '#7aa2f7',
      brightMagenta: '#bb9af7',
      brightCyan: '#7dcfff',
      brightWhite: '#c0caf5'
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
    id: 'solarized-dark',
    name: 'Solarized Dark',
    kind: 'dark',
    app: {
      background: '#00212b',
      sidebar: '#00242f',
      surface: '#002b36',
      raised: '#073642',
      border: '#0f4350',
      text: '#93a1a1',
      muted: '#8499a0',
      accent: '#2fb5ab',
      onAccent: '#00212b',
      busy: '#d5a100',
      idle: '#8499a0',
      exited: '#ee6e6a',
      danger: '#c42a27',
      onDanger: '#fdf6e3'
    },
    term: {
      background: '#002b36',
      foreground: '#93a1a1',
      cursor: '#93a1a1',
      cursorAccent: '#002b36',
      selectionBackground: '#073642',
      black: '#073642',
      red: '#dc322f',
      green: '#859900',
      yellow: '#b58900',
      blue: '#268bd2',
      magenta: '#d33682',
      cyan: '#2aa198',
      white: '#eee8d5',
      brightBlack: '#586e75',
      brightRed: '#cb4b16',
      brightGreen: '#586e75',
      brightYellow: '#657b83',
      brightBlue: '#839496',
      brightMagenta: '#6c71c4',
      brightCyan: '#93a1a1',
      brightWhite: '#fdf6e3'
    }
  },
  {
    id: 'gruvbox-dark',
    name: 'Gruvbox Dark',
    kind: 'dark',
    app: {
      background: '#1d2021',
      sidebar: '#212425',
      surface: '#282828',
      raised: '#3c3836',
      border: '#504945',
      text: '#ebdbb2',
      muted: '#a89984',
      accent: '#fabd2f',
      onAccent: '#1d2021',
      busy: '#fe8019',
      idle: '#a89984',
      exited: '#ff6b57',
      danger: '#ff6b57',
      onDanger: '#1d2021'
    },
    term: {
      background: '#282828',
      foreground: '#ebdbb2',
      cursor: '#ebdbb2',
      cursorAccent: '#282828',
      selectionBackground: '#504945',
      black: '#282828',
      red: '#cc241d',
      green: '#98971a',
      yellow: '#d79921',
      blue: '#458588',
      magenta: '#b16286',
      cyan: '#689d6a',
      white: '#a89984',
      brightBlack: '#928374',
      brightRed: '#fb4934',
      brightGreen: '#b8bb26',
      brightYellow: '#fabd2f',
      brightBlue: '#83a598',
      brightMagenta: '#d3869b',
      brightCyan: '#8ec07c',
      brightWhite: '#ebdbb2'
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
  },
  {
    id: 'solarized-light',
    name: 'Solarized Light',
    kind: 'light',
    app: {
      background: '#eee8d5',
      sidebar: '#f3edda',
      surface: '#fdf6e3',
      raised: '#eee8d5',
      border: '#d9d2bd',
      text: '#475b62',
      muted: '#566b72',
      accent: '#14609a',
      onAccent: '#fdf6e3',
      busy: '#7a5800',
      idle: '#566b72',
      exited: '#c4291f',
      danger: '#c4291f',
      onDanger: '#fdf6e3'
    },
    term: {
      background: '#fdf6e3',
      foreground: '#475b62',
      cursor: '#475b62',
      cursorAccent: '#fdf6e3',
      selectionBackground: '#eee8d5',
      black: '#073642',
      red: '#dc322f',
      green: '#859900',
      yellow: '#b58900',
      blue: '#268bd2',
      magenta: '#d33682',
      cyan: '#2aa198',
      white: '#eee8d5',
      brightBlack: '#002b36',
      brightRed: '#cb4b16',
      brightGreen: '#586e75',
      brightYellow: '#657b83',
      brightBlue: '#839496',
      brightMagenta: '#6c71c4',
      brightCyan: '#93a1a1',
      brightWhite: '#fdf6e3'
    }
  }
]

export const findTheme = (id: string): Theme => THEMES.find((t) => t.id === id) ?? THEMES[0]
