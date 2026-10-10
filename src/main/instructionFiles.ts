import { randomBytes } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import {
  INSTRUCTION_MAX_BYTES,
  isInstructionName,
  type FileStamp,
  type InstructionRead,
  type InstructionWriteRequest,
  type InstructionWriteResult
} from '../shared/instructions'
import type { Project } from '../shared/types'

const same = (a: string, b: string): boolean => resolve(a).toLowerCase() === resolve(b).toLowerCase()

export function projectFolder(projects: Project[], folder: unknown): string | null {
  if (typeof folder !== 'string' || folder === '') return null
  const project = projects.find((p) => same(p.folder, folder))
  return project ? resolve(project.folder) : null
}

function stampOf(path: string): (FileStamp & { isFile: boolean }) | null {
  try {
    const stat = statSync(path)
    return { mtimeMs: stat.mtimeMs, size: stat.size, isFile: stat.isFile() }
  } catch {
    return null
  }
}

type Target = { ok: true; path: string } | { ok: false; message: string }

function targetOf(root: string, name: string): Target {
  const path = join(root, name)
  let link = false
  try {
    link = lstatSync(path).isSymbolicLink()
  } catch {
    return { ok: true, path }
  }
  if (!link) return { ok: true, path }
  let real: string
  try {
    real = realpathSync(path)
  } catch {
    return { ok: false, message: `${name} is a link to a file that does not exist.` }
  }
  const inside = relative(realpathSync(root), real)
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
    return { ok: false, message: `${name} links to a file outside the project, so Dawsha leaves it alone.` }
  }
  return { ok: true, path: real }
}

export function readInstruction(projects: Project[], folder: unknown, name: unknown): InstructionRead {
  const root = projectFolder(projects, folder)
  if (!root || !isInstructionName(name)) return { ok: false, message: 'That file is not part of a Dawsha project.' }
  const target = targetOf(root, name)
  if (!target.ok) return { ok: false, message: target.message }
  const path = target.path
  const stamp = stampOf(path)
  if (!stamp) return { ok: true, exists: false, content: '', size: 0, mtimeMs: 0 }
  if (!stamp.isFile) return { ok: false, message: `${name} is not a regular file.` }
  if (stamp.size > INSTRUCTION_MAX_BYTES) {
    return { ok: false, message: `${name} is larger than ${INSTRUCTION_MAX_BYTES / 1024} KB. Open it in an editor instead.` }
  }
  try {
    return { ok: true, exists: true, content: readFileSync(path, 'utf8'), size: stamp.size, mtimeMs: stamp.mtimeMs }
  } catch (error) {
    return { ok: false, message: `Could not read ${name}: ${(error as Error).message}` }
  }
}

const failure = (reason: 'changed' | 'invalid' | 'toolarge' | 'error', message: string): InstructionWriteResult => ({
  ok: false,
  reason,
  message
})

function changedOnDisk(path: string, expected: FileStamp | null): boolean {
  const current = stampOf(path)
  if (expected === null) return current !== null
  return !current || current.mtimeMs !== expected.mtimeMs || current.size !== expected.size
}

export function writeInstruction(projects: Project[], request: InstructionWriteRequest): InstructionWriteResult {
  const root = projectFolder(projects, request?.folder)
  if (!root || !isInstructionName(request?.name) || typeof request.content !== 'string') {
    return failure('invalid', 'That file is not part of a Dawsha project.')
  }
  const { name, content } = request
  if (Buffer.byteLength(content, 'utf8') > INSTRUCTION_MAX_BYTES) {
    return failure('toolarge', `${name} would be larger than ${INSTRUCTION_MAX_BYTES / 1024} KB.`)
  }
  const target = targetOf(root, name)
  if (!target.ok) return failure('invalid', target.message)
  const path = target.path
  const current = stampOf(path)
  if (current && !current.isFile) return failure('invalid', `${name} is not a regular file.`)
  if (!request.overwrite && changedOnDisk(path, request.expected ?? null)) {
    return failure('changed', `${name} changed on disk since you opened it.`)
  }
  const temp = join(dirname(path), `.${basename(path)}.dawsha-${randomBytes(4).toString('hex')}.tmp`)
  try {
    writeFileSync(temp, content, 'utf8')
    renameSync(temp, path)
  } catch (error) {
    if (existsSync(temp)) rmSync(temp, { force: true })
    return failure('error', `Could not save ${name}: ${(error as Error).message}`)
  }
  const saved = stampOf(path)
  return { ok: true, size: saved?.size ?? 0, mtimeMs: saved?.mtimeMs ?? 0 }
}
