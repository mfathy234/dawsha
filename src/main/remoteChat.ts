import { composerHolds, submitDelayFor, submitKey } from '../shared/chatSubmit'
import type { ChatReadRequest, ChatReadResult } from '../shared/chatLog'
import { REMOTE_CHAT_READ_ONLY, isRemoteChatAgent, isTerminalId, toRemoteChat, type RemoteChatPayload } from '../shared/remoteChat'
import type { AgentKind, Project, ResumeEntry } from '../shared/types'
import type { RemoteTerminalSnapshot } from './remoteTerminalState'

export type RemoteChatSendResult = { ok: true } | { ok: false; status: number; error: string }

export interface RemoteChatHost {
  read(terminalId: string, version?: unknown): Promise<RemoteChatPayload>
  /** `allowed` is asked again right before anything is typed, so a permission turned off during the call still wins. */
  send(terminalId: string, text: string, allowed: () => boolean): RemoteChatSendResult
}

export interface RemoteChatDependencies {
  terminals: {
    snapshot(id?: string): RemoteTerminalSnapshot[]
    tail(id: string): Promise<string | null>
    write(id: string, data: string): void
  }
  getProjects(): Project[]
  listSessions(project: Project, agent: AgentKind): Promise<ResumeEntry[]>
  readChat(request: ChatReadRequest): Promise<ChatReadResult>
  /** The session a phone-started terminal resumed, when it did. */
  knownSession?(terminalId: string): string | undefined
  schedule?(task: () => void, ms: number): void
}

const START_SLACK_MS = 5000
const CHECK_MS = 700
const MAX_PRESSES = 3
const MAX_CHECKS = 20
const MAX_VERSION = 300
const GONE = 'That session is no longer running.'
const UNSUPPORTED = 'Chat is available for Claude and Codex sessions.'

export function createRemoteChatHost(dependencies: RemoteChatDependencies): RemoteChatHost {
  const resolved = new Map<string, string>()
  const schedule = dependencies.schedule ?? ((task, ms) => { setTimeout(task, ms).unref?.() })

  function terminalOf(id: string): RemoteTerminalSnapshot | null {
    if (!isTerminalId(id)) return null
    const terminal = dependencies.terminals.snapshot(id)[0]
    return terminal && isRemoteChatAgent(terminal.agent) ? terminal : null
  }

  async function sessionOf(terminal: RemoteTerminalSnapshot, project: Project, agent: AgentKind): Promise<string | null> {
    const known = dependencies.knownSession?.(terminal.id) ?? resolved.get(terminal.id)
    if (known) return known
    const since = terminal.startedAt - START_SLACK_MS
    const entries = (await dependencies.listSessions(project, agent)).filter((entry) => entry.modifiedAt >= since)
    const newest = entries.sort((a, b) => b.modifiedAt - a.modifiedAt)[0]
    if (!newest) return null
    resolved.set(terminal.id, newest.id)
    return newest.id
  }

  function forget(): void {
    const live = new Set(dependencies.terminals.snapshot().map((terminal) => terminal.id))
    for (const id of [...resolved.keys()]) if (!live.has(id)) resolved.delete(id)
  }

  return {
    async read(terminalId, version) {
      const terminal = terminalOf(terminalId)
      if (!terminal || !isRemoteChatAgent(terminal.agent)) return { status: 'failed', reason: terminal === null && isTerminalId(terminalId) ? GONE : UNSUPPORTED }
      const project = dependencies.getProjects().find((candidate) => candidate.id === terminal.projectId)
      if (!project || typeof project.folder !== 'string' || project.folder === '') return { status: 'none' }
      forget()
      try {
        const sessionId = await sessionOf(terminal, project, terminal.agent)
        if (!sessionId) return { status: 'none' }
        const request: ChatReadRequest = { agent: terminal.agent, sessionId, folder: project.folder, ...(typeof version === 'string' && version.length <= MAX_VERSION ? { version } : {}) }
        const result = await dependencies.readChat(request)
        if (result.status === 'ok') return toRemoteChat(result.items, result.version, result.earlier)
        if (result.status === 'unchanged') return { status: 'unchanged' }
        if (result.status === 'no-session') return { status: 'none' }
        return { status: 'failed', reason: 'Dawsha could not read this chat.' }
      } catch {
        return { status: 'failed', reason: 'Dawsha could not read this chat.' }
      }
    },

    send(terminalId, text, allowed) {
      const terminal = terminalOf(terminalId)
      if (!terminal) return { ok: false, status: 404, error: isTerminalId(terminalId) ? GONE : UNSUPPORTED }
      if (!allowed()) return { ok: false, status: 403, error: REMOTE_CHAT_READ_ONLY }
      const agent = terminal.agent as AgentKind
      dependencies.terminals.write(terminalId, text)
      // The same pause the desktop chat leaves between the text and Enter, then the same check that Enter took.
      schedule(() => {
        if (!dependencies.terminals.snapshot(terminalId).length) return
        dependencies.terminals.write(terminalId, '\r')
        if (agent === 'codex') confirmSent(terminalId, text, 1, 0)
      }, submitDelayFor(agent))
      return { ok: true }
    }
  }

  function confirmSent(id: string, message: string, presses: number, checks: number): void {
    schedule(() => {
      void dependencies.terminals.tail(id).then((tail) => {
        if (!tail || !composerHolds(tail, message)) return
        const key = submitKey(tail)
        if (key) dependencies.terminals.write(id, key)
        const pressed = presses + (key ? 1 : 0)
        if (pressed <= MAX_PRESSES && checks < MAX_CHECKS) confirmSent(id, message, pressed, checks + 1)
      }, () => undefined)
    }, CHECK_MS)
  }
}
