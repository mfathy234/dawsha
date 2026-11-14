import { describe, expect, it } from 'vitest'
import { clipElementBounds, elementMessage, readPickedElement } from '../../src/shared/browserPick'

const element = { tag: 'button', id: 'save', classes: ['primary'], name: 'Save', text: 'Save changes', selector: 'button#save', bounds: { x: 12.4, y: 20.2, width: 90.5, height: 32.1 } }

describe('picked page elements', () => {
  it('accepts a bounded description and refuses malformed guest data', () => {
    expect(readPickedElement(element)).toEqual(element)
    for (const bad of [null, {}, { ...element, tag: '<script>' }, { ...element, selector: 'x'.repeat(2049) }, { ...element, bounds: { x: 0, y: 0, width: -1, height: 4 } }, { ...element, name: 'x'.repeat(501) }, { ...element, classes: Array(21).fill('x') }]) {
      expect(readPickedElement(bad)).toBeNull()
    }
  })

  it('clips a partial element to the visible guest viewport and refuses invisible captures', () => {
    expect(clipElementBounds({ x: -12.3, y: 90.4, width: 60, height: 25 }, { width: 100, height: 100 })).toEqual({ x: 0, y: 90, width: 48, height: 10 })
    expect(clipElementBounds({ x: 12.4, y: 20.2, width: 90.5, height: 32.1 }, { width: 100, height: 100 })).toEqual({ x: 12, y: 20, width: 88, height: 33 })
    expect(clipElementBounds({ x: 110, y: 0, width: 10, height: 10 }, { width: 100, height: 100 })).toBeNull()
    expect(clipElementBounds({ x: 0, y: 0, width: NaN, height: 10 }, { width: 100, height: 100 })).toBeNull()
  })

  it('sends the page, selector, readable name and user note as literal text', () => {
    expect(elementMessage('http://localhost:4200/settings', element, 'Make this easier to find')).toBe("In http://localhost:4200/settings, the element `button#save` ('Save'): Make this easier to find")
    expect(elementMessage('http://localhost/', { ...element, name: '', text: '  Save changes  ' }, '  أصلح هذا  ')).toContain("('Save changes'): أصلح هذا")
  })
})
