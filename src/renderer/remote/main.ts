import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { AGENTS, AGENT_MARKS, AGENT_NAMES } from '../../shared/agents'
import { deviceNameFromAgent, pairingCodeFromHash } from '../../shared/remotePairing'
import { DEFAULT_THEME_ID, findTheme } from '../../shared/themes'
import type { AgentKind } from '../../shared/types'
import { TERMINAL_FONT } from '../terminalFont'
import { initApprovals, reconnectApprovals, refresh as refreshApprovals, setApprovalsEnabled, setApprovalsVisible } from './approvals'
import './remote.css'

interface RemoteSession { id: string; title: string; modifiedAt: number; agent: AgentKind }
interface RemoteProject { id: string; name: string; defaultAgent: AgentKind; sessions: RemoteSession[] }
interface RemoteTerminal { id: string; projectId: string | null; agent: AgentKind | null; startedAt: number; cols?: number; rows?: number; remoteManaged?: boolean }
interface RemoteState {
  device: { id: string; name: string } | null
  projects: RemoteProject[]
  terminals: RemoteTerminal[]
  permissions: { read: boolean; terminalInput: boolean; sessionControl: boolean; approvals?: boolean }
}
type BrowserView = 'sessions' | 'projects' | 'terminal' | 'approvals'

class RemoteRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

// A pairing code from a scanned QR link (#pair=123456). Drop it from the address bar at once
// so it is not left in history or shared by accident.
let scannedCode = pairingCodeFromHash(location.hash)
if (scannedCode) history.replaceState(null, '', location.pathname + location.search)

const pairView = document.querySelector<HTMLElement>('#pair-view')!
const disconnectedView = document.querySelector<HTMLElement>('#disconnected-view')!
const workspaceView = document.querySelector<HTMLElement>('#workspace-view')!
const sessionsView = document.querySelector<HTMLElement>('#sessions-view')!
const projectsView = document.querySelector<HTMLElement>('#projects-view')!
const terminalView = document.querySelector<HTMLElement>('#terminal-view')!
const approvalsView = document.querySelector<HTMLElement>('#approvals-view')!
const approvalsBadge = document.querySelector<HTMLElement>('#approvals-badge')!
const connectionDot = document.querySelector<HTMLElement>('#connection-dot')!
const connectionLabel = document.querySelector<HTMLElement>('#connection-label')!
const pairForm = document.querySelector<HTMLFormElement>('#pair-form')!
const pairError = document.querySelector<HTMLElement>('#pair-error')!
const activeSessions = document.querySelector<HTMLElement>('#active-sessions')!
const recentSessions = document.querySelector<HTMLElement>('#recent-sessions')!
const projectGrid = document.querySelector<HTMLElement>('#project-grid')!
const sessionProjectFilter = document.querySelector<HTMLSelectElement>('#session-project-filter')!
const terminalElement = document.querySelector<HTMLElement>('#terminal')!
const terminalEmpty = document.querySelector<HTMLElement>('#terminal-empty')!
const terminalSessions = document.querySelector<HTMLElement>('#terminal-session-list')!
const terminalSessionCount = document.querySelector<HTMLElement>('#terminal-session-count')!
const terminalReadonly = document.querySelector<HTMLElement>('#terminal-readonly')!
const terminalDimensions = document.querySelector<HTMLElement>('#terminal-dimensions')!
const streamStatus = document.querySelector<HTMLElement>('#terminal-stream-status')!
const streamStatusLabel = document.querySelector<HTMLElement>('#terminal-stream-label')!
const composeHost = document.querySelector<HTMLElement>('#terminal-compose-host')!
const notice = document.querySelector<HTMLElement>('#remote-notice')!
const terminalNotice = document.querySelector<HTMLElement>('#terminal-notice')!
const projectNotice = document.querySelector<HTMLElement>('#project-notice')!
const logoutButton = document.querySelector<HTMLButtonElement>('#remote-logout')!
const newSessionDialog = document.querySelector<HTMLDialogElement>('#new-session-dialog')!
const newSessionForm = document.querySelector<HTMLFormElement>('#new-session-form')!
const newSessionProject = document.querySelector<HTMLSelectElement>('#new-session-project')!
const newSessionAgent = document.querySelector<HTMLSelectElement>('#new-session-agent')!
const newSessionSubmit = document.querySelector<HTMLButtonElement>('#new-session-submit')!
const newSessionError = document.querySelector<HTMLElement>('#new-session-error')!

let state: RemoteState | null = null
let activeProjectId: string | null = null
let activeTerminalId: string | null = null
let activeTerminalRequestedAt = 0
let activeTerminalSeen = false
let selectedProjectFilter: string | null = null
let currentView: BrowserView = 'sessions'
let stream: WebSocket | null = null
let streamTerminalId: string | null = null
let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let terminalResizeObserver: ResizeObserver | null = null
let controlBusy = false
let terminalResizeTimer = 0
// The PTY's real size. The browser draws at exactly this size so full-screen agent TUIs line up.
let ptySize: { cols: number; rows: number } | null = null
// Cell size per pixel of font, measured at the preferred size so PTY size requests stay stable.

// Agent TUIs (Claude Code, Codex) treat text that arrives together with Enter as a paste and
// leave it unsent, so the draft and its Enter are written separately with a short gap.
const SUBMIT_ENTER_DELAY_MS = 200
const TERMINAL_THEME = findTheme(DEFAULT_THEME_ID).term
const compactLayout = window.matchMedia('(max-width: 760px)')
const terminalFontSize = (): number => compactLayout.matches ? 13 : 15
const MIN_TERMINAL_FONT_SIZE = 9
const TERMINAL_LINE_HEIGHT = 1.2
const wait = (ms: number): Promise<void> => new Promise((resolveWait) => window.setTimeout(resolveWait, ms))

function cellRatios(): { width: number; height: number } {
  const screen = terminalElement.querySelector<HTMLElement>('.xterm-screen')
  const size = terminal?.options.fontSize ?? terminalFontSize()
  if (!terminal || !screen || !screen.clientWidth || !screen.clientHeight) return { width: .6, height: 1.6 }
  return { width: screen.clientWidth / terminal.cols / size, height: screen.clientHeight / terminal.rows / size }
}

function terminalArea(): { width: number; height: number } {
  const style = getComputedStyle(terminalElement)
  return {
    width: terminalElement.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
    height: terminalElement.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
  }
}

function fitTerminal(): void {
  if (!fitAddon || !terminal || currentView !== 'terminal' || !activeTerminalId || !state) return
  const area = terminalArea()
  if (area.width <= 0 || area.height <= 0) return
  const preferred = terminalFontSize()
  const ratio = cellRatios()

  // The browser never resizes the PTY: the desktop pane owns its size, and an agent redrawn
  // for a phone-width PTY would garble the desktop view. Mirror it and scale or scroll instead.

  terminalElement.classList.toggle('pty-sized', Boolean(ptySize))
  if (!ptySize) {
    // Older hosts do not report the PTY size; fall back to filling the frame.
    if (terminal.options.fontSize !== preferred) terminal.options.fontSize = preferred
    try { fitAddon.fit() } catch { return }
  } else {
    if (terminal.cols !== ptySize.cols || terminal.rows !== ptySize.rows) terminal.resize(ptySize.cols, ptySize.rows)
    const fitting = Math.min(preferred, area.width / (ptySize.cols * ratio.width), area.height / (ptySize.rows * ratio.height))
    const fontSize = Math.max(MIN_TERMINAL_FONT_SIZE, Math.floor(fitting * 2) / 2)
    if (terminal.options.fontSize !== fontSize) {
      terminal.options.fontSize = fontSize
      // Cell sizes are only exact after a render at the new size, so settle once more.
      requestAnimationFrame(fitTerminal)
    }
  }
  terminalDimensions.textContent = `${terminal.cols} × ${terminal.rows}`
}

function endpoint(path: string): string {
  return new URL(`./api/${path}`, window.location.href).toString()
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(endpoint(path), { credentials: 'same-origin', cache: 'no-store', ...init })
  const data = await response.json().catch(() => ({})) as { error?: unknown } & T
  if (!response.ok) throw new RemoteRequestError(typeof data.error === 'string' ? data.error : 'The request could not be completed.', response.status)
  return data
}

function showPair(message?: string): void {
  state = null
  stream?.close()
  stream = null
  streamTerminalId = null
  pairView.hidden = false
  disconnectedView.hidden = true
  workspaceView.hidden = true
  document.querySelector<HTMLElement>('#remote-nav')!.hidden = true
  document.querySelector<HTMLButtonElement>('#remote-new-session')!.hidden = true
  logoutButton.hidden = true
  connectionDot.className = 'status-dot offline'
  connectionLabel.textContent = 'Not paired'
  if (message) {
    pairError.textContent = message
    pairError.hidden = false
  } else {
    pairError.textContent = ''
    pairError.hidden = true
  }
  const deviceInput = document.querySelector<HTMLInputElement>('#device-name')!
  if (deviceInput.value === 'My browser') deviceInput.value = deviceNameFromAgent(navigator.userAgent)
  // A code works once, so a used one is not left in the box after Disconnect.
  document.querySelector<HTMLInputElement>('#pairing-code')!.value = scannedCode ?? ''
  if (scannedCode) {
    scannedCode = null
    pairForm.requestSubmit()
  }
}

function showDisconnected(message: string): void {
  stream?.close()
  stream = null
  streamTerminalId = null
  pairView.hidden = true
  disconnectedView.hidden = false
  workspaceView.hidden = true
  document.querySelector<HTMLElement>('#remote-nav')!.hidden = true
  document.querySelector<HTMLButtonElement>('#remote-new-session')!.hidden = true
  logoutButton.hidden = false
  connectionDot.className = 'status-dot offline'
  connectionLabel.textContent = 'Disconnected'
  document.querySelector('#disconnect-message')!.textContent = message
}

function setNotice(message: string, error = false, target = notice): void {
  target.textContent = message
  target.classList.toggle('error', error)
  target.hidden = !message
}

function setStreamStatus(label: string, status: 'connecting' | 'connected' | 'offline'): void {
  streamStatusLabel.textContent = label
  streamStatus.classList.remove('connecting', 'connected', 'offline')
  streamStatus.classList.add(status)
}

function button(label: string, className: string, onClick: () => void, ariaLabel?: string): HTMLButtonElement {
  const element = document.createElement('button')
  element.type = 'button'
  element.className = className
  element.textContent = label
  if (ariaLabel) element.setAttribute('aria-label', ariaLabel)
  element.addEventListener('click', onClick)
  return element
}

function makeAgentMark(agent: AgentKind): HTMLElement {
  const mark = document.createElement('span')
  mark.className = `agent-badge agent-${agent}`
  mark.setAttribute('aria-hidden', 'true')
  mark.textContent = AGENT_MARKS[agent]
  return mark
}

function appendLabel(parent: HTMLElement, className: string, text: string): HTMLElement {
  const element = document.createElement('span')
  element.className = className
  element.textContent = text
  parent.append(element)
  return element
}

function projectTerminals(projectId: string): RemoteTerminal[] {
  return (state?.terminals ?? []).filter((item) => item.projectId === projectId)
}

function setView(view: BrowserView): void {
  currentView = view
  render()
}

function openTerminal(id: string): void {
  activeTerminalId = id
  activeTerminalRequestedAt = Date.now()
  activeTerminalSeen = false
  const selected = state?.terminals.find((item) => item.id === id)
  if (selected?.projectId) activeProjectId = selected.projectId
  currentView = 'terminal'
  render()
}

function showSessionDialog(projectId?: string): void {
  if (!state?.permissions.sessionControl || state.projects.length === 0) return
  newSessionProject.replaceChildren(...state.projects.map((project) => {
    const option = document.createElement('option')
    option.value = project.id
    option.textContent = project.name
    return option
  }))
  newSessionAgent.replaceChildren(...AGENTS.map((agent) => {
    const option = document.createElement('option')
    option.value = agent
    option.textContent = AGENT_NAMES[agent]
    return option
  }))
  const initialProject = state.projects.find((project) => project.id === projectId) ?? state.projects[0]
  newSessionProject.value = initialProject.id
  newSessionAgent.value = initialProject.defaultAgent
  newSessionError.textContent = ''
  newSessionError.hidden = true
  newSessionSubmit.disabled = false
  newSessionDialog.showModal()
}

async function createSession(projectId: string, agent: AgentKind, sessionId?: string): Promise<void> {
  if (!state?.permissions.sessionControl || controlBusy) return
  controlBusy = true
  newSessionSubmit.disabled = true
  newSessionError.hidden = true
  setNotice(sessionId ? `Resuming ${AGENT_NAMES[agent]} session…` : `Starting ${AGENT_NAMES[agent]}…`)
  try {
    const result = await apiRequest<{ id?: string }>('session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, agent, ...(sessionId ? { sessionId } : {}), cols: terminal?.cols ?? 100, rows: terminal?.rows ?? 30 })
    })
    if (!result.id) throw new Error('Dawsha did not return the new session ID.')
    activeProjectId = projectId
    activeTerminalId = result.id
    activeTerminalRequestedAt = Date.now()
    activeTerminalSeen = false
    currentView = 'terminal'
    newSessionDialog.close()
    setNotice('Session started. Connecting to its terminal…')
    await loadState(false)
  } catch (error) {
    if (error instanceof RemoteRequestError && error.status === 401) showPair('This browser pairing has expired or was revoked.')
    else {
      const message = error instanceof Error ? error.message : 'Could not start that session.'
      newSessionError.textContent = message
      newSessionError.hidden = false
      setNotice(message, true, sessionId ? notice : projectNotice)
    }
  } finally {
    controlBusy = false
    newSessionSubmit.disabled = false
  }
}

async function stopRemoteSession(id: string): Promise<void> {
  if (!state?.permissions.sessionControl || controlBusy) return
  controlBusy = true
  setNotice('Stopping session…')
  try {
    await apiRequest('session/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    if (activeTerminalId === id) { stream?.close(); stream = null; streamTerminalId = null; activeTerminalId = null }
    setNotice('Session stopped.')
    await loadState(false)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not stop that session.'
    setNotice(message, true, terminalNotice)
  } finally { controlBusy = false }
}

function ensureTerminal(): Terminal {
  if (terminal) return terminal
  terminal = new Terminal({
    cursorBlink: false,
    disableStdin: true,
    fontFamily: TERMINAL_FONT,
    fontSize: terminalFontSize(),
    lineHeight: TERMINAL_LINE_HEIGHT,
    letterSpacing: 0,
    theme: TERMINAL_THEME,
    scrollback: 5000
  })
  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminalElement.style.background = TERMINAL_THEME.background
  terminal.open(terminalElement)
  terminalResizeObserver = new ResizeObserver(() => requestAnimationFrame(fitTerminal))
  terminalResizeObserver.observe(terminalElement)
  terminal.onData((data) => { void sendInput(data) })
  return terminal
}

async function sendInput(data: string): Promise<void> {
  if (!state?.permissions.terminalInput || !activeTerminalId || controlBusy) return
  try {
    await postTerminalInput(activeTerminalId, data)
  } catch (error) {
    if (error instanceof RemoteRequestError && error.status === 401) showPair('This browser pairing has expired or was revoked.')
    else setNotice(error instanceof Error ? error.message : 'Terminal input was not sent.', true, terminalNotice)
  }
}

async function postTerminalInput(id: string, data: string): Promise<void> {
  if (!state?.permissions.terminalInput) throw new Error('Terminal input is disabled in Dawsha settings.')
  if (controlBusy) throw new Error('Wait for the current session action to finish, then retry.')
  await apiRequest('terminal/input', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, data })
  })
}

function validSize(cols: unknown, rows: unknown): { cols: number; rows: number } | null {
  return Number.isInteger(cols) && Number.isInteger(rows) && (cols as number) >= 2 && (rows as number) >= 1 && (cols as number) <= 1000 && (rows as number) <= 1000
    ? { cols: cols as number, rows: rows as number }
    : null
}

function attachOutput(id: string): void {
  if (streamTerminalId === id) return
  ptySize = null
  stream?.close()
  streamTerminalId = id
  setStreamStatus('Connecting', 'connecting')
  const target = new URL(endpoint(`terminal/output?id=${encodeURIComponent(id)}`))
  target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:'
  const source = new WebSocket(target)
  stream = source
  source.addEventListener('open', () => {
    if (stream === source) setStreamStatus('Connected', 'connected')
  })
  source.addEventListener('message', (event) => {
    if (stream !== source || !terminal) return
    try {
      const frame = JSON.parse(String(event.data)) as { event?: string; data?: unknown }
      if (frame.event === 'snapshot' && frame.data && typeof frame.data === 'object') {
        const snapshot = frame.data as { output?: string; cols?: unknown; rows?: unknown }
        terminal.reset()
        ptySize = validSize(snapshot.cols, snapshot.rows)
        if (ptySize) terminal.resize(ptySize.cols, ptySize.rows)
        terminal.write(snapshot.output ?? '')
        requestAnimationFrame(fitTerminal)
        setStreamStatus('Connected', 'connected')
      }
      else if (frame.event === 'resize' && frame.data && typeof frame.data === 'object') {
        const size = validSize((frame.data as { cols?: unknown }).cols, (frame.data as { rows?: unknown }).rows)
        if (size) {
          ptySize = size
          terminal.resize(size.cols, size.rows)
          requestAnimationFrame(fitTerminal)
        }
      }
      else if (frame.event === 'output' && typeof frame.data === 'string') {
        terminal.write(frame.data)
        setStreamStatus('Live', 'connected')
      }
      else if (frame.event === 'closed') { source.close(); stream = null; streamTerminalId = null; setStreamStatus('Session ended', 'offline'); setNotice('This terminal has ended.', false, terminalNotice) }
      else if (frame.event === 'revoked') { source.close(); showPair('This browser was revoked from Dawsha. Pair again to reconnect.') }
    } catch { setNotice('Received invalid terminal output.', true, terminalNotice) }
  })
  source.addEventListener('close', () => {
    if (stream !== source) return
    stream = null
    streamTerminalId = null
    connectionDot.className = 'status-dot offline'
    connectionLabel.textContent = 'Reconnecting'
    setStreamStatus('Reconnecting', 'connecting')
  })
  source.onerror = () => {
    if (stream === source) {
      stream = null
      streamTerminalId = null
      source.close()
      connectionDot.className = 'status-dot offline'
      connectionLabel.textContent = 'Reconnecting'
      setStreamStatus('Reconnecting', 'connecting')
    }
  }
}

function relativeTime(timestamp: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(timestamp)
}

function cardMeta(agent: AgentKind, title: string, subtitle: string): HTMLElement {
  const meta = document.createElement('span')
  meta.className = 'session-card-meta'
  meta.append(makeAgentMark(agent))
  const text = document.createElement('span')
  text.className = 'session-card-copy'
  appendLabel(text, 'session-card-title', title)
  appendLabel(text, 'session-card-project', subtitle)
  meta.append(text)
  return meta
}

function chevron(): HTMLElement {
  const mark = document.createElement('span')
  mark.className = 'row-chevron'
  mark.setAttribute('aria-hidden', 'true')
  mark.textContent = '›'
  return mark
}

function renderSessionOverview(): void {
  if (!state) return
  const projects = state.projects
  sessionProjectFilter.replaceChildren()
  const allProjects = document.createElement('option')
  allProjects.value = ''
  allProjects.textContent = 'All projects'
  sessionProjectFilter.append(allProjects)
  for (const project of projects) {
    const option = document.createElement('option')
    option.value = project.id
    option.textContent = project.name
    sessionProjectFilter.append(option)
  }
  sessionProjectFilter.value = selectedProjectFilter ?? ''

  const matchesProject = (projectId: string | null): boolean => !selectedProjectFilter || projectId === selectedProjectFilter
  const running = state.terminals.filter((item) => matchesProject(item.projectId))
  const resumable = projects.flatMap((project) => project.sessions
    .filter((session) => matchesProject(project.id))
    .map((session) => ({ project, session })))
    .sort((a, b) => b.session.modifiedAt - a.session.modifiedAt)
    .slice(0, 30)

  document.querySelector<HTMLElement>('#session-count')!.textContent = `${running.length} running`
  document.querySelector<HTMLElement>('#active-session-count')!.textContent = String(running.length)
  document.querySelector<HTMLElement>('#recent-session-count')!.textContent = String(resumable.length)
  document.querySelector<HTMLElement>('#sessions-empty')!.hidden = running.length > 0 || resumable.length > 0
  document.querySelector<HTMLElement>('#active-sessions-section')!.hidden = running.length === 0
  document.querySelector<HTMLElement>('#recent-sessions-section')!.hidden = resumable.length === 0
  document.querySelector<HTMLElement>('#recent-sessions-empty')!.hidden = resumable.length !== 0 || running.length === 0
  document.querySelector<HTMLButtonElement>('#empty-new-session')!.hidden = !state.permissions.sessionControl || projects.length === 0

  activeSessions.replaceChildren(...running.map((item) => {
    const project = projects.find((candidate) => candidate.id === item.projectId)
    const agentName = item.agent ? AGENT_NAMES[item.agent] : 'Agent'
    const row = button('', `session-card running-card${item.id === activeTerminalId ? ' active' : ''}`, () => openTerminal(item.id))
    row.setAttribute('aria-label', `Open ${agentName} session in ${project?.name ?? 'workspace'}`)
    const live = document.createElement('span')
    live.className = 'live-pill'
    live.textContent = 'Live'
    row.append(cardMeta(item.agent ?? 'codex', project?.name ?? 'Workspace', `${agentName} · started ${relativeTime(item.startedAt)}`), live, chevron())
    return row
  }))

  recentSessions.replaceChildren(...resumable.map(({ project, session }) => {
    const row = document.createElement('article')
    row.className = 'session-card recent-card'
    row.append(cardMeta(session.agent, session.title || 'Untitled session', `${project.name} · ${AGENT_NAMES[session.agent]} · ${relativeTime(session.modifiedAt)}`))
    if (state?.permissions.sessionControl) {
      const resume = button('Resume', 'quiet-button resume-button', () => void createSession(project.id, session.agent, session.id))
      resume.dataset.resumeSession = session.id
      resume.setAttribute('aria-label', `Resume ${session.title || 'session'} in ${project.name} with ${AGENT_NAMES[session.agent]}`)
      row.append(resume)
    } else appendLabel(row, 'read-only-label', 'Read only')
    return row
  }))
}

function renderProjects(): void {
  if (!state) return
  const projects = state.projects
  const canStartSessions = state.permissions.sessionControl
  document.querySelector<HTMLElement>('#project-count')!.textContent = `${projects.length} ${projects.length === 1 ? 'project' : 'projects'}`
  document.querySelector<HTMLElement>('#projects-empty')!.hidden = projects.length > 0
  projectGrid.replaceChildren(...projects.map((project) => {
    const terminals = projectTerminals(project.id)
    const card = document.createElement('article')
    card.className = 'project-card'
    card.id = `project-card-${project.id}`
    const heading = document.createElement('div')
    heading.className = 'project-card-heading'
    const icon = document.createElement('span')
    icon.className = 'project-glyph'
    icon.setAttribute('aria-hidden', 'true')
    icon.textContent = project.name.trim().slice(0, 1).toUpperCase() || 'D'
    const title = document.createElement('div')
    appendLabel(title, 'project-name', project.name)
    appendLabel(title, 'project-agent', `${AGENT_NAMES[project.defaultAgent]} default`)
    heading.append(icon, title)
    card.append(heading)

    const stats = document.createElement('div')
    stats.className = 'project-stats'
    appendLabel(stats, '', `${terminals.length} running`)
    appendLabel(stats, '', `${project.sessions.length} recent`)
    card.append(stats)

    const recent = project.sessions.slice(0, 2)
    if (recent.length) {
      const preview = document.createElement('div')
      preview.className = 'project-recent'
      for (const session of recent) {
        const line = document.createElement('div')
        line.className = 'project-recent-row'
        line.append(makeAgentMark(session.agent))
        appendLabel(line, '', session.title || 'Untitled session')
        preview.append(line)
      }
      card.append(preview)
    } else {
      const preview = document.createElement('p')
      preview.className = 'project-recent project-recent-empty'
      preview.textContent = 'No recent sessions yet.'
      card.append(preview)
    }

    const actions = document.createElement('div')
    actions.className = 'project-card-actions'
    const viewSessions = button('View sessions', 'secondary-button', () => {
      selectedProjectFilter = project.id
      setView('sessions')
    })
    actions.append(viewSessions)
    if (canStartSessions) {
      const start = button('New session', 'quiet-button', () => showSessionDialog(project.id))
      start.id = `project-start-${project.id}`
      actions.append(start)
    }
    card.append(actions)
    return card
  }))
}

function renderTerminalSessions(): void {
  if (!state) return
  const focusedSessionId = document.activeElement instanceof HTMLElement
    && terminalSessions.contains(document.activeElement)
    ? document.activeElement.id
    : null
  const running = state.terminals.filter((item) => item.agent !== null)
  terminalSessionCount.textContent = String(running.length)
  terminalSessions.replaceChildren(...running.map((item) => {
    const project = state?.projects.find((entry) => entry.id === item.projectId)
    const option = button('', 'terminal-session-option', () => openTerminal(item.id))
    option.id = `terminal-session-${item.id}`
    option.setAttribute('aria-pressed', String(item.id === activeTerminalId))
    const meta = document.createElement('span')
    meta.className = 'terminal-session-option-meta'
    meta.append(makeAgentMark(item.agent!))
    const copy = document.createElement('span')
    copy.className = 'terminal-session-option-copy'
    appendLabel(copy, 'terminal-session-agent', AGENT_NAMES[item.agent!])
    appendLabel(copy, 'terminal-session-project', project?.name ?? 'Unknown project')
    meta.append(copy)
    const status = document.createElement('span')
    status.className = 'terminal-session-live-dot'
    status.setAttribute('aria-label', 'Running')
    option.append(meta, status)
    return option
  }))
  if (focusedSessionId) {
    document.getElementById(focusedSessionId)?.focus({ preventScroll: true })
  }
}

function renderTerminal(): void {
  if (!state) return
  renderTerminalSessions()
  const project = state.projects.find((item) => item.id === activeProjectId) ?? state.projects[0] ?? null
  if (project && activeProjectId !== project.id) activeProjectId = project.id
  const current = state.terminals.find((item) => item.id === activeTerminalId)
  const stopButton = document.querySelector<HTMLButtonElement>('#terminal-stop-session')!
  stopButton.hidden = !(current?.remoteManaged && state.permissions.sessionControl)
  stopButton.disabled = controlBusy
  document.querySelector<HTMLElement>('#active-project-name')!.textContent = project?.name ?? 'No configured projects'
  const title = document.querySelector<HTMLElement>('#terminal-title')!
  const connection = document.querySelector<HTMLElement>('#terminal-connection')!
  terminalNotice.hidden = true
  if (!current) {
    terminalElement.hidden = true
    terminalEmpty.hidden = false
    composeHost.replaceChildren()
    terminalReadonly.hidden = true
    setStreamStatus(activeTerminalId ? 'Waiting' : 'No session', 'offline')
    const starting = Boolean(activeTerminalId && !activeTerminalSeen && Date.now() - activeTerminalRequestedAt < 30_000)
    if (activeTerminalId && !starting && streamTerminalId === activeTerminalId) {
      stream?.close()
      stream = null
      streamTerminalId = null
    }
    terminalEmpty.replaceChildren(
      Object.assign(document.createElement('p'), { className: 'eyebrow', textContent: activeTerminalId ? starting ? 'STARTING SESSION' : 'SESSION ENDED' : 'NO ACTIVE TERMINAL' }),
      Object.assign(document.createElement('h2'), { textContent: activeTerminalId ? starting ? 'Connecting to your session' : 'This session is no longer active' : 'Choose a session' }),
      Object.assign(document.createElement('p'), { textContent: activeTerminalId ? starting ? 'Dawsha is opening the terminal. This view will connect as soon as it is ready.' : 'Return to Sessions to resume it or choose another terminal.' : 'Choose a running session or resume one from the Sessions view.' })
    )
    if (activeTerminalId && !starting) terminalEmpty.append(button('Back to sessions', 'primary-button', () => setView('sessions')))
    if (!activeTerminalId && state.permissions.sessionControl && project) {
      terminalEmpty.append(button('New session', 'primary-button', () => showSessionDialog(project.id)))
    }
    title.textContent = activeTerminalId ? starting ? 'Starting…' : 'Session ended' : 'No active terminal'
    connection.textContent = state.permissions.terminalInput ? 'Input enabled' : 'Read only'
    connection.classList.toggle('live', state.permissions.terminalInput)
    return
  }

  activeTerminalSeen = true
  terminalEmpty.hidden = true
  terminalElement.hidden = false
  title.textContent = `${current.agent ? AGENT_NAMES[current.agent] : 'Agent'} · started ${relativeTime(current.startedAt)}`
  document.querySelector<HTMLElement>('#terminal-session-id')!.textContent = `${current.agent ? AGENT_NAMES[current.agent] : 'Agent'} session`
  connection.textContent = state.permissions.terminalInput ? 'Input enabled' : 'Read only'
  connection.classList.toggle('live', state.permissions.terminalInput)
  terminalReadonly.hidden = state.permissions.terminalInput
  const view = ensureTerminal()
  const touchInput = window.matchMedia('(pointer: coarse)').matches
  view.options.disableStdin = !state.permissions.terminalInput || touchInput
  if (streamTerminalId !== current.id) view.reset()
  attachOutput(current.id)
  requestAnimationFrame(fitTerminal)

  const existingComposer = composeHost.querySelector<HTMLFormElement>('#terminal-compose')
  if (state.permissions.terminalInput && existingComposer && composeHost.dataset.terminalId === current.id) return
  composeHost.replaceChildren()
  if (state.permissions.terminalInput) {
    composeHost.dataset.terminalId = current.id
    const form = document.createElement('form')
    form.id = 'terminal-compose'
    form.className = 'terminal-compose'
    const input = document.createElement('textarea')
    input.id = 'terminal-input'
    input.className = 'terminal-input'
    input.rows = 1
    input.maxLength = 4096
    input.placeholder = `Message ${current.agent ? AGENT_NAMES[current.agent] : 'the agent'}…`
    input.setAttribute('aria-label', 'Terminal input')
    input.setAttribute('enterkeyhint', 'send')
    const send = document.createElement('button')
    send.id = 'terminal-send'
    send.className = 'terminal-send'
    send.type = 'submit'
    send.innerHTML = '<svg aria-hidden="true" viewBox="0 0 16 16" width="18" height="18"><path d="M8 13V3.5M3.5 8 8 3.5 12.5 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>'
    send.setAttribute('aria-label', 'Send input to the active session')
    const status = document.createElement('p')
    status.id = 'terminal-compose-status'
    status.className = 'terminal-compose-status'
    status.setAttribute('role', 'status')
    status.setAttribute('aria-live', 'polite')
    status.hidden = true
    input.setAttribute('aria-describedby', status.id)
    const box = document.createElement('div')
    box.className = 'terminal-compose-box'
    const footer = document.createElement('div')
    footer.className = 'terminal-compose-footer'
    const keys = document.createElement('div')
    keys.className = 'terminal-key-row'
    keys.setAttribute('aria-label', 'Terminal keys')
    const terminalKeys = [
      { label: 'Esc', key: 'escape', data: '\u001b', name: 'Escape' },
      { label: '↑', key: 'up', data: '\u001b[A', name: 'Up arrow' },
      { label: '↓', key: 'down', data: '\u001b[B', name: 'Down arrow' },
      { label: 'Tab', key: 'tab', data: '\t', name: 'Tab' },
      { label: '⏎', key: 'enter', data: '\r', name: 'Enter' },
      { label: '^C', key: 'interrupt', data: '\u0003', name: 'Ctrl+C' }
    ]
    for (const item of terminalKeys) {
      const keyButton = button(item.label, 'terminal-key', () => {
        void sendInput(item.data)
      }, `Send ${item.name} to the terminal`)
      keyButton.dataset.terminalKey = item.key
      keys.append(keyButton)
    }
    // Tapping a key or Send must not blur the textarea, or the phone keyboard closes after every tap.
    for (const control of [send, ...keys.querySelectorAll('button')]) {
      control.addEventListener('mousedown', (event) => { if (document.activeElement === input) event.preventDefault() })
    }
    const autosize = (): void => {
      input.style.height = 'auto'
      input.style.height = `${Math.min(input.scrollHeight, compactLayout.matches ? 132 : 168)}px`
      send.classList.toggle('ready', input.value.trim().length > 0)
    }
    let sending = false
    const submit = async (): Promise<void> => {
      if (sending || !input.value.trim() || !activeTerminalId) return
      sending = true
      send.disabled = true
      status.hidden = false
      status.classList.remove('error')
      status.textContent = 'Sending…'
      const draft = input.value
      const sessionId = activeTerminalId
      let typed = false
      try {
        await postTerminalInput(sessionId, draft)
        typed = true
        await wait(SUBMIT_ENTER_DELAY_MS)
        await postTerminalInput(sessionId, '\r')
        if (input.value === draft) {
          input.value = ''
          status.hidden = true
          status.textContent = ''
        } else {
          status.textContent = 'Sent. Your newer text is still here.'
        }
      } catch (error) {
        if (error instanceof RemoteRequestError && error.status === 401) {
          showPair('This browser pairing has expired or was revoked.')
          status.textContent = 'Pair this browser again before sending.'
        } else if (typed) {
          // The text already reached the session; resending it would type it twice.
          if (input.value === draft) input.value = ''
          status.classList.add('error')
          status.textContent = `Your text reached the session but Enter was not sent. Tap ⏎ to submit it. ${error instanceof Error ? error.message : ''}`.trim()
        } else {
          status.classList.add('error')
          status.textContent = `Not sent. Your text is still here. ${error instanceof Error ? error.message : 'Retry when the connection is ready.'}`
        }
      } finally {
        sending = false
        send.disabled = false
        autosize()
      }
    }
    input.addEventListener('input', () => {
      autosize()
      if (!sending) status.hidden = true
    })
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
      event.preventDefault()
      void submit()
    })
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      void submit()
    })
    footer.append(keys, send)
    box.append(input, footer)
    form.append(status, box)
    composeHost.append(form)
    autosize()
  } else {
    delete composeHost.dataset.terminalId
  }
}

function render(): void {
  if (!state) return
  pairView.hidden = true
  disconnectedView.hidden = true
  workspaceView.hidden = false
  document.querySelector<HTMLElement>('#remote-nav')!.hidden = false
  logoutButton.hidden = false
  connectionDot.className = 'status-dot online'
  connectionLabel.textContent = state.device?.name ?? 'Paired'
  const canStart = state.permissions.sessionControl && state.projects.length > 0
  document.querySelector<HTMLButtonElement>('#remote-new-session')!.hidden = !canStart
  document.querySelector<HTMLButtonElement>('#empty-new-session')!.hidden = !canStart
  const sessionsButton = document.querySelector<HTMLButtonElement>('#remote-nav-sessions')!
  const projectsButton = document.querySelector<HTMLButtonElement>('#remote-nav-projects')!
  const approvalsButton = document.querySelector<HTMLButtonElement>('#remote-nav-approvals')!
  sessionsButton.classList.toggle('selected', currentView === 'sessions' || currentView === 'terminal')
  projectsButton.classList.toggle('selected', currentView === 'projects')
  sessionsButton.setAttribute('aria-pressed', String(currentView === 'sessions' || currentView === 'terminal'))
  projectsButton.setAttribute('aria-pressed', String(currentView === 'projects'))
  approvalsButton.classList.toggle('selected', currentView === 'approvals')
  approvalsButton.setAttribute('aria-pressed', String(currentView === 'approvals'))
  approvalsView.hidden = currentView !== 'approvals'
  setApprovalsEnabled(state.permissions.approvals === true)
  setApprovalsVisible(currentView === 'approvals')
  sessionsView.hidden = currentView !== 'sessions'
  projectsView.hidden = currentView !== 'projects'
  terminalView.hidden = currentView !== 'terminal'
  if (currentView === 'sessions') renderSessionOverview()
  else if (currentView === 'projects') renderProjects()
  else if (currentView === 'terminal') renderTerminal()
}

async function loadState(initial: boolean): Promise<void> {
  try {
    const next = await apiRequest<RemoteState>('state')
    if (!next || !Array.isArray(next.projects) || !Array.isArray(next.terminals)) throw new Error('Dawsha returned an invalid state.')
    state = next
    if (!activeProjectId || !state.projects.some((item) => item.id === activeProjectId)) {
      activeProjectId = state.terminals.find((item) => item.projectId && state?.projects.some((project) => project.id === item.projectId))?.projectId ?? state.projects[0]?.id ?? null
    }
    if (activeTerminalId && !state.terminals.some((item) => item.id === activeTerminalId) && currentView !== 'terminal') activeTerminalId = null
    if (!activeTerminalId && activeProjectId) activeTerminalId = projectTerminals(activeProjectId)[0]?.id ?? null
    setNotice('')
    render()
  } catch (error) {
    if (error instanceof RemoteRequestError && error.status === 401) {
      if (state) showPair('This browser is not paired or its access was revoked.')
      else showPair()
      return
    }
    const message = error instanceof Error ? error.message : 'Dawsha could not be reached.'
    if (initial) showDisconnected(message)
    else setNotice(message, true)
  }
}

pairForm.addEventListener('submit', (event) => {
  event.preventDefault()
  const code = document.querySelector<HTMLInputElement>('#pairing-code')!.value.trim()
  const deviceName = document.querySelector<HTMLInputElement>('#device-name')!.value.trim()
  const submit = document.querySelector<HTMLButtonElement>('#pair-submit')!
  submit.disabled = true
  pairError.hidden = true
  void apiRequest('pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, deviceName }) })
    .then(() => loadState(true))
    .catch((error: unknown) => {
      pairError.textContent = error instanceof Error ? error.message : 'Pairing failed.'
      pairError.hidden = false
    }).finally(() => { submit.disabled = false })
})

document.querySelector<HTMLButtonElement>('#remote-retry')!.addEventListener('click', () => void loadState(true))
document.querySelector<HTMLButtonElement>('#remote-nav-sessions')!.addEventListener('click', () => setView('sessions'))
document.querySelector<HTMLButtonElement>('#remote-nav-projects')!.addEventListener('click', () => setView('projects'))
document.querySelector<HTMLButtonElement>('#remote-nav-approvals')!.addEventListener('click', () => setView('approvals'))
window.addEventListener('dawsha-open-approvals', () => setView('approvals'))
initApprovals({
  root: document.querySelector<HTMLElement>('#approvals-root')!,
  host: {
    request: apiRequest,
    endpoint,
    onBadge: (count) => { approvalsBadge.textContent = String(count); approvalsBadge.hidden = count === 0 },
    onUnpaired: () => showPair('This browser was revoked from Dawsha. Pair again to reconnect.')
  }
})
document.addEventListener('visibilitychange', () => { if (!document.hidden) { reconnectApprovals(); void refreshApprovals() } })
document.querySelector<HTMLButtonElement>('#remote-new-session')!.addEventListener('click', () => showSessionDialog(activeProjectId ?? undefined))
document.querySelector<HTMLButtonElement>('#empty-new-session')!.addEventListener('click', () => showSessionDialog(activeProjectId ?? undefined))
document.querySelector<HTMLButtonElement>('#terminal-back')!.addEventListener('click', () => setView('sessions'))
sessionProjectFilter.addEventListener('change', () => {
  selectedProjectFilter = sessionProjectFilter.value || null
  renderSessionOverview()
})
newSessionProject.addEventListener('change', () => {
  const project = state?.projects.find((item) => item.id === newSessionProject.value)
  if (project) newSessionAgent.value = project.defaultAgent
})
newSessionForm.addEventListener('submit', (event) => {
  event.preventDefault()
  if (!AGENTS.includes(newSessionAgent.value as AgentKind)) return
  void createSession(newSessionProject.value, newSessionAgent.value as AgentKind)
})
document.querySelector<HTMLButtonElement>('#new-session-close')!.addEventListener('click', () => newSessionDialog.close())
document.querySelector<HTMLButtonElement>('#new-session-cancel')!.addEventListener('click', () => newSessionDialog.close())
logoutButton.addEventListener('click', () => {
  void apiRequest('logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => undefined).finally(() => showPair())
})
document.querySelector<HTMLButtonElement>('#terminal-stop-session')!.addEventListener('click', () => {
  if (activeTerminalId) void stopRemoteSession(activeTerminalId)
})
window.addEventListener('resize', () => {
  window.clearTimeout(terminalResizeTimer)
  terminalResizeTimer = window.setTimeout(() => requestAnimationFrame(fitTerminal), 120)
})
const syncViewportHeight = (): void => {
  const height = window.visualViewport?.height ?? window.innerHeight
  document.documentElement.style.setProperty('--app-height', `${Math.round(height)}px`)
}
window.visualViewport?.addEventListener('resize', syncViewportHeight)
syncViewportHeight()
window.addEventListener('focus', () => void loadState(false))
window.setInterval(() => { if (!document.hidden && state) void loadState(false) }, 5000)

if (location.hash === '#approvals') {
  currentView = 'approvals'
  history.replaceState(null, '', location.pathname + location.search)
}
void loadState(true)
