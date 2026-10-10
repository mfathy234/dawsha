import { appendFileSync } from 'node:fs'

export type QuitLog = (message: string) => void

export function createQuitLog(path: string | undefined = process.env.DAWSHA_QUIT_LOG): QuitLog {
  if (!path) return () => undefined
  const started = Date.now()
  return (message) => {
    try {
      appendFileSync(path, `${new Date().toISOString()} +${Date.now() - started}ms pid=${process.pid} ${message}\n`, 'utf8')
    } catch {
      return
    }
  }
}
