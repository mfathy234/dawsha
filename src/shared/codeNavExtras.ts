import type { CodeNavEngine, CodeNavHit, CodeNavRequest } from './codeNav'
import type { SearchRequest } from './fileSearch'

/** Positions and edit ranges are 1-based UTF-16, with an exclusive end. */
export type SymbolRequest = Omit<CodeNavRequest, 'kind'>
export type ExtrasError = { ok: false; error: string; needsLanguageServer?: boolean }
export type HoverResult = { ok: true; engine: CodeNavEngine; display: string; documentation: string; declaration?: CodeNavHit } | ExtrasError
export interface TextEdit { line: number; column: number; endLine: number; endColumn: number; newText: string }
export interface EditPreviewFile { path: string; expectedMtime: number; edits: TextEdit[]; matches: number }
/** Previews are held by main for five minutes. Apply consumes the token, never client-supplied edits. */
export interface ApplyEditsRequest { action: 'apply'; previewId: string; /** All dirty editor buffers; these files are refused. */ dirtyPaths: string[] }
export type RenameSymbolRequest = (SymbolRequest & { action: 'preview'; newName: string }) | ApplyEditsRequest
export type ReplaceInFilesRequest = (SearchRequest & { action: 'preview'; replacement: string }) | ApplyEditsRequest
export interface EditFileOutcome { path: string; ok: boolean; mtimeMs?: number; conflict?: boolean; error?: string }
export type EditResult =
  | { ok: true; action: 'preview'; previewId: string; files: EditPreviewFile[]; engine: CodeNavEngine | 'search'; truncated: boolean }
  | { ok: true; action: 'apply'; files: EditFileOutcome[] }
  | ExtrasError

export interface CallHierarchyRequest extends SymbolRequest { direction: 'incoming' | 'outgoing' }
export interface CallHierarchyItem { symbol: CodeNavHit; /** Call sites (in caller files). */ calls: CodeNavHit[]; name: string }
export type CallHierarchyResult = { ok: true; engine: CodeNavEngine; items: CallHierarchyItem[]; outside: boolean } | ExtrasError
export interface StaleCaller { symbol: CodeNavHit; references: CodeNavHit[]; implementations: CodeNavHit[]; engine: CodeNavEngine }
export type StaleCallersResult = { ok: true; symbols: StaleCaller[]; stoppedEarly: boolean; reason?: 'timeout' | 'symbolCap'; scannedSymbols: number } | ExtrasError

/** Coordinates of one hunk against the merge base used by fileAgainstBase; header/body from a unified diff.
 * Main regenerates it, compares it byte for byte, checks mtime, and git checks applicability.
 * Stage can refuse when the index has diverged from that base. */
export interface HunkRequest {
  path: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  /** Use 0 only for a deleted file; main verifies that the path is still absent. */
  expectedMtime: number
  expectedHunk: string
}
export type HunkResult = { ok: true } | { ok: false; error: string; conflict?: boolean }

export interface AgentFileTouch { sessionId: string; agent: 'claude' | 'codex' | 'gemini'; at: number; precision: 'file' | 'time' }
export interface LineSession { line: number; /** Absent when no session evidence exists. */ session?: AgentFileTouch }
export type LineSessionsResult = { ok: true; precision: 'file' | 'time' | 'unknown'; lines: LineSession[]; note: string } | ExtrasError
/** A recorded edit event from a session log, not an inference from filesystem activity. */
export interface AgentEditEvent { folder: string; path: string; sessionId: string; agent: 'claude' | 'codex' | 'gemini'; at: number; precision: 'file' }
