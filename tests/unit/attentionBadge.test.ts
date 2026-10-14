import { describe, expect, it } from 'vitest'
import { OVERLAY_SIZE, badgeWindowTitle, needsCount, normalizeBadgeCount, overlayBitmap, overlayLabel } from '../../src/shared/attentionBadge'
import { permissionPromptText } from '../../src/shared/permissionPrompt'

describe('attention badge', () => {
  it('counts only sessions that need the user', () => {
    expect(needsCount(['needs', 'working', 'needs', 'done'])).toBe(2)
    expect(needsCount([])).toBe(0)
  })

  it('titles the window with the count when above zero', () => {
    expect(badgeWindowTitle(0)).toBe('Dawsha')
    expect(badgeWindowTitle(3)).toBe('(3) Dawsha')
  })

  it('normalizes untrusted counts', () => {
    expect(normalizeBadgeCount(-4)).toBe(0)
    expect(normalizeBadgeCount('2')).toBe(0)
    expect(normalizeBadgeCount(NaN)).toBe(0)
    expect(normalizeBadgeCount(2.7)).toBe(2)
    expect(normalizeBadgeCount(500)).toBe(99)
  })

  it('draws an overlay bitmap of the right size with an opaque disc', () => {
    const data = overlayBitmap(3)
    expect(data.length).toBe(OVERLAY_SIZE * OVERLAY_SIZE * 4)
    const center = (OVERLAY_SIZE / 2 * OVERLAY_SIZE + OVERLAY_SIZE / 2) * 4
    expect(data[center + 3]).toBe(255)
    expect(data[3]).toBe(0)
    expect(overlayLabel(12)).toBe('9+')
    expect(overlayBitmap(12).length).toBe(data.length)
  })
})

describe('permissionPromptText', () => {
  it('returns the line above the question', () => {
    const tail = ['│ Bash command │', '│   npm run build   │', '', 'Do you want to proceed?', '1. Yes', '3. No'].join('\n')
    expect(permissionPromptText(tail)).toBe('npm run build')
  })

  it('is empty when there is no question', () => {
    expect(permissionPromptText('just output')).toBe('')
  })

  it('truncates long text', () => {
    const tail = `${'x'.repeat(400)}\nDo you want to proceed?\n1. Yes`
    expect(permissionPromptText(tail).length).toBe(160)
  })
})
