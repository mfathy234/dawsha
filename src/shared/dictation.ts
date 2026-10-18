export type DictationLanguage = 'auto' | 'ar' | 'en'
export type DictationModel = 'base' | 'small' | 'turbo'

export interface DictationSettings {
  language: DictationLanguage
  model: DictationModel
  /** Device id of the microphone to use; '' means the system default. */
  microphone: string
  /** Whether the first-use card (local processing, model size) has been shown. */
  introShown: boolean
}

export const DICTATION_SHORTCUT = 'Ctrl+Shift+Space'
export const DICTATION_SAMPLE_RATE = 16_000
export const DICTATION_MAX_SECONDS = 120
export const DICTATION_MAX_SAMPLES = DICTATION_SAMPLE_RATE * DICTATION_MAX_SECONDS
/** Below this peak (about -60 dBFS) a recording is silence: a muted or switched-off microphone sends exact zeros. */
export const SILENCE_PEAK = 0.001
/** How long the microphone may stay silent while listening before the indicator says so. */
export const QUIET_HINT_MS = 2000
const MAX_DEVICE_ID = 512

export const DICTATION_LANGUAGES: { id: DictationLanguage; label: string }[] = [
  { id: 'auto', label: 'Auto-detect' },
  { id: 'ar', label: 'Arabic' },
  { id: 'en', label: 'English' }
]

/** ONNX precision per model file, as transformers.js takes it. */
export type ModelDtype = string | Record<string, string>

export interface DictationModelInfo {
  id: DictationModel
  repo: string
  label: string
  size: string
  /** On a GPU with 16-bit float shaders. */
  gpuF16: ModelDtype
  /** On any other GPU. */
  gpu: ModelDtype
  /** On the CPU (WASM). */
  cpu: ModelDtype
}

export const DICTATION_MODELS: DictationModelInfo[] = [
  {
    id: 'base',
    repo: 'onnx-community/whisper-base',
    label: 'Base (faster)',
    size: 'about 80 to 200 MB',
    gpuF16: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
    gpu: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
    cpu: 'q8'
  },
  {
    id: 'small',
    repo: 'onnx-community/whisper-small',
    label: 'Small (more accurate)',
    size: 'about 250 to 590 MB',
    gpuF16: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
    gpu: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
    cpu: 'q8'
  },
  {
    id: 'turbo',
    repo: 'onnx-community/whisper-large-v3-turbo',
    label: 'Large turbo (most accurate)',
    size: 'about 570 to 760 MB',
    gpuF16: { encoder_model: 'q4f16', decoder_model_merged: 'q4f16' },
    gpu: { encoder_model: 'q4', decoder_model_merged: 'q4' },
    cpu: { encoder_model: 'q4', decoder_model_merged: 'q4' }
  }
]

export const modelInfo = (model: DictationModel): DictationModelInfo => DICTATION_MODELS.find((m) => m.id === model) ?? DICTATION_MODELS[0]

export const defaultDictation = (): DictationSettings => ({ language: 'auto', model: 'turbo', microphone: '', introShown: false })

export const isDictationLanguage = (value: unknown): value is DictationLanguage => value === 'auto' || value === 'ar' || value === 'en'
export const isDictationModel = (value: unknown): value is DictationModel => DICTATION_MODELS.some((m) => m.id === value)

export function sanitizeDictation(value: unknown): DictationSettings {
  const defaults = defaultDictation()
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return defaults
  const raw = value as Record<string, unknown>
  return {
    language: isDictationLanguage(raw.language) ? raw.language : defaults.language,
    model: isDictationModel(raw.model) ? raw.model : defaults.model,
    microphone: typeof raw.microphone === 'string' && raw.microphone.length <= MAX_DEVICE_ID ? raw.microphone : defaults.microphone,
    introShown: raw.introShown === true
  }
}

export const modelRepo = (model: DictationModel): string => modelInfo(model).repo

/** Whisper takes a language name; leaving it out lets the model detect the language itself. */
export const whisperLanguage = (language: DictationLanguage): string | null => (language === 'ar' ? 'arabic' : language === 'en' ? 'english' : null)

/** The largest absolute sample value. */
export function peakOf(samples: Float32Array): number {
  let peak = 0
  for (const value of samples) peak = Math.max(peak, Math.abs(value))
  return peak
}

/** Root mean square of the samples. */
export function rmsOf(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (const value of samples) sum += value * value
  return Math.sqrt(sum / samples.length)
}

/** Loudness for a level meter, 0 to 1, on a decibel scale from -60 dBFS (silent) to -10 dBFS (loud speech). */
export function levelFromRms(rms: number): number {
  if (rms <= 0) return 0
  const db = 20 * Math.log10(rms)
  return Math.min(1, Math.max(0, (db + 60) / 50))
}

/** Averages interleaved or separate channels down to one. */
export function downmix(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0)
  if (channels.length === 1) return channels[0]
  const out = new Float32Array(channels[0].length)
  for (const channel of channels) for (let i = 0; i < out.length; i += 1) out[i] += channel[i] / channels.length
  return out
}

/** Linear-interpolation resampling; good enough for speech going into Whisper. */
export function resample(input: Float32Array, fromRate: number, toRate: number = DICTATION_SAMPLE_RATE): Float32Array {
  if (input.length === 0 || fromRate === toRate) return input
  const length = Math.max(1, Math.round((input.length * toRate) / fromRate))
  const out = new Float32Array(length)
  const ratio = fromRate / toRate
  for (let i = 0; i < length; i += 1) {
    const position = i * ratio
    const left = Math.min(input.length - 1, Math.floor(position))
    const right = Math.min(input.length - 1, left + 1)
    const weight = position - left
    out[i] = input[left] * (1 - weight) + input[right] * weight
  }
  return out
}

export function joinChunks(chunks: Float32Array[], maxSamples: number = DICTATION_MAX_SAMPLES): Float32Array {
  const total = Math.min(maxSamples, chunks.reduce((sum, chunk) => sum + chunk.length, 0))
  const out = new Float32Array(total)
  let offset = 0
  for (const chunk of chunks) {
    if (offset >= total) break
    const part = chunk.length + offset > total ? chunk.subarray(0, total - offset) : chunk
    out.set(part, offset)
    offset += part.length
  }
  return out
}

export const cleanTranscript = (text: string): string => text.replace(/\s+/g, ' ').trim()

export interface FieldLike {
  tagName: string
  type?: string
  readOnly?: boolean
  disabled?: boolean
  insideTerminal: boolean
}

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', ''])

/** True when dictated text can be typed into this element instead of the terminal. */
export function isTextField(field: FieldLike | null): boolean {
  if (!field || field.insideTerminal || field.readOnly || field.disabled) return false
  const tag = field.tagName.toUpperCase()
  if (tag === 'TEXTAREA') return true
  return tag === 'INPUT' && TEXT_INPUT_TYPES.has((field.type ?? '').toLowerCase())
}

export interface Insertion {
  value: string
  caret: number
}

/** Replaces the selection (or inserts at the caret) and reports where the caret should land. */
export function insertAtCaret(value: string, start: number, end: number, text: string): Insertion {
  const from = Math.max(0, Math.min(start, end, value.length))
  const to = Math.min(value.length, Math.max(start, end))
  return { value: value.slice(0, from) + text + value.slice(to), caret: from + text.length }
}
