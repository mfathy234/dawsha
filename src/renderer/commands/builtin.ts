import { AGENTS, AGENT_NAMES, agentOf } from '../../shared/agents'
import { bind, formatShortcut } from '../../shared/shortcuts'
import { DICTATION_SHORTCUT } from '../../shared/dictation'
import {
  addTab,
  closePane,
  focusRelative,
  focusPaneAt,
  focusNextAttention,
  findInPane,
  movePane,
  movePaneBy,
  openChanges,
  openDetails,
  paneHasRepo,
  openPaneFolder,
  openQuickPick,
  openResumePicker,
  togglePinned,
  openWhatsNew,
  openOnboarding,
  openSettings,
  runUpdateAction,
  showPaneDiff,
  showView,
  startSession,
  toggleMaximize,
  toggleSidebar,
  toggleThemePicker,
  focusPane
} from '../actions'
import { derivePanes } from '../derive'
import { applyStashPane, fetchPane, pullPane, stashPane, switchBranchPane } from '../gitQuickActions'
import { toggleDictation } from '../dictation/dictationActions'
import { openInstructionsForPane } from '../instructionsActions'
import {
  canJumpPrompt,
  clearScrollback,
  copyCurrentPrompt,
  copyLastReply,
  jumpPrompt
} from '../terminalActions'
import { exportTranscript } from '../transcriptActions'
import { replayPane } from '../replayActions'
import { openShortcutsSheet } from '../components/shortcutsSheet'
import { openTimelineWith, toggleTimeline } from '../timelineActions'
import { paneById, store, type AppState } from '../state'
import { setSessionsLayout } from '../sessionsLayout'
import { registerCommands, registerProvider, type Command } from './registry'

const hasPane = (state: AppState): boolean => paneById(state, state.focusedId) !== undefined

const withKeys = (text: string): Pick<Command, 'keys' | 'shortcut'> => ({
  keys: [bind(text)],
  shortcut: formatShortcut(bind(text))
})

function focusedAction(id: string, title: string, run: (paneId: string) => unknown, keywords?: string): Command {
  return {
    id,
    title,
    group: 'Actions',
    keywords,
    enabled: hasPane,
    run: () => {
      const paneId = store.state.focusedId
      if (paneId) void run(paneId)
    }
  }
}

export function installBuiltinCommands(): void {
  registerCommands(
    { id: 'session.new', title: 'New session', group: 'Actions', ...withKeys('Ctrl+N'), run: () => openQuickPick() },
    {
      id: 'session.new-other',
      title: 'New session with the next agent',
      group: 'Actions',
      ...withKeys('Ctrl+Shift+N'),
      searchOnly: true,
      run: () => openQuickPick('other')
    },
    {
      id: 'dictation.toggle',
      title: 'Dictate',
      group: 'Actions',
      keywords: 'voice speech microphone talk arabic whisper',
      shortcut: formatShortcut(bind(DICTATION_SHORTCUT)),
      run: () => void toggleDictation()
    },
    { id: 'session.resume', title: 'Resume a session', group: 'Actions', ...withKeys('Ctrl+Shift+R'), run: () => openResumePicker() },
    {
      id: 'pane.maximize',
      title: 'Maximize or restore the pane',
      group: 'Actions',
      ...withKeys('Ctrl+Enter'),
      scope: 'grid',
      enabled: hasPane,
      run: () => toggleMaximize()
    },
    {
      id: 'pane.next',
      title: 'Focus the next pane',
      group: 'Actions',
      keys: [bind('Ctrl+Tab'), bind('Ctrl+Alt+ArrowRight')],
      shortcut: formatShortcut(bind('Ctrl+Tab')),
      scope: 'grid',
      enabled: hasPane,
      run: () => focusRelative(1)
    },
    {
      id: 'pane.previous',
      title: 'Focus the previous pane',
      group: 'Actions',
      keys: [bind('Ctrl+Shift+Tab'), bind('Ctrl+Alt+ArrowLeft')],
      shortcut: formatShortcut(bind('Ctrl+Shift+Tab')),
      scope: 'grid',
      enabled: hasPane,
      run: () => focusRelative(-1)
    },
    {
      id: 'pane.next-attention',
      title: 'Go to the session that needs you',
      group: 'Actions',
      keywords: 'waiting done permission attention',
      ...withKeys('Ctrl+Shift+J'),
      enabled: (state) => Object.values(state.attention).some((a) => a !== 'none'),
      run: () => void focusNextAttention()
    },
    ...Array.from({ length: 9 }, (_, i): Command => ({
      id: `pane.focus-${i + 1}`,
      title: `Focus pane ${i + 1}`,
      group: 'Actions',
      ...withKeys(`Ctrl+${i + 1}`),
      scope: 'grid',
      searchOnly: true,
      enabled: (state) => state.panes.length > i,
      run: () => focusPaneAt(i)
    })),
    {
      id: 'pane.pin',
      title: 'Pin or unpin the pane',
      group: 'Actions',
      keywords: 'keep visible side column sticky',
      scope: 'grid',
      enabled: hasPane,
      run: () => togglePinned()
    },
    {
      id: 'pane.move-earlier',
      title: 'Move the pane earlier',
      group: 'Actions',
      keywords: 'reorder left up arrange',
      ...withKeys('Ctrl+Shift+Alt+ArrowLeft'),
      scope: 'grid',
      enabled: hasPane,
      run: () => void (store.state.focusedId && movePaneBy(store.state.focusedId, -1))
    },
    {
      id: 'pane.move-later',
      title: 'Move the pane later',
      group: 'Actions',
      keywords: 'reorder right down arrange',
      ...withKeys('Ctrl+Shift+Alt+ArrowRight'),
      scope: 'grid',
      enabled: hasPane,
      run: () => void (store.state.focusedId && movePaneBy(store.state.focusedId, 1))
    },
    {
      id: 'pane.move-first',
      title: 'Move the pane to the first position',
      group: 'Actions',
      keywords: 'reorder arrange top',
      ...withKeys('Ctrl+Shift+Alt+Home'),
      scope: 'grid',
      searchOnly: true,
      enabled: hasPane,
      run: () => void (store.state.focusedId && movePane(store.state.focusedId, 0))
    },
    {
      id: 'pane.move-last',
      title: 'Move the pane to the last position',
      group: 'Actions',
      keywords: 'reorder arrange bottom',
      ...withKeys('Ctrl+Shift+Alt+End'),
      scope: 'grid',
      searchOnly: true,
      enabled: hasPane,
      run: () => void (store.state.focusedId && movePane(store.state.focusedId, store.state.panes.length - 1))
    },
    {
      ...focusedAction('pane.find', 'Find in the terminal', findInPane, 'search text output'),
      ...withKeys('Ctrl+Shift+F')
    },
    {
      id: 'terminal.previous-prompt',
      title: 'Go to the previous prompt',
      group: 'Actions',
      keywords: 'jump scroll input history marker',
      ...withKeys('Ctrl+ArrowUp'),
      scope: 'grid',
      enabled: (state) => hasPane(state) && canJumpPrompt(-1),
      run: () => jumpPrompt(-1)
    },
    {
      id: 'terminal.next-prompt',
      title: 'Go to the next prompt',
      group: 'Actions',
      keywords: 'jump scroll input history marker',
      ...withKeys('Ctrl+ArrowDown'),
      scope: 'grid',
      enabled: (state) => hasPane(state) && canJumpPrompt(1),
      run: () => jumpPrompt(1)
    },
    {
      ...focusedAction('terminal.copy-reply', 'Copy the last reply', copyLastReply, 'clipboard answer output response'),
      ...withKeys('Ctrl+Alt+C')
    },
    {
      ...focusedAction('terminal.copy-prompt', 'Copy the prompt you are typing', copyCurrentPrompt, 'clipboard input draft current'),
      ...withKeys('Ctrl+Alt+P')
    },
    focusedAction('terminal.clear-scrollback', 'Clear the terminal scrollback', clearScrollback, 'history wipe screen output'),
    focusedAction('pane.instructions', 'Edit project instructions', openInstructionsForPane, 'claude agents gemini md rules'),
    focusedAction('pane.vscode', 'Open in VS Code', (id) => openPaneFolder(id, 'vscode'), 'editor folder'),
    focusedAction('pane.explorer', 'Open in Explorer', (id) => openPaneFolder(id, 'explorer'), 'folder files'),
    focusedAction('pane.terminal', 'Open a terminal here', (id) => addTab(id, 'shell'), 'shell tab'),
    focusedAction('pane.diff', 'Show git diff', showPaneDiff, 'changes'),
    focusedAction('git.pull', 'Pull', pullPane, 'git fast-forward update upstream'),
    focusedAction('git.switch', 'Switch branch…', switchBranchPane, 'git checkout create branch'),
    focusedAction('git.stash', 'Stash changes', stashPane, 'git save uncommitted work'),
    focusedAction('git.stash-pop', 'Apply last stash', applyStashPane, 'git pop restore'),
    focusedAction('git.fetch', 'Fetch', fetchPane, 'git prune remote ahead behind'),
    {
      id: 'pane.changes',
      title: 'Show changes and commit',
      group: 'Actions',
      keywords: 'git commit discard stage diff push',
      ...withKeys('Ctrl+Shift+G'),
      enabled: (state) => hasPane(state) && paneHasRepo(state.focusedId ?? ''),
      run: () => void (store.state.focusedId && openChanges(store.state.focusedId))
    },
    {
      ...focusedAction('pane.timeline', 'Show session timeline', toggleTimeline, 'history events edits commands tests approvals search insights'),
      ...withKeys('Ctrl+Shift+T')
    },
    {
      ...focusedAction('timeline.search-all', 'Search all session timelines…', (id) => openTimelineWith(id, { scope: 'all' }), 'find prompts edits commands tests old closed past sessions history'),
      ...withKeys('Ctrl+Alt+F')
    },
    focusedAction('pane.replay', 'Replay the session', replayPane, 'play back terminal recording history'),
    focusedAction('pane.transcript', 'Export transcript…', exportTranscript, 'save markdown html conversation chat history'),
    focusedAction('pane.details', 'Show pane details', openDetails, 'context limits files'),
    focusedAction('pane.close', 'Close the pane', closePane, 'stop session'),
    { id: 'view.sidebar', title: 'Toggle the sidebar', group: 'Actions', run: () => toggleSidebar() },
    { id: 'view.projects', title: 'Open Projects', group: 'Actions', keywords: 'folders', run: () => showView('projects') },
    { id: 'view.background', title: 'Open background agents', group: 'Actions', keywords: 'agents subagents sub-agents timeline running tasks codex claude', ...withKeys('Ctrl+Shift+L'), run: () => showView('background') },
    { id: 'view.agents', title: 'Open Agent tools', group: 'Actions', keywords: 'agents install update cli', run: () => showView('agents') },
    { id: 'view.skills', title: 'Open Skills', group: 'Actions', keywords: 'installed export copy agent', run: () => showView('skills') },
    { id: 'view.usage', title: 'Open Usage', group: 'Actions', keywords: 'tokens cost limits history', run: () => showView('usage') },
    {
      id: 'view.settings',
      title: 'Open Settings',
      group: 'Actions',
      keywords: 'preferences options shortcut notifications updates changelog about',
      shortcut: 'Ctrl+,',
      keys: [{ key: ',', ctrl: true, shift: false, alt: false }],
      run: () => openSettings()
    },
    {
      id: 'view.board',
      title: 'Switch to board view',
      group: 'Actions',
      keywords: 'kanban columns layout',
      ...withKeys('Ctrl+Shift+B'),
      enabled: (state) => state.settings.sessionsLayout !== 'board',
      run: () => setSessionsLayout('board')
    },
    {
      id: 'view.grid-layout',
      title: 'Switch to grid view',
      group: 'Actions',
      keywords: 'panes layout',
      ...withKeys('Ctrl+Shift+B'),
      enabled: (state) => state.settings.sessionsLayout === 'board',
      run: () => setSessionsLayout('grid')
    },
    { id: 'view.grid', title: 'Back to the grid', group: 'Actions', searchOnly: true, run: () => showView('grid') },
    {
      id: 'app.shortcuts',
      title: 'Keyboard shortcuts',
      group: 'Actions',
      keywords: 'keys hotkeys help bindings cheat sheet',
      shortcut: 'Ctrl+/',
      keys: [{ key: '/', ctrl: true, shift: false, alt: false }],
      run: () => void openShortcutsSheet()
    },
    { id: 'app.theme', title: 'Choose a theme', group: 'Actions', keywords: 'colors background', run: () => toggleThemePicker(true) },
    { id: 'app.updates', title: 'Check for updates', group: 'Actions', run: () => runUpdateAction('check') },
    { id: 'app.whats-new', title: "Show what's new", group: 'Actions', searchOnly: true, run: () => openWhatsNew() },
    { id: 'app.setup', title: 'Open Getting started', group: 'Actions', searchOnly: true, run: () => openOnboarding() }
  )
  registerProvider(sessionCommands)
  registerProvider(projectCommands)
}

function sessionCommands(state: AppState): Command[] {
  return derivePanes(state).map((view) => ({
    id: `session:${view.pane.id}`,
    title: `${view.index + 1} · ${view.title}`,
    group: 'Sessions',
    hint: view.project?.name,
    mark: view.agent === 'shell' ? undefined : view.agent,
    run: () => focusPane(view.pane.id)
  }))
}

function projectCommands(state: AppState): Command[] {
  return state.settings.projects.flatMap((project) =>
    AGENTS.map((agent): Command => ({
      id: `project:${project.id}:${agent}`,
      title: `Start ${AGENT_NAMES[agent]} in ${project.name}`,
      group: 'Projects',
      mark: agent,
      searchOnly: agent !== agentOf(project),
      run: () => void startSession(project.id, agent)
    }))
  )
}
