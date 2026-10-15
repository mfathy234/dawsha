import { openReplayPicker } from '../replayActions'
import { registerCommands } from './registry'

export function installReplayCommands(): void {
  registerCommands({
    id: 'replay.open',
    title: 'Replay a session…',
    group: 'Actions',
    keywords: 'recording recorded playback history terminal watch',
    run: () => openReplayPicker()
  })
}
