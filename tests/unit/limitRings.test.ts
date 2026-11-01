import { describe, expect, it } from 'vitest'
import { RING_SIZE, RING_SIZE_COMPACT, ringGeometry, ringLetter, ringSpecs, ringStage, ringTitle } from '../../src/shared/limitRings'
import { limitsPillModel } from '../../src/shared/limitsPill'
import type { RateLimitWindow } from '../../src/shared/types'

const win = (key: string, percent: number, extra: Partial<RateLimitWindow> = {}): RateLimitWindow => ({ key, label: key, percent, resetsAt: null, ...extra })
const NOW = 1_000_000

describe('limit rings', () => {
  it('colours accent under 80, amber from 80 and danger from 95', () => {
    expect([0, 79.9, 80, 94.9, 95, 100].map(ringStage)).toEqual(['ok', 'ok', 'warn', 'warn', 'danger', 'danger'])
  })

  it('computes the arc from the percent and clamps it', () => {
    const half = ringGeometry(50)
    expect(half.size).toBe(RING_SIZE)
    expect(half.radius).toBeCloseTo(11.75)
    expect(half.dashOffset).toBeCloseTo(half.circumference / 2)
    expect(ringGeometry(0).dashOffset).toBeCloseTo(ringGeometry(0).circumference)
    expect(ringGeometry(140).dashOffset).toBe(0)
    expect(ringGeometry(-5).dashOffset).toBeCloseTo(ringGeometry(0).circumference)
    expect(ringGeometry(Number.NaN).dashOffset).toBeCloseTo(ringGeometry(0).circumference)
  })

  it('letters 5h, W and the model family', () => {
    expect(ringLetter(win('five_hour', 3))).toBe('5h')
    expect(ringLetter(win('seven_day', 3))).toBe('W')
    expect(ringLetter(win('seven_day_opus', 3, { family: 'opus' }))).toBe('O')
    expect(ringLetter(win('window_120m', 3, { label: '2h' }))).toBe('2')
    expect(ringLetter(win('x', 3, { label: '' }))).toBe('?')
  })

  it('titles a ring with the plain window name and the reset', () => {
    const five = win('five_hour', 3, { resetsAt: NOW + (4 * 60 + 28) * 60_000 })
    expect(ringTitle('Claude', five, NOW)).toBe('Claude 5-hour: 3%, resets in 4h 28m')
    expect(ringTitle('Codex', win('seven_day', 49), NOW)).toBe('Codex weekly: 49%')
    expect(ringTitle('Claude', win('seven_day_opus', 97, { family: 'opus' }), NOW)).toBe('Claude Opus weekly: 97%')
  })

  it('draws one ring per reported window and never an empty one', () => {
    const specs = ringSpecs('Claude', [win('five_hour', 3)], NOW, false)
    expect(specs.map((spec) => spec.letter)).toEqual(['5h'])
    expect(ringSpecs('Claude', [], NOW, false)).toEqual([])
    expect(ringSpecs('Claude', [win('five_hour', Number.NaN)], NOW, false)).toEqual([])
  })

  it('shows only the highest window, small and unlettered, when compact', () => {
    const specs = ringSpecs('Claude', [win('five_hour', 3), win('seven_day', 49)], NOW, true)
    expect(specs).toHaveLength(1)
    expect(specs[0]).toMatchObject({ lettered: false, stage: 'ok' })
    expect(specs[0].window.key).toBe('seven_day')
    expect(specs[0].geometry.size).toBe(RING_SIZE_COMPACT)
  })
})

describe('limits pill model', () => {
  const store = { claude: { windows: [win('five_hour', 84), win('seven_day', 10)], at: NOW } }

  it('lists a ring per window for each agent with data', () => {
    const model = limitsPillModel(store, 'claude', NOW, false)
    expect(model.hidden).toBe(false)
    expect(model.agents.map((item) => [item.agent, item.rings.length])).toEqual([['claude', 2]])
    expect(model.ariaLabel).toBe('Claude limits: Claude 5-hour: 84%; Claude weekly: 10%. Show limits for every agent')
  })

  it('keeps every window in the label when compact', () => {
    const model = limitsPillModel(store, 'claude', NOW, true)
    expect(model.agents[0].rings).toHaveLength(1)
    expect(model.ariaLabel).toContain('Claude weekly: 10%')
  })

  it('reports the empty state for a focused agent with no reading, and hides with nothing at all', () => {
    expect(limitsPillModel({}, 'codex', NOW, false)).toMatchObject({ hidden: false, empty: 'codex', agents: [] })
    expect(limitsPillModel({}, null, NOW, false).hidden).toBe(true)
  })

  it('marks old readings stale', () => {
    expect(limitsPillModel(store, 'claude', NOW + 31 * 60_000, false).stale).toBe(true)
  })

  it('leaves out agents that are not visible', () => {
    const both = { ...store, codex: { windows: [win('five_hour', 5)], at: NOW } }
    expect(limitsPillModel(both, 'claude', NOW, false, ['claude']).agents.map((item) => item.agent)).toEqual(['claude'])
    expect(limitsPillModel(both, 'claude', NOW, false).agents).toHaveLength(2)
  })
})
