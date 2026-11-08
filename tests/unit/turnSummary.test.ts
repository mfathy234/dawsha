import { describe, expect, it } from 'vitest'
import { turnSummaries } from '../../src/shared/turnSummary'
import type { ChatItem } from '../../src/shared/chatLog'

const edit = (id: string, path: string, added: number, removed: number, activity: 'edit' | 'create' = 'edit'): ChatItem => ({
  kind: 'tool', id, activity, verb: activity === 'create' ? 'Created' : 'Edited', target: path, path,
  added, removed, output: '', outputTruncated: false, done: true
})
const agent = (id: string): ChatItem => ({ kind: 'message', id, role: 'agent', text: 'Done' })
const user = (id: string): ChatItem => ({ kind: 'message', id, role: 'user', text: 'Change this' })

describe('turnSummaries', () => {
  it('merges edits to a file and emits a summary at the finished agent reply', () => {
    expect(turnSummaries([user('u'), edit('e1', 'src/a.ts', 2, 1), edit('e2', 'src/a.ts', 3, 4), agent('a')])).toEqual([
      { messageId: 'a', files: [{ path: 'src/a.ts', status: 'M', added: 5, removed: 5 }], added: 5, removed: 5 }
    ])
  })

  it('marks new and deleted files, separates turns at user messages, and accepts Claude and Codex parsed shapes', () => {
    const items: ChatItem[] = [
      user('u1'), edit('claude-write', 'new.ts', 8, 0, 'create'), agent('a1'),
      user('u2'),
      { kind: 'tool', id: 'patch', activity: 'edit', verb: 'Deleted', target: 'old.ts', path: 'old.ts', added: 0, removed: 6, output: '', outputTruncated: false, done: true },
      { kind: 'tool', id: 'codex-patch', activity: 'edit', verb: 'Edited', target: 'src/x.ts', path: 'src/x.ts', added: 1, removed: 2, output: '', outputTruncated: false, done: true }, agent('a2')
    ]
    expect(turnSummaries(items)).toEqual([
      { messageId: 'a1', files: [{ path: 'new.ts', status: 'A', added: 8, removed: 0 }], added: 8, removed: 0 },
      { messageId: 'a2', files: [{ path: 'old.ts', status: 'D', added: 0, removed: 6 }, { path: 'src/x.ts', status: 'M', added: 1, removed: 2 }], added: 1, removed: 8 }
    ])
  })
})
