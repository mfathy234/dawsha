import { installUsageSnapshot } from './usageSnapshot'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import {
  flushWorkspace,
  attachRemoteSession,
  initWhatsNew,
  focusPane,
  handleTerminalExit,
  openOnboarding,
  refreshBranches,
  refreshAgentTools,
  refreshBridge,
  refreshGitChanges,
  restoreWorkspace,
  setCodexSessions,
  setGeminiSessions,
  setStatusInfos,
  setUpdateState,
  zoomPane
} from './actions'
import { CODEX_MARK, GEMINI_MARK } from '../shared/agents'
import { api } from './api'
import { installAttention } from './attention'
import { guardWindowDrops } from './fileDrop'
import { installOps } from './ops'
import { installProcessActivity } from './processActivity'
import { AppShell } from './components/appShell'
import { toast } from './components/toast'
import { runCliCommand } from './cliHost'
import { installBuiltinCommands } from './commands/builtin'
import { installCompareCommands } from './commands/compare'
import { installOrchestratorCommands } from './commands/orchestrator'
import { closeOrchPane, openOrchPane } from './orchActions'
import { installHandoffCommands } from './commands/handoff'
import { installLayoutCommands } from './commands/layouts'
import { installReplayCommands } from './commands/replay'
import { installSnippetCommands } from './commands/snippets'
import { installSettingsTransferCommands } from './commands/settingsTransfer'
import { installKeyboard } from './keyboard'
import { store } from './state'
import { applyBundleToAll, connectPtyStreams, setTerminalEvents } from './terminals'
import { applyTheme, onThemeChange } from './themeManager'

const BRANCH_POLL_MS = 5000
const GIT_CHANGES_POLL_MS = 10_000

function paneOfTerm(termId: string): string | undefined {
  return store.state.panes.find((p) => p.tabs.some((t) => t.id === termId))?.id
}

async function boot(): Promise<void> {
  const [loaded, info, sessions, codexSessions, geminiSessions, statusInfos, update] = await Promise.all([
    api.getSettings(),
    api.appInfo(),
    api.listSessions(),
    api.listCodexSessions(),
    api.listGeminiSessions(),
    api.listStatus(),
    api.getUpdateState()
  ])
  store.patch({ settings: loaded.settings, info, sessions, codexSessions, geminiSessions, update, ready: true })
  const markStyle = document.documentElement.style
  markStyle.setProperty('--codex-bg', CODEX_MARK.background)
  markStyle.setProperty('--codex-fg', CODEX_MARK.color)
  markStyle.setProperty('--gemini-bg', GEMINI_MARK.background)
  markStyle.setProperty('--gemini-fg', GEMINI_MARK.color)
  applyTheme(loaded.settings.theme, true)
  onThemeChange(applyBundleToAll)

  const shell = new AppShell()
  document.getElementById('app')?.append(shell.el)
  store.subscribe((state) => shell.render(state))
  shell.render(store.state)

  setTerminalEvents({
    onZoom: (termId, direction) => {
      const paneId = paneOfTerm(termId)
      if (paneId) zoomPane(paneId, direction)
    },
    onFocus: (termId) => {
      const paneId = paneOfTerm(termId)
      // Typing into the board's peek must not leave the board for the grid.
      if (paneId && store.state.boardPeekId === paneId && store.state.settings.sessionsLayout === 'board') return
      if (paneId) focusPane(paneId, true)
    }
  })
  connectPtyStreams(handleTerminalExit)
  api.onRemoteSessionStarted(attachRemoteSession)
  api.onSessions((next) => store.patch({ sessions: next }))
  setStatusInfos(statusInfos)
  void refreshBridge()
  void refreshAgentTools(false)
  api.onStatus(setStatusInfos)
  api.onCodexSessions(setCodexSessions)
  api.onGeminiSessions(setGeminiSessions)
  setInterval(() => void refreshBranches(), BRANCH_POLL_MS)
  setInterval(() => void refreshGitChanges(), GIT_CHANGES_POLL_MS)
  document.addEventListener('visibilitychange', () => void refreshGitChanges())
  installAttention()
  guardWindowDrops()
  installUsageSnapshot()
  void installOps()
  installProcessActivity()
  installBuiltinCommands()
  installLayoutCommands()
  installCompareCommands()
  installHandoffCommands()
  installReplayCommands()
  installSnippetCommands()
  installSettingsTransferCommands()
  installOrchestratorCommands()
  installKeyboard()
  api.onUpdateState(setUpdateState)
  initWhatsNew()
  api.onFlushRequest(flushWorkspace)
  api.onCliRun(runCliCommand)
  api.onOrchOpenPane(openOrchPane)
  api.onOrchClosePane(closeOrchPane)
  api.onCliNotice((text, ok) => toast(text, ok ? 'info' : 'error'))
  if (loaded.warning) toast(loaded.warning, 'info')
  if (!loaded.settings.onboardingDismissed && loaded.settings.projects.length === 0) openOnboarding()
  await restoreWorkspace()
  api.cliReady()
  document.documentElement.dataset.ready = 'true'
}

boot().catch((error: unknown) => {
  console.error(error)
  toast(`Dawsha could not start: ${(error as Error).message}`)
})
