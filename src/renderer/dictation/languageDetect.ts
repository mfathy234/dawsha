import { Tensor, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'
import type { DictationLanguage } from '../../shared/dictation'

const WHISPER_WINDOW_SAMPLES = 16_000 * 30

type Candidate = Exclude<DictationLanguage, 'auto'>

interface WhisperInternals {
  processor: (audio: Float32Array) => Promise<{ input_features: unknown }>
  model: ((inputs: Record<string, unknown>) => Promise<{ logits: { data: ArrayLike<number>; dims: number[] } }>) & {
    generation_config: { decoder_start_token_id: number; lang_to_id: Record<string, number> }
  }
}

/**
 * Transformers.js has no language detection and silently assumes English, which would turn Arabic speech into
 * English guesses. Whisper predicts the language token right after the start token, so run one decoder step and
 * compare the two languages this app supports.
 */
export async function detectLanguage(transcriber: AutomaticSpeechRecognitionPipeline, audio: Float32Array): Promise<Candidate> {
  const { processor, model } = transcriber as unknown as WhisperInternals
  const { decoder_start_token_id: start, lang_to_id: ids } = model.generation_config
  const arabic = ids['<|ar|>']
  const english = ids['<|en|>']
  if (start === undefined || arabic === undefined || english === undefined) return 'en'
  const { input_features } = await processor(audio.subarray(0, WHISPER_WINDOW_SAMPLES))
  const output = await model({ input_features, decoder_input_ids: new Tensor('int64', BigInt64Array.of(BigInt(start)), [1, 1]) })
  const vocab = output.logits.dims[output.logits.dims.length - 1]
  const last = (output.logits.dims[1] - 1) * vocab
  return output.logits.data[last + arabic] > output.logits.data[last + english] ? 'ar' : 'en'
}
