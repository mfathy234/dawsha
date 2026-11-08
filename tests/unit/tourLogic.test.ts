import { describe, expect, it } from 'vitest'
import { nextTourStep, placeTourCard, previousTourStep } from '../../src/shared/tourLogic'

describe('tour navigation', () => {
  it('skips steps without visible targets in either direction', () => {
    const visible = [true, false, true, false]
    expect(nextTourStep(0, visible)).toBe(2)
    expect(previousTourStep(2, visible)).toBe(0)
    expect(nextTourStep(2, visible)).toBe(-1)
  })
})

describe('tour card placement', () => {
  it('places beside a target and flips when the preferred side has no room', () => {
    expect(placeTourCard({ x: 300, y: 200, width: 80, height: 40 }, { width: 280, height: 180 }, { width: 900, height: 700 }))
      .toEqual({ x: 396, y: 130, width: 280, height: 180, side: 'right' })
    expect(placeTourCard({ x: 700, y: 200, width: 80, height: 40 }, { width: 280, height: 180 }, { width: 900, height: 700 }).side)
      .toBe('left')
  })
})
