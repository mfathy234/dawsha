import {
  importToastText,
  planImport,
  replaceConfirmLabel,
  replaceWarning,
  type ImportPlan,
  type ParsedTransfer,
  type TransferMode
} from '../shared/settingsTransfer'
import { discardPane, saveSettings } from './actions'
import { api } from './api'
import { confirmDialog } from './components/dialogs'
import { chooseImportMode } from './components/importPreviewDialog'
import { toast } from './components/toast'
import { newId, store } from './state'

export async function exportSettingsFromUi(): Promise<void> {
  try {
    const result = await api.exportSettings()
    if (result.status === 'saved') toast(`Settings saved to ${result.path}`, 'info')
    else if (result.status === 'error') toast(result.message)
  } catch (error) {
    toast((error as Error).message || 'Could not export settings.')
  }
}

async function missingFolders(transfer: ParsedTransfer): Promise<Set<string>> {
  const folders = (transfer.data.projects ?? []).map((project) => project.folder)
  const checks = await Promise.all(folders.map(async (folder) => ((await api.checkFolder(folder)).ok ? null : folder)))
  return new Set(checks.filter((folder): folder is string => folder !== null))
}

function planFor(transfer: ParsedTransfer, mode: TransferMode, missing: Set<string>, keepFullAccess: boolean): ImportPlan {
  return planImport({ current: store.state.settings, data: transfer.data, mode, missingFolders: missing, newId, keepFullAccess })
}

async function applyPlan(plan: ImportPlan): Promise<void> {
  const projectIds = new Set((plan.patch.projects ?? store.state.settings.projects).map((project) => project.id))
  const orphaned = store.state.panes.filter((pane) => !projectIds.has(pane.projectId))
  for (const pane of orphaned) await discardPane(pane.id)
  store.set((s) => ({ ...s, settings: { ...s.settings, ...plan.patch } }))
  await saveSettings(plan.patch)
  toast(importToastText(plan.summary), 'info')
}

export async function importSettingsFromUi(onSelectedPath?: (path: string) => void): Promise<void> {
  try {
    const read = await api.readSettingsImport()
    if (read.status === 'cancelled') return
    if (read.path) onSelectedPath?.(read.path)
    if (read.status === 'error') {
      toast(read.message)
      return
    }
    const missing = await missingFolders(read.transfer)
    const mergePlan = planFor(read.transfer, 'merge', missing, false)
    const choice = await chooseImportMode(mergePlan.summary, read.transfer)
    if (!choice) return
    const plan = planFor(read.transfer, choice.mode, missing, choice.keepFullAccess)
    if (choice.mode === 'replace') {
      // Counted the way applyPlan closes them: a file without projects keeps the current ones.
      const kept = plan.patch.projects ?? store.state.settings.projects
      const open = store.state.panes.filter((pane) => !kept.some((project) => project.id === pane.projectId)).length
      const confirmed = await confirmDialog({
        title: 'Replace your projects and layouts?',
        body: replaceWarning(plan.summary, open),
        confirmLabel: replaceConfirmLabel(plan.summary)
      })
      if (!confirmed) return
    }
    await applyPlan(plan)
  } catch (error) {
    toast((error as Error).message || 'Could not import settings.')
  }
}
