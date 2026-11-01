import type { FileDoc } from './fileDoc'

/** What the second-wave tools need from the Files view. */
export interface ToolsHost {
  folder(): string | null
  /** The project's place in its repository. File tabs use repo paths, the engines use project paths. */
  prefix(): string
  active(): FileDoc | null
  say(text: string): void
  warn(text: string): void
  /** Repo paths of open files with unsaved edits. */
  dirtyPaths(): string[]
  /** Files were written outside the editor (a rename, a replace, a revert): reload them and the tree. Repo paths. */
  changedOnDisk(paths: readonly string[]): void
  sessions(): Array<{ paneId: string; title: string }>
  /** Opens a repo path and puts the caret on a line. */
  openAt(path: string, line: number): Promise<void>
  /** The text of a repo path: the open buffer when there is one. */
  text(path: string): Promise<string | null>
  overlay(): HTMLElement
  /** The Changes view needs its gutters drawn again. */
  refreshAnnotations(): void
  /** Opens the file the agent just edited and shows its changes. */
  followTo(path: string): void
}
