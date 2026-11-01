import { Worker } from 'node:worker_threads'
import type { CodeNavHit } from '../../shared/codeNav'
import { SYMBOL_DISCOVERY_SOURCE } from './symbolDiscoverySource'

export interface ChangedSymbol extends CodeNavHit { name: string; endLine: number }
interface Options { limit?: number; deadline?: number; names?: string[] }

/** Parsing runs in a disposable Node worker, so even pathological files cannot block IPC or its deadline. */
export function changedSymbols(path: string, text: string, lines: ReadonlySet<number>, options: Options = {}): Promise<ChangedSymbol[]> {
  const remaining = (options.deadline ?? Date.now() + 5000) - Date.now()
  if (remaining <= 0) return Promise.resolve([])
  return new Promise((resolve, reject) => {
    const worker = new Worker(SYMBOL_DISCOVERY_SOURCE, {
      eval: true,
      workerData: { path, text, lines: [...lines], limit: options.limit ?? 101, names: options.names ?? [], typescript: require.resolve('typescript').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1') },
      resourceLimits: { maxOldGenerationSizeMb: 256 }
    })
    const timer = setTimeout(() => { void worker.terminate(); resolve([]) }, remaining)
    worker.once('message', (symbols: ChangedSymbol[]) => { clearTimeout(timer); void worker.terminate(); resolve(symbols) })
    worker.once('error', error => { clearTimeout(timer); reject(error) })
    worker.once('exit', code => { clearTimeout(timer); if (code !== 0) resolve([]) })
  })
}
