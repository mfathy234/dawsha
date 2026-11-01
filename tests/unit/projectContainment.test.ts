import { posix, win32 } from 'node:path'
import { expect, it } from 'vitest'
import { containsProjectPath } from '../../src/main/projectContainment'

it('rejects other drives, traversal and sibling prefixes on Windows', () => {
  expect(containsProjectPath('C:\\project', 'D:\\outside\\.editorconfig', win32)).toBe(false)
  expect(containsProjectPath('C:\\project', 'C:\\project2\\file', win32)).toBe(false)
  expect(containsProjectPath('C:\\project', 'C:\\outside\\file', win32)).toBe(false)
  expect(containsProjectPath('C:\\project', 'C:\\project\\src\\file', win32)).toBe(true)
  expect(containsProjectPath('C:\\project', 'c:\\project', win32)).toBe(true)
})

it('keeps the root itself and descendants inside on POSIX', () => {
  expect(containsProjectPath('/project', '/project', posix)).toBe(true)
  expect(containsProjectPath('/project', '/project/src/.editorconfig', posix)).toBe(true)
  expect(containsProjectPath('/project', '/project-elsewhere/file', posix)).toBe(false)
  expect(containsProjectPath('/project', '/outside/file', posix)).toBe(false)
})
