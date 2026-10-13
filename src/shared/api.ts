import type { ClipboardContent } from './clipboard'
import type { AgentsReport } from './agentTools'
import type { CliCommand, CliReply } from './cli'
import type { FileRef } from './filePaths'
import type { InstructionRead, InstructionWriteRequest, InstructionWriteResult } from './instructions'
import type { WorktreeStatus } from './compare'
import type { BranchListResult, GitQuickRequest, GitQuickResult, SyncCounts } from './gitBranches'
import type { CommitRequest, DiscardRequest, GitCommitResult, GitDiffResult, RepoStatusResult } from './gitStatus'
import type { OpsSnapshot } from './opsFeed'
import type { ProcessActivity } from './processActivity'
import type { SkillEntry } from './skills'
import type { PaneonImportPreview } from './paneonImport'
import type { UpdateState } from './updates'
import type { UsageSnapshot } from './sessionCost'
import type { TranscriptRequest, TranscriptResult } from './transcript'
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
  getSettings(): Promise<SettingsLoadResult>
  updateSettings(patch: Partial<Settings>): Promise<Settings>
  remoteAccess?: {
    getState(): Promise<RemoteAccessState>
    enable(): Promise<RemoteAccessState>
    disable(): Promise<RemoteAccessState>
    refreshPairing(): Promise<RemoteAccessState>
    setPermissions(patch: Partial<RemoteAccessSettings>): Promise<RemoteAccessState>
    setAllowedEmail(email: string): Promise<RemoteAccessState>
    revokeDevice(id: string): Promise<RemoteAccessState>
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
  gitSync(folder: string): Promise<SyncCounts | null>
  gitBranches(folder: string): Promise<BranchListResult>
  gitQuick(request: GitQuickRequest): Promise<GitQuickResult>
  listResumable(agent: AgentKind, folder: string): Promise<ResumeEntry[]>
  listAllResumable(query: ResumeQuery): Promise<ResumeSession[]>
  quickOpen(kind: QuickOpenKind, folder: string): Promise<void>
  findSolution(folder: string): Promise<string | null>
  existingFiles(folder: string, candidates: string[]): Promise<(string | null)[]>
  openFile(folder: string, ref: FileRef): Promise<void>
  readInstruction(folder: string, name: string): Promise<InstructionRead>
  writeInstruction(request: InstructionWriteRequest): Promise<InstructionWriteResult>
  openInstruction(folder: string, name: string): Promise<void>
  notify(request: NotifyRequest): void
  onNotifyClick(listener: (paneId: string) => void): () => void
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
  exportTranscript(request: TranscriptRequest): Promise<TranscriptResult>
  compareProbe(folder: string): Promise<RepoProbe>
  compareCreate(folder: string, short: string): Promise<WorktreesResult>
  compareStatus(repo: string, path: string, branch: string): Promise<WorktreeStatus>
  compareRemove(request: WorktreeRemoval): Promise<GitResult>
  onFlushRequest(listener: () => Promise<void>): void
}
