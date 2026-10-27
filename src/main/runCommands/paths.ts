import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { safeRunRelativePath } from '../../shared/runCommands'

export async function runPath(
  root: string,
  input: unknown,
  directory = false
): Promise<string> {
  if (!safeRunRelativePath(input))
    throw new Error('Path is outside the selected checkout.')
  const base = await realpath(root)
  const file = resolve(base, input)
  const rel = relative(base, file)
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`))
    throw new Error('Path is outside the selected checkout.')
  let current = base
  for (const part of rel.split(sep).filter(Boolean)) {
    current = resolve(current, part)
    if ((await lstat(current)).isSymbolicLink())
      throw new Error('Symlink paths are not allowed for run commands.')
  }
  const canonical = await realpath(file)
  const canonicalRel = relative(base, canonical)
  if (
    isAbsolute(canonicalRel) ||
    canonicalRel === '..' ||
    canonicalRel.startsWith(`..${sep}`)
  )
    throw new Error('Path is outside the selected checkout.')
  const stat = await lstat(canonical)
  if (directory ? !stat.isDirectory() : !stat.isFile())
    throw new Error(
      directory
        ? 'Working directory is unavailable.'
        : 'Configuration file is unavailable.'
    )
  return canonical
}
