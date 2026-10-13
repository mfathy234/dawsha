import { randomUUID } from 'node:crypto'
import { isAgent } from '../shared/agents'
import type { AgentKind, FullAccess, Project, RemoteSessionStarted, SpawnRequest, SpawnResult } from '../shared/types'

export interface RemoteSessionRequest {
  projectId: string
  agent?: AgentKind
  sessionId?: string
  cols: number
  rows: number
}

export interface RemoteSessionDependencies {
  projects: Project[]
  fullAccess: FullAccess
  ptys: { spawn(request: SpawnRequest): SpawnResult }
  isKnownSession(project: Project, agent: AgentKind, sessionId: string): Promise<boolean>
  focusHost(): void
  authorizeStart(): boolean
  onStarted?(session: RemoteSessionStarted): void
}

export type RemoteSpawnResult = SpawnResult | { ok: true; pid: number; id: string }

function invalid(message: string): { ok: false; error: string } {
  return { ok: false, error: message }
}

export async function startRemoteSession(input: unknown, dependencies: RemoteSessionDependencies): Promise<RemoteSpawnResult> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid('Invalid session request.')
  const request = input as Record<string, unknown>
  const allowedKeys = new Set(['projectId', 'agent', 'sessionId', 'cols', 'rows'])
  if (Object.keys(request).some((key) => !allowedKeys.has(key))) return invalid('Remote session requests can only choose a configured project, agent, and session.')
  if (typeof request.projectId !== 'string' || !Number.isInteger(request.cols) || !Number.isInteger(request.rows)) return invalid('Invalid session request.')
  if ((request.cols as number) < 2 || (request.cols as number) > 400 || (request.rows as number) < 1 || (request.rows as number) > 200) {
    return invalid('Terminal size is outside the supported range.')
  }

  const project = dependencies.projects.find((candidate) => candidate.id === request.projectId)
  if (!project || typeof project.folder !== 'string' || !project.folder || !['claude', 'codex', 'gemini'].includes(project.defaultAgent)) {
    return invalid('That project is not configured for remote sessions.')
  }

  const agent = request.agent ?? project.defaultAgent
  if (!isAgent(agent)) return invalid('That agent is not supported for remote sessions.')

  const sessionId = request.sessionId
  if (sessionId !== undefined) {
    if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(sessionId)) return invalid('Invalid session ID.')
    if (!await dependencies.isKnownSession(project, agent, sessionId)) return invalid('That session is not available for this project and agent.')
  }

  if (!dependencies.authorizeStart()) return invalid('Remote session control was revoked before the session could start.')

  const id = randomUUID()
  const result = dependencies.ptys.spawn({
    id,
    projectId: project.id,
    agent,
    cwd: project.folder,
    resume: sessionId !== undefined,
    ...(sessionId === undefined ? {} : { sessionId }),
    cols: request.cols as number,
    rows: request.rows as number,
    fullAccess: dependencies.fullAccess[agent],
    desktopVisible: true,
    remoteManaged: true
  })
  if (!result.ok) return result
  dependencies.onStarted?.({ id, projectId: project.id, agent, pid: result.pid, ...(sessionId === undefined ? {} : { sessionId }) })
  dependencies.focusHost()
  return { ...result, id }
}
