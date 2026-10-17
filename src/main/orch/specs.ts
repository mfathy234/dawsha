import { lstat, mkdir, open, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import type { OrchSpecContent, OrchSpecVersion } from '../../shared/orch/api'

const SPEC_LIMIT = 512 * 1024
const MOCKUP_LIMIT = 1024 * 1024
const MOCKUP_COUNT = 30

export function validSpecRunId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id)
}

function folder(root: string, runId: string): string {
  if (!validSpecRunId(runId)) throw new Error('Invalid spec run id.')
  return join(root, runId)
}

/**
 * Reject links in every path component below `base`, including .dawsha and mockups directory junctions.
 * Folders above it (the worktree or the spec store) are the user's own and may be links: /var on macOS is one.
 */
async function noLinks(path: string, base: string): Promise<void> {
  const absolute = resolve(path)
  const inside = relative(resolve(base), absolute)
  if (inside.startsWith('..') || isAbsolute(inside)) throw new Error('Spec files must stay inside the run.')
  let current = resolve(base)
  for (const part of inside.split(/[\\/]/).filter(Boolean)) {
    current = join(current, part)
    if ((await lstat(current)).isSymbolicLink()) throw new Error('Spec files cannot use symbolic links.')
  }
}

async function readLimited(path: string, limit: number, base: string): Promise<string> {
  await noLinks(path, base)
  const before = await lstat(path)
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const stat = await file.stat()
    await noLinks(path, base)
    const after = await lstat(path)
    if (stat.dev !== before.dev || stat.ino !== before.ino || stat.dev !== after.dev || stat.ino !== after.ino) {
      throw new Error('Spec file changed while opening it.')
    }
    if (!stat.isFile()) throw new Error('Spec content must be a regular file.')
    if (stat.size > limit) throw new Error('Spec file exceeds its size limit.')
    const buffer = Buffer.alloc(limit + 1)
    let size = 0
    while (size < buffer.length) {
      const read = await file.read(buffer, size, buffer.length - size, null)
      if (!read.bytesRead) break
      size += read.bytesRead
    }
    if (size > limit) throw new Error('Spec file exceeds its size limit.')
    return buffer.subarray(0, size).toString('utf8')
  } finally { await file.close() }
}

const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT'

async function content(path: string, version: number, base: string): Promise<OrchSpecContent> {
  const spec = await readLimited(join(path, 'spec.md'), SPEC_LIMIT, base)
  const mockupsPath = join(path, 'mockups')
  let names: string[] = []
  try {
    await noLinks(mockupsPath, base)
    names = await readdir(mockupsPath)
  } catch (error) { if (!missing(error)) throw error }
  if (names.length > MOCKUP_COUNT) throw new Error('A spec can have at most 30 mockups.')
  const mockups: OrchSpecContent['mockups'] = []
  for (const name of names.sort()) {
    if (!/^[^/\\\x00-\x1f]+\.html$/.test(name)) throw new Error('Only HTML files directly in mockups are allowed.')
    mockups.push({ name, html: await readLimited(join(mockupsPath, name), MOCKUP_LIMIT, base) })
  }
  return { version, spec, mockups }
}

export async function listSpecVersions(specsRoot: string, runId: string): Promise<OrchSpecVersion[]> {
  const run = folder(specsRoot, runId)
  let names: string[]
  try { await noLinks(run, specsRoot); names = await readdir(run) } catch (error) { if (missing(error)) return []; throw error }
  const versions: OrchSpecVersion[] = []
  for (const name of names.filter((n) => /^v[1-9]\d*$/.test(n))) {
    const version = Number(name.slice(1))
    const raw: unknown = JSON.parse(await readLimited(join(run, name, 'version.json'), 4096, specsRoot))
    const meta = raw as OrchSpecVersion
    if (meta.version !== version || !Number.isFinite(meta.createdAt) || (meta.decisionId !== null && typeof meta.decisionId !== 'string')) throw new Error('Invalid spec version metadata.')
    versions.push({ version, createdAt: meta.createdAt, decisionId: meta.decisionId, answer: null })
  }
  return versions.sort((a, b) => a.version - b.version)
}

/** runFolder is .dawsha/runs/<runId> within the run worktree. Publish only complete snapshots. */
export async function snapshotSpec(
  runFolder: string, specsRoot: string, runId: string,
  metadata: { decisionId?: string; createdAt?: number } = {}
): Promise<OrchSpecVersion> {
  const run = folder(specsRoot, runId)
  // runFolder is <worktree>/.dawsha/runs/<runId>; agents control everything below the worktree.
  const source = await content(runFolder, 0, resolve(runFolder, '..', '..', '..'))
  const versions = await listSpecVersions(specsRoot, runId)
  const version = (versions.at(-1)?.version ?? 0) + 1
  const meta: OrchSpecVersion = { version, createdAt: metadata.createdAt ?? Date.now(), decisionId: metadata.decisionId ?? null, answer: null }
  await mkdir(run, { recursive: true })
  await noLinks(run, specsRoot)
  const staging = join(run, `.pending-${randomUUID()}`)
  await mkdir(join(staging, 'mockups'), { recursive: true })
  try {
    await writeFile(join(staging, 'spec.md'), source.spec, 'utf8')
    for (const mockup of source.mockups) await writeFile(join(staging, 'mockups', mockup.name), mockup.html, 'utf8')
    await writeFile(join(staging, 'version.json'), JSON.stringify(meta), 'utf8')
    await rename(staging, join(run, `v${version}`))
    return meta
  } finally { await rm(staging, { recursive: true, force: true }) }
}

export async function readSpecVersion(specsRoot: string, runId: string, version: number): Promise<OrchSpecContent | null> {
  const run = folder(specsRoot, runId)
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('Invalid spec version.')
  const path = join(run, `v${version}`)
  try { await lstat(path) } catch (error) { if (missing(error)) return null; throw error }
  return content(path, version, specsRoot)
}
