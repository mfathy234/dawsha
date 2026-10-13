import { describe, expect, it } from 'vitest'
import { clampSidebarWidth, DEFAULT_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH } from '../../src/shared/sidebarWidth'

describe('project sidebar width', () => {
  it('keeps widths within the supported range and rounds pixel values', () => {
    expect(clampSidebarWidth(MIN_SIDEBAR_WIDTH - 10)).toBe(MIN_SIDEBAR_WIDTH)
    expect(clampSidebarWidth(MAX_SIDEBAR_WIDTH + 10)).toBe(MAX_SIDEBAR_WIDTH)
    expect(clampSidebarWidth(271.6)).toBe(272)
  })

  it('uses the default for invalid persisted values', () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(DEFAULT_SIDEBAR_WIDTH)
    expect(clampSidebarWidth('wide')).toBe(DEFAULT_SIDEBAR_WIDTH)
  })
})
