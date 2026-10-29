import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readLinked } from '../../src/main/crewSources'
import type { SkillLocations } from '../../src/main/skillInventory'

const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function locationsWithPrompt(): { locations: SkillLocations; file: string } {
  const root = mkdtempSync(join(tmpdir(), 'dawsha-crew-sources-'))
  roots.push(root)
  const codex = join(root, 'codex')
  mkdirSync(join(codex, 'prompts'), { recursive: true })
  const file = join(codex, 'prompts', 'review.md')
  writeFileSync(file, 'first', 'utf8')
  const empty = join(root, 'none')
  return { locations: { claude: empty, codex, gemini: empty, shared: empty, projects: [] }, file }
}

describe('readLinked', () => {
  it('returns the text of a listed source and refuses a path the scan does not list', () => {
    const { locations, file } = locationsWithPrompt()
    expect(readLinked(locations, file)).toBe('first')
    expect(readLinked(locations, join(tmpdir(), 'elsewhere.md'))).toBeNull()
    expect(readLinked(locations, '')).toBeNull()
    expect(readLinked(locations, 42)).toBeNull()
  })

  it('reuses the scan for five seconds, then reads the folders again', () => {
    const { locations, file } = locationsWithPrompt()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    expect(readLinked(locations, file)).toBe('first')
    writeFileSync(file, 'second', 'utf8')
    clock.mockReturnValue(5_999)
    expect(readLinked(locations, file)).toBe('first')
    clock.mockReturnValue(6_000)
    expect(readLinked(locations, file)).toBe('second')
  })
})
