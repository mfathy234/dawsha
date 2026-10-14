import { describe, expect, it } from 'vitest'
import { pickWorkFolder, sameFolder } from '../../src/shared/workFolder'

describe('pickWorkFolder', () => {
  it('uses the project folder when no live cwd is known', () => {
    expect(pickWorkFolder('C:\\code\\app', null)).toBe('C:\\code\\app')
    expect(pickWorkFolder('C:\\code\\app', '  ')).toBe('C:\\code\\app')
    expect(pickWorkFolder(null, undefined)).toBeNull()
  })

  it('keeps the project folder when the live cwd is the same folder spelled differently', () => {
    expect(pickWorkFolder('C:\\code\\app', 'c:/code/app/')).toBe('C:\\code\\app')
  })

  it('follows a session into its worktree', () => {
    const worktree = 'C:\\code\\app\\.claude\\worktrees\\dark-mode'
    expect(pickWorkFolder('C:\\code\\app', worktree)).toBe(worktree)
    expect(pickWorkFolder(null, '/home/me/app-wt')).toBe('/home/me/app-wt')
  })

  it('compares POSIX paths case-sensitively and drive paths case-insensitively', () => {
    expect(sameFolder('/home/Me/app', '/home/me/app')).toBe(false)
    expect(sameFolder('D:\\Work\\App', 'd:/work/app')).toBe(true)
  })
})
