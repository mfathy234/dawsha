const normalize = (path: string): string => {
  const forward = path.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  return /^[a-z]:/i.test(forward) ? forward.toLowerCase() : forward
}

export const sameFolder = (a: string, b: string): boolean => normalize(a) === normalize(b)

/**
 * The folder a session is really working in. Agents can move into a git worktree after they start
 * (Claude's worktree mode, `claude -w`, Codex in another checkout), and they report that live cwd.
 * Use it when it is known and different from the project folder; otherwise use the project folder.
 */
export function pickWorkFolder(base: string | null, liveCwd: string | null | undefined): string | null {
  const live = liveCwd?.trim()
  if (!live) return base
  if (base && sameFolder(base, live)) return base
  return live
}
