import { api } from './api'
import { toast } from './components/toast'
import { usageExportDialog, type ExportChoice } from './components/usageExportDialog'

let last: ExportChoice | undefined

/** Usage page > Export CSV: pick a range and grouping, choose where to save, then confirm with the file name. */
export async function exportUsageCsv(): Promise<void> {
  const choice = await usageExportDialog(last)
  if (!choice) return
  last = choice
  try {
    const result = await api.usageExport(choice)
    if (result.status === 'cancelled') return
    if (result.status === 'error') return toast(result.message)
    toast(`Saved ${result.name}.`, 'info', { label: 'Show in folder', run: () => void api.usageExportReveal(result.path) })
  } catch (error) {
    toast((error as Error).message || 'Could not export the usage.')
  }
}
