import type { AgentKind } from '../shared/types'
import { stat } from 'node:fs/promises'
import { Worker } from 'node:worker_threads'
import { ACTIVE_GAP_MS } from '../shared/sessionDetail'

/** Self-contained so the bundled app can launch it without another entry point. */
async function streamSpans(): Promise<void> {
  const { parentPort, workerData } = require('node:worker_threads') as typeof import('node:worker_threads')
  const { createReadStream } = require('node:fs') as typeof import('node:fs')
  const { createInterface } = require('node:readline') as typeof import('node:readline')
  const { path, agent, gap } = workerData as { path: string; agent: AgentKind; gap: number }
  const times: number[] = []
  const time = (value: unknown): void => {
    if (typeof value !== 'string') return
    const at = Date.parse(value)
    if (Number.isFinite(at)) times.push(at)
  }
  const record = (value: unknown): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    const row = value as Record<string, unknown>
    time(row.timestamp)
    if (agent === 'codex' && row.type === 'session_meta') time((row.payload as Record<string, unknown> | undefined)?.timestamp)
    if (agent === 'gemini') {
      const meta = (row.$set ?? row) as Record<string, unknown>
      time(meta.startTime)
      time(meta.lastUpdated)
      if (Array.isArray(row.messages)) for (const message of row.messages) {
        if (message && typeof message === 'object') time((message as Record<string, unknown>).timestamp)
      }
    }
  }
  const input = createReadStream(path, { encoding: 'utf8' })
  if (agent === 'gemini' && path.endsWith('.json')) {
    // Legacy Gemini is one JSON document, sometimes on one enormous line.
    // Tokenize strings incrementally, retaining only short keys/date values.
    let quoted = false, escaped = false, token = '', previous = '', key = '', isKey = false
    for await (const chunk of input) {
      for (const char of chunk as string) {
        if (quoted) {
          if (escaped) { if (token.length < 128) token += `\\${char}`; escaped = false }
          else if (char === '\\') escaped = true
          else if (char === '"') {
            quoted = false
            let value = ''
            try { value = JSON.parse(`"${token}"`) as string } catch { /* Not a date/key. */ }
            if (isKey) key = value
            else if (previous === ':' && ['timestamp', 'startTime', 'lastUpdated'].includes(key)) time(value)
            previous = '"'
          } else if (token.length < 128) token += char
        } else if (char === '"') {
          quoted = true; token = ''; isKey = previous === '{' || previous === ','
        } else if (!/\s/.test(char)) previous = char
      }
    }
  } else {
    const lines = createInterface({ input, crlfDelay: Infinity })
    // readline does not forward input errors to its async iterator.
    input.on('error', error => lines.emit('error', error))
    try {
      for await (const line of lines) {
        try { record(JSON.parse(line)) } catch { /* Partial or malformed JSONL record. */ }
      }
    } finally { lines.close(); input.destroy() }
  }
  times.sort((a, b) => a - b)
  const spans: [number, number][] = []
  for (const at of times) {
    const last = spans.at(-1)
    if (last && at - last[1] <= gap) last[1] = at
    else spans.push([at, at])
  }
  parentPort!.postMessage(spans.map(([start, end]) => [start, Math.max(end, start + 60_000)]))
}

function readSpans(path: string, agent: AgentKind): Promise<[number, number][]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(`(${streamSpans.toString()})().catch(error => { throw error })`, {
      eval: true, workerData: { path, agent, gap: ACTIVE_GAP_MS }
    })
    worker.once('message', resolve)
    worker.once('error', reject)
    worker.once('exit', () => reject(new Error('Could not read session activity.')))
  })
}

export class WorkSpanReader {
  private readonly cache = new Map<string, { key: string; job: Promise<[number, number][]> }>()
  constructor(private readonly limit = 5000) {}

  async read(path: string, agent: AgentKind): Promise<[number, number][]> {
    const info = await stat(path)
    const key = `${agent}:${info.size}:${info.mtimeMs}`
    const cached = this.cache.get(path)
    if (cached?.key === key) return cached.job
    const job = readSpans(path, agent)
    this.cache.delete(path)
    if (this.cache.size >= this.limit) this.cache.delete(this.cache.keys().next().value!)
    this.cache.set(path, { key, job })
    job.catch(() => { if (this.cache.get(path)?.job === job) this.cache.delete(path) })
    return job
  }
}
