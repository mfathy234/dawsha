import { registerOrchestratorIpc, type OrchestratorIpc } from './orch/switch'
import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { BrowserWindow, clipboard, dialog, ipcMain, shell, app } from 'electron'
import { IPC } from '../shared/ipc'
import type {
  AgentKind,
  FolderCheck,
  NotifyRequest,
  QuickOpenKind,
  ResumeQuery,
  Settings,
  SpawnRequest,
  WorktreeRemoval
} from '../shared/types'
import { readCodexSessions } from './codexWatcher'
import { readGeminiSessions } from './geminiWatcher'
import { applyAttentionBadge, findSolution, notifyUser, quickOpen } from './desktop'
import { existingFiles, openFile } from './fileOpen'
import { projectFolder, readInstruction, writeInstruction } from './instructionFiles'
import { isInstructionName, type InstructionWriteRequest } from '../shared/instructions'
import type { FileRef } from '../shared/filePaths'
import { createWorktrees, probeRepo, removeWorktree, worktreeStatus } from './compare'
import { changedFiles, currentBranch, gitChanges, gitSync } from './git'
import { listBranches, runGitQuick } from './gitQuick'
import type { GitQuickRequest } from '../shared/gitBranches'
import { commitFiles, discardFiles, fileDiff, pushBranch, repoStatus } from './gitCommit'
import { fileDiffSince, projectFiles, readProjectFile, sessionBaseline, sessionStatus } from './gitWorkspace'
import type { CommitRequest, DiscardRequest } from '../shared/gitStatus'
import { checkAgentTools } from './agentTools'
import { readClipboardContent } from './clipboardImage'
import { bridgeDirs, claudeHome, claudeSettingsPath } from './paths'
import { exportSkill, exportSkills, listSkills, resolveSkill, type SkillLocations } from './skillInventory'
  import { previewPaneonImport, queuePaneonImport } from './paneonImport'
  import { paneonUserDataDir } from './paths'
import { listAllSessions } from './sessionIndex'
import { listClaudeSessions, listCodexSessions, listGeminiSessions } from './projectSessions'
import { bridgePreview, bridgeStatus, installBridge, uninstallBridge, type BridgeLocations } from './statusBridge'
import type { OpsWatcher } from './opsWatcher'
import type { StatusWatcher } from './statusWatcher'
import { exportTranscript } from './transcriptExport'
import { exportSettings, readSettingsImport } from './settingsTransfer'
import { exportTimeline, sessionTimeline } from './sessionTimeline'
import { searchTimelines } from './timelineSearch'
import type { TimelineSearchRequest } from '../shared/timelineSearch'
import type { TimelineExportRequest, TimelineRequest } from '../shared/timeline'
import { platformExecutableDirs, resolveExecutable } from './executables'
import type { PtyManager } from './ptyManager'
import { readSessions } from './sessionsWatcher'
import { collectProcessActivity } from './processActivity'
import { appVersion } from './appVersion'
import type { SettingsStore } from './settingsStore'
import type { UsageService } from './usage'
import type { TranscriptRequest } from '../shared/transcript'
import { USAGE_RANGES, type UsageRange } from '../shared/usage'
import type { RemoteAccessSettings } from '../shared/types'
import type { createRemoteAccessController } from './remoteAccessController'
import type { RecordingService } from './recordings'

function checkFolder(path: string): FolderCheck {
  if (typeof path !== 'string' || path.trim() === '') return { ok: false, error: 'Enter a folder.' }
  try {
    return statSync(path).isDirectory() ? { ok: true } : { ok: false, error: 'This path is not a folder.' }
  } catch {
    return { ok: false, error: 'This folder does not exist.' }
  }
}

function isSafeUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

export function registerIpc(
  getWindow: () => BrowserWindow | null,
  onNotifyClick: (paneId: string) => void,
  settings: SettingsStore,
  ptys: PtyManager,
  status: StatusWatcher,
  ops: OpsWatcher,
  usage: UsageService,
  initialWarning: string | null,
  remoteAccess?: ReturnType<typeof createRemoteAccessController>,
  recordings?: RecordingService,
  orchestrator?: OrchestratorIpc
): void {
  const locations = (): BridgeLocations => ({
    settingsPath: claudeSettingsPath(),
    ...bridgeDirs(app.getPath('userData')),
    nodePath: resolveExecutable(process.platform === 'win32' ? 'node.exe' : 'node', platformExecutableDirs())
  })
  const skillLocations = (): SkillLocations => ({
    claude: claudeHome(),
    codex: process.env.DAWSHA_CODEX_HOME ?? join(homedir(), '.codex'),
    gemini: process.env.DAWSHA_GEMINI_HOME ?? join(homedir(), '.gemini'),
    shared: process.env.DAWSHA_SHARED_HOME ?? join(homedir(), '.agents'),
    projects: settings.get().projects.map((project) => project.folder)
  })
  let warning = initialWarning
  ipcMain.handle(IPC.settingsGet, () => {
    const result = { settings: settings.get(), warning }
    warning = null
    return result
  })
  ipcMain.handle(IPC.settingsUpdate, (_event, patch: Partial<Settings>) => {
    const updated = settings.update(patch)
    orchestrator?.apply(updated)
    return updated
  })
  ipcMain.handle(IPC.settingsExport, () => exportSettings(getWindow(), settings.get()))
  ipcMain.handle(IPC.settingsImportRead, () => readSettingsImport(getWindow()))
  if (remoteAccess) {
    ipcMain.handle(IPC.remoteAccessGet, () => remoteAccess.getState())
    ipcMain.handle(IPC.remoteAccessEnable, () => remoteAccess.enable())
    ipcMain.handle(IPC.remoteAccessDisable, () => remoteAccess.disable())
    ipcMain.handle(IPC.remoteAccessPairing, () => remoteAccess.refreshPairing())
    ipcMain.handle(IPC.remoteAccessPermissions, (_event, patch: Partial<RemoteAccessSettings>) => remoteAccess.setPermissions(patch))
    ipcMain.handle(IPC.remoteAccessEmail, (_event, email: string) => remoteAccess.setAllowedEmail(email))
    ipcMain.handle(IPC.remoteApprovalAnswered, (_event, terminalId: string, allowed: boolean, tail?: string) => remoteAccess.recordDesktopApproval(terminalId, allowed, tail))
    ipcMain.handle(IPC.remoteAccessRevoke, (_event, id: string) => remoteAccess.revoke(id))
  }
  ipcMain.handle(IPC.paneonImportPreview, () => previewPaneonImport(paneonUserDataDir(), app.getPath('userData')))
  ipcMain.handle(IPC.paneonImportQueue, () => queuePaneonImport(paneonUserDataDir(), app.getPath('userData')))
  ipcMain.handle(IPC.checkFolder, (_event, path: string) => checkFolder(path))
  ipcMain.handle(IPC.gitBranch, (_event, folder: string) => currentBranch(folder))
  ipcMain.handle(IPC.sessionsList, () => readSessions())
  ipcMain.handle(IPC.codexList, () => readCodexSessions())
  ipcMain.handle(IPC.geminiList, () => readGeminiSessions())
  ipcMain.handle(IPC.statusList, () => status.current())
  ipcMain.handle(IPC.opsList, () => ops.current())
  ipcMain.handle(IPC.processActivityList, () => collectProcessActivity(ptys.activityRoots()))
  ipcMain.handle(IPC.skillsList, () => listSkills(skillLocations()))
  ipcMain.handle(IPC.skillsOpen, async (_event, id: unknown) => {
    const skill = resolveSkill(skillLocations(), id)
    if (!skill) throw new Error('Skill is no longer available.')
    const error = await shell.openPath(skill.kind === 'agent' ? skill.path : join(skill.path, 'SKILL.md'))
    if (error) throw new Error(error)
  })
  ipcMain.handle(IPC.skillsExport, async (_event, id: unknown) => {
    if (!resolveSkill(skillLocations(), id)) throw new Error('Skill is no longer available.')
    const owner = getWindow()
      const options = { properties: ['openDirectory'] as Array<'openDirectory'>, title: 'Export to folder' }
    const selected = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    if (selected.canceled || !selected.filePaths[0]) return null
    return exportSkill(skillLocations(), id, selected.filePaths[0])
  })
  ipcMain.handle(IPC.skillsExportMany, async (_event, ids: unknown) => {
    if (!Array.isArray(ids) || ids.length === 0) throw new Error('Nothing to export.')
    const owner = getWindow()
    const options = { properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>, title: 'Export to folder' }
    const selected = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    if (selected.canceled || !selected.filePaths[0]) return null
    return exportSkills(skillLocations(), ids, selected.filePaths[0])
  })
  ipcMain.on(IPC.opsTrack, (_event, ids: unknown) => {
    ops.track(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [])
  })
  ipcMain.handle(IPC.gitChanges, (_event, folder: string) => gitChanges(folder))
  ipcMain.handle(IPC.gitFiles, (_event, folder: string) => changedFiles(folder))
  ipcMain.handle(IPC.gitStatus, (_event, folder: string) => repoStatus(folder))
  ipcMain.handle(IPC.gitCommit, (_event, request: CommitRequest) => commitFiles(request))
  ipcMain.handle(IPC.gitPush, (_event, folder: string) => pushBranch(folder))
  ipcMain.handle(IPC.gitDiscard, (_event, request: DiscardRequest) => discardFiles(request))
  ipcMain.handle(IPC.gitDiff, (_event, folder: string, path: string) => fileDiff(folder, path))
  ipcMain.handle(IPC.gitDiffSince, (_event, folder: unknown, path: unknown, baseline: unknown) => fileDiffSince(folder, path, baseline))
  ipcMain.handle(IPC.gitBaseline, (_event, folder: unknown) => sessionBaseline(folder))
  ipcMain.handle(IPC.gitSessionStatus, (_event, folder: unknown, baseline: unknown) => sessionStatus(folder, baseline))
  ipcMain.handle(IPC.projectFiles, (_event, folder: unknown) => projectFiles(folder))
  ipcMain.handle(IPC.projectFile, (_event, folder: unknown, path: unknown) => readProjectFile(folder, path))
  ipcMain.handle(IPC.gitSync, (_event, folder: string) => gitSync(folder))
  ipcMain.handle(IPC.gitBranches, (_event, folder: string) => listBranches(folder))
  ipcMain.handle(IPC.gitQuick, (_event, request: GitQuickRequest) => runGitQuick(request))
  ipcMain.handle(IPC.resumeList, (_event, agent: AgentKind, folder: string) =>
    agent === 'codex' ? listCodexSessions(folder) : agent === 'gemini' ? listGeminiSessions(folder) : listClaudeSessions(folder)
  )
  ipcMain.handle(IPC.resumeAll, (_event, query: ResumeQuery) => listAllSessions(settings.get().projects, query ?? {}))
  ipcMain.handle(IPC.quickOpen, (_event, kind: QuickOpenKind, folder: string) => quickOpen(kind, folder))
  ipcMain.handle(IPC.findSolution, (_event, folder: string) => (typeof folder === 'string' ? findSolution(folder) : null))
  ipcMain.handle(IPC.filesExist, (_event, folder: string, candidates: string[]) => existingFiles(folder, candidates))
  ipcMain.handle(IPC.filesOpen, (_event, folder: string, ref: FileRef) => openFile(folder, ref))
  ipcMain.handle(IPC.instructionsRead, (_event, folder: unknown, name: unknown) =>
    readInstruction(settings.get().projects, folder, name)
  )
  ipcMain.handle(IPC.instructionsWrite, (_event, request: InstructionWriteRequest) =>
    writeInstruction(settings.get().projects, request)
  )
  ipcMain.handle(IPC.instructionsOpen, (_event, folder: unknown, name: unknown) => {
    const root = projectFolder(settings.get().projects, folder)
    return root && isInstructionName(name) ? openFile(root, { path: name }) : undefined
  })
  ipcMain.on(IPC.notify, (_event, request: NotifyRequest) => notifyUser(getWindow, request, onNotifyClick))
  ipcMain.on(IPC.attentionBadge, (_event, count: unknown) => applyAttentionBadge(getWindow(), count))
  ipcMain.handle(IPC.bridgePreview, () => bridgePreview(locations()))
  ipcMain.handle(IPC.bridgeStatus, () => bridgeStatus(locations()))
  ipcMain.handle(IPC.bridgeInstall, () => installBridge(locations()))
  ipcMain.handle(IPC.bridgeUninstall, () => uninstallBridge(locations()))
  ipcMain.handle(IPC.agentsCheck, (_event, force: unknown) => checkAgentTools(force === true))
  ipcMain.handle(IPC.appInfo, () => ({ ...ptys.info(app.getPath('userData')), version: appVersion() }))
  ipcMain.handle(IPC.pickFolder, async () => {
    const window = getWindow()
    const options = { title: 'Choose a project folder', properties: ['openDirectory' as const] }
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })
  ipcMain.handle(IPC.pickImage, async () => {
    const window = getWindow()
    const options = {
      title: 'Choose a background image',
      properties: ['openFile' as const],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }]
    }
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })
  if (recordings) {
    ipcMain.handle(IPC.recordingsList, () => recordings.list())
    ipcMain.handle(IPC.recordingsRead, (_event, id: unknown) => recordings.read(id))
    ipcMain.handle(IPC.recordingsStats, () => recordings.stats())
    ipcMain.handle(IPC.recordingsDeleteAll, () => recordings.deleteAll())
    ipcMain.handle(IPC.recordingsOpenFolder, async () => {
      const error = await shell.openPath(await recordings.ensureRoot())
      if (error) throw new Error(error)
    })
    ipcMain.handle(IPC.recordingsPause, (_event, id: unknown, paused: unknown) =>
      typeof id === 'string' ? recordings.setPaused(id, typeof paused === 'boolean' ? paused : null) : null
    )
    ipcMain.on(IPC.recordingsTitle, (_event, id: unknown, title: unknown) => {
      if (typeof id === 'string' && typeof title === 'string') recordings.setTitle(id, title)
    })
  }
  ipcMain.handle(IPC.ptySpawn, (_event, request: SpawnRequest) => {
    const extras = orchestrator?.prepareSpawn(request) ?? null
    if (extras && 'error' in extras) return { ok: false, error: extras.error }
    return ptys.spawn(extras ? { ...request, resume: extras.resume } : request, extras ?? {})
  })
  if (orchestrator) registerOrchestratorIpc(orchestrator)
  ipcMain.on(IPC.ptyWrite, (_event, id: string, data: string) => ptys.write(id, data))
  ipcMain.on(IPC.ptyResize, (_event, id: string, cols: number, rows: number) => ptys.resize(id, cols, rows))
  ipcMain.handle(IPC.ptyKill, (_event, id: string) => ptys.kill(id))
  ipcMain.handle(IPC.usageGet, (_event, range: UsageRange) => {
    const known = USAGE_RANGES.some((entry) => entry.value === range)
    return usage.report(known ? range : '7d', settings.get().projects)
  })
  ipcMain.handle(IPC.usageSnapshot, () => usage.snapshot(settings.get().projects))
  ipcMain.handle(IPC.transcriptExport, (_event, request: TranscriptRequest) => exportTranscript(getWindow(), request))
  ipcMain.handle(IPC.timelineSession, (_event, request: TimelineRequest) => sessionTimeline(request))
  ipcMain.handle(IPC.timelineExport, (_event, request: TimelineExportRequest) => exportTimeline(getWindow(), request))
  ipcMain.handle(IPC.timelineSearch, (_event, request: TimelineSearchRequest) => searchTimelines(request, settings.get().projects))
  ipcMain.handle(IPC.compareProbe, (_event, folder: string) => probeRepo(folder))
  ipcMain.handle(IPC.compareCreate, (_event, folder: string, short: string) => createWorktrees(folder, short))
  ipcMain.handle(IPC.compareStatus, (_event, repo: string, path: string, branch: string) => worktreeStatus(repo, path, branch))
  ipcMain.handle(IPC.compareRemove, (_event, request: WorktreeRemoval) => removeWorktree(request))
  ipcMain.handle(IPC.clipboardRead, () => readClipboardContent())
  ipcMain.handle(IPC.clipboardWrite, (_event, text: string) => clipboard.writeText(String(text)))
  ipcMain.handle(IPC.openExternal, async (_event, url: string) => {
    if (isSafeUrl(url)) await shell.openExternal(url)
  })
}
