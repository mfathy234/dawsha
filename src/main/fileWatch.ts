import { watch, type FSWatcher } from 'node:fs'
import { resolve } from 'node:path'

const DEBOUNCE_MS = 300
const IGNORED = new Set(['.git', 'node_modules'])

const ignored = (rel: string): boolean => rel.split(/[\\/]/).some((part) => IGNORED.has(part))

// Watches a project folder and reports the changed relative paths in one batch after changes settle.
// Returns a function that stops the watcher.
export function watchProject(folder: string, onChange: (paths: string[]) => void, debounceMs = DEBOUNCE_MS): () => void {
  const pending = new Set<string>()
  let timer: NodeJS.Timeout | null = null
  let watcher: FSWatcher | null = null
  try {
    watcher = watch(folder, { recursive: true }, (_event, name) => {
      if (!name) return
      const rel = `${name}`.replace(/\\/g, '/')
      if (ignored(rel)) return
      pending.add(rel)
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        const paths = [...pending].sort()
        pending.clear()
        onChange(paths)
      }, debounceMs)
    })
    watcher.on('error', () => undefined)
  } catch {
    watcher = null
  }
  return () => {
    if (timer) clearTimeout(timer)
    timer = null
    pending.clear()
    watcher?.close()
    watcher = null
  }
}

// One watcher per folder, shared by every caller; it closes when the last caller unwatches.
export function createWatchRegistry(
  emit: (folder: string, paths: string[]) => void,
  start: typeof watchProject = watchProject
): { watch(folder: string): void; unwatch(folder: string): void; closeAll(): void } {
  const entries = new Map<string, { count: number; stop: () => void }>()
  return {
    watch(folder) {
      const key = resolve(folder)
      const entry = entries.get(key)
      if (entry) {
        entry.count += 1
        return
      }
      entries.set(key, { count: 1, stop: start(key, (paths) => emit(folder, paths)) })
    },
    unwatch(folder) {
      const key = resolve(folder)
      const entry = entries.get(key)
      if (!entry) return
      entry.count -= 1
      if (entry.count > 0) return
      entry.stop()
      entries.delete(key)
    },
    closeAll() {
      for (const entry of entries.values()) entry.stop()
      entries.clear()
    }
  }
}
