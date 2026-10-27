// VS Code Dark+ and Light+ token colours for the Files editor. Dark themes use Dark+, light themes Light+.

export type SyntaxKind = 'dark' | 'light'

export type SyntaxRole =
  | 'keyword' | 'control' | 'function' | 'type' | 'string' | 'variable' | 'comment' | 'number' | 'tag' | 'attribute' | 'punctuation'
  | 'constant' | 'regexp' | 'escape' | 'link' | 'invalid'

export const SYNTAX_COLORS: Record<SyntaxKind, Record<SyntaxRole, string>> = {
  dark: {
    keyword: '#569cd6', control: '#c586c0', function: '#dcdcaa', type: '#4ec9b0', string: '#ce9178', variable: '#9cdcfe', comment: '#6a9955',
    number: '#b5cea8', tag: '#569cd6', attribute: '#9cdcfe', punctuation: '#d4d4d4', constant: '#4fc1ff', regexp: '#d16969', escape: '#d7ba7d',
    link: '#3794ff', invalid: '#f44747'
  },
  light: {
    keyword: '#0000ff', control: '#af00db', function: '#795e26', type: '#267f99', string: '#a31515', variable: '#001080', comment: '#008000',
    number: '#098658', tag: '#800000', attribute: '#e50000', punctuation: '#000000', constant: '#0070c1', regexp: '#811f3f', escape: '#ee0000',
    link: '#006ab1', invalid: '#cd3131'
  }
}

export interface EditorColors {
  background: string
  foreground: string
  gutter: string
  gutterActive: string
  caret: string
  selection: string
  activeLine: string
}

export const EDITOR_COLORS: Record<SyntaxKind, EditorColors> = {
  dark: {
    background: '#1e1e1e', foreground: '#d4d4d4', gutter: '#858585', gutterActive: '#c6c6c6', caret: '#aeafad', selection: '#264f78',
    activeLine: 'rgb(255 255 255 / .05)'
  },
  light: {
    background: '#ffffff', foreground: '#000000', gutter: '#237893', gutterActive: '#0b216f', caret: '#000000', selection: '#add6ff',
    activeLine: 'rgb(0 0 0 / .045)'
  }
}

export const syntaxColor = (kind: SyntaxKind, role: SyntaxRole): string => SYNTAX_COLORS[kind][role]
