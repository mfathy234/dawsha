import { describe, expect, it } from 'vitest'
import { DiagramQueue } from '../../src/main/diagramQueue'

describe('diagram render queue', () => {
  it('runs only one render at a time and keeps the latest pending request per file', async () => {
    const queue = new DiagramQueue(1000)
    const calls: string[] = []
    let release!: () => void
    const first = queue.render('a', async () => {
      calls.push('a1')
      await new Promise<void>(resolve => { release = resolve })
      return { ok: true, svg: 'old' }
    })
    const skipped = queue.render('a', async () => { calls.push('a2'); return { ok: true, svg: 'skip' } })
    const other = queue.render('b', async () => { calls.push('b'); return { ok: true, svg: 'other' } })
    const latest = queue.render('a', async () => { calls.push('a3'); return { ok: true, svg: 'latest' } })
    expect(await skipped).toMatchObject({ ok: false, reason: 'superseded' })
    expect(calls).toEqual(['a1'])
    release()
    expect(await first).toMatchObject({ ok: false, reason: 'superseded' })
    expect(await latest).toEqual({ ok: true, svg: 'latest' })
    expect(await other).toEqual({ ok: true, svg: 'other' })
    expect(calls).toEqual(['a1', 'a3', 'b'])
  })

  it('aborts a timed-out render and continues the queue after the child stops', async () => {
    const queue = new DiagramQueue(15)
    let stopped = false
    const timed = queue.render('slow', signal => new Promise(resolve => {
      signal.addEventListener('abort', () => {
        stopped = true
        resolve({ ok: false, error: 'stopped', reason: 'render' })
      })
    }))
    const next = queue.render('next', async () => ({ ok: true, svg: stopped ? 'stopped first' : 'overlap' }))
    expect(await timed).toMatchObject({ ok: false, error: expect.stringContaining('timed out') })
    expect(await next).toEqual({ ok: true, svg: 'stopped first' })
  })

  it('continues after a renderer rejects unexpectedly', async () => {
    const queue = new DiagramQueue(1000)
    const failed = queue.render('bad', async () => { throw new Error('cannot spawn') })
    const good = queue.render('good', async () => ({ ok: true, svg: '<svg/>' }))
    expect(await failed).toMatchObject({ ok: false, error: 'cannot spawn' })
    expect(await good).toEqual({ ok: true, svg: '<svg/>' })
  })
})
