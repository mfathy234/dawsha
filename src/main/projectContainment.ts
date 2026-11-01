import { isAbsolute, relative } from 'node:path'

export function containsProjectPath(root: string, file: string, paths = { relative, isAbsolute }): boolean {
  const rel = paths.relative(root, file)
  return !paths.isAbsolute(rel) && !rel.split(/[\\/]/).includes('..')
}
