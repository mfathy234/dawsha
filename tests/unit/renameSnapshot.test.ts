import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.doUnmock('typescript'); vi.resetModules() })

it('loads the TypeScript scanner only when validating a TypeScript rename', async () => {
  let loads = 0
  vi.doMock('typescript', async importOriginal => {
    loads++
    return await importOriginal<typeof import('typescript')>()
  })
  vi.resetModules()
  const { validRename } = await import('../../src/main/codeNav/renameSnapshot')
  expect(loads).toBe(0)
  expect(await validRename('@class', 'csharp')).toBe(true)
  expect(loads).toBe(0)
  expect(await validRename('renamed', 'typescript')).toBe(true)
  expect(loads).toBe(1)
  expect(await validRename('class', 'typescript')).toBe(false)
  expect(await validRename('one two', 'typescript')).toBe(false)
})
