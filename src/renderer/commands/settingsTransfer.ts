import { exportSettingsFromUi, importSettingsFromUi } from '../settingsTransferActions'
import { registerCommands } from './registry'

export function installSettingsTransferCommands(): void {
  registerCommands(
    { id: 'settings.export', title: 'Export settings…', group: 'Actions', keywords: 'backup move save json', run: () => void exportSettingsFromUi() },
    { id: 'settings.import', title: 'Import settings…', group: 'Actions', keywords: 'restore move load json', run: () => void importSettingsFromUi() }
  )
}
