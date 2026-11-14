import { describe, expect, it } from 'vitest'
import { buildReviewPrompt, clipDiff, completeObjects, defaultReviewer, findingText, normalizeSeverity, parseFindings, sortFindings, summaryLabel } from '../../src/shared/reviewFindings'

const one = { file: 'src/a.ts', line: 12, severity: 'high', title: 'Null deref', explanation: 'x can be null', suggested_fix: 'check it' }
const two = { file: 'src/b.ts', line: 3, severity: 'low', title: 'Typo', explanation: 'spelling', suggested_fix: '' }

describe('parseFindings', () => {
  it('reads strict JSON', () => {
    const parsed = parseFindings(JSON.stringify({ findings: [two, one] }))
    expect(parsed.ok).toBe(true)
    expect(parsed.findings.map((finding) => finding.title)).toEqual(['Null deref', 'Typo'])
    expect(parsed.findings[0]).toMatchObject({ file: 'src/a.ts', line: 12, severity: 'high', fix: 'check it' })
  })
  it('reads a bare array and a fenced block with chatter around it', () => {
    expect(parseFindings(JSON.stringify([one])).findings).toHaveLength(1)
    const fenced = `Here is my review.\n\n\`\`\`json\n${JSON.stringify({ findings: [one, two] }, null, 2)}\n\`\`\`\nDone.`
    expect(parseFindings(fenced).findings).toHaveLength(2)
  })
  it('keeps the complete findings of a reply that was cut off', () => {
    const cut = `{"findings":[${JSON.stringify(one)},${JSON.stringify(two)},{"file":"src/c.ts","line":9,"seve`
    const parsed = parseFindings(cut)
    expect(parsed.ok).toBe(true)
    expect(parsed.findings.map((finding) => finding.file)).toEqual(['src/a.ts', 'src/b.ts'])
  })
  it('accepts an empty list and plain "no findings", and fails on prose with nothing parsable', () => {
    expect(parseFindings('{"findings":[]}')).toMatchObject({ ok: true, findings: [] })
    expect(parseFindings('```json\n[]\n```').ok).toBe(true)
    expect(parseFindings('LGTM, no issues found.').ok).toBe(true)
    const bad = parseFindings('I looked at the diff and it has several problems in the parser.')
    expect(bad.ok).toBe(false)
    expect(bad.raw).toContain('several problems')
  })
  it('ignores the example shape from the prompt itself', () => {
    const echo = '{"findings":[{"file":"path/relative/to/the/repo","line":12,"severity":"high|medium|low","title":"short title","explanation":"what","suggested_fix":"x"}]}'
    expect(parseFindings(echo).findings).toEqual([])
  })
  it('tolerates other field names, string lines and unknown severities', () => {
    const parsed = parseFindings(JSON.stringify([{ path: './x.ts', lines: '14-18', severity: 'Critical', description: 'bad' }, { file: 'y.ts', line: '7', severity: 'weird', title: 't' }]))
    expect(parsed.findings[0]).toMatchObject({ file: 'x.ts', line: 14, severity: 'high', title: 'bad' })
    expect(parsed.findings[1]).toMatchObject({ line: 7, severity: 'medium' })
  })
})

describe('severity', () => {
  it('maps words and orders most severe first, then file and line', () => {
    expect(normalizeSeverity('MINOR')).toBe('low')
    expect(normalizeSeverity(undefined)).toBe('medium')
    const sorted = sortFindings([
      { severity: 'low' as const, file: 'a', line: 1 },
      { severity: 'high' as const, file: 'b', line: 9 },
      { severity: 'high' as const, file: 'b', line: 2 },
      { severity: 'medium' as const, file: 'a', line: 5 }
    ])
    expect(sorted.map((entry) => `${entry.severity}:${entry.file}:${entry.line}`)).toEqual(['high:b:2', 'high:b:9', 'medium:a:5', 'low:a:1'])
  })
  it('summarises the counts', () => {
    expect(summaryLabel([])).toBe('No findings')
    expect(summaryLabel([{ severity: 'low' }, { severity: 'high' }, { severity: 'low' }])).toBe('3 findings: 1 high, 2 low')
    expect(summaryLabel([{ severity: 'info' }])).toBe('1 finding: 1 info')
  })
})

describe('review prompt', () => {
  it('asks for strict JSON, read only, and says when the diff was cut', () => {
    const prompt = buildReviewPrompt({ scope: 'uncommitted', diff: '+a ``` b', truncated: true, command: 'git diff HEAD' })
    expect(prompt).toContain('read only')
    expect(prompt).toContain('strict JSON')
    expect(prompt).toContain('`git diff HEAD`')
    expect(prompt).not.toContain('+a ``` b')
  })
  it('clips a long diff at a line', () => {
    const diff = Array.from({ length: 50 }, (_, index) => `line ${index}`).join('\n')
    const clipped = clipDiff(diff, 100)
    expect(clipped.truncated).toBe(true)
    expect(clipped.text.length).toBeLessThanOrEqual(100)
    expect(diff.startsWith(clipped.text)).toBe(true)
    expect(clipDiff('short').truncated).toBe(false)
  })
  it('picks the other agent and joins title with explanation', () => {
    expect(defaultReviewer('claude')).toBe('codex')
    expect(defaultReviewer('codex')).toBe('claude')
    expect(findingText({ title: 'Null deref', explanation: 'x can be null' })).toBe('Null deref. x can be null')
    expect(findingText({ title: 'Same', explanation: 'Same' })).toBe('Same')
  })
  it('finds whole objects in broken text', () => {
    expect(completeObjects('x {"a":"}"} y {"b":1} {"c"')).toEqual(['{"a":"}"}', '{"b":1}'])
  })
})
