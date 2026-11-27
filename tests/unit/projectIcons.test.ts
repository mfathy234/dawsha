import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectIcons, findProjectIcon } from '../../src/main/projectIcons'

let root = ''
const put = (...parts: string[]): string => {
  const path = join(root, ...parts)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, 'x')
  return path
}

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'dawsha-icons-')) })
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('findProjectIcon', () => {
  it('finds nothing in an empty folder', () => {
    expect(findProjectIcon(root)).toBeNull()
  })

  it('prefers .dawsha/icon over a favicon', () => {
    put('favicon.svg')
    const own = put('.dawsha', 'icon.png')
    expect(findProjectIcon(root)).toBe(own)
  })

  it('looks at the root, then public, site and assets', () => {
    const inPublic = put('public', 'favicon.ico')
    expect(findProjectIcon(root)).toBe(inPublic)
    const atRoot = put('favicon.png')
    expect(findProjectIcon(root)).toBe(atRoot)
  })

  it('uses build/icon.png when there is no favicon', () => {
    const build = put('build', 'icon.png')
    expect(findProjectIcon(root)).toBe(build)
  })

  it('finds a favicon one folder under src', () => {
    const nested = put('src', 'web', 'favicon.svg')
    expect(findProjectIcon(root)).toBe(nested)
  })

  it('ignores empty files and folders deeper than one level', () => {
    writeFileSync(join(root, 'favicon.png'), '')
    put('src', 'a', 'b', 'favicon.svg')
    expect(findProjectIcon(root)).toBeNull()
  })
})

describe('ProjectIcons', () => {
  const project = (extra: object = {}) => ({ id: 'p1', name: 'One', folder: root, ...extra })

  it('uses the picked image over the folder icon, and nothing once initials are chosen', () => {
    put('favicon.svg')
    const picked = put('mine', 'logo.png')
    const icons = new ProjectIcons()
    expect(icons.pathFor(project({ iconPath: picked }))).toBe(picked)
    expect(icons.pathFor(project({ noIcon: true }))).toBeNull()
  })

  it('looks again after a rename', () => {
    const icons = new ProjectIcons()
    expect(icons.pathFor(project())).toBeNull()
    const found = put('favicon.svg')
    expect(icons.pathFor(project({ name: 'Renamed' }))).toBe(found)
  })

  it('ignores a picked file that is not an image', () => {
    const text = put('notes.txt')
    expect(new ProjectIcons().pathFor(project({ iconPath: text }))).toBeNull()
  })
})
