import type { OrchExportFormat, OrchArchiveFileResult } from './orch/api'
import type { WorkPeriod, WorkReport } from './workDashboard'
import type { BackgroundAgentsReport, BgKind, BgRange } from './backgroundAgents'
import type { ClipboardContent } from './clipboard'
import type { AgentsReport } from './agentTools'
import type { CliCommand, CliReply } from './cli'
import type { FileRef } from './filePaths'
import type { InstructionRead, InstructionWriteRequest, InstructionWriteResult } from './instructions'
import type { WorktreeStatus } from './compare'
import type { BranchListResult, GitQuickRequest, GitQuickResult, SyncCounts } from './gitBranches'
import type {
  CommitRequest,
  DiscardRequest,
  GitCommitResult,
  GitDiffResult,
  FileAgainstBaseResult,
  ProjectFileResult,
  ProjectFileWriteResult,
  ProjectFilesResult,
  RepoStatusResult,
  SessionBaseline,
  SessionBaselineResult,
  SessionStatusResult
} from './gitStatus'
import type { OpsSnapshot } from './opsFeed'
import type { RecordingStats, RecordingSummary } from './recordings'
import type { ProcessActivity } from './processActivity'
import type { BulkSkillExport, SkillEntry } from './skills'
import type { PaneonImportPreview } from './paneonImport'
import type { SettingsExportResult, SettingsImportRead } from './settingsTransfer'
import type { UpdateState } from './updates'
import type { UsageSnapshot } from './sessionCost'
import type { OrchDecisionView, OrchHandoffInput, OrchPaneRequest, OrchResult, OrchRunView, OrchSnapshot, OrchStartInput, OrchStatus, OrchSpecView, OrchSpecContent } from './orch/api'
import type { TimelineExportRequest, TimelineExportResult, TimelineRequest, TimelineResult } from './timeline'
import type { TimelineSearchRequest, TimelineSearchResult } from './timelineSearch'
import type { TranscriptRequest, TranscriptResult } from './transcript'
import type { HandoffTranscriptRequest, HandoffTranscriptResult } from './handoff'
import type { UsageRange, UsageReport } from './usage'
import type {
  AgentKind,
  AppInfo,
  BridgePreview,
  BridgeResult,
  BridgeStatus,
  CodexSession,
  GeminiSession,
  FolderCheck,
  GitChanges,
  GitResult,
  NotifyRequest,
  QuickOpenKind,
  RepoProbe,
  ResumeEntry,
  ResumeQuery,
  ResumeSession,
  StatusInfo,
  SessionFile,
  Settings,
  SettingsLoadResult,
  RemoteAccessSettings,
  RemoteAccessState,
  RemoteSessionStarted,
  SpawnRequest,
  SpawnResult,
  WorktreeRemoval,
  WorktreesResult
} from './types'

export interface GridApi {
  runs: import('./runCommands').RunApi
  getSettings(): Promise<SettingsLoadResult>
  updateSettings(patch: Partial<Settings>): Promise<Settings>
  exportSettings(): Promise<SettingsExportResult>
  readSettingsImport(): Promise<SettingsImportRead>
  remoteAccess?: {
    getState(): Promise<RemoteAccessState>
    enable(): Promise<RemoteAccessState>
    disable(): Promise<RemoteAccessState>
    verify(): Promise<RemoteAccessState>
    refreshPairing(): Promise<RemoteAccessState>
    setPermissions(patch: Partial<RemoteAccessSettings>): Promise<RemoteAccessState>
    setAllowedEmail(email: string): Promise<RemoteAccessState>
    revokeDevice(id: string): Promise<RemoteAccessState>
    recordApproval(terminalId: string, allowed: boolean, tail?: string): Promise<void>
  }
  paneonImportPreview(): Promise<PaneonImportPreview>
  queuePaneonImport(): Promise<void>
  pickFolder(): Promise<string | null>
  pickImage(): Promise<string | null>
  pathForFile(file: File): string
  checkFolder(path: string): Promise<FolderCheck>
  gitBranch(folder: string): Promise<string | null>
  listSessions(): Promise<SessionFile[]>
  onSessions(listener: (sessions: SessionFile[]) => void): () => void
  listCodexSessions(): Promise<CodexSession[]>
  onCodexSessions(listener: (sessions: CodexSession[]) => void): () => void
  listGeminiSessions(): Promise<GeminiSession[]>
  onGeminiSessions(listener: (sessions: GeminiSession[]) => void): () => void
  listStatus(): Promise<StatusInfo[]>
  onStatus(listener: (infos: StatusInfo[]) => void): () => void
  listOps(): Promise<OpsSnapshot[]>
  onOps(listener: (snapshots: OpsSnapshot[]) => void): () => void
  trackOps(sessionIds: string[]): void
  gitChanges(folder: string): Promise<GitChanges | null>
  gitFiles(folder: string): Promise<string[] | null>
  gitStatus(folder: string): Promise<RepoStatusResult>
  gitCommit(request: CommitRequest): Promise<GitCommitResult>
  gitPush(folder: string): Promise<GitResult>
  gitDiscard(request: DiscardRequest): Promise<GitResult>
  gitDiff(folder: string, path: string): Promise<GitDiffResult>
  gitDiffSince(folder: string, path: string, baseline: SessionBaseline): Promise<GitDiffResult>
  gitBaseline(folder: string): Promise<SessionBaselineResult>
  gitSessionStatus(folder: string, baseline: SessionBaseline): Promise<SessionStatusResult>
  projectFiles(folder: string): Promise<ProjectFilesResult>
  projectFile(folder: string, path: string): Promise<ProjectFileResult>
  writeProjectFile(folder: string, path: string, text: string, expectedMtime: number): Promise<ProjectFileWriteResult>
  fileAgainstBase(folder: string, path: string): Promise<FileAgainstBaseResult>
  watchFiles(folder: string): Promise<void>
  unwatchFiles(folder: string): Promise<void>
  // folder is normalizeFolder(project folder); compare with normalizeFolder() on the renderer side. An empty paths list means refresh everything.
  /** The watcher of a folder stopped (key is normalizeFolder of it); the view says live updates are off. */
  onFilesWatchFailed(listener: (folder: string) => void): () => void
  onFilesChanged(listener: (folder: string, paths: string[]) => void): () => void
  gitSync(folder: string): Promise<SyncCounts | null>
  gitBranches(folder: string): Promise<BranchListResult>
  gitQuick(request: GitQuickRequest): Promise<GitQuickResult>
  listResumable(agent: AgentKind, folder: string): Promise<ResumeEntry[]>
  listAllResumable(query: ResumeQuery): Promise<ResumeSession[]>
  quickOpen(kind: QuickOpenKind, folder: string): Promise<void>
  findSolution(folder: string): Promise<string | null>
  existingFiles(folder: string, candidates: string[]): Promise<(string | null)[]>
  openFile(folder: string, ref: FileRef): Promise<void>
  openFileInVsCode(folder: string, path: string, line?: number): Promise<void>
  revealProjectPath(folder: string, path: string): Promise<{ ok: true } | { ok: false; error: string }>
  filesWorkspaces(projectId: string, folder?: string): Promise<import('./filesWorkspace').FilesWorkspacesResult>
  trashProjectPath(folder: string, path: string): Promise<import('./filesWorkspace').FilesTrashResult>
  searchFiles(folder: string, request: import('./fileSearch').SearchRequest): Promise<import('./fileSearch').SearchResult>
  fileLog(folder: string, path: string): Promise<import('./filePreview').FileLogResult>
  filePreviewUrl(folder: string, path: string, text: string | null): Promise<{ ok: true; url: string } | { ok: false; error: string }>
  fileImage(folder: string, path: string, base: boolean): Promise<import('./filePreview').FileImageResult>
  openFileInBrowser(folder: string, path: string): Promise<{ ok: true } | { ok: false; error: string }>
  linkedRepos(projectId: string, folders: string[]): Promise<import('./linkedRepos').LinkedRepo[]>
  readInstruction(folder: string, name: string): Promise<InstructionRead>
  writeInstruction(request: InstructionWriteRequest): Promise<InstructionWriteResult>
  openInstruction(folder: string, name: string): Promise<void>
  notify(request: NotifyRequest): void
  onNotifyClick(listener: (paneId: string) => void): () => void
  setAttentionBadge(count: number): void
  bridgePreview(): Promise<BridgePreview>
  bridgeStatus(): Promise<BridgeStatus>
  bridgeInstall(): Promise<BridgeResult>
  bridgeUninstall(): Promise<BridgeResult>
  spawn(request: SpawnRequest): Promise<SpawnResult>
  write(id: string, data: string): void
  resize(id: string, cols: number, rows: number): void
  kill(id: string): Promise<void>
  onData(listener: (id: string, data: string) => void): () => void
  onExit(listener: (id: string, exitCode: number) => void): () => void
  onRemoteSessionStarted(listener: (session: RemoteSessionStarted) => void): () => void
  listProcessActivity(): Promise<ProcessActivity[]>
  listSkills(): Promise<SkillEntry[]>
  openSkill(id: string): Promise<void>
  exportSkill(id: string): Promise<string | null>
  /** Asks for a folder once, then exports every id. Null when the folder picker is cancelled. */
  exportSkills(ids: string[]): Promise<BulkSkillExport | null>
  readClipboard(): Promise<ClipboardContent>
  writeClipboard(text: string): Promise<void>
  openExternal(url: string): Promise<void>
  appInfo(): Promise<AppInfo>
  checkAgents(force: boolean): Promise<AgentsReport>
  onCliRun(listener: (command: CliCommand) => Promise<CliReply>): void
  onCliNotice(listener: (text: string, ok: boolean) => void): () => void
  cliReady(): void
  getUpdateState(): Promise<UpdateState>
  onUpdateState(listener: (state: UpdateState) => void): () => void
  checkForUpdate(): Promise<void>
  downloadUpdate(): Promise<void>
  retryUpdate(): Promise<void>
  dismissUpdate(): Promise<void>
  restartToUpdate(): Promise<void>
  openUpdateLink(url: string): Promise<void>
  usageReport(range: UsageRange): Promise<UsageReport>
  usageSnapshot(): Promise<UsageSnapshot>
  /** `offset`: periods back from now (0 now, -1 the one before). */
  workReport(period: WorkPeriod, offset?: number): Promise<WorkReport>
  backgroundAgents(range: BgRange): Promise<BackgroundAgentsReport>
  revealBackgroundAgent(kind: BgKind, id: string): Promise<boolean>
  exportTranscript(request: TranscriptRequest): Promise<TranscriptResult>
  writeHandoffTranscript(request: HandoffTranscriptRequest): Promise<HandoffTranscriptResult>
  revealHandoff(path: string): Promise<void>
  sessionTimeline(request: TimelineRequest): Promise<TimelineResult>
  exportTimeline(request: TimelineExportRequest): Promise<TimelineExportResult>
  searchTimelines(request: TimelineSearchRequest): Promise<TimelineSearchResult>
  compareProbe(folder: string): Promise<RepoProbe>
  compareCreate(folder: string, short: string): Promise<WorktreesResult>
  compareStatus(repo: string, path: string, branch: string): Promise<WorktreeStatus>
  compareRemove(request: WorktreeRemoval): Promise<GitResult>
  onOrchOpenPane(listener: (request: OrchPaneRequest) => void): () => void
  onOrchClosePane(listener: (agentId: string) => void): () => void
  orchStatus(): Promise<OrchStatus>
  orchStartRun(input: OrchStartInput): Promise<OrchResult<string>>
  orchRuns(): Promise<OrchRunView[]>
  orchDecisions(): Promise<OrchDecisionView[]>
  orchAnswer(decisionId: string, answer: string): Promise<OrchResult>
  orchSnapshot(): Promise<OrchSnapshot>
  onOrchChanged(listener: () => void): () => void
  orchRestart(runId: string, agentId: string): Promise<OrchResult>
  orchHandoff(input: OrchHandoffInput): Promise<OrchResult>
  orchCancelRun(runId: string): Promise<OrchResult>
  orchRetryCleanup(runId: string): Promise<OrchResult>
  orchSpec(runId: string): Promise<OrchSpecView | null>
  orchSpecVersion(runId: string, version: number): Promise<OrchSpecContent | null>
  orchExportRun(runId: string, format: OrchExportFormat): Promise<OrchResult<string | null>>
  orchExportRuns(runIds: string[]): Promise<OrchResult<OrchArchiveFileResult[]>>
  orchImportRuns(): Promise<OrchResult<OrchArchiveFileResult[]>>
  listRecordings(): Promise<RecordingSummary[]>
  readRecording(id: string): Promise<string>
  recordingStats(): Promise<RecordingStats>
  deleteAllRecordings(): Promise<number>
  openRecordingsFolder(): Promise<void>
  setRecordingTitle(id: string, title: string): void
  /** Pass null to read the state. Resolves to null when the terminal is not being recorded. */
  setRecordingPaused(id: string, paused: boolean | null): Promise<boolean | null>
  onFlushRequest(listener: () => Promise<void>): void
  /** Asked when the window is closing; resolve false to keep it open. */
  onCloseCheck(listener: () => Promise<boolean>): void
}
