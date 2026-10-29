import { api } from './api'
import { currentMembers, memberById, runMember } from './crewActions'
import { crewRunStatuses, liveRuns, memberStateNow } from './crewLive'
import { store, type AppState } from './state'
import { isRunChoice } from '../shared/crew'
import { createPhoneRunGate, type PhoneRunInput, type RemoteCrewSnapshot } from '../shared/remoteCrew'

export function remoteCrewSnapshot(state: AppState): RemoteCrewSnapshot {
  const states: RemoteCrewSnapshot['states'] = {}
  for (const member of currentMembers()) states[member.id] = memberStateNow(state, member.id)
  const jobs = liveRuns(state).flatMap((run) => {
    const identity = run.tab.crew
    if (!identity || run.state === 'idle') return []
    const title = state.settings.crewRuns.find((entry) => entry.id === identity.runId)?.title ?? run.tab.name ?? identity.name
    const prefix = `${identity.name} · `
    return [{
      runId: identity.runId,
      memberId: identity.memberId,
      name: identity.name,
      initials: identity.initials,
      colour: identity.colour,
      task: title.startsWith(prefix) ? title.slice(prefix.length) : '',
      state: run.state,
      line: '',
      termId: run.tab.id
    }]
  })
  return { states, jobs, goal: currentGoal(state) }
}

/** The newest goal whose Lead session is still open, so the phone can show what Maya is working on. */
function currentGoal(state: AppState): RemoteCrewSnapshot['goal'] {
  const live = liveRuns(state)
  const goals = [...state.settings.crewGoals].sort((a, b) => b.startedAt - a.startedAt)
  for (const goal of goals) {
    const lead = live.find((run) => run.tab.crew?.runId === goal.leadRunId)
    if (lead) return { title: goal.text.split('\n')[0].slice(0, 120), state: lead.state, line: '' }
  }
  return null
}

/** Keeps the phone's picture of the crew current and starts the runs a phone asks for. Only exists in builds that have Remote Access. */
export function installRemoteCrew(): void {
  const remote = api.remoteCrew
  if (!remote) return
  let sent = ''
  const publish = (state: AppState): void => {
    if (!state.ready) return
    const snapshot = remoteCrewSnapshot(state)
    const text = JSON.stringify(snapshot)
    if (text === sent) return
    sent = text
    remote.publish(snapshot)
  }
  store.subscribe(publish)
  publish(store.state)
  const phoneRuns = createPhoneRunGate()
  remote.onRun((id, request) => {
    const member = memberById(request.memberId)
    if (!member || !isRunChoice(request.choice)) {
      remote.reply(id, { ok: false, error: 'That agent is not available.' })
      return
    }
    const input: PhoneRunInput = { memberId: request.memberId, projectId: request.projectId, fields: request.fields, deadline: request.deadline }
    const decision = phoneRuns.check(input, Date.now(), runStates(store.state))
    if (decision.kind === 'refuse') return remote.reply(id, { ok: false, error: decision.error })
    if (decision.kind === 'duplicate') return remote.reply(id, { ok: true, runId: decision.runId })
    const ticket = phoneRuns.begin(input, Date.now())
    void runMember({ member, projectId: request.projectId, choice: request.choice, fields: request.fields, background: true })
      .then((result) => {
        ticket.finish(result.ok ? result.runId : null)
        remote.reply(id, result.ok ? { ok: true, runId: result.runId } : { ok: false, error: result.error })
      })
      .catch(() => {
        ticket.finish(null)
        remote.reply(id, { ok: false, error: 'Could not start the run.' })
      })
  })
}

const runStates = (state: AppState): Map<string, string> => new Map(crewRunStatuses(state).map((run) => [run.id, run.state]))
