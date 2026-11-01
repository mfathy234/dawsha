import { realpath, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { repoRoot } from '../gitCommit'
import { projectFiles } from '../gitWorkspace'
import { containsProjectPath } from '../projectContainment'

export async function validRename(name: string, engine: string): Promise<boolean> {
  if (engine !== 'typescript') return true // C# accepts escaped identifiers; its rename provider validates language-specific names.
  const { createScanner, ScriptTarget, SyntaxKind } = await import('typescript')
  const scanner = createScanner(ScriptTarget.Latest, true, undefined, name)
  return scanner.scan() === SyntaxKind.Identifier && scanner.scan() === SyntaxKind.EndOfFileToken
}

/** Capture identities and mtimes before asking the server, so its ranges cannot be paired with newer text. */
export async function renameSnapshot(folder: string): Promise<ReadonlyMap<string, number>> {
  const listed = await projectFiles(folder)
  if (!listed.ok || listed.truncated) throw new Error('Too many files to snapshot rename safely.')
  const root = await realpath(await repoRoot(folder) ?? folder)
  const scope = await realpath(folder)
  const entries = new Map<string, number>()
  for (let from = 0; from < listed.files.length; from += 100) {
    const batch = await Promise.all(listed.files.slice(from, from + 100).map(async path => {
      const full = await realpath(join(root, path)).catch(() => null)
      if (!full || !containsProjectPath(scope, full)) return null
      const info = await stat(full).catch(() => null)
      return info?.isFile() ? [relative(root, full).replace(/\\/g, '/'), info.mtimeMs] as const : null
    }))
    for (const entry of batch) if (entry) entries.set(entry[0], entry[1])
  }
  return entries
}
