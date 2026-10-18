import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'
import { cleanTranscript, modelInfo, modelRepo, whisperLanguage, type DictationModel } from '../../shared/dictation'
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
// Download progress goes to the transcription that is waiting for the model, also when a prepare started the download.
let progressListener: ((progress: LoadProgress) => void) | null = null

const reply = (message: WorkerResponse): void => (self as unknown as Worker).postMessage(message)

type GpuSupport = 'none' | 'gpu' | 'gpuF16'

async function webGpuSupport(): Promise<GpuSupport> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu
  if (!gpu) return 'none'
  try {
    const adapter = await gpu.requestAdapter()
    if (!adapter) return 'none'
    return adapter.features.has('shader-f16') ? 'gpuF16' : 'gpu'
  } catch {
    return 'none'
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

async function build(model: DictationModel, support: GpuSupport, report: (progress: LoadProgress) => void): Promise<Loaded> {
  const info = modelInfo(model)
  const device: Device = support === 'none' ? 'wasm' : 'webgpu'
  const dtype = support === 'none' ? info.cpu : info[support]
  const transcriber = (await pipeline('automatic-speech-recognition', modelRepo(model), {
    device,
    dtype: dtype as never,
    progress_callback: progressTracker(report) as never
  })) as AutomaticSpeechRecognitionPipeline
  return { model, device, transcriber }
}

const report = (progress: LoadProgress): void => progressListener?.(progress)

async function load(model: DictationModel): Promise<Loaded> {
  if (loaded?.model === model) return loaded
  if (loading && loadingModel === model) return loading
  loadingModel = model
  loading = (async () => {
    const previous = loaded
    loaded = null
    await previous?.transcriber.dispose().catch(() => undefined)
    const support = webGpuBroken ? 'none' : await webGpuSupport()
    if (support !== 'none') {
      try {
        return await build(model, support, report)
      } catch {
        // WebGPU can be present but unusable (driver, blocklist, unsupported operator); fall through to WASM.
      }
    }
    return build(model, 'none', report)
  })()
  try {
    loaded = await loading
    return loaded
  } finally {
    loading = null
    loadingModel = null
  }
}

type TranscribeRequest = Extract<WorkerRequest, { type: 'transcribe' }>

async function run(request: TranscribeRequest): Promise<void> {
  const { id, audio, options } = request
  progressListener = (progress) => reply({ type: 'progress', id, progress })
  const engine = await load(options.model).finally(() => (progressListener = null))
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

async function transcribe(request: TranscribeRequest): Promise<void> {
  try {
    await run(request)
  } catch (error) {
    reply({ type: 'error', id: request.id, message: error instanceof Error ? error.message : String(error) })
  }
}

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data
  if (request.type === 'transcribe') queue = queue.then(() => transcribe(request))
  // Not queued: loading starts at once and a transcribe that follows waits on the same load.
  else void load(request.model).catch(() => undefined)
})
