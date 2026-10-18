import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'
import { cleanTranscript, modelRepo, whisperLanguage, type DictationModel } from '../../shared/dictation'
import { detectLanguage } from './languageDetect'
import type { LoadProgress, WorkerRequest, WorkerResponse } from './protocol'
import ortModule from '../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs?url'
import ortBinary from '../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm?url'

// Everything the engine needs is bundled or cached: ONNX Runtime's WASM ships with the app, and the model files
// are fetched once from Hugging Face into the browser Cache Storage under the app's user data folder.
env.allowLocalModels = false
env.useBrowserCache = true
env.useWasmCache = false
const wasm = env.backends.onnx.wasm
if (wasm) {
  wasm.wasmPaths = { mjs: new URL(ortModule, self.location.href).href, wasm: new URL(ortBinary, self.location.href).href }
  wasm.numThreads = 1
  wasm.proxy = false
}

type Device = 'webgpu' | 'wasm'
interface Loaded {
  model: DictationModel
  device: Device
  transcriber: AutomaticSpeechRecognitionPipeline
}

let loaded: Loaded | null = null
let loading: Promise<Loaded> | null = null
let loadingModel: DictationModel | null = null
let queue: Promise<void> = Promise.resolve()
let webGpuBroken = false

const reply = (message: WorkerResponse): void => (self as unknown as Worker).postMessage(message)

async function webGpuAvailable(): Promise<boolean> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown | null> } }).gpu
  if (!gpu) return false
  try {
    return (await gpu.requestAdapter()) !== null
  } catch {
    return false
  }
}

function progressTracker(report: (progress: LoadProgress) => void): (event: { status: string; file?: string; loaded?: number; total?: number }) => void {
  const files = new Map<string, LoadProgress>()
  return (event) => {
    if (!event.file || event.status !== 'progress' || !event.total) return
    files.set(event.file, { loaded: event.loaded ?? 0, total: event.total })
    let loadedBytes = 0
    let totalBytes = 0
    for (const file of files.values()) {
      loadedBytes += file.loaded
      totalBytes += file.total
    }
    report({ loaded: loadedBytes, total: totalBytes })
  }
}

async function build(model: DictationModel, device: Device, report: (progress: LoadProgress) => void): Promise<Loaded> {
  const dtype = device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8'
  const transcriber = (await pipeline('automatic-speech-recognition', modelRepo(model), {
    device,
    dtype: dtype as never,
    progress_callback: progressTracker(report) as never
  })) as AutomaticSpeechRecognitionPipeline
  return { model, device, transcriber }
}

async function load(model: DictationModel, report: (progress: LoadProgress) => void): Promise<Loaded> {
  if (loaded?.model === model) return loaded
  if (loading && loadingModel === model) return loading
  loadingModel = model
  loading = (async () => {
    const previous = loaded
    loaded = null
    await previous?.transcriber.dispose().catch(() => undefined)
    if (!webGpuBroken && (await webGpuAvailable())) {
      try {
        return await build(model, 'webgpu', report)
      } catch {
        // WebGPU can be present but unusable (driver, blocklist, unsupported operator); fall through to WASM.
      }
    }
    return build(model, 'wasm', report)
  })()
  try {
    loaded = await loading
    return loaded
  } finally {
    loading = null
    loadingModel = null
  }
}

async function run(request: WorkerRequest): Promise<void> {
  const { id, audio, options } = request
  const engine = await load(options.model, (progress) => reply({ type: 'progress', id, progress }))
  try {
    const chosen = options.language === 'auto' ? await detectLanguage(engine.transcriber, audio) : options.language
    const result = await engine.transcriber(audio, {
      task: 'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false,
      language: whisperLanguage(chosen) ?? undefined
    })
    const text = Array.isArray(result) ? result.map((r) => r.text).join(' ') : result.text
    reply({ type: 'result', id, text: cleanTranscript(text), device: engine.device })
  } catch (error) {
    if (engine.device !== 'webgpu') throw error
    // The GPU session loaded but cannot run (driver, device lost, unsupported operator): retry once on WASM.
    webGpuBroken = true
    loaded = null
    await engine.transcriber.dispose().catch(() => undefined)
    await run(request)
  }
}

async function transcribe(request: WorkerRequest): Promise<void> {
  try {
    await run(request)
  } catch (error) {
    reply({ type: 'error', id: request.id, message: error instanceof Error ? error.message : String(error) })
  }
}

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  if (event.data.type === 'transcribe') queue = queue.then(() => transcribe(event.data))
})
