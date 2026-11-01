import { AGENTS, AGENT_NAMES, agentOf } from '../../shared/agents'
import { openHandDialog } from '../components/crewDialogs'
import { bind, formatShortcut } from '../../shared/shortcuts'
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
  setDimOtherPanes,
  showPaneDiff,
  showView,
  startSession,
  toggleMaximize,
  toggleSidebar,
  setColorSessionsByTag,
  toggleThemePicker,
  focusPane,
  makeLarge,
  canMakeLargePane
} from '../actions'
import { derivePanes } from '../derive'
import { applyStashPane, fetchPane, pullPane, stashPane, switchBranchPane } from '../gitQuickActions'
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
import { toggleQuickOpen } from '../components/quickOpen'
import { filesTarget, openFolderInFiles, requestFilesCommand, type FilesCommand } from '../files/filesActions'
import { openTimelineWith, toggleTimeline } from '../timelineActions'
import { paneById, store, type AppState } from '../state'
import { setGridStyle, setSessionsLayout } from '../sessionsLayout'
import { SIDEBAR_FILTER_EVENT } from '../../shared/sidebarModel'
import { registerCommands, registerProvider, type Command } from './registry'

const hasPane = (state: AppState): boolean => paneById(state, state.focusedId) !== undefined

const withKeys = (text: string): Pick<Command, 'keys' | 'shortcut'> => ({
  keys: [bind(text)],
  shortcut: formatShortcut(bind(text))
})

const functionKey = (key: string, shift = false): Pick<Command, 'keys' | 'shortcut'> => {
  const binding = { key, ctrl: false, shift, alt: false }
  return { keys: [binding], shortcut: formatShortcut(binding) }
}

const filesOnly = (state: AppState): boolean => state.view === 'files'

function filesCommand(id: string, title: string, command: FilesCommand, keys: Pick<Command, 'keys' | 'shortcut'>, keywords: string): Command {
  return { id, title, group: 'Actions', keywords: `files code ${keywords}`, ...keys, enabled: filesOnly, run: () => requestFilesCommand(command) }
}

const PANEL_OPEN_DELAY_MS = 150

// Panel tabs open from anywhere: outside Files the view opens on the focused session's project first.
function panelCommand(id: string, title: string, command: FilesCommand, keywords: string): Command {
  return {
    id, title, group: 'Actions', keywords: `files panel ${keywords}`,
    run: () => {
      if (store.state.view === 'files') return requestFilesCommand(command)
      const target = filesTarget()
      if (target) openFolderInFiles(target)
      else showView('files')
      window.setTimeout(() => requestFilesCommand(command), PANEL_OPEN_DELAY_MS)
    }
  }
}

// Code navigation keys work only while Files is showing, so Ctrl+Shift+O keeps filtering the sidebar in the grid.
function filesNavigationCommands(): Command[] {
  return [
    filesCommand('files.definition', 'Go to Definition', 'definition', functionKey('F12'), 'jump declaration f12'),
    filesCommand('files.implementation', 'Go to Implementation', 'implementation', withKeys('Ctrl+F12'), 'jump implements f12'),
    filesCommand('files.references', 'Find All References', 'references', functionKey('F12', true), 'usages peek f12'),
    filesCommand('files.back', 'Go Back', 'back', withKeys('Alt+ArrowLeft'), 'previous location history navigate'),
    filesCommand('files.forward', 'Go Forward', 'forward', withKeys('Alt+ArrowRight'), 'next location history navigate'),
    filesCommand('files.everything', 'Go to Everything…', 'everything', withKeys('Ctrl+T'), 'search symbol text file anywhere'),
    filesCommand('files.symbol', 'Go to Symbol in this file…', 'symbol', withKeys('Ctrl+Shift+O'), 'outline method class function'),
    filesCommand('files.line', 'Go to Line…', 'line', withKeys('Ctrl+G'), 'goto number position'),
    filesCommand('files.rename', 'Rename Symbol…', 'rename', functionKey('F2'), 'refactor name all files preview'),
    filesCommand('files.replace', 'Replace in Files…', 'replace', withKeys('Ctrl+Shift+H'), 'search replace across files preview'),
    filesCommand('files.calls', 'Call Hierarchy', 'calls', withKeys('Ctrl+Shift+Alt+H'), 'callers callees incoming outgoing'),
    filesCommand('files.nextProblem', 'Go to Next Problem', 'next-problem', functionKey('F8'), 'error warning marker underline'),
    filesCommand('files.previousProblem', 'Go to Previous Problem', 'previous-problem', functionKey('F8', true), 'error warning marker underline'),
    filesCommand('files.nextChange', 'Go to Next Change', 'next-change', functionKey('F7'), 'diff review hunk changes'),
    filesCommand('files.previousChange', 'Go to Previous Change', 'previous-change', functionKey('F7', true), 'diff review hunk changes'),
    filesCommand('files.ask', 'Ask an Agent About This Code…', 'ask', withKeys('Ctrl+Alt+A'), 'send selection question symbol references'),
    filesCommand('files.stale', 'Show Callers the Agent Did Not Update', 'stale', {}, 'unupdated stale callers implementations changed'),
    filesCommand('files.follow', 'Follow the Agent', 'follow', {}, 'watch open edited files live toggle')
  ]
}

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
      title: 'Jump to the next pane that needs you',
      group: 'Actions',
      keywords: 'waiting done permission attention next jump',
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
      id: 'pane.make-large',
      title: 'Make the pane large',
      group: 'Actions',
      keywords: 'big main focus spot calm promote',
      ...withKeys('Ctrl+Alt+L'),
      scope: 'grid',
      enabled: (state) => state.focusedId !== null && canMakeLargePane(state, state.focusedId),
      run: () => makeLarge()
    },
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
      ...focusedAction('pane.find', 'Find in the terminal (in Files: search files)', findInPane, 'search text output find in files'),
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
    {
      id: 'sidebar.filter',
      title: 'Filter projects and sessions',
      group: 'Actions',
      keywords: 'sidebar search find projects',
      ...withKeys('Ctrl+Shift+O'),
      scope: 'grid',
      run: () => void window.dispatchEvent(new CustomEvent(SIDEBAR_FILTER_EVENT))
    },
    { id: 'view.toggleTagColors', title: 'Toggle tag colours', group: 'Actions', keywords: 'session tag bug feature colour color chip', run: () => setColorSessionsByTag(!store.state.settings.colorSessionsByTag) },
    { id: 'view.projects', title: 'Open Projects', group: 'Actions', keywords: 'folders', run: () => showView('projects') },
    { id: 'view.files', title: 'Open Files', group: 'Actions', keywords: 'files tree editor code browse project explorer', ...withKeys('Ctrl+Shift+E'), run: () => showView('files') },
    {
      id: 'files.inspector',
      title: 'Show or hide outline and activity',
      group: 'Actions',
      keywords: 'files inspector outline activity panel side right',
      ...withKeys('Ctrl+Alt+B'),
      enabled: (state) => state.view === 'files',
      run: () => requestFilesCommand('toggle-inspector')
    },
    {
      id: 'files.explorer',
      title: 'Show or hide the file explorer',
      group: 'Actions',
      keywords: 'files explorer tree sidebar left panel',
      ...withKeys('Ctrl+Alt+E'),
      enabled: (state) => state.view === 'files',
      run: () => requestFilesCommand('toggle-explorer')
    },
    panelCommand('files.config', 'Show config files', 'show-config', 'appsettings launchsettings env environment variables secrets settings'),
    panelCommand('files.pr', 'Show pull request', 'show-pr', 'github gh review comments ci checks merge create'),
    panelCommand('files.browser', 'Show browser', 'show-browser', 'preview localhost web page devtools screenshot'),
    {
      id: 'files.worktree',
      title: 'Switch worktree…',
      group: 'Actions',
      keywords: 'files checkout branch git worktree switch',
      ...withKeys('Ctrl+Alt+W'),
      enabled: (state) => state.view === 'files',
      run: () => requestFilesCommand('switch-worktree')
    },
    {
      id: 'files.branch',
      title: 'Switch branch…',
      group: 'Actions',
      keywords: 'files git branch switch checkout remote new',
      enabled: (state) => state.view === 'files',
      run: () => requestFilesCommand('switch-branch')
    },
    ...filesNavigationCommands(),
    { id: 'view.quickopen', title: 'Find a file…', group: 'Actions', keywords: 'quick open ctrl p files search project fuzzy', ...withKeys('Ctrl+P'), run: () => toggleQuickOpen() },
    { id: 'view.agents', title: 'Open Agent tools', group: 'Actions', keywords: 'agents install update cli', run: () => showView('agents') },
    { id: 'view.crew', title: 'Open Agents', group: 'Actions', keywords: 'agents crew members run lead maya', ...withKeys('Ctrl+Shift+L'), run: () => showView('crew') },
    { id: 'crew.hand', title: 'Hand a job to an agent…', group: 'Actions', keywords: 'crew paste run member job', run: () => openHandDialog() },
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
    { id: 'view.toggleDim', title: 'Toggle dimming of other sessions', group: 'Actions', keywords: 'dim others focus calm idle sessions', run: () => setDimOtherPanes(!store.state.settings.dimOtherPanes) },
    { id: 'view.gridFocus', title: 'Sessions grid: calm focus', group: 'Actions', keywords: 'grid layout focus one large pane siblings calm sessions', run: () => setGridStyle('focus') },
    { id: 'view.gridTiles', title: 'Sessions grid: mission control', group: 'Actions', keywords: 'grid layout tiles equal mission control sessions', run: () => setGridStyle('tiles') },
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
