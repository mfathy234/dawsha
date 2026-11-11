import { describe, expect, it } from 'vitest'
import type { ChatItem } from '../../src/shared/chatLog'
import { changedSince, rewindPlan, splitRewind } from '../../src/shared/rewind'
import { cutTranscript, laterSameCount, nextTryNumber, triedTitle, tryPrompt } from '../../src/shared/tryAgain'

const user = (id: string, text: string, at?: number): ChatItem => ({ kind: 'message', id, role: 'user', text, ...(at !== undefined ? { at } : {}) }) as ChatItem
const reply = (id: string, at?: number): ChatItem => ({ kind: 'message', id, role: 'agent', text: 'ok', ...(at !== undefined ? { at } : {}) }) as ChatItem
const tool = (id: string, path: string, activity: 'edit' | 'create', added = 1, at?: number, extra: Partial<{ failed: boolean; done: boolean }> = {}): ChatItem =>
  ({ kind: 'tool', id, activity, verb: 'Edited', target: path, path, added, removed: 0, output: '', outputTruncated: false, done: extra.done ?? true, failed: extra.failed, ...(at !== undefined ? { at } : {}) }) as ChatItem

describe('rewindPlan', () => {
  const items = [
    user('u1', 'first', 100), tool('t1', 'a.ts', 'edit', 3, 110), reply('r1', 120),
    user('u2', 'second', 200), tool('t2', 'a.ts', 'edit', 2, 210), tool('t3', 'b.ts', 'create', 5, 215), reply('r2', 230),
    user('u3', 'third', 300), tool('t4', 'c.ts', 'edit', 1, 310, { failed: true }), reply('r3', 320)
  ]

  it('collects the files of this turn and every later one, summing counts', () => {
    const plan = rewindPlan(items, 'u1')!
    expect(plan.files.map((f) => [f.path, f.added])).toEqual([['a.ts', 5], ['b.ts', 5]])
    expect(plan.turns).toBe(3)
    expect(plan.messageAt).toBe(100)
  })

  it('starts at the chosen message and ignores earlier turns', () => {
    const plan = rewindPlan(items, 'u2')!
    expect(plan.files.map((f) => f.path)).toEqual(['a.ts', 'b.ts'])
    expect(plan.turns).toBe(2)
    expect(rewindPlan(items, 'u3')!.files).toEqual([])
  })

  it('stamps each file with the end of the last turn that touched it', () => {
    const plan = rewindPlan(items, 'u1')!
    expect(plan.files.find((f) => f.path === 'a.ts')!.touchedAt).toBe(230)
  })

  it('skips unfinished and failed tools and unknown messages', () => {
    expect(rewindPlan([user('u', 'x'), tool('t', 'a', 'edit', 1, 1, { done: false })], 'u')!.files).toEqual([])
    expect(rewindPlan(items, 'nope')).toBeNull()
  })

  it('does not change its input', () => {
    const copy = JSON.stringify(items)
    rewindPlan(items, 'u1')
    expect(JSON.stringify(items)).toBe(copy)
  })
})

describe('changed since', () => {
  it('flags only files written after the reply ended', () => {
    expect(changedSince(1000, 900)).toBe(false)
    expect(changedSince(900 + 6000, 900)).toBe(true)
    expect(changedSince(null, 900)).toBe(false)
    expect(changedSince(99999, undefined)).toBe(false)
  })

  it('splits files into put back and kept', () => {
    const files = [{ path: 'a.ts', added: 1, removed: 0 }, { path: 'b.ts', added: 2, removed: 1 }]
    const split = splitRewind(files, [{ path: 'a.ts', isNew: true, changedSince: false }, { path: 'b.ts', isNew: false, changedSince: true }])
    expect(split.put.map((f) => [f.path, f.isNew])).toEqual([['a.ts', true]])
    expect(split.kept.map((f) => f.path)).toEqual(['b.ts'])
  })
})

describe('try another way', () => {
  it('numbers tries', () => {
    expect(triedTitle('Upload retries')).toBe('Upload retries · try 2')
    expect(triedTitle('Upload retries · try 2')).toBe('Upload retries · try 3')
    expect(nextTryNumber('x')).toBe(2)
  })

  it('cuts a transcript before the chosen message, counting from the end for repeats', () => {
    const entries = [
      { kind: 'user' as const, text: 'go' }, { kind: 'assistant' as const, text: 'a' },
      { kind: 'user' as const, text: 'go' }, { kind: 'assistant' as const, text: 'b' }
    ]
    expect(cutTranscript(entries, 'go', 0)).toHaveLength(2)
    expect(cutTranscript(entries, ' go ', 1)).toHaveLength(0)
    expect(cutTranscript(entries, 'missing', 0)).toBeNull()
  })

  it('counts later identical messages', () => {
    expect(laterSameCount([user('1', 'go'), reply('r'), user('2', 'go')], '1')).toBe(1)
  })

  it('points the new agent at the transcript only when there is one', () => {
    expect(tryPrompt({ from: 'claude', projectName: 'p', transcriptPath: null, message: 'hi' })).toBe('hi')
    const text = tryPrompt({ from: 'claude', projectName: 'p', transcriptPath: 'C:/t.md', message: 'hi' })
    expect(text).toContain('C:/t.md')
    expect(text.endsWith('hi')).toBe(true)
  })
})
