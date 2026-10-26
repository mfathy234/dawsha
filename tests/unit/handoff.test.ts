import { describe, expect, it } from 'vitest'
import {
  HANDOFF_TOTAL_MAX,
  buildHandoff,
  lastErrorLine,
  parseNumstat,
  stripAnsi,
  tailLines,
  type HandoffInput
} from '../../src/shared/handoff'

const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)

const input = (over: Partial<HandoffInput> = {}): HandoffInput => ({
  from: 'claude',
  projectName: 'acme-web',
  title: 'Fix flaky login test',
  files: ['tests/login.spec.ts', 'src/auth/redirect.ts', 'playwright.config.ts'],
  plan: { title: 'Stabilise login', done: 4, total: 6 },
  check: { kind: 'test', ok: false, summary: '41 passed 1 failed' },
  output: 'Running login spec\ntimeout waiting for #dashboard\n',
  ...over
})

describe('stripAnsi', () => {
  it('removes colours, cursor moves, titles and stray control characters', () => {
    const raw = `${ESC}[1m${ESC}[31mFAIL${ESC}[0m login${ESC}[2K${ESC}[1G ${ESC}]0;window title${BEL}done${ESC}(B\u0008\r\n`
    expect(stripAnsi(raw)).toBe('FAIL login done\n')
  })

  it('keeps tabs and newlines and plain text untouched', () => {
    expect(stripAnsi('a\tb\nc')).toBe('a\tb\nc')
  })
})

describe('tailLines', () => {
  it('keeps the last lines, trims blank edges and shortens long lines', () => {
    const output = `\n\n${Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join('\n')}\n\n\n`
    const lines = tailLines(output, 40)
    expect(lines).toHaveLength(40)
    expect(lines[0]).toBe('line 21')
    expect(lines[39]).toBe('line 60')
    expect(tailLines(`${'x'.repeat(300)}\n`)[0]).toHaveLength(200)
  })

  it('returns nothing for empty output', () => {
    expect(tailLines('  \n\n')).toEqual([])
    expect(tailLines('')).toEqual([])
  })
})

describe('lastErrorLine', () => {
  it('finds the last line that reports an error and ignores clean results', () => {
    expect(lastErrorLine(['Error: boom', 'ok', 'TimeoutError: waiting for #dashboard', 'done'])).toBe(
      'TimeoutError: waiting for #dashboard'
    )
    expect(lastErrorLine(['Build succeeded with 0 errors', 'tests: 0 failed'])).toBeNull()
    expect(lastErrorLine(['all fine'])).toBeNull()
    expect(lastErrorLine([])).toBeNull()
  })
})

describe('parseNumstat', () => {
  it('lists changed paths once, including binary and renamed files', () => {
    const text = ['3\t1\tsrc/auth/redirect.ts', '-\t-\tdocs/logo.png', '0\t0\tsrc/{old => new}.ts', 'bogus', '3\t1\tsrc/auth/redirect.ts', ''].join('\n')
    expect(parseNumstat(text)).toEqual(['src/auth/redirect.ts', 'docs/logo.png', 'src/{old => new}.ts'])
    expect(parseNumstat('')).toEqual([])
  })
})

describe('buildHandoff', () => {
  it('writes the goal, files, progress, last error and the recent output', () => {
    const text = buildHandoff(input())
    expect(text).toContain('Continue this task. Handoff from Claude Code in acme-web.')
    expect(text).toContain('Goal: Fix flaky login test')
    expect(text).toContain('Files touched (3):\n- tests/login.spec.ts\n- src/auth/redirect.ts\n- playwright.config.ts')
    expect(text).toContain("What's done: 4 of 6 plan steps done (Stabilise login). Last test: failed, 41 passed 1 failed.")
    expect(text).toContain("What's left: 2 plan steps.")
    expect(text).toContain('Last error: test failed: 41 passed 1 failed')
    expect(text).toContain('Recent terminal output (last 40 lines at most):\nRunning login spec\ntimeout waiting for #dashboard')
  })

  it('says what is missing instead of inventing it', () => {
    const text = buildHandoff(input({ title: null, files: [], plan: null, check: null, output: '' }))
    expect(text).toContain('Goal: (not captured, describe it here)')
    expect(text).toContain('Files touched: none found')
    expect(text).toContain("What's done: (not captured, describe it here)")
    expect(text).toContain("What's left: (not captured, describe it here)")
    expect(text).toContain('Last error: none seen')
    expect(text).not.toContain('Recent terminal output')
  })

  it('takes the last error from the output when no check failed', () => {
    const text = buildHandoff(input({ check: { kind: 'build', ok: true, summary: null }, output: 'compiling\nError: cannot find module x\nretrying' }))
    expect(text).toContain('Last error: Error: cannot find module x')
    expect(text).toContain("What's done: 4 of 6 plan steps done (Stabilise login). Last build: passed.")
  })

  it('reports a finished plan and singular wording', () => {
    const text = buildHandoff(input({ plan: { title: null, done: 5, total: 5 }, check: null }))
    expect(text).toContain("What's done: 5 of 5 plan steps done.")
    expect(text).toContain("What's left: All plan steps are done.")
    expect(buildHandoff(input({ plan: { title: null, done: 2, total: 3 } }))).toContain("What's left: 1 plan step.")
  })

  it('lists at most 30 files and strips colours from the output', () => {
    const files = Array.from({ length: 35 }, (_, i) => `src/file${i}.ts`)
    const text = buildHandoff(input({ files, output: `${ESC}[32mgreen${ESC}[0m line` }))
    expect(text).toContain('Files touched (35):')
    expect(text).toContain('- src/file29.ts')
    expect(text).not.toContain('- src/file30.ts')
    expect(text).toContain('- and 5 more')
    expect(text).toContain('green line')
    expect(text).not.toContain(ESC)
  })

  it('keeps the whole summary under the size limit by cutting the oldest output first', () => {
    const output = Array.from({ length: 200 }, (_, i) => `output line number ${i} ${'x'.repeat(150)}`).join('\n')
    const text = buildHandoff(input({ output }))
    expect(text.length).toBeLessThanOrEqual(HANDOFF_TOTAL_MAX)
    expect(text).toContain('output line number 199')
    expect(text).not.toContain('output line number 100 ')
  })
})

describe('transcript handoff', () => {
  const base = {
    from: 'claude' as const,
    projectName: 'billing-api',
    title: 'Fix flaky login test',
    files: ['README.md', 'tests/login.spec.ts'],
    plan: { title: 'Stabilise login', done: 3, total: 6 },
    check: { kind: 'test' as const, ok: false, summary: '40 passed 1 failed' },
    output: 'ok\nError: timeout waiting for #dashboard\n',
    transcriptPath: 'C:\Users\me\AppData\Roaming\dawsha\handoffs\billing-api-claude-20261020-120000.md'
  }

  it('tells the next agent to read the quoted file first and to summarise before continuing', async () => {
    const { buildTranscriptHandoff } = await import('../../src/shared/handoff')
    const text = buildTranscriptHandoff(base)
    expect(text.split('\n')[0]).toBe(
      `Continue this task. First read the transcript file at "${base.transcriptPath}". It is the full conversation of the previous Claude Code session in billing-api.`
    )
    expect(text).toContain('Goal: Fix flaky login test')
    expect(text).toContain('Files touched (2):\n- README.md\n- tests/login.spec.ts')
    expect(text).toContain("What's left: 3 plan steps.")
    expect(text).toContain('Last error: test failed: 40 passed 1 failed')
    expect(text.trimEnd().endsWith('summarise in a few lines where things stand, then continue from there.')).toBe(true)
    expect(text).not.toContain('Recent terminal output')
  })

  it('says what it does not know instead of inventing it', async () => {
    const { buildTranscriptHandoff } = await import('../../src/shared/handoff')
    const text = buildTranscriptHandoff({ ...base, title: null, files: [], plan: null, check: null, output: '' })
    expect(text).toContain('Goal: (not captured, see the transcript)')
    expect(text).toContain('Files touched: none found')
    expect(text).toContain("What's left: (not captured, see the transcript)")
    expect(text).toContain('Last error: none seen')
  })

  it('accepts only a project id, a known agent and a plain session id', async () => {
    const { parseHandoffRequest } = await import('../../src/shared/handoff')
    expect(parseHandoffRequest({ projectId: 'smoke', agent: 'codex', sessionId: '019aaaaa-0000-7000-8000-0000000000aa' })).toEqual({
      projectId: 'smoke',
      agent: 'codex',
      sessionId: '019aaaaa-0000-7000-8000-0000000000aa'
    })
    for (const bad of [
      null,
      'x',
      { projectId: 'smoke', agent: 'shell', sessionId: 'abc' },
      { projectId: 'smoke', agent: 'claude', sessionId: '../../etc/passwd' },
      { projectId: 'smoke', agent: 'claude', sessionId: 'a b' },
      { projectId: '', agent: 'claude', sessionId: 'abc' },
      { projectId: 'smoke', agent: 'claude', sessionId: 'a'.repeat(200) },
      { projectId: 'smoke', agent: 'claude', sessionId: 5 }
    ]) expect(parseHandoffRequest(bad)).toBeNull()
  })

  it('names files project-agent-date-time and keeps names safe', async () => {
    const { handoffFileName } = await import('../../src/shared/handoff')
    const when = new Date(2026, 9, 20, 9, 5, 7)
    expect(handoffFileName('billing-api', 'claude', when)).toBe('billing-api-claude-20261020-090507.md')
    expect(handoffFileName('..\My: Project/x', 'codex', when)).toBe('My-Project-x-codex-20261020-090507.md')
    expect(handoffFileName('***', 'gemini', when)).toBe('project-gemini-20261020-090507.md')
  })

  it('keeps the newest 50 files and only ever names markdown files for deletion', async () => {
    const { staleHandoffs, HANDOFF_KEEP_FILES } = await import('../../src/shared/handoff')
    const files = Array.from({ length: 53 }, (_, i) => ({ name: `f${i}.md`, modifiedAt: i }))
    const stale = staleHandoffs([...files, { name: 'notes.txt', modifiedAt: 0 }])
    expect(HANDOFF_KEEP_FILES).toBe(50)
    expect(stale.sort()).toEqual(['f0.md', 'f1.md', 'f2.md'])
    expect(staleHandoffs(files.slice(0, 10))).toEqual([])
  })
})
