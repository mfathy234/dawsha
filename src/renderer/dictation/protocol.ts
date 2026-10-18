import type { DictationLanguage, DictationModel } from '../../shared/dictation'

export interface TranscribeOptions {
  model: DictationModel
  language: DictationLanguage
}

/** Download progress for the speech model: bytes so far out of the total, once known. */
export interface LoadProgress {
  loaded: number
  total: number
}

export type WorkerRequest = { type: 'transcribe'; id: number; audio: Float32Array; options: TranscribeOptions }

export type WorkerResponse =
  | { type: 'progress'; id: number; progress: LoadProgress }
  | { type: 'result'; id: number; text: string; device: 'webgpu' | 'wasm' }
  | { type: 'error'; id: number; message: string }

export interface DictationEngine {
  transcribe(audio: Float32Array, options: TranscribeOptions, onProgress: (progress: LoadProgress) => void): Promise<string>
}
