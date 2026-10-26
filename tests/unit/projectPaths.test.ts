import { describe, expect, it } from 'vitest'
import { toProjectPath, toRepoPath } from '../../src/shared/projectPaths'

describe('project paths', () => {
  it('strips and adds the project prefix', () => {
    expect(toProjectPath('packages/web', 'packages/web/src/a.ts')).toBe('src/a.ts')
    expect(toProjectPath('', 'src/a.ts')).toBe('src/a.ts')
    expect(toProjectPath('packages/web', 'packages/webby/a.ts')).toBe('packages/webby/a.ts')
    expect(toRepoPath('packages/web', 'src/a.ts')).toBe('packages/web/src/a.ts')
    expect(toRepoPath('', 'src/a.ts')).toBe('src/a.ts')
  })
})
