import { describe, expect, it } from 'vitest'
import { swatchTarget } from '../../src/shared/swatchKeys'
import { highlightPreview } from '../../src/shared/highlights'

describe('swatchTarget', () => {
  it('moves with the arrow keys and wraps around', () => {
    expect(swatchTarget(5, 0, 'ArrowRight')).toBe(1)
    expect(swatchTarget(5, 4, 'ArrowRight')).toBe(0)
    expect(swatchTarget(5, 0, 'ArrowLeft')).toBe(4)
    expect(swatchTarget(5, 2, 'ArrowDown')).toBe(3)
    expect(swatchTarget(5, 2, 'ArrowUp')).toBe(1)
  })
  it('jumps to the ends and ignores other keys', () => {
    expect(swatchTarget(5, 2, 'Home')).toBe(0)
    expect(swatchTarget(5, 2, 'End')).toBe(4)
    expect(swatchTarget(5, 2, 'a')).toBeNull()
    expect(swatchTarget(0, 0, 'ArrowRight')).toBeNull()
  })
  it('flips left and right in a right-to-left page', () => {
    expect(swatchTarget(5, 2, 'ArrowRight', true)).toBe(1)
    expect(swatchTarget(5, 2, 'ArrowLeft', true)).toBe(3)
  })
})

describe('highlightPreview', () => {
  const rules = [{ pattern: 'error', color: 'red' as const }, { pattern: 'passed', color: 'green' as const }]
  it('colours the sample lines the way the terminal would', () => {
    const lines = highlightPreview(rules, null)
    expect(lines.find((line) => line.text.startsWith('error'))?.color).toBe('red')
    expect(lines.find((line) => line.text.includes('passed'))?.color).toBe('green')
    expect(lines.find((line) => line.text.startsWith('Build'))?.color).toBeNull()
    expect(lines.some((line) => line.draft)).toBe(false)
  })
  it('adds a line for the rule being typed, and none for an empty or broken one', () => {
    const typed = highlightPreview(rules, { pattern: 'deploy', color: 'purple' })
    expect(typed.at(-1)).toMatchObject({ draft: true, color: 'purple' })
    expect(highlightPreview(rules, { pattern: '  ', color: 'purple' }).some((line) => line.draft)).toBe(false)
    expect(highlightPreview(rules, { pattern: '(', color: 'blue', regex: true }).some((line) => line.draft)).toBe(false)
  })
})
