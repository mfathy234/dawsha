import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readInstruction, writeInstruction } from '../../src/main/instructionFiles'
import { INSTRUCTION_MAX_BYTES } from '../../src/shared/instructions'

let root = ''
let folder = ''
const projects = () => [{ id: 'acme', name: 'acme-web', folder, defaultAgent: 'claude' as const }]

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dawsha-instr-'))
  folder = join(root, 'acme-web')
  mkdirSync(folder)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('readInstruction', () => {
  it('reads content and stamp, and reports a missing file as not existing', () => {
    writeFileSync(join(folder, 'CLAUDE.md'), 'a\r\nb')
    expect(readInstruction(projects(), folder, 'CLAUDE.md')).toMatchObject({ ok: true, exists: true, content: 'a\r\nb', size: 4 })
    expect(readInstruction(projects(), folder, 'AGENTS.md')).toMatchObject({ ok: true, exists: false, content: '' })
  })

  it('refuses other names and foreign folders', () => {
    writeFileSync(join(root, 'secret.md'), 'x')
    expect(readInstruction(projects(), folder, '..\secret.md').ok).toBe(false)
    expect(readInstruction(projects(), folder, 'README.md').ok).toBe(false)
    expect(readInstruction(projects(), root, 'CLAUDE.md').ok).toBe(false)
  })

  it('refuses a file over the size limit', () => {
    writeFileSync(join(folder, 'CLAUDE.md'), 'x'.repeat(INSTRUCTION_MAX_BYTES + 1))
    expect(readInstruction(projects(), folder, 'CLAUDE.md').ok).toBe(false)
  })
})

describe('writeInstruction', () => {
  const request = (over: Record<string, unknown>) => ({ folder, name: 'CLAUDE.md', content: 'new', expected: null, overwrite: false, ...over }) as any

  it('creates a missing file and leaves no temp file behind', () => {
    const result = writeInstruction(projects(), request({}))
    expect(result.ok).toBe(true)
    expect(readFileSync(join(folder, 'CLAUDE.md'), 'utf8')).toBe('new')
    expect(readdirSync(folder)).toEqual(['CLAUDE.md'])
  })

  it('refuses to create a file that appeared meanwhile', () => {
    writeFileSync(join(folder, 'CLAUDE.md'), 'theirs')
    const result = writeInstruction(projects(), request({}))
    expect(result).toMatchObject({ ok: false, reason: 'changed' })
    expect(readFileSync(join(folder, 'CLAUDE.md'), 'utf8')).toBe('theirs')
  })

  it('saves when the stamp matches and refuses when the file changed', () => {
    writeFileSync(join(folder, 'CLAUDE.md'), 'v1')
    const read = readInstruction(projects(), folder, 'CLAUDE.md')
    if (!read.ok) throw new Error('unexpected')
    const expected = { mtimeMs: read.mtimeMs, size: read.size }
    expect(writeInstruction(projects(), request({ expected, content: 'v2' })).ok).toBe(true)
    writeFileSync(join(folder, 'CLAUDE.md'), 'external edit')
    utimesSync(join(folder, 'CLAUDE.md'), new Date(), new Date(Date.now() + 5000))
    const stale = writeInstruction(projects(), request({ expected, content: 'v3' }))
    expect(stale).toMatchObject({ ok: false, reason: 'changed' })
    expect(readFileSync(join(folder, 'CLAUDE.md'), 'utf8')).toBe('external edit')
  })

  it('overwrites when asked to', () => {
    writeFileSync(join(folder, 'CLAUDE.md'), 'theirs')
    expect(writeInstruction(projects(), request({ overwrite: true, content: 'mine' })).ok).toBe(true)
    expect(readFileSync(join(folder, 'CLAUDE.md'), 'utf8')).toBe('mine')
  })

  it('refuses other names, foreign folders and oversize content', () => {
    expect(writeInstruction(projects(), request({ name: 'package.json' })).ok).toBe(false)
    expect(writeInstruction(projects(), request({ folder: root })).ok).toBe(false)
    expect(writeInstruction(projects(), request({ content: 'x'.repeat(INSTRUCTION_MAX_BYTES + 1) }))).toMatchObject({
      ok: false,
      reason: 'toolarge'
    })
    expect(readdirSync(folder)).toEqual([])
  })

  it('keeps CRLF bytes exactly as given', () => {
    writeInstruction(projects(), request({ content: 'a\r\nb\r\n' }))
    expect(readFileSync(join(folder, 'CLAUDE.md'), 'utf8')).toBe('a\r\nb\r\n')
  })
})

describe('instruction files that are links', () => {
  const canLink = (target: string, path: string): boolean => {
    try {
      symlinkSync(target, path, 'file')
      return true
    } catch {
      return false
    }
  }

  it('writes through a link to a file inside the project and keeps the link', (context) => {
    writeFileSync(join(folder, 'AGENTS.md'), 'shared')
    if (!canLink(join(folder, 'AGENTS.md'), join(folder, 'CLAUDE.md'))) return context.skip()
    expect(readInstruction(projects(), folder, 'CLAUDE.md')).toMatchObject({ ok: true, exists: true, content: 'shared' })
    expect(writeInstruction(projects(), { folder, name: 'CLAUDE.md', content: 'updated', expected: null, overwrite: true } as any).ok).toBe(true)
    expect(lstatSync(join(folder, 'CLAUDE.md')).isSymbolicLink()).toBe(true)
    expect(readFileSync(join(folder, 'AGENTS.md'), 'utf8')).toBe('updated')
  })

  it('refuses links that point outside the project or to nothing', (context) => {
    writeFileSync(join(root, 'outside.md'), 'x')
    if (!canLink(join(root, 'outside.md'), join(folder, 'CLAUDE.md'))) return context.skip()
    expect(readInstruction(projects(), folder, 'CLAUDE.md').ok).toBe(false)
    expect(writeInstruction(projects(), { folder, name: 'CLAUDE.md', content: 'y', expected: null, overwrite: true } as any).ok).toBe(false)
    expect(readFileSync(join(root, 'outside.md'), 'utf8')).toBe('x')
    canLink(join(folder, 'missing.md'), join(folder, 'GEMINI.md'))
    expect(readInstruction(projects(), folder, 'GEMINI.md').ok).toBe(false)
  })
})
