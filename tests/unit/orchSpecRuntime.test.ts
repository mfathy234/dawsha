import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { OrchRuntime } from '../../src/main/orch/runtime'
import { defaultOrchSettings } from '../../src/shared/orch/profiles'

vi.mock('../../src/main/orch/worktrees', async (original) => ({
  ...await original<object>(),
  runWorktree: async (repo: string) => ({ path: repo, branch: 'test' })
}))

describe('runtime spec snapshots', () => {
  it('captures each approval once, retains old content and pairs answers across restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orch-spec-runtime-'))
    const deps = {
      dbPath: join(root, 'orchestrator.db'), configRoot: join(root, 'orchestrator', 'agents'),
      version: '1', log: vi.fn(), settings: defaultOrchSettings, projectFolder: () => root,
      writePty: vi.fn(), openPane: vi.fn(), closePane: vi.fn(), changed: vi.fn()
    }
    const rt = new OrchRuntime(deps)
    await rt.start()
    try {
      const svc = rt.service!
      const run = svc.createRun({ projectPath: root, title: 'CSV', story: 'Export', plan: 'default' })
      const files = join(root, '.dawsha', 'runs', run.id)
      await mkdir(files, { recursive: true })
      await writeFile(join(files, 'spec.md'), '# First')
      const first = svc.raiseDecision(run.id, 'spec-approval', { question: 'Approve?', options: ['Approve'], context: '', taskId: null })
      const view = await rt.spec(run.id)
      expect(view?.current.spec).toBe('# First')
      expect(view?.versions).toEqual([expect.objectContaining({ version: 1, decisionId: first.id, answer: null })])
      svc.answerDecision(first.id, '- [spec] Add retry')
      await writeFile(join(files, 'spec.md'), '# Second')
      svc.raiseDecision(run.id, 'spec-approval', { question: 'Again?', options: ['Approve'], context: '', taskId: null })
      expect((await rt.spec(run.id))?.versions).toEqual([
        expect.objectContaining({ version: 1, answer: '- [spec] Add retry' }), expect.objectContaining({ version: 2, answer: null })
      ])
      expect((await rt.specVersion(run.id, 1))?.spec).toBe('# First')
      expect(await rt.spec('unknown')).toBeNull()
      await rt.stop()
      await rt.start()
      expect((await rt.spec(run.id))?.versions).toHaveLength(2)
      expect((await rt.spec(run.id))?.current.spec).toBe('# Second')
    } finally { await rt.stop() }
  })
})
