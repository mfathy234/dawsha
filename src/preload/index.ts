import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { GridApi } from '../shared/api'
import { IPC } from '../shared/ipc'
import { isRemoteControlBuild } from '../shared/remoteBuild'
import type { OpsSnapshot } from '../shared/opsFeed'
import type { UpdateState } from '../shared/updates'
import type { CodexSession, GeminiSession, SessionFile, StatusInfo, RemoteSessionStarted } from '../shared/types'

function subscribe<T extends unknown[]>(channel: string, listener: (...args: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]): void => listener(...(args as T))
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: GridApi = {
  ...(isRemoteControlBuild ? {
    remoteAccess: {
      getState: () => ipcRenderer.invoke(IPC.remoteAccessGet),
      enable: () => ipcRenderer.invoke(IPC.remoteAccessEnable),
      disable: () => ipcRenderer.invoke(IPC.remoteAccessDisable),
      refreshPairing: () => ipcRenderer.invoke(IPC.remoteAccessPairing),
      setPermissions: (patch) => ipcRenderer.invoke(IPC.remoteAccessPermissions, patch),
      setAllowedEmail: (email) => ipcRenderer.invoke(IPC.remoteAccessEmail, email),
      revokeDevice: (id) => ipcRenderer.invoke(IPC.remoteAccessRevoke, id),
      recordApproval: (terminalId, allowed, tail) => ipcRenderer.invoke(IPC.remoteApprovalAnswered, terminalId, allowed, tail)
    }
  } : {}),
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  updateSettings: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
  exportSettings: () => ipcRenderer.invoke(IPC.settingsExport),
  readSettingsImport: () => ipcRenderer.invoke(IPC.settingsImportRead),
  paneonImportPreview: () => ipcRenderer.invoke(IPC.paneonImportPreview),
  queuePaneonImport: () => ipcRenderer.invoke(IPC.paneonImportQueue),
  pickFolder: () => ipcRenderer.invoke(IPC.pickFolder),
  pickImage: () => ipcRenderer.invoke(IPC.pickImage),
  pathForFile: (file) => webUtils.getPathForFile(file),
  checkFolder: (path) => ipcRenderer.invoke(IPC.checkFolder, path),
  gitBranch: (folder) => ipcRenderer.invoke(IPC.gitBranch, folder),
  listSessions: () => ipcRenderer.invoke(IPC.sessionsList),
  onSessions: (listener) => subscribe<[SessionFile[]]>(IPC.sessionsUpdate, listener),
  listCodexSessions: () => ipcRenderer.invoke(IPC.codexList),
  onCodexSessions: (listener) => subscribe<[CodexSession[]]>(IPC.codexUpdate, listener),
  listGeminiSessions: () => ipcRenderer.invoke(IPC.geminiList),
  onGeminiSessions: (listener) => subscribe<[GeminiSession[]]>(IPC.geminiUpdate, listener),
  listStatus: () => ipcRenderer.invoke(IPC.statusList),
  onStatus: (listener) => subscribe<[StatusInfo[]]>(IPC.statusUpdate, listener),
  listOps: () => ipcRenderer.invoke(IPC.opsList),
  onOps: (listener) => subscribe<[OpsSnapshot[]]>(IPC.opsUpdate, listener),
  trackOps: (sessionIds) => ipcRenderer.send(IPC.opsTrack, sessionIds),
  gitChanges: (folder) => ipcRenderer.invoke(IPC.gitChanges, folder),
  gitFiles: (folder) => ipcRenderer.invoke(IPC.gitFiles, folder),
  gitStatus: (folder) => ipcRenderer.invoke(IPC.gitStatus, folder),
  gitCommit: (request) => ipcRenderer.invoke(IPC.gitCommit, request),
  gitPush: (folder) => ipcRenderer.invoke(IPC.gitPush, folder),
  gitDiscard: (request) => ipcRenderer.invoke(IPC.gitDiscard, request),
  gitDiff: (folder, path) => ipcRenderer.invoke(IPC.gitDiff, folder, path),
  gitDiffSince: (folder, path, baseline) => ipcRenderer.invoke(IPC.gitDiffSince, folder, path, baseline),
  gitBaseline: (folder) => ipcRenderer.invoke(IPC.gitBaseline, folder),
  gitSessionStatus: (folder, baseline) => ipcRenderer.invoke(IPC.gitSessionStatus, folder, baseline),
  projectFiles: (folder) => ipcRenderer.invoke(IPC.projectFiles, folder),
  projectFile: (folder, path) => ipcRenderer.invoke(IPC.projectFile, folder, path),
  gitSync: (folder) => ipcRenderer.invoke(IPC.gitSync, folder),
  gitBranches: (folder) => ipcRenderer.invoke(IPC.gitBranches, folder),
  gitQuick: (request) => ipcRenderer.invoke(IPC.gitQuick, request),
  listResumable: (agent, folder) => ipcRenderer.invoke(IPC.resumeList, agent, folder),
  listAllResumable: (query) => ipcRenderer.invoke(IPC.resumeAll, query),
  quickOpen: (kind, folder) => ipcRenderer.invoke(IPC.quickOpen, kind, folder),
  findSolution: (folder) => ipcRenderer.invoke(IPC.findSolution, folder),
  existingFiles: (folder, candidates) => ipcRenderer.invoke(IPC.filesExist, folder, candidates),
  openFile: (folder, ref) => ipcRenderer.invoke(IPC.filesOpen, folder, ref),
  readInstruction: (folder, name) => ipcRenderer.invoke(IPC.instructionsRead, folder, name),
  writeInstruction: (request) => ipcRenderer.invoke(IPC.instructionsWrite, request),
  openInstruction: (folder, name) => ipcRenderer.invoke(IPC.instructionsOpen, folder, name),
  notify: (request) => ipcRenderer.send(IPC.notify, request),
  onNotifyClick: (listener) => subscribe<[string]>(IPC.notifyClick, listener),
  setAttentionBadge: (count) => ipcRenderer.send(IPC.attentionBadge, count),
  bridgePreview: () => ipcRenderer.invoke(IPC.bridgePreview),
  bridgeStatus: () => ipcRenderer.invoke(IPC.bridgeStatus),
  bridgeInstall: () => ipcRenderer.invoke(IPC.bridgeInstall),
  bridgeUninstall: () => ipcRenderer.invoke(IPC.bridgeUninstall),
  spawn: (request) => ipcRenderer.invoke(IPC.ptySpawn, request),
  write: (id, data) => ipcRenderer.send(IPC.ptyWrite, id, data),
  resize: (id, cols, rows) => ipcRenderer.send(IPC.ptyResize, id, cols, rows),
  kill: (id) => ipcRenderer.invoke(IPC.ptyKill, id),
  onData: (listener) => subscribe<[string, string]>(IPC.ptyData, listener),
  onExit: (listener) => subscribe<[string, number]>(IPC.ptyExit, listener),
  onRemoteSessionStarted: (listener) => subscribe<[RemoteSessionStarted]>(IPC.remoteSessionStarted, listener),
  listProcessActivity: () => ipcRenderer.invoke(IPC.processActivityList),
  listSkills: () => ipcRenderer.invoke(IPC.skillsList),
  openSkill: (id) => ipcRenderer.invoke(IPC.skillsOpen, id),
  exportSkill: (id) => ipcRenderer.invoke(IPC.skillsExport, id),
  exportSkills: (ids) => ipcRenderer.invoke(IPC.skillsExportMany, ids),
  readClipboard: () => ipcRenderer.invoke(IPC.clipboardRead),
  writeClipboard: (text) => ipcRenderer.invoke(IPC.clipboardWrite, text),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
  checkAgents: (force) => ipcRenderer.invoke(IPC.agentsCheck, force),
  onCliRun: (listener) => {
    ipcRenderer.on(IPC.cliRun, (_event, id: number, command) => {
      void listener(command).then((reply) => ipcRenderer.send(IPC.cliDone, id, reply))
    })
  },
  onCliNotice: (listener) => subscribe<[string, boolean]>(IPC.cliNotice, listener),
  cliReady: () => ipcRenderer.send(IPC.cliReady),
  getUpdateState: () => ipcRenderer.invoke(IPC.updateGet),
  onUpdateState: (listener) => subscribe<[UpdateState]>(IPC.updateState, listener),
  checkForUpdate: () => ipcRenderer.invoke(IPC.updateCheck),
  downloadUpdate: () => ipcRenderer.invoke(IPC.updateDownload),
  retryUpdate: () => ipcRenderer.invoke(IPC.updateRetry),
  dismissUpdate: () => ipcRenderer.invoke(IPC.updateDismiss),
  restartToUpdate: () => ipcRenderer.invoke(IPC.updateRestart),
  openUpdateLink: (url) => ipcRenderer.invoke(IPC.updateOpenLink, url),
  usageReport: (range) => ipcRenderer.invoke(IPC.usageGet, range),
  usageSnapshot: () => ipcRenderer.invoke(IPC.usageSnapshot),
  exportTranscript: (request) => ipcRenderer.invoke(IPC.transcriptExport, request),
  sessionTimeline: (request) => ipcRenderer.invoke(IPC.timelineSession, request),
  exportTimeline: (request) => ipcRenderer.invoke(IPC.timelineExport, request),
  searchTimelines: (request) => ipcRenderer.invoke(IPC.timelineSearch, request),
  compareProbe: (folder) => ipcRenderer.invoke(IPC.compareProbe, folder),
  compareCreate: (folder, short) => ipcRenderer.invoke(IPC.compareCreate, folder, short),
  compareStatus: (repo, path, branch) => ipcRenderer.invoke(IPC.compareStatus, repo, path, branch),
  compareRemove: (request) => ipcRenderer.invoke(IPC.compareRemove, request),
  listRecordings: () => ipcRenderer.invoke(IPC.recordingsList),
  readRecording: (id) => ipcRenderer.invoke(IPC.recordingsRead, id),
  recordingStats: () => ipcRenderer.invoke(IPC.recordingsStats),
  deleteAllRecordings: () => ipcRenderer.invoke(IPC.recordingsDeleteAll),
  openRecordingsFolder: () => ipcRenderer.invoke(IPC.recordingsOpenFolder),
  setRecordingPaused: (id, paused) => ipcRenderer.invoke(IPC.recordingsPause, id, paused),
  setRecordingTitle: (id, title) => ipcRenderer.send(IPC.recordingsTitle, id, title),
  onFlushRequest: (listener) => {
    ipcRenderer.on(IPC.flushRequest, () => {
      void listener().finally(() => ipcRenderer.send(IPC.flushDone))
    })
  }
}

contextBridge.exposeInMainWorld('gridApi', api)
