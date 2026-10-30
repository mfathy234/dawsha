export interface CommitFileChange {
  status: 'A' | 'M' | 'D' | 'R'
  path: string
  oldPath?: string
  added: number | null
  removed: number | null
}

export interface CommitDetails {
  hash: string
  author: string
  email: string
  authorAt: number
  committer: string
  committerEmail: string
  committerAt: number
  parents: string[]
  subject: string
  body: string
  refs: string[]
  files: CommitFileChange[]
  added: number
  removed: number
}

export type CommitDetailsResult = { ok: true; details: CommitDetails } | { ok: false; error: string }
export type CommitFileResult = { ok: true; diff: string; text: string | null; truncated: boolean; binary: boolean } | { ok: false; error: string }

/** Parse a NUL-delimited `git show --format=... --numstat -z` record. */
export function parseCommitShow(output: string, statusOutput = ''): Omit<CommitDetails, 'refs'> {
  const separator = output.indexOf('\x1e')
  const header = separator < 0 ? output : output.slice(0, separator)
  const numstat = separator < 0 ? '' : output.slice(separator + 1).replace(/^\r?\n/, '')
  const [hash = '', author = '', email = '', authorAt = '0', committer = '', committerEmail = '', committerAt = '0', parents = '', subject = '', body = ''] = header.split('\x1f')
  const files: CommitFileChange[] = []
  const records = numstat.split('\0')
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i]
    if (!record) continue
    const fields = record.split('\t')
    if (fields.length === 3) {
      const [addedRaw, removedRaw, path] = fields
      if (path === '') {
        const oldPath = records[++i] ?? ''
        const newPath = records[++i] ?? oldPath
        files.push({ status: 'R', oldPath, path: newPath, added: addedRaw === '-' ? null : Number(addedRaw), removed: removedRaw === '-' ? null : Number(removedRaw) })
      } else files.push({ status: addedRaw === '-' && removedRaw === '-' ? 'M' : 'M', path, added: addedRaw === '-' ? null : Number(addedRaw), removed: removedRaw === '-' ? null : Number(removedRaw) })
    } else if (fields.length === 2) {
      const [addedRaw, removedRaw] = fields
      const oldPath = records[++i] ?? ''
      const path = records[++i] ?? oldPath
      files.push({ status: 'R', oldPath, path, added: addedRaw === '-' ? null : Number(addedRaw), removed: removedRaw === '-' ? null : Number(removedRaw) })
    }
  }
  const statusRecords = statusOutput.split('\0')
  for (let i = 0; i < statusRecords.length; i += 1) {
    const status = statusRecords[i]
    if (!status) continue
    const path = status.startsWith('R') || status.startsWith('C') ? statusRecords[i + 2] : statusRecords[i + 1]
    if (status.startsWith('R') && path) {
      const oldPath = statusRecords[i + 1]
      const file = files.find((candidate) => candidate.path === path)
      if (file) { file.status = 'R'; file.oldPath = oldPath }
      i += 2
    } else if (/^[AMD]$/.test(status) && path) {
      const file = files.find((candidate) => candidate.path === path)
      if (file) file.status = status as 'A' | 'M' | 'D'
      i += 1
    }
  }
  const totals = files.reduce((sum, file) => ({ added: sum.added + (file.added ?? 0), removed: sum.removed + (file.removed ?? 0) }), { added: 0, removed: 0 })
  return { hash, author, email, authorAt: Number(authorAt) * 1000, committer, committerEmail, committerAt: Number(committerAt) * 1000, parents: parents ? parents.split(' ') : [], subject, body, files, ...totals }
}
