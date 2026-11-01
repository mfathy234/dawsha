import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { editorConfig } from '../../src/main/editorConfig'
import { writeProjectFile } from '../../src/main/gitWorkspace'

const folders: string[] = []
function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'dawsha-config-'))
  folders.push(root)
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src/a.ts'), 'a\r\nb\nc\r\n')
  return root
}
afterEach(() => folders.forEach(root => rmSync(root, { recursive: true, force: true })))

describe('project editorconfig', () => {
  it('merges matching globs, unsets inherited rules and stops at the project boundary', async () => {
    const root = project()
    writeFileSync(join(root, '.editorconfig'), '[*.{ts,js}]\nindent_style = space\nindent_size = 2\nend_of_line = crlf\ntrim_trailing_whitespace = true\n')
    writeFileSync(join(root, 'src/.editorconfig'), '[a.ts]\nindent_size = 4\nend_of_line = unset\ninsert_final_newline = false\n')
    expect(await editorConfig(root, 'src/a.ts')).toEqual({ indentStyle: 'space', indentSize: 4, tabWidth: 4, trimTrailingWhitespace: true, insertFinalNewline: false })
    expect(await editorConfig(join(root, 'src'), 'a.ts')).toEqual({ indentSize: 4, tabWidth: 4, insertFinalNewline: false })
    expect(await editorConfig(root, '../outside')).toEqual({})
  })

  it('honors root=true and never follows an editorconfig link outside the root', async () => {
    const root = project()
    writeFileSync(join(root, '.editorconfig'), '[*]\nindent_size=2\n')
    writeFileSync(join(root, 'src/.editorconfig'), 'root=true\n[*]\nindent_style=tab\ntab_width=8\n')
    expect(await editorConfig(root, 'src/a.ts')).toEqual({ indentStyle: 'tab', indentSize: 8, tabWidth: 8 })
    rmSync(join(root, 'src/.editorconfig'))
    const outside = project()
    try { symlinkSync(join(outside, 'src/a.ts'), join(root, 'src/.editorconfig')) } catch { return }
    expect(await editorConfig(root, 'src/a.ts')).toMatchObject({ indentSize: 2 })
  })

  it('preserves mixed endings without a rule', async () => {
    const root = project()
    const path = join(root, 'src/a.ts')
    expect(await writeProjectFile(root, 'src/a.ts', 'A\r\nb\nc\r\n', statSync(path).mtimeMs)).toMatchObject({ ok: true })
    expect(readFileSync(path, 'utf8')).toBe('A\r\nb\nc\r\n')
  })

  it('applies save rules, including CR and explicit false, only to edited files', async () => {
    const root = project()
    const path = join(root, 'src/a.ts')
    writeFileSync(join(root, '.editorconfig'), '[*]\nend_of_line=cr\ntrim_trailing_whitespace=true\ninsert_final_newline=false\n')
    const before = readFileSync(path, 'utf8')
    await writeProjectFile(root, 'src/a.ts', before, statSync(path).mtimeMs)
    expect(readFileSync(path, 'utf8')).toBe(before)
    await writeProjectFile(root, 'src/a.ts', 'edited  \nnext\n', statSync(path).mtimeMs)
    expect(readFileSync(path, 'utf8')).toBe('edited\rnext')
    writeFileSync(join(root, '.editorconfig'), '[*]\nend_of_line=lf\ninsert_final_newline=true\ntrim_trailing_whitespace=false\n')
    await writeProjectFile(root, 'src/a.ts', 'markdown  ', statSync(path).mtimeMs)
    expect(readFileSync(path, 'utf8')).toBe('markdown  \n')
    rmSync(path)
    await writeProjectFile(root, 'src/a.ts', 'new', 0)
    expect(readFileSync(path, 'utf8')).toBe('new\n')
  })
})
