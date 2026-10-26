import { watch, type FSWatcher } from 'node:fs'
import { normalizeFolder } from '../shared/folderKey'

const DEBOUNCE_MS = 300
const MAX_PENDING = 1000
const IGNORED = new Set(['.git', 'node_modules'])

const ignored = (rel: string): boolean => rel.split(/[\\/]/).some((part) => IGNORED.has(part))

// Watches a project folder and reports the changed relative paths in one batch after changes settle.
// A batch of more than MAX_PENDING paths is reported as [], which means "refresh everything".
// A watcher error closes it and calls onError once. Returns a function that stops the watcher.
export function watchProject(
  folder: string,
  onChange: (paths: string[]) => void,
  debounceMs = DEBOUNCE_MS,
  onError: (error: Error) => void = () => undefined,
  maxPending = MAX_PENDING
): () => void {
  const pending = new Set<string>()
  let overflow = false
  let timer: NodeJS.Timeout | null = null
  let watcher: FSWatcher | null = null
  try {
    watcher = watch(folder, { recursive: true }, (_event, name) => {
      if (!name) return
      const rel = `${name}`.replace(/\\/g, '/')
      if (ignored(rel)) return
      if (pending.size >= maxPending) overflow = true
      else pending.add(rel)
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        const paths = overflow ? [] : [...pending].sort()
        pending.clear()
        overflow = false
        onChange(paths)
      }, debounceMs)
    })
    watcher.on('error', (error) => {
      stop()
      onError(error)
    })
  } catch (error) {
    watcher = null
    onError(error as Error)
  }
  function stop(): void {
    if (timer) clearTimeout(timer)
    timer = null
    pending.clear()
    watcher?.close()
    watcher = null
  }
  return stop
}

// One watcher per folder, shared by every caller; it closes when the last caller unwatches.
// Folders are keyed (and reported to emit) in their normalized form.
export function createWatchRegistry(
  emit: (folderKey: string, paths: string[]) => void,
  start: typeof watchProject = watchProject,
  log: (message: string) => void = (message) => console.warn(message),
  onFailed: (folderKey: string) => void = () => undefined
): { watch(folder: string): void; unwatch(folder: string): void; closeAll(): void } {
  const entries = new Map<string, { count: number; stop: () => void }>()
  return {
    watch(folder) {
      const key = normalizeFolder(folder)
      const entry = entries.get(key)
      if (entry) {
        entry.count += 1
        return
      }
      let failed = false
      const stop = start(
        folder,
        (paths) => emit(key, paths),
        DEBOUNCE_MS,
        (error) => {
          failed = true
          entries.get(key)?.stop()
          entries.delete(key)
          log(`[files] watcher for ${folder} failed: ${error.message}`)
          onFailed(key)
        }
      )
      if (!failed) entries.set(key, { count: 1, stop })
    },
    unwatch(folder) {
      const key = normalizeFolder(folder)
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
