import { DICTATION_MAX_SAMPLES, DICTATION_SAMPLE_RATE, joinChunks, levelFromRms, peakOf, resample, rmsOf, SILENCE_PEAK } from '../../shared/dictation'

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
  /** Loudest sample so far; 0 for a muted or switched-off microphone. */
  peak = 0
  /** Loudness of the latest chunk, 0 to 1, for a level meter. */
  level = 0
  /** When the microphone last delivered more than silence (or when recording started). */
  lastSoundAt = Date.now()
  /** Whether the chosen microphone was missing and the system default is used instead. */
  fellBack = false

  private constructor(
    /** The microphone's name as the system reports it. */
    readonly label: string,
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
      const peak = peakOf(chunk)
      this.peak = Math.max(this.peak, peak)
      this.level = levelFromRms(rmsOf(chunk))
      if (peak > SILENCE_PEAK) this.lastSoundAt = Date.now()
      this.chunks.push(chunk)
      this.samples += chunk.length
      if (this.samples >= DICTATION_MAX_SAMPLES) onLimit()
    }
    source.connect(node)
    node.connect(context.destination)
  }

  /** Opens `deviceId` ('' for the system default); a chosen microphone that is gone falls back to the default. */
  static async start(onLimit: () => void, deviceId = ''): Promise<Recorder> {
    const constraints = (id: string): MediaStreamConstraints => ({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, ...(id ? { deviceId: { exact: id } } : {}) }
    })
    let stream: MediaStream
    let fellBack = false
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints(deviceId))
    } catch (error) {
      const name = (error as { name?: string })?.name
      if (!deviceId || (name !== 'NotFoundError' && name !== 'OverconstrainedError')) throw classify(error)
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints(''))
        fellBack = true
      } catch (fallbackError) {
        throw classify(fallbackError)
      }
    }
    let context: AudioContext | null = null
    try {
      context = new AudioContext({ sampleRate: DICTATION_SAMPLE_RATE })
      const source = context.createMediaStreamSource(stream)
      const node = context.createScriptProcessor(4096, 1, 1)
      const recorder = new Recorder(stream.getAudioTracks()[0]?.label || 'the microphone', stream, context, node, source, onLimit)
      recorder.fellBack = fellBack
      return recorder
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
