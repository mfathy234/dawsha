import { describe, expect, it } from 'vitest'
import {
  MAX_PRESETS,
  PRESET_NAME_MAX,
  addPreset,
  presetCommandTitle,
  presetSummary,
  removePreset,
  renamePreset,
  sanitizePresets,
  validatePresetName
} from '../../src/shared/sessionPresets'
import type { SessionPreset } from '../../src/shared/types'

const preset = (id: string, name: string, over: Partial<SessionPreset> = {}): SessionPreset => ({
  id,
  name,
  agent: 'claude',
  projectId: 'p1',
  worktree: false,
  prompt: '',
  ...over
})

describe('validatePresetName', () => {
  it('requires a name', () => expect(validatePresetName('  ', [])).toMatch(/name/i))
  it('limits the length', () => expect(validatePresetName('x'.repeat(PRESET_NAME_MAX + 1), [])).toMatch(/characters/))
  it('refuses a name another preset has, ignoring case', () => {
    expect(validatePresetName('review', [preset('a', 'Review')])).toMatch(/already/i)
  })
  it('lets a preset keep its own name', () => {
    expect(validatePresetName('Review', [preset('a', 'Review')], 'a')).toBeNull()
  })
  it('accepts a fresh name', () => expect(validatePresetName('Bugfix', [preset('a', 'Review')])).toBeNull())
})

describe('preset list edits', () => {
  const list = [preset('a', 'One'), preset('b', 'Two')]
  it('adds without mutating', () => {
    const next = addPreset(list, preset('c', 'Three'))
    expect(next.map((p) => p.id)).toEqual(['a', 'b', 'c'])
    expect(list).toHaveLength(2)
  })
  it('stops at the limit', () => {
    const full = Array.from({ length: MAX_PRESETS }, (_, i) => preset(`p${i}`, `N${i}`))
    expect(addPreset(full, preset('x', 'Extra'))).toHaveLength(MAX_PRESETS)
  })
  it('renames only the named preset', () => {
    const next = renamePreset(list, 'b', ' Deux ')
    expect(next.map((p) => p.name)).toEqual(['One', 'Deux'])
    expect(list[1].name).toBe('Two')
  })
  it('removes by id', () => expect(removePreset(list, 'a').map((p) => p.id)).toEqual(['b']))
})

describe('sanitizePresets', () => {
  const ids = new Set(['p1'])
  it('keeps valid presets', () => {
    expect(sanitizePresets([preset('a', 'One', { agent: 'shell', worktree: true, prompt: 'ls' })], ids)).toEqual([
      preset('a', 'One', { agent: 'shell', worktree: true, prompt: 'ls' })
    ])
  })
  it('drops presets of unknown projects, bad agents and nameless entries', () => {
    const raw = [preset('a', 'One', { projectId: 'gone' }), { ...preset('b', 'Two'), agent: 'vim' }, { ...preset('c', ''), name: ' ' }, 7, null]
    expect(sanitizePresets(raw, ids)).toEqual([])
  })
  it('drops duplicate ids and clips long text', () => {
    const out = sanitizePresets([preset('a', 'x'.repeat(100), { prompt: 'y'.repeat(20000) }), preset('a', 'Dupe')], ids)
    expect(out).toHaveLength(1)
    expect(out[0].name).toHaveLength(PRESET_NAME_MAX)
    expect(out[0].prompt.length).toBeLessThan(20000)
  })
  it('tolerates non-arrays', () => expect(sanitizePresets('nope', ids)).toEqual([]))
})

describe('labels', () => {
  it('titles the palette command', () => expect(presetCommandTitle(preset('a', 'Review'))).toBe('Start preset: Review'))
  it('summarises a preset', () => {
    expect(presetSummary(preset('a', 'x', { agent: 'codex', worktree: true, prompt: 'go' }), 'Alpha')).toBe('Codex in Alpha, new worktree, first prompt')
    expect(presetSummary(preset('a', 'x', { agent: 'shell' }), undefined)).toBe('Shell in a missing project')
  })
})
