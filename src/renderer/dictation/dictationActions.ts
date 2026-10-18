import { insertAtCaret, isTextField } from '../../shared/dictation'
import { toast } from '../components/toast'
import { paneById, store } from '../state'
import { getTerminal } from '../terminals'
import { WorkerEngine } from './engine'
import { dictationStatus, resetDictationStatus, setDictationStatus } from './dictationState'
import type { DictationEngine } from './protocol'
import { MicError, Recorder } from './recorder'

const MIN_SAMPLES = 4800
const POINTER_FOCUS_MS = 1500

/**
 * Test hook, like window.__grid. With `fake` set, no microphone or model is used and the fixed text is returned.
 * With `samples` set, those 16 kHz samples stand in for the microphone and the real engine still runs.
 */
interface DictationTestHook {
  fake: { text: string; error?: string } | null
  samples: Float32Array | null
}
Object.defineProperty(window, '__dictationTest', { value: { fake: null, samples: null } satisfies DictationTestHook })
// Read through window so the bundler cannot treat the hook as a constant: tests set it after load.
const hook = (): DictationTestHook => (window as unknown as { __dictationTest: DictationTestHook }).__dictationTest
const currentFake = (): DictationTestHook['fake'] => hook().fake

type Target = { kind: 'field'; element: HTMLInputElement | HTMLTextAreaElement } | { kind: 'terminal'; paneId: string; tabId: string }

let engine: DictationEngine | null = null
let recorder: Recorder | null = null
let target: Target | null = null
let run = 0
let starting = false
let pointerFocus: { element: Element | null; at: number } = { element: null, at: 0 }

// Clicking the pane's mic button moves focus to the pane before the click lands, so remember what had focus when the pointer went down.
document.addEventListener('pointerdown', (event) => {
  if ((event.target as Element | null)?.closest('.pane-mic')) pointerFocus = { element: document.activeElement, at: Date.now() }
}, true)

function fieldAt(element: Element | null): HTMLInputElement | HTMLTextAreaElement | null {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return null
  const field = { tagName: element.tagName, type: element instanceof HTMLInputElement ? element.type : undefined, readOnly: element.readOnly, disabled: element.disabled, insideTerminal: element.closest('.xterm') !== null }
  return isTextField(field) ? element : null
}

function chooseTarget(): Target | null {
  const recent = Date.now() - pointerFocus.at < POINTER_FOCUS_MS ? pointerFocus.element : null
  const field = fieldAt(document.activeElement) ?? fieldAt(recent)
  if (field) return { kind: 'field', element: field }
  return terminalTarget()
}

function terminalTarget(): Target | null {
  const state = store.state
  const pane = paneById(state, state.focusedId)
  const tab = pane?.tabs.find((t) => t.id === pane.activeTabId)
  return pane && tab ? { kind: 'terminal', paneId: pane.id, tabId: tab.id } : null
}

function ensureEngine(): DictationEngine {
  engine ??= new WorkerEngine()
  return engine
}

function fakeEngine(fake: { text: string; error?: string }): DictationEngine {
  return {
    transcribe: async () => {
      if (fake.error) throw new Error(fake.error)
      return fake.text
    }
  }
}

function insertIntoField(element: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  const start = element.selectionStart ?? element.value.length
  const end = element.selectionEnd ?? start
  const next = insertAtCaret(element.value, start, end, text)
  element.focus()
  element.value = next.value
  element.dispatchEvent(new Event('input', { bubbles: true }))
  try {
    element.setSelectionRange(next.caret, next.caret)
  } catch {
    // Some input types (email) have no caret to restore.
  }
}

function insertIntoTerminal(paneId: string, tabId: string, text: string): boolean {
  const tab = paneById(store.state, paneId)?.tabs.find((t) => t.id === tabId)
  const view = getTerminal(tabId)
  if (!tab || !view) {
    toast('The session you were dictating into is gone. Click a session and try again.')
    return false
  }
  if (tab.status === 'exited') {
    toast(`${tab.label} has exited. Restart it before dictating.`)
    return false
  }
  view.insertText(text)
  view.focus()
  return true
}

function deliver(text: string, chosen: Target): void {
  if (chosen.kind === 'field') {
    if (chosen.element.isConnected) insertIntoField(chosen.element, text)
    else toast(`The text box you were dictating into is gone, so nothing was inserted. You said: ${text}`)
    return
  }
  if (insertIntoTerminal(chosen.paneId, chosen.tabId, text)) toast('Dictated text added. Press Enter to send it.', 'info')
}

function describeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (error instanceof MicError) return message
  if (!navigator.onLine) return 'Dictation needs an internet connection the first time, to download the speech model. Connect, then try again. After that it works offline.'
  if (/fetch|network|load failed|download|huggingface|failed to/i.test(message)) {
    return `The speech model could not be downloaded (${message}). Check your connection and try again.`
  }
  return `Dictation failed: ${message}`
}

export async function startDictation(): Promise<void> {
  const chosen = chooseTarget()
  if (!chosen) {
    toast('Open a session, or click a text box, then start dictation.', 'info')
    return
  }
  const id = ++run
  target = chosen
  const paneId = store.state.focusedId
  starting = true
  try {
    if (!currentFake() && !hook().samples) recorder = await Recorder.start(() => void finishDictation())
  } catch (error) {
    if (id === run) toast(describeFailure(error))
    return
  } finally {
    starting = false
  }
  if (id !== run) {
    recorder?.cancel()
    recorder = null
    return
  }
  setDictationStatus({ phase: 'recording', paneId, intoField: chosen.kind === 'field', progress: null })
  if (recorder) ensureEngine().prepare?.(store.state.settings.dictation.model)
}

export async function finishDictation(): Promise<void> {
  if (dictationStatus().phase !== 'recording' || !target) return
  const id = run
  const chosen = target
  const fake = currentFake()
  const audio = fake ? new Float32Array(MIN_SAMPLES) : (hook().samples?.slice() ?? recorder?.stop() ?? new Float32Array(0))
  recorder = null
  if (audio.length < MIN_SAMPLES) {
    resetDictationStatus()
    toast('Nothing was recorded. Speak for a little longer, then finish.', 'info')
    return
  }
  const settings = store.state.settings.dictation
  setDictationStatus({ phase: 'transcribing' })
  try {
    const text = await (fake ? fakeEngine(fake) : ensureEngine()).transcribe(audio, settings, (progress) => {
      if (id !== run || progress.total <= 0) return
      setDictationStatus({ phase: 'loading', progress: Math.min(1, progress.loaded / progress.total) })
    })
    if (id !== run) return
    resetDictationStatus()
    if (text === '') toast('No speech was detected. Try again a bit closer to the microphone.', 'info')
    else deliver(text, chosen)
  } catch (error) {
    if (id !== run) return
    resetDictationStatus()
    toast(describeFailure(error))
  }
}

export function cancelDictation(): boolean {
  if (dictationStatus().phase === 'idle' && !starting) return false
  run += 1
  recorder?.cancel()
  recorder = null
  target = null
  resetDictationStatus()
  return true
}

// Closing the pane or tab that was going to receive the text ends the recording, so the microphone never stays open unseen.
store.subscribe(() => {
  if (target?.kind !== 'terminal' || dictationStatus().phase === 'idle') return
  const { paneId, tabId } = target
  if (!paneById(store.state, paneId)?.tabs.some((t) => t.id === tabId)) cancelDictation()
})

export async function toggleDictation(): Promise<void> {
  const { phase } = dictationStatus()
  if (starting) return
  if (phase === 'recording') return finishDictation()
  if (phase === 'idle') return startDictation()
  toast('Still transcribing the last recording. Press Esc to cancel it.', 'info')
}
