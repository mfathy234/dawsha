import { describe, expect, it } from 'vitest'
import { localMermaidError } from '../../src/shared/mermaidDiagram'

describe('local Mermaid input', () => {
  it('allows ordinary graphs, sequence blocks and URL labels without fetching them', () => {
    expect(localMermaidError('flowchart LR\n A[https://internal.example] --> B')).toBeNull()
    expect(localMermaidError('sequenceDiagram\n participant A as العربية\n A->>B: hello')).toBeNull()
  })
  it.each([
    'flowchart LR\n A@{ img: "https://example.com/private" }',
    'flowchart LR\n A@{ "img": "https://example.com/private" }',
    "flowchart LR\n A@{ 'img': 'https://example.com/private' }",
    'sequenceDiagram\n participant A\n properties A: {"icon":"https://example.com/private"}',
    String.raw`flowchart LR
 A@{ "im\u0067": "https://example.com/private" }`,
    String.raw`sequenceDiagram
 participant A
 properties A: {"ic\u006fn":"https://example.com/private"}`,
    'flowchart LR\n A["<img src=https://example.com/x>"]',
    'flowchart LR\n classDef a fill:url(https://example.com/x)',
    'flowchart LR\n @import "https://example.com/x"',
    '%%{init: {"themeCSS":"body{}"}}%%\nflowchart LR\n A --> B',
    '---\nconfig:\n themeCSS: x\n---\nflowchart LR\n A --> B'
  ])('rejects constructs that could load remote resources before SVG sanitizing: %s', (text) => {
    expect(localMermaidError(text)).toMatch(/not supported/)
  })
  it('caps source before loading the rendering library', () => {
    expect(localMermaidError('a'.repeat(200_001))).toMatch(/too large/)
  })
})
