import { describe, expect, it } from 'vitest'
import { diagramFileName, validDiagramPng } from '../../src/shared/diagramExport'

describe('diagram export', () => {
  it('uses a plain leaf filename for both project paths and Markdown blocks', () => {
    expect(diagramFileName('docs/Sequence.puml')).toBe('Sequence.svg')
    expect(diagramFileName('C:\\work\\Flow.mmd')).toBe('Flow.svg')
    expect(diagramFileName('docs/design.md')).toBe('design.svg')
    expect(diagramFileName('')).toBe('diagram.svg')
  })
  it('requires a bounded PNG data URL', () => {
    expect(validDiagramPng('data:image/png;base64,iVBORw0KGgo=')).toBe(true)
    for (const value of [undefined, '', 'data:text/html;base64,AAAA', 'data:image/png;base64,AAAA', 'data:image/png;base64,iVBORw0KGgo=' + 'A'.repeat(24 * 1024 * 1024)]) {
      expect(validDiagramPng(value)).toBe(false)
    }
  })
})
