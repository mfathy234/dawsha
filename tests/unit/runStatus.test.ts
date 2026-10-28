import { describe, expect, it } from 'vitest'
import { detectPort, runTabLabel, runningSummary, runningText } from '../../src/shared/runStatus'
import type { RunSnapshot } from '../../src/shared/runCommands'

const run = (over: Partial<RunSnapshot> = {}): RunSnapshot => ({
  id: '1', commandId: 'c', name: 'dev', projectId: 'p', folder: 'C:\\w\\app', cwd: '.', display: 'npm run dev', status: 'running', output: '', exitCode: null, startedAt: 1, ...over
})

describe('detectPort', () => {
  it('reads the usual dev server banners', () => {
    expect(detectPort('  Local:   http://localhost:5173/')).toBe(5173)
    expect(detectPort('listening on http://127.0.0.1:3000')).toBe(3000)
    expect(detectPort('Now listening on: https://[::1]:7001')).toBe(7001)
    expect(detectPort('Server started on port 8080')).toBe(8080)
  })
  it('takes the last one printed and ignores colour codes', () => {
    expect(detectPort('http://localhost:3000\n\u001b[32mhttp://localhost:3001\u001b[0m')).toBe(3001)
  })
  it('is null when nothing names a port', () => {
    expect(detectPort('compiled in 3s\nline 12:40')).toBeNull()
    expect(detectPort('')).toBeNull()
  })
})

describe('run tabs and the status summary', () => {
  it('labels a run, adding the checkout when it is another one', () => {
    expect(runTabLabel(run(), 'c:/w/app/')).toBe('Run · dev')
    expect(runTabLabel(run(), 'C:\\w\\other')).toBe('Run · dev · app')
  })
  it('summarises the newest running command of this checkout with its port', () => {
    const runs = [run({ id: 'a', name: 'old', startedAt: 1 }), run({ id: 'b', name: 'dev', startedAt: 5, output: 'http://localhost:5173' }), run({ id: 'c', name: 'x', status: 'stopped', startedAt: 9 }), run({ id: 'd', folder: 'C:\\w\\other', startedAt: 10 })]
    const summary = runningSummary(runs, 'C:/w/app')
    expect(summary).toEqual({ name: 'dev', port: 5173 })
    expect(runningText(summary!)).toBe('dev running · :5173')
    expect(runningText({ name: 'test', port: null })).toBe('test running')
  })
  it('is null when nothing runs here', () => {
    expect(runningSummary([run({ status: 'exited' })], 'C:\\w\\app')).toBeNull()
    expect(runningSummary([run()], null)).toBeNull()
  })
})
