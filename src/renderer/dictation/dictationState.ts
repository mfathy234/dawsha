export type DictationPhase = 'idle' | 'recording' | 'loading' | 'transcribing'

export interface DictationStatus {
  phase: DictationPhase
  /** The pane the text will go to when no input field is the target; null when idle. */
  paneId: string | null
  /** True when the text will be typed into an input or textarea instead of a terminal. */
  intoField: boolean
  /** Model download progress, 0 to 1, while the phase is 'loading'. */
  progress: number | null
}

const IDLE: DictationStatus = { phase: 'idle', paneId: null, intoField: false, progress: null }

let status: DictationStatus = IDLE
const listeners = new Set<(next: DictationStatus) => void>()

export const dictationStatus = (): DictationStatus => status

export function setDictationStatus(next: Partial<DictationStatus>): void {
  status = { ...status, ...next }
  for (const listener of [...listeners]) listener(status)
}

export const resetDictationStatus = (): void => {
  status = IDLE
  for (const listener of [...listeners]) listener(status)
}

export function onDictationStatus(listener: (next: DictationStatus) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function statusText(next: DictationStatus): string {
  switch (next.phase) {
    case 'recording':
      return 'Listening… click the mic again to finish, Esc to cancel'
    case 'loading': {
      const percent = next.progress === null ? '' : ` ${Math.round(next.progress * 100)}%`
      return `Preparing the speech model${percent}… (the first use downloads it)`
    }
    case 'transcribing':
      return 'Transcribing…'
    default:
      return ''
  }
}
