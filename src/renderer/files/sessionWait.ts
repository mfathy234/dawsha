export interface WaitOptions {
  timeoutMs: number
  stepMs: number
  sleep: (ms: number) => Promise<void>
}

/** Polls until the check passes; false when the timeout came first. */
export async function waitUntil(ready: () => boolean, { timeoutMs, stepMs, sleep }: WaitOptions): Promise<boolean> {
  for (let waited = 0; waited <= timeoutMs; waited += stepMs) {
    if (ready()) return true
    await sleep(stepMs)
  }
  return ready()
}

/** A new session is ready for text once it has printed something and then gone quiet; a timeout is not a failure. */
export async function waitForSessionOutput(lastOutputAt: () => number | undefined, now: () => number, options: WaitOptions, quietMs: number, settleTimeoutMs: number): Promise<boolean> {
  const printed = await waitUntil(() => lastOutputAt() !== undefined, options)
  if (!printed) return false
  return waitUntil(() => now() - (lastOutputAt() ?? 0) >= quietMs, { ...options, timeoutMs: settleTimeoutMs })
}
