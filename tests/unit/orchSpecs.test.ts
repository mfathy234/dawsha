import { mkdtemp, mkdir, writeFile, symlink, open, rename, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { snapshotSpec, listSpecVersions, readSpecVersion } from '../../src/main/orch/specs'

vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>()
  return { ...fs, open: vi.fn(fs.open) }
})

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'orch-spec-'))
  const run = join(root, 'run')
  const specs = join(root, 'specs')
  await mkdir(join(run, 'mockups'), { recursive: true })
  await writeFile(join(run, 'spec.md'), '# Goal\nExport CSV')
  await writeFile(join(run, 'mockups', 'export.html'), '<h1>Export</h1>')
  return { root, run, specs }
}

describe('spec versions', () => {
  it('accepts links above the worktree and the spec store, like /var on macOS', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orch-spec-'))
    await mkdir(join(root, 'real'))
    await symlink(join(root, 'real'), join(root, 'link'), 'junction')
    const run = join(root, 'link', 'wt', '.dawsha', 'runs', 'run_a')
    await mkdir(run, { recursive: true })
    await writeFile(join(run, 'spec.md'), '# Goal')
    const specs = join(root, 'link', 'specs')
    await expect(snapshotSpec(run, specs, 'run_a')).resolves.toMatchObject({ version: 1 })
    expect(await readSpecVersion(specs, 'run_a', 1)).toMatchObject({ spec: '# Goal' })
  })
  it('refuses a directory replaced by an outside junction while opening a file', async () => {
    const { root, run, specs } = await setup()
    const outside = join(root, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'spec.md'), 'private')
    const real = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    vi.mocked(open).mockImplementationOnce(async (...args: Parameters<typeof open>) => {
      await rename(run, join(root, 'original'))
      await symlink(outside, run, 'junction')
      const handle = await real.open(...args)
      await unlink(run)
      await rename(join(root, 'original'), run)
      return handle
    })
    await expect(snapshotSpec(run, specs, 'run_a')).rejects.toThrow(/symbolic|symlink|changed/i)
    expect(await listSpecVersions(specs, 'run_a')).toEqual([])
  })
  it('numbers immutable snapshots per run, preserving files and metadata', async () => {
    const { run, specs } = await setup()
    await snapshotSpec(run, specs, 'run_a', { decisionId: 'd1', createdAt: 10 })
    await writeFile(join(run, 'spec.md'), '# Revised')
    await snapshotSpec(run, specs, 'run_a', { decisionId: 'd2', createdAt: 20 })
    expect(await listSpecVersions(specs, 'run_a')).toEqual([
      { version: 1, decisionId: 'd1', createdAt: 10, answer: null },
      { version: 2, decisionId: 'd2', createdAt: 20, answer: null }
    ])
    expect(await readSpecVersion(specs, 'run_a', 1)).toEqual({ version: 1, spec: '# Goal\nExport CSV', mockups: [{ name: 'export.html', html: '<h1>Export</h1>' }] })
    expect((await readSpecVersion(specs, 'run_a', 2))?.spec).toBe('# Revised')
    expect(await readSpecVersion(specs, 'run_a', 3)).toBeNull()
    expect(await listSpecVersions(specs, 'run_b')).toEqual([])
  })
  it.each(['../escape', '', 'a/b', 'a\\b', '.'])('rejects unsafe run id %j', async (id) => {
    const { run, specs } = await setup()
    await expect(snapshotSpec(run, specs, id)).rejects.toThrow(/run/i)
  })
  it.each(['spec', 'mockup', 'count', 'name', 'directory'])('rejects %s limits without publishing a version', async (kind) => {
    const { run, specs } = await setup()
    if (kind === 'spec') await writeFile(join(run, 'spec.md'), Buffer.alloc(512 * 1024 + 1))
    if (kind === 'mockup') await writeFile(join(run, 'mockups', 'export.html'), Buffer.alloc(1024 * 1024 + 1))
    if (kind === 'count') for (let i = 0; i < 30; i++) await writeFile(join(run, 'mockups', `${i}.html`), '')
    if (kind === 'name') await writeFile(join(run, 'mockups', 'bad.js'), '')
    if (kind === 'directory') await mkdir(join(run, 'mockups', 'nested.html'))
    await expect(snapshotSpec(run, specs, 'run_a')).rejects.toThrow()
    expect(await listSpecVersions(specs, 'run_a')).toEqual([])
  })
  it('refuses directory symlinks to files outside the run', async () => {
    const { root, run, specs } = await setup()
    const outside = join(root, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'spec.md'), 'private')
    await symlink(outside, join(run, 'linked'), 'junction')
    await expect(snapshotSpec(join(run, 'linked'), specs, 'run_a')).rejects.toThrow(/symbolic|symlink/i)
    await symlink(outside, join(run, 'mockups', 'escape.html'), 'junction')
    await expect(snapshotSpec(run, specs, 'run_a')).rejects.toThrow(/symbolic|symlink/i)
  })
  it('rejects invalid version numbers', async () => {
    const { specs } = await setup()
    for (const version of [0, -1, 1.5, NaN]) await expect(readSpecVersion(specs, 'run_a', version)).rejects.toThrow(/version/i)
  })
})
