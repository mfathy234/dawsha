import { answerDecisions, startBugRun, startFeatureRun } from '../orchActions'
import type { AppState } from '../state'
import { registerCommands } from './registry'

const available = (state: AppState): boolean => state.settings.experimental.orchestrator && state.settings.projects.length > 0

/** Phase 2 entry points for the experimental orchestrator; the Orchestrator view replaces them later. */
export function installOrchestratorCommands(): void {
  registerCommands(
    {
      id: 'orchestrator.bug',
      title: 'Orchestrator: fix a bug…',
      group: 'Actions',
      keywords: 'orchestrator bug fix agent model',
      enabled: available,
      run: () => void startBugRun()
    },
    {
      id: 'orchestrator.feature',
      title: 'Orchestrator: build a feature…',
      group: 'Actions',
      keywords: 'orchestrator feature story spec plan agents',
      enabled: available,
      run: () => void startFeatureRun()
    },
    {
      id: 'orchestrator.decide',
      title: 'Orchestrator: answer a decision…',
      group: 'Actions',
      keywords: 'orchestrator decision question approve spec human review',
      enabled: (state) => state.settings.experimental.orchestrator,
      run: () => void answerDecisions()
    }
  )
}
