import type { OrchTask, OrchTaskState } from '../../shared/orch/types'
import { MAX_REVIEW_ROUNDS } from './context'

// Texts written for agents: the handoff brief and the spec of a review task.

const numbered = (items: readonly string[]): string => items.map((item, i) => `${i + 1}. ${item}`).join('\n')

export function buildBrief(state: OrchTaskState): string {
  const { task, run, agent } = state
  const section = (title: string, body: string): string => (body.trim() ? `## ${title}\n${body.trim()}` : '')
  return [
    `# Continue task ${task.key}: ${task.title}`,
    `You are taking over this task${agent ? ` from the ${agent.role} agent (${agent.runner} · ${agent.model})` : ''}. ` +
      `Run "${run.title}" in ${run.projectPath}.`,
    section('Task spec', task.spec),
    section('Acceptance criteria', numbered(task.acceptance)),
    section('Status', `${task.status.replace(/_/g, ' ')}, review round ${task.reviewRound}`),
    section('Latest review or human feedback', task.feedback ?? ''),
    section('Progress so far', state.progress.map((line) => `- ${line}`).join('\n')),
    section('Last summary', task.summary ?? ''),
    section('Files and branch', [task.files.join(', '), task.branch ? `Branch: ${task.branch}` : ''].filter(Boolean).join('\n')),
    section('Shared notes', state.notes.map((n) => `- ${n.key}: ${n.text}`).join('\n')),
    section('Messages about this task', state.messages.map((m) => `- ${m.from}: ${m.body}`).join('\n')),
    'Pick up where it stopped: check the working tree and branch first, then call get_my_task and continue. Do not redo finished work.'
  ].filter(Boolean).join('\n\n')
}

export function reviewSpec(task: OrchTask): string {
  return [
    `Review ${task.key} "${task.title}" (round ${task.reviewRound + 1} of ${MAX_REVIEW_ROUNDS}).`,
    `Task spec:\n${task.spec}`,
    task.acceptance.length ? `Acceptance criteria:\n${numbered(task.acceptance)}` : '',
    `Summary from the author:\n${task.summary ?? ''}`,
    task.files.length ? `Files: ${task.files.join(', ')}` : '',
    task.branch ? `Branch: ${task.branch}` : '',
    'Approve only if every criterion is met. When rejecting, say exactly what to change.'
  ].filter(Boolean).join('\n\n')
}
