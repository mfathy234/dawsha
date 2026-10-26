// A comparable form of a folder path: forward slashes, no trailing slash, and lower case for Windows paths
// (drive letter or UNC), which are case-insensitive. Used as the key of file-watch events.
export function normalizeFolder(folder: string): string {
  const slashed = folder.replace(/\\/g, '/').replace(/\/+$/, '') || '/'
  return /^([a-zA-Z]:|\/\/)/.test(slashed) ? slashed.toLowerCase() : slashed
}
