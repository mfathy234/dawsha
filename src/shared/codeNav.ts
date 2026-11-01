// The contract between the Files editor (renderer) and the code navigation engine (main).

export type CodeNavKind = 'definition' | 'implementation' | 'references'

export interface CodeNavRequest {
  kind: CodeNavKind
  /** Project-relative path with forward slashes. */
  path: string
  /** The name under the cursor. */
  symbol: string
  /** 1-based position of the cursor. */
  line: number
  column: number
  /** The editor's current text when it has unsaved edits, so positions match what the user sees. */
  unsavedText?: string
}

export interface CodeNavHit {
  /** Project-relative path with forward slashes. */
  path: string
  /** 1-based. */
  line: number
  column: number
  /** The trimmed text of that line, for result lists. */
  preview: string
}

export type CodeNavEngine = 'typescript' | 'csharp' | 'name'

export type CodeNavResult =
  | {
      ok: true
      hits: CodeNavHit[]
      /** Which engine answered. 'name' means a text search, which the UI labels "Best match by name". */
      engine: CodeNavEngine
      /** The name is defined somewhere this project cannot open, such as a package. */
      outside: boolean
    }
  | { ok: false; error: string }

export type LanguageServerState = 'starting' | 'ready' | 'stopped' | 'missing' | 'none'

export interface CodeNavStatus {
  /** The engine that serves this file when it is ready. */
  engine: CodeNavEngine
  state: LanguageServerState
  /** True when `csharp-ls` can be offered for install: a C# file, no server found and a dotnet SDK present. */
  canInstall: boolean
}

/** The `.editorconfig` properties that apply to one file. Anything the files do not set is absent. */
export interface EditorConfigRules {
  indentStyle?: 'tab' | 'space'
  indentSize?: number
  tabWidth?: number
  endOfLine?: 'lf' | 'crlf' | 'cr'
  insertFinalNewline?: boolean
  trimTrailingWhitespace?: boolean
}
