import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { claimPendingWorktree, completePendingWorktree, configurePendingWorktrees, registerPendingWorktree, rememberPendingLaunch } from '../../src/main/worktreeSetupPending'
import { sanitizePendingWorktrees } from '../../src/shared/terminalSetup'

describe('pending worktree setup', () => {
  it('claims a checkout only once, persists its prompt and requires setup after restart', () => {
    const folder = mkdtempSync(join(tmpdir(), 'dawsha-pending-'))
    let saved: import('../../src/shared/terminalSetup').PendingWorktreeSetup[] = []
    try {
      configurePendingWorktrees([], (entries) => { saved = entries })
      registerPendingWorktree(folder, folder)
      const canonical = realpathSync.native(folder)
      expect(claimPendingWorktree(canonical)?.repo).toBe(folder)
      expect(claimPendingWorktree(folder)).toBeNull()
      rememberPendingLaunch(folder, { agent: 'codex', prompt: 'Keep this first prompt' })
      configurePendingWorktrees(saved, (entries) => { saved = entries })
      expect(claimPendingWorktree(folder)?.launch?.prompt).toBe('Keep this first prompt')
      completePendingWorktree(folder)
      expect(saved).toEqual([])
      configurePendingWorktrees(saved, () => undefined)
      expect(claimPendingWorktree(folder)).toBeNull()
    } finally {
      configurePendingWorktrees([], () => undefined)
      rmSync(folder, { recursive: true, force: true })
    }
  })

  it('rejects malformed paths and bounds the persisted registry', () => {
    const valid = { path: 'C:\\work\\tree', repo: 'C:\\work\\repo', launch: { agent: 'codex', prompt: 'hello', fullAccess: true } }
    expect(sanitizePendingWorktrees([valid, { path: '../outside', repo: valid.repo }, { path: valid.path, repo: 'bad\0root' }, valid])).toEqual([valid])
    expect(sanitizePendingWorktrees(Array.from({ length: 600 }, (_, i) => ({ path: `/work/tree${i}`, repo: '/work/repo' })))).toHaveLength(500)
  })
})
