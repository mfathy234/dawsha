import type { AgentKind } from './types'

export const ONBOARDING_STEPS = 3

export interface StarterPrompt {
  id: string
  label: string
  text: string
}

export const STARTER_PROMPTS: readonly StarterPrompt[] = [
  { id: 'explain', label: 'Explain this codebase', text: 'Explain this codebase: what it does, how it is laid out and where to start reading.' },
  { id: 'tests', label: 'Find and fix a failing test', text: 'Run the tests, find a failing one and fix it.' },
  { id: 'readme', label: 'Write a README', text: 'Write a clear README for this project.' }
]

export interface OnboardingProgress {
  done: number
  total: number
  percent: number
  label: string
  active: 1 | 2 | 3
}

export function onboardingProgress(input: { projects: number; installedAgents: number }): OnboardingProgress {
  const projectDone = input.projects > 0
  const agentsDone = input.installedAgents > 0
  const done = Number(projectDone) + Number(agentsDone)
  const active = !projectDone ? 1 : !agentsDone ? 2 : 3
  return {
    done,
    total: ONBOARDING_STEPS,
    percent: Math.round((done / ONBOARDING_STEPS) * 100),
    label: `${done} of ${ONBOARDING_STEPS}`,
    active
  }
}

export function pickStartAgent(preferred: AgentKind, installed: readonly AgentKind[] | null): AgentKind {
  if (!installed || installed.length === 0 || installed.includes(preferred)) return preferred
  return installed[0]
}

export function starterPromptById(id: string | null): StarterPrompt | null {
  return STARTER_PROMPTS.find((prompt) => prompt.id === id) ?? null
}
