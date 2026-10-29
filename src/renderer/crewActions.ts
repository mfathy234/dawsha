import { shortId } from '../shared/compare'
import {
  buildPrompt,
  duplicateMember,
  identityOf,
  inScope,
  missingFields,
  resolveRun,
  runTitle,
  uniqueMemberId,
  type CrewMember,
  type CrewRun,
  type CrewSettings,
  type RunChoice
} from '../shared/crew'
import { BUILTIN_IDS, crewMembers } from '../shared/crewBuiltins'
import { mergeLinked, parseSourceFile } from '../shared/crewImport'
import { composeInstructions, crewFullAccess } from '../shared/crewLaunch'
import { keepRuns } from '../shared/crew'
import { api } from './api'
import { saveSettings, startCrewSession } from './actions'
import { projectById, store } from './state'

export const currentMembers = (): CrewMember[] => crewMembers(store.state.settings.crew)

export const memberById = (id: string): CrewMember | undefined => currentMembers().find((member) => member.id === id)

function writeCrew(crew: CrewSettings): void {
  store.set((state) => ({ ...state, settings: { ...state.settings, crew } }))
  void saveSettings({ crew })
}

export function addMembers(members: CrewMember[]): CrewMember[] {
  const current = store.state.settings.crew
  const all = [...currentMembers()]
  const saved: CrewMember[] = []
  for (const member of members) {
    const stored: CrewMember = { ...member, id: uniqueMemberId(all, member.name), builtin: false, hidden: false, lead: false }
    all.push(stored)
    saved.push(stored)
  }
  writeCrew({ ...current, members: [...current.members, ...saved] })
  return saved
}

export function updateMember(id: string, change: Partial<CrewMember>): void {
  const current = store.state.settings.crew
  if (BUILTIN_IDS.includes(id)) return
  writeCrew({ ...current, members: current.members.map((member) => (member.id === id ? { ...member, ...change, id: member.id, builtin: false } : member)) })
}

export function removeMember(id: string): void {
  const current = store.state.settings.crew
  writeCrew({ ...current, members: current.members.filter((member) => member.id !== id) })
}

export function setBuiltinHidden(id: string, hidden: boolean): void {
  if (!BUILTIN_IDS.includes(id)) return
  const current = store.state.settings.crew
  const rest = current.hidden.filter((entry) => entry !== id)
  writeCrew({ ...current, hidden: hidden ? [...rest, id] : rest })
}

export function duplicateById(id: string): CrewMember | null {
  const source = memberById(id)
  if (!source) return null
  const copy = duplicateMember(source, currentMembers())
  writeCrew({ ...store.state.settings.crew, members: [...store.state.settings.crew.members, copy] })
  return copy
}

export const runsOf = (memberId: string): CrewRun[] => store.state.settings.crewRuns.filter((run) => run.memberId === memberId)

export function patchRuns(change: (runs: CrewRun[]) => CrewRun[]): void {
  const crewRuns = keepRuns(change(store.state.settings.crewRuns))
  store.set((state) => ({ ...state, settings: { ...state.settings, crewRuns } }))
  void saveSettings({ crewRuns })
}

const basename = (path: string): string => path.split(/[\\/]/).pop() ?? path

/** A linked member re-reads its file each time it is shown or run, so edits to the file reach the next run. */
export async function refreshLinked(member: CrewMember): Promise<CrewMember> {
  if (!member.source.linked || member.source.kind === 'dawsha' || member.builtin) return member
  let text: string | null = null
  try {
    text = await api.crewReadLinked(member.source.path)
  } catch {
    return member
  }
  if (text === null) return member
  const file = parseSourceFile(basename(member.source.path), text)
  const merged = mergeLinked(member, { description: file.description, body: file.body })
  if (merged.description !== member.description || merged.instructions !== member.instructions || merged.prompt !== member.prompt) {
    updateMember(member.id, { description: merged.description, instructions: merged.instructions, prompt: merged.prompt })
  }
  return merged
}

export interface RunInput {
  member: CrewMember
  projectId: string
  choice: RunChoice
  fields: Record<string, string>
  background: boolean
  goalId?: string
}

export type RunOutcome = { ok: true; runId: string; paneId: string; termId: string } | { ok: false; error: string }

export async function runMember(input: RunInput): Promise<RunOutcome> {
  const project = projectById(store.state, input.projectId)
  if (!project) return { ok: false, error: 'Choose a project to run in.' }
  if (input.member.lead) return { ok: false, error: `${input.member.name} is not available yet.` }
  if (!inScope(input.member, project.name)) return { ok: false, error: `${input.member.name} is limited to ${input.member.projects.join(', ')}.` }
  const missing = missingFields(input.member, input.fields)
  if (missing.length > 0) return { ok: false, error: `Fill in ${missing.join(', ')} first.` }
  const { runner, model } = resolveRun(input.member, input.choice)
  if (runner === 'gemini') {
    const accounts = await api.agentAccounts().catch(() => null)
    if (accounts && accounts.gemini.kind === 'none') return { ok: false, error: 'Gemini is not signed in. Open a Gemini session and sign in first.' }
  }
  const member = await refreshLinked(input.member)
  const runId = shortId()
  const instructions = composeInstructions(member, runner)
  const title = runTitle(member, input.fields)
  const started = await startCrewSession(project.id, {
    agent: runner,
    title,
    prompt: buildPrompt(member, input.fields),
    launch: {
      instructions,
      model,
      effort: runner === member.runner ? member.effort : '',
      permissions: member.permissions,
      startup: member.startup
    },
    fullAccess: crewFullAccess(runner, member.permissions),
    identity: identityOf(member, runId),
    background: input.background
  })
  if (!started) return { ok: false, error: 'Could not open a pane for the run.' }
  patchRuns((runs) => [
    {
      id: runId,
      memberId: member.id,
      memberName: member.name,
      projectId: project.id,
      projectName: project.name,
      title,
      runner,
      model,
      startedAt: Date.now(),
      endedAt: null,
      outcome: 'running',
      costUsd: null,
      paneId: started.paneId,
      termId: started.termId,
      ...(input.goalId ? { goalId: input.goalId } : {})
    },
    ...runs
  ])
  return { ok: true, runId, paneId: started.paneId, termId: started.termId }
}
