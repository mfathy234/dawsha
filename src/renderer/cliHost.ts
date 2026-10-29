import { planFor } from '../shared/agentTools'
import { folderName, runCli, type CliCommand, type CliHost, type CliReply } from '../shared/cli'
import { api } from './api'
import {
  createProject,
  openResumePicker,
  refreshAgentTools,
  resumeInNewPane,
  runAgentTask,
  startInFocusedPane,
  startSession
} from './actions'
import { openLayoutByName } from './layoutActions'
import { currentMembers, runMember } from './crewActions'
import { goalQueue, leadHost } from './crewLead'
import { crewRunResult, crewRunStatuses } from './crewLive'
import { store } from './state'

async function addProject(folder: string, name?: string): Promise<ReturnType<typeof createProject> | string> {
  const check = await api.checkFolder(folder)
  if (!check.ok) return `${folder}: ${check.error ?? 'not a folder.'}`
  const projects = store.state.settings.projects
  const wanted = (name ?? folderName(folder)).toLowerCase()
  if (projects.some((p) => p.name.toLowerCase() === wanted)) {
    return `A project named '${wanted}' already exists. Use dawsha add <path> --name <name>.`
  }
  return createProject(folder, name)
}

async function updateAgents(): Promise<string> {
  if (!store.state.agents.report) await refreshAgentTools(false)
  const report = store.state.agents.report
  if (!report) return 'Could not check the agents.'
  if (!planFor(report.tools, 'updates')) return 'All installed agents are up to date.'
  await runAgentTask('updates')
  return 'Updating the agents in a shell tab.'
}

export function runCliCommand(command: CliCommand): Promise<CliReply> {
  const host: CliHost = {
    version: '',
    get projects() {
      return store.state.settings.projects
    },
    get layouts() {
      return store.state.settings.layouts
    },
    now: Date.now(),
    openCount: (projectId) => store.state.panes.filter((p) => p.projectId === projectId).length,
    listSessions: (query) => api.listAllResumable(query),
    addProject,
    startSession: (projectId, agent, here) => (here ? startInFocusedPane(projectId, agent) : startSession(projectId, agent)),
    resumeSession: resumeInNewPane,
    openResumePicker,
    openLayout: openLayoutByName,
    updateAgents,
    crewMembers: currentMembers,
    crewRun: async (request) => {
      const result = await runMember({ member: request.member, projectId: request.project.id, choice: request.choice, fields: request.fields, background: request.background, goalId: request.goal })
      return result.ok ? { ok: true, runId: result.runId } : result
    },
    crewRuns: () => crewRunStatuses(store.state),
    crewResult: (run) => crewRunResult(store.state, run),
    lead: leadHost
  }
  if (command.kind === 'crew-run' && command.goal) return goalQueue(command.goal, () => runCli(command, host))
  return runCli(command, host)
}
