import { DICTATION_MAX_SAMPLES, DICTATION_SAMPLE_RATE, joinChunks, resample } from '../../shared/dictation'

export type MicProblem = 'denied' | 'missing' | 'other'

export class MicError extends Error {
  constructor(readonly problem: MicProblem, message: string) {
    super(message)
  }
}

function classify(error: unknown): MicError {
  const name = (error as { name?: string })?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new MicError('denied', 'Microphone access was denied. Allow microphone access for Dawsha in your system privacy settings, then try again.')
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError') {
    return new MicError('missing', 'No microphone is available. Connect or enable one, then try again.')
  }
  return new MicError('other', `The microphone could not be started: ${(error as Error)?.message ?? 'unknown error'}`)
}

/**
 * Captures mono Float32 audio at 16 kHz into memory only. Nothing is written to disk.
 * ScriptProcessor is deprecated but needs no extra script, so it works under the strict script CSP.
 */
export class Recorder {
  private readonly chunks: Float32Array[] = []
  private samples = 0
  private ended = false

  private constructor(
    private readonly stream: MediaStream,
    private readonly context: AudioContext,
    private readonly node: ScriptProcessorNode,
    private readonly source: MediaStreamAudioSourceNode,
    onLimit: () => void
  ) {
    node.onaudioprocess = (event) => {
      if (this.ended) return
      const input = event.inputBuffer.getChannelData(0)
      const chunk = context.sampleRate === DICTATION_SAMPLE_RATE ? input.slice() : resample(input, context.sampleRate)
      this.chunks.push(chunk)
      this.samples += chunk.length
      if (this.samples >= DICTATION_MAX_SAMPLES) onLimit()
    }
    source.connect(node)
    node.connect(context.destination)
  }

  static async start(onLimit: () => void): Promise<Recorder> {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
    } catch (error) {
      throw classify(error)
    }
    let context: AudioContext | null = null
    try {
      context = new AudioContext({ sampleRate: DICTATION_SAMPLE_RATE })
      const source = context.createMediaStreamSource(stream)
      const node = context.createScriptProcessor(4096, 1, 1)
      return new Recorder(stream, context, node, source, onLimit)
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop())
      void context?.close().catch(() => undefined)
      throw classify(error)
    }
  }

  /** Stops capturing and returns everything recorded (at most 120 s). */
  stop(): Float32Array {
    this.release()
    return joinChunks(this.chunks)
  }

  cancel(): void {
    this.release()
    this.chunks.length = 0
  }

  private release(): void {
    if (this.ended) return
    this.ended = true
    this.node.onaudioprocess = null
    this.source.disconnect()
    this.node.disconnect()
    this.stream.getTracks().forEach((track) => track.stop())
    void this.context.close().catch(() => undefined)
  }
}
