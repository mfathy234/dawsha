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
import { applyAttentionBadge, findSolution, notifyUser, openInVsCode, quickOpen, revealInFolder } from './desktop'
import { existingFiles, openFile, resolveFile } from './fileOpen'
import { projectFolder, readInstruction, writeInstruction } from './instructionFiles'
import { isInstructionName, type InstructionWriteRequest } from '../shared/instructions'
import type { FileRef } from '../shared/filePaths'
import { createWorktrees, probeRepo, removeWorktree, worktreeStatus } from './compare'
import { changedFiles, currentBranch, gitChanges, gitSync } from './git'
import { listBranches, runGitQuick } from './gitQuick'
import type { GitQuickRequest } from '../shared/gitBranches'
import { commitFiles, discardFiles, fileDiff, pushBranch, repoStatus } from './gitCommit'
import { fileAgainstBase, fileDiffSince, projectFiles, readProjectFile, resolveProjectPath, sessionBaseline, sessionStatus, writeProjectFile } from './gitWorkspace'
import { createWatchRegistry } from './fileWatch'
import { knownProjectFolder, whenKnown } from './knownFolder'
import { listFilesWorkspaces } from './filesWorkspace'
import { PreviewServer } from './filePreviewServer'
import { registerPreviewProtocol } from './previewProtocol'
import { fileCommitDetails, fileCommitFile, fileLog, htmlToOpen, linkedRepos, readImage, searchFiles } from './filesExtra'
import { trashProjectPath } from './filesTrash'
import type { CommitRequest, DiscardRequest } from '../shared/gitStatus'
import { checkAgentTools } from './agentTools'
import { readClipboardContent } from './clipboardImage'
import { bridgeDirs, claudeHome, claudeSettingsPath } from './paths'
import { createAgentAccountsReader } from './agentAccounts'
import { createCodexLimitsReader } from './codexLimits'
import { readLinked, scanSources } from './crewSources'
import { exportSkill, exportSkills, listSkills, resolveSkill, type SkillLocations } from './skillInventory'
import { listAllSessions } from './sessionIndex'
import { listClaudeSessions, listCodexSessions, listGeminiSessions } from './projectSessions'
import { bridgePreview, bridgeStatus, installBridge, uninstallBridge, type BridgeLocations } from './statusBridge'
import type { OpsWatcher } from './opsWatcher'
import type { StatusWatcher } from './statusWatcher'
import { exportTranscript } from './transcriptExport'
import { revealHandoff, writeHandoffTranscript } from './handoffTranscript'
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
import { WorkService } from './workDashboard'
import { projectWorktreeGroups } from './worktreeRoots'
import { MAX_STEPS_BACK, type WorkPeriod } from '../shared/workDashboard'
import type { TranscriptRequest } from '../shared/transcript'
import { USAGE_RANGES, type UsageRange } from '../shared/usage'
import type { RemoteAccessPatch, RemoteAccessState } from '../shared/types'
import type { createRemoteAccessController } from './remoteAccessController'

async function remoteResult(action: () => Promise<RemoteAccessState>): Promise<{ ok: true; state: RemoteAccessState } | { ok: false; error: string }> {
  try {
    return { ok: true, state: await action() }
  } catch (error) {
    const message = error instanceof Error ? error.message.trim() : ''
    return { ok: false, error: message || 'Remote Access could not be changed. Try again in a moment.' }
  }
}
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
  recordings?: RecordingService
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
    return updated
  })
  ipcMain.handle(IPC.settingsExport, () => exportSettings(getWindow(), settings.get()))
  ipcMain.handle(IPC.settingsImportRead, () => readSettingsImport(getWindow()))
  if (remoteAccess) {
    ipcMain.handle(IPC.remoteAccessGet, () => remoteAccess.getState())
    ipcMain.handle(IPC.remoteAccessEnable, () => remoteResult(() => remoteAccess.enable()))
    ipcMain.handle(IPC.remoteAccessDisable, () => remoteResult(() => remoteAccess.disable()))
    ipcMain.handle(IPC.remoteAccessVerify, () => remoteResult(() => remoteAccess.verify()))
    ipcMain.handle(IPC.remoteAccessReconnect, () => remoteResult(() => remoteAccess.reconnect()))
    ipcMain.handle(IPC.remoteAccessPairing, () => remoteResult(() => remoteAccess.refreshPairing()))
    ipcMain.handle(IPC.remoteAccessPermissions, (_event, patch: RemoteAccessPatch) => remoteResult(() => remoteAccess.setPermissions(patch)))
    ipcMain.handle(IPC.remoteAccessEmail, (_event, email: string) => remoteResult(() => remoteAccess.setAllowedEmail(email)))
    ipcMain.handle(IPC.remoteApprovalAnswered, (_event, terminalId: string, allowed: boolean, tail?: string) => remoteAccess.recordDesktopApproval(terminalId, allowed, tail))
    ipcMain.handle(IPC.remoteAccessRevoke, (_event, id: string) => remoteResult(() => remoteAccess.revoke(id)))
  }
  ipcMain.handle(IPC.checkFolder, (_event, path: string) => checkFolder(path))
  ipcMain.handle(IPC.gitBranch, (_event, folder: string) => currentBranch(folder))
  ipcMain.handle(IPC.projectGroups, async () => Object.fromEntries(await projectWorktreeGroups(settings.get().projects)))
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
  ipcMain.handle(IPC.crewSources, (_event, ids: unknown) =>
    scanSources(skillLocations(), Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string').slice(0, 200) : undefined)
  )
  ipcMain.handle(IPC.crewReadLinked, (_event, path: unknown) => readLinked(skillLocations(), path))
  ipcMain.on(IPC.opsTrack, (_event, ids: unknown) => {
    ops.track(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [])
  })
  ipcMain.handle(IPC.gitChanges, (_event, folder: string) => gitChanges(folder))
  ipcMain.handle(IPC.gitFiles, (_event, folder: string) => changedFiles(folder))
  const refusedGit = { ok: false as const, error: 'Not a project folder.' }
  const gated = <T>(folder: unknown, run: (folder: string) => Promise<T> | T): Promise<T | typeof refusedGit> =>
    whenKnown<T | typeof refusedGit>(settings.get().projects, folder, run, refusedGit)
  ipcMain.handle(IPC.gitStatus, (_event, folder: unknown) => gated(folder, repoStatus))
  ipcMain.handle(IPC.gitCommit, (_event, request: CommitRequest) => gated(request?.folder, () => commitFiles(request)))
  ipcMain.handle(IPC.gitPush, (_event, folder: unknown) => gated(folder, pushBranch))
  ipcMain.handle(IPC.gitDiscard, (_event, request: DiscardRequest) => gated(request?.folder, () => discardFiles(request)))
  ipcMain.handle(IPC.gitDiff, (_event, folder: unknown, path: unknown) => gated(folder, (root) => fileDiff(root, path)))
  ipcMain.handle(IPC.gitDiffSince, (_event, folder: unknown, path: unknown, baseline: unknown) => gated(folder, (root) => fileDiffSince(root, path, baseline)))
  ipcMain.handle(IPC.gitBaseline, (_event, folder: unknown) => gated(folder, sessionBaseline))
  ipcMain.handle(IPC.gitSessionStatus, (_event, folder: unknown, baseline: unknown) => gated(folder, (root) => sessionStatus(root, baseline)))
  const known = (folder: unknown): Promise<string | null> => knownProjectFolder(settings.get().projects, folder)
  const refused = { ok: false as const, error: 'Not a project folder.' }
  ipcMain.handle(IPC.filesWorkspaces, (_event, projectId: unknown, folder: unknown) => listFilesWorkspaces(settings.get().projects, projectId, folder))
  ipcMain.handle(IPC.filesTrash, (_event, folder: unknown, path: unknown) => trashProjectPath(settings.get().projects, folder, path, full => shell.trashItem(full)))
  ipcMain.handle(IPC.projectFiles, async (_event, folder: unknown) => {
    const root = await known(folder)
    return root ? projectFiles(root) : refused
  })
  ipcMain.handle(IPC.projectFile, async (_event, folder: unknown, path: unknown) => {
    const root = await known(folder)
    return root ? readProjectFile(root, path) : refused
  })
  ipcMain.handle(IPC.projectFileWrite, async (_event, folder: unknown, path: unknown, text: unknown, mtime: unknown) => {
    const root = await known(folder)
    return root ? writeProjectFile(root, path, text, mtime) : refused
  })
  ipcMain.handle(IPC.projectFileBase, async (_event, folder: unknown, path: unknown) => {
    const root = await known(folder)
    return root ? fileAgainstBase(root, path) : refused
  })
  const watchers = createWatchRegistry((key, paths) => {
    const window = getWindow()
    if (window && !window.isDestroyed()) window.webContents.send(IPC.filesChanged, key, paths)
  }, undefined, undefined, (key) => {
    const window = getWindow()
    if (window && !window.isDestroyed()) window.webContents.send(IPC.filesWatchFailed, key)
  })
  let watchedWindow: BrowserWindow | null = null
  ipcMain.handle(IPC.filesWatch, async (_event, folder: unknown) => {
    const root = await known(folder)
    if (!root) return
    const window = getWindow()
    if (window && window !== watchedWindow) {
      watchedWindow = window
      window.once('closed', () => {
        watchers.closeAll()
        watchedWindow = null
      })
      window.webContents.on('did-navigate', () => watchers.closeAll())
    }
    watchers.watch(root)
  })
  ipcMain.handle(IPC.filesUnwatch, (_event, folder: unknown) => {
    if (typeof folder === 'string') watchers.unwatch(folder)
  })
  ipcMain.handle(IPC.gitSync, (_event, folder: string) => gitSync(folder))
  ipcMain.handle(IPC.gitBranches, (_event, folder: unknown) => gated(folder, listBranches))
  ipcMain.handle(IPC.gitQuick, (_event, request: GitQuickRequest) => gated(request?.folder, () => runGitQuick(request)))
  ipcMain.handle(IPC.resumeList, (_event, agent: AgentKind, folder: string) =>
    agent === 'codex' ? listCodexSessions(folder) : agent === 'gemini' ? listGeminiSessions(folder) : listClaudeSessions(folder)
  )
  ipcMain.handle(IPC.resumeAll, (_event, query: ResumeQuery) => listAllSessions(settings.get().projects, query ?? {}))
  ipcMain.handle(IPC.quickOpen, (_event, kind: QuickOpenKind, folder: string) => quickOpen(kind, folder))
  ipcMain.handle(IPC.findSolution, (_event, folder: string) => (typeof folder === 'string' ? findSolution(folder) : null))
  ipcMain.handle(IPC.filesExist, (_event, folder: string, candidates: string[]) => existingFiles(folder, candidates))
  ipcMain.handle(IPC.filesOpenVsCode, async (_event, folder: unknown, path: unknown, line: unknown) => {
    const root = await known(folder)
    const full = root ? await resolveProjectPath(root, path) : null
    if (full && !full.includes('"')) await openInVsCode(full, Number.isInteger(line) && (line as number) > 0 ? (line as number) : undefined)
  })
  ipcMain.handle(IPC.filesReveal, async (_event, folder: unknown, path: unknown) => {
    const root = await known(folder)
    const full = root ? await resolveProjectPath(root, path) : null
    if (!full) return refused
    revealInFolder(full)
    return { ok: true as const }
  })
  ipcMain.handle(IPC.filesSearch, async (_event, folder: unknown, request: unknown) => {
    const root = await known(folder)
    return root ? searchFiles(root, request) : refused
  })
  ipcMain.handle(IPC.filesLog, async (_event, folder: unknown, path: unknown) => {
    const root = await known(folder)
    return root ? fileLog(root, path) : refused
  })
  ipcMain.handle(IPC.filesCommitDetails, async (_event, folder: unknown, hash: unknown) => {
    const root = await known(folder)
    return root ? fileCommitDetails(root, hash) : refused
  })
  ipcMain.handle(IPC.filesCommitFile, async (_event, folder: unknown, hash: unknown, path: unknown, full: unknown) => {
    const root = await known(folder)
    return root ? fileCommitFile(root, hash, path, full === true) : refused
  })
  const previews = new PreviewServer(known)
  registerPreviewProtocol(previews)
  ipcMain.handle(IPC.filesPreviewUrl, (_event, folder: unknown, path: unknown, text: unknown) => previews.register(folder, path, typeof text === 'string' ? text : null))
  ipcMain.handle(IPC.filesImage, async (_event, folder: unknown, path: unknown, base: unknown) => {
    const root = await known(folder)
    return root ? readImage(root, path, base === true) : refused
  })
  ipcMain.handle(IPC.filesOpenBrowser, async (_event, folder: unknown, path: unknown) => {
    const root = await known(folder)
    const full = root ? await htmlToOpen(root, path) : null
    if (!full) return refused
    const failed = await shell.openPath(full)
    return failed ? { ok: false as const, error: failed } : { ok: true as const }
  })
  ipcMain.handle(IPC.filesLinked, (_event, projectId: unknown, folders: unknown) => linkedRepos(settings.get().projects, projectId, folders))
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
  ipcMain.handle(IPC.ptySpawn, (_event, request: SpawnRequest) => ptys.spawn(request))
  ipcMain.on(IPC.ptyWrite, (_event, id: string, data: string) => ptys.write(id, data))
  ipcMain.on(IPC.ptyResize, (_event, id: string, cols: number, rows: number) => ptys.resize(id, cols, rows))
  ipcMain.handle(IPC.ptyKill, (_event, id: string) => ptys.kill(id))
  ipcMain.handle(IPC.usageGet, (_event, range: UsageRange) => {
    const known = USAGE_RANGES.some((entry) => entry.value === range)
    return usage.report(known ? range : '7d', settings.get().projects)
  })
  const readAccounts = createAgentAccountsReader()
  const readCodexLimitsCached = createCodexLimitsReader()
  ipcMain.handle(IPC.agentAccounts, async () => {
    const accounts = await readAccounts()
    if (accounts.codex.kind !== 'account' || accounts.codex.plan) return accounts
    return { ...accounts, codex: { ...accounts.codex, plan: (await readCodexLimitsCached()).plan } }
  })
  ipcMain.handle(IPC.knownLimits, async () => ({ claude: usage.lastClaudeLimits(), codex: (await readCodexLimitsCached()).entry }))
  ipcMain.handle(IPC.usageSnapshot, () => usage.snapshot(settings.get().projects))
  const work = new WorkService()
  ipcMain.handle(IPC.workGet, async (_event, period: unknown, offset: unknown) => {
    const valid: WorkPeriod = period === 'week' || period === 'month' ? period : 'today'
    // Steps back from now; anything else is now.
    const steps = typeof offset === 'number' && Number.isInteger(offset) && offset <= 0 && offset >= -MAX_STEPS_BACK ? offset : 0
    return work.report(valid, settings.get().projects, steps)
  })
  ipcMain.handle(IPC.transcriptExport, (_event, request: TranscriptRequest) => exportTranscript(getWindow(), request))
  ipcMain.handle(IPC.handoffTranscript, (_event, request: unknown) => writeHandoffTranscript(settings.get().projects, join(app.getPath('userData'), 'handoffs'), request))
  ipcMain.handle(IPC.handoffReveal, (_event, path: unknown) => revealHandoff(join(app.getPath('userData'), 'handoffs'), path))
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
