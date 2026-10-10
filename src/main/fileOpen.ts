import { spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { shell } from 'electron'
import { MAX_FILE_CANDIDATES, MAX_FILE_PATH_LENGTH, gotoTarget, isSafeToOpen, type FileRef } from '../shared/filePaths'
import { logTo } from './desktop'

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

const isNetworkPath = (path: string): boolean => /^[\\/]{2}/.test(path)

export function resolveFile(folder: string, candidate: unknown): string | null {
  if (typeof folder !== 'string' || !isAbsolute(folder) || isNetworkPath(folder)) return null
  if (typeof candidate !== 'string' || candidate === '' || candidate.length > MAX_FILE_PATH_LENGTH) return null
  if (isNetworkPath(candidate)) return null
  const trimmed = candidate.replace(/[. ]+$/, '')
  if (trimmed === '') return null
  const absolute = isAbsolute(trimmed)
  const full = absolute ? resolve(trimmed) : resolve(folder, trimmed)
  if (!absolute) {
    const inside = relative(resolve(folder), full)
    if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) return null
  }
  return isFile(full) ? full : null
}

export function existingFiles(folder: string, candidates: unknown): (string | null)[] {
  if (!Array.isArray(candidates)) return []
  return candidates.slice(0, MAX_FILE_CANDIDATES).map((candidate) => resolveFile(folder, candidate))
}

function launchEditor(target: string, onFailure: () => void): void {
  if (/["%^&|<>\r\n]/.test(target)) return onFailure()
  const child = spawn(`code -g "${target}"`, { shell: true, detached: true, stdio: 'ignore', windowsHide: true })
  child.on('error', onFailure)
  child.on('exit', (code) => {
    if (code !== 0) onFailure()
  })
  child.unref()
}

export async function openFile(folder: string, ref: FileRef): Promise<void> {
  const full = resolveFile(folder, ref?.path)
  if (!full) return
  const line = Number.isInteger(ref.line) && (ref.line as number) > 0 ? ref.line : undefined
  const col = line !== undefined && Number.isInteger(ref.col) && (ref.col as number) > 0 ? ref.col : undefined
  const target = gotoTarget(full, { path: full, line, col })
  const log = process.env.DAWSHA_OPEN_LOG
  if (log) return logTo(log, JSON.stringify({ editor: 'code', goto: target }))
  const fallback = (): void => {
    if (isSafeToOpen(full)) void shell.openPath(full)
    else shell.showItemInFolder(full)
  }
  launchEditor(target, fallback)
}
