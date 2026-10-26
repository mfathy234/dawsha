// A project can be a sub folder of its git repository. Files lists repo-relative paths, while a session runs in the
// project folder, so prompts and session edits use the project-relative form. `prefix` is the project's place in
// the repo ("" when the project is the repo root, otherwise "packages/web", without a trailing slash).

/** The path as the agent sees it from the project folder. */
export function toProjectPath(prefix: string, repoPath: string): string {
  return prefix !== '' && repoPath.startsWith(`${prefix}/`) ? repoPath.slice(prefix.length + 1) : repoPath
}

/** A path relative to the project folder, as a repo-relative path. */
export function toRepoPath(prefix: string, projectPath: string): string {
  return prefix === '' ? projectPath : `${prefix}/${projectPath}`
}
