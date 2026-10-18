import type { DictationEngine, LoadProgress, TranscribeOptions, WorkerResponse } from './protocol'

/** Talks to the Whisper worker. The worker is created on first use and kept so the model stays loaded. */
export class WorkerEngine implements DictationEngine {
  private worker: Worker | null = null
  private nextId = 1
  private readonly pending = new Map<number, { resolve(text: string): void; reject(error: Error): void; progress(p: LoadProgress): void }>()

  transcribe(audio: Float32Array, options: TranscribeOptions, onProgress: (progress: LoadProgress) => void): Promise<string> {
    const worker = this.ensureWorker()
    const id = this.nextId++
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, progress: onProgress })
      worker.postMessage({ type: 'transcribe', id, audio, options }, [audio.buffer])
    })
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => this.onMessage(event.data))
    worker.addEventListener('error', (event) => this.fail(event.message || 'The speech engine stopped unexpectedly.'))
    this.worker = worker
    return worker
  }

  private onMessage(message: WorkerResponse): void {
    const entry = this.pending.get(message.id)
    if (!entry) return
    if (message.type === 'progress') return entry.progress(message.progress)
    this.pending.delete(message.id)
    if (message.type === 'result') entry.resolve(message.text)
    else entry.reject(new Error(message.message))
  }

  private fail(reason: string): void {
    this.worker?.terminate()
    this.worker = null
    for (const entry of this.pending.values()) entry.reject(new Error(reason))
    this.pending.clear()
  }
}
