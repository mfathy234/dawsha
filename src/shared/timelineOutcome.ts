import { isRecord, parseJson, type Json } from './transcript'

export interface Outcome { output: string; failed: boolean; exitCode?: number; patch?: Json[] }
const str = (value: unknown): string => typeof value === 'string' ? value : ''
const failureText = (output: string): boolean => /^(?:error:|apply_patch verification failed:|failed to (?:apply|write|edit)|permission denied)/im.test(output.trim())

export function codexOutput(raw: unknown): Outcome {
  const value = parseJson(raw)
  if (isRecord(value)) {
    const metadata = isRecord(value.metadata) ? value.metadata : {}
    const exitCode = typeof metadata.exit_code === 'number' ? metadata.exit_code : undefined
    const output = str(value.output) || str(value.error)
    return { output, failed: value.isError === true || value.is_error === true || value.error !== undefined || (exitCode !== undefined && exitCode !== 0) || failureText(output), exitCode }
  }
  const output = str(value)
  const match = /Exit code:\s*(-?\d+)/.exec(output)
  const exitCode = match ? Number(match[1]) : undefined
  return { output, failed: (exitCode !== undefined && exitCode !== 0) || failureText(output), exitCode }
}

export function geminiResult(call: Json): Outcome {
  const results = Array.isArray(call.result) ? call.result : []
  const outputs = results.map((entry) => {
    const response = isRecord(entry) && isRecord(entry.functionResponse) && isRecord(entry.functionResponse.response) ? entry.functionResponse.response : {}
    return str(response.output) || str(response.error)
  })
  const failed = call.status === 'error' || call.status === 'cancelled'
  return { output: outputs.join('\n') || str(call.resultDisplay), failed }
}
