import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { activeTermId, closeApp, createSandbox, lastInput, launchApp, type Sandbox } from './helpers'

const SCREENS = 'test-results/screens'
const A_TS = 'export const one = 1\nexport function run() {\n  return one\n}\n'

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid', ...args], { cwd, encoding: 'utf8' }).trim()

// main has a.ts and helpers.ts; the feature branch edits a.ts (so Changes shows a diff against main), and the working tree
// has one modified file (README.md) and one untracked file (src/new.ts).
function makeRepo(sandbox: Sandbox): string {
  const repo = sandbox.projectFolder
  mkdirSync(join(repo, 'src', 'util'), { recursive: true })
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'src', 'a.ts'), 'export const one = 1\n')
  writeFileSync(join(repo, 'src', 'util', 'helpers.ts'), 'export const help = true\n')
  writeFileSync(join(repo, 'README.md'), 'hello\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'first')
  git(repo, 'checkout', '-q', '-b', 'feature')
  writeFileSync(join(repo, 'src', 'a.ts'), A_TS)
  git(repo, 'commit', '-q', '-am', 'edit a')
  writeFileSync(join(repo, 'README.md'), 'hello again\n')
  writeFileSync(join(repo, 'src', 'new.ts'), 'export const fresh = 1\n')
  return repo
}

const editor = (page: Page) => page.locator('.files-editor:not([hidden]) .cm-content')
const diskText = (repo: string, rel: string): string => readFileSync(join(repo, ...rel.split('/')), 'utf8')

async function openA(page: Page): Promise<void> {
  await expect(page.locator('#files-view')).toBeVisible()
  await page.locator('.files-row[data-path="src"]').click()
  await page.locator('.files-row[data-path="src/a.ts"]').click()
  await expect(editor(page)).toContainText('export function run')
}

test('Files opens a file read-only, lets you copy from it, and Changes toggles without losing edits', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  const repo = makeRepo(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    await page.locator('#files-button').click()
    await expect(page.locator('#files-view')).toBeVisible()
    await expect(page.locator('#files-button')).toHaveAttribute('aria-pressed', 'true')
    // the projects sidebar steps aside in Files and comes back afterwards
    await expect(page.locator('.sidebar')).toBeHidden()
    await expect(page.locator('.files-row[data-path="README.md"] .files-badge')).toHaveText('M')

    await openA(page)
    await expect(page.locator('.files-row[data-path="src/new.ts"] .files-badge')).toHaveText('A')
    await expect(page.locator('.files-tab.active')).toContainText('a.ts')
    await expect(page.locator('.files-tab.active')).toHaveClass(/preview/)
    await expect(page.locator('#files-status')).toContainText('Read only')
    await expect(page.locator('#files-status')).toContainText('TypeScript')
    await page.screenshot({ path: join(SCREENS, '60-files-file.png') })

    // read-only, yet it can be selected and copied
    await page.evaluate(() => {
      const w = window as unknown as { __copied?: string }
      document.addEventListener('copy', (event) => {
        w.__copied = event.clipboardData?.getData('text/plain') ?? ''
      })
    })
    await app.evaluate(({ clipboard }) => clipboard.writeText('before'))
    await editor(page).click()
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Control+c')
    await expect.poll(() => page.evaluate(() => (window as unknown as { __copied?: string }).__copied)).toBe(A_TS)
    // the system clipboard itself round-trips on CI; a local desktop session may block it
    if (process.env.CI) await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(A_TS)
    await page.keyboard.type('zzz')
    expect(await editor(page).textContent()).not.toContain('zzz')

    // Changes shows the diff against main; pressing it again shows the file
    await page.locator('#files-changes').click()
    await expect(page.locator('#files-changes')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.files-editor:not([hidden]) .cm-changedLine').first()).toBeVisible()
    await expect(page.locator('#files-status')).toContainText('since main')
    await page.screenshot({ path: join(SCREENS, '61-files-changes.png') })
    await page.locator('#files-changes').click()
    await expect(page.locator('#files-changes')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('.files-editor:not([hidden]) .cm-changedLine')).toHaveCount(0)

    // edit: the tab is pinned and dirty, and toggling Changes never loses the text
    await editor(page).click()
    await page.keyboard.press('e')
    await page.keyboard.press('Control+End')
    await page.keyboard.type('// my edited')
    await expect(page.locator('#files-edit')).toHaveText('Done')
    // every typed character arrives, the slashes included
    expect(await editor(page).textContent()).toMatch(/\}\/\/ my edited$/)
    await expect(page.locator('.files-tab.active')).toHaveClass(/dirty/)
    await expect(page.locator('.files-tab.active')).not.toHaveClass(/preview/)
    await page.locator('#files-changes').click()
    await expect(page.locator('#files-changes')).toHaveAttribute('aria-pressed', 'true')
    await expect(editor(page)).toContainText('// my edited')
    await page.locator('#files-changes').click()
    await expect(page.locator('#files-changes')).toHaveAttribute('aria-pressed', 'false')
    await expect(editor(page)).toContainText('// my edited')
    await editor(page).click()
    await page.keyboard.press('Control+z')
    expect(await editor(page).textContent()).not.toContain('// my edited')
    await page.keyboard.press('Control+y')
    await expect(editor(page)).toContainText('// my edited')

    // closing a tab with unsaved edits asks first and names the file
    await page.locator('.files-tab.active .files-tab-close').click()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toContainText('a.ts')
    await expect(confirm.getByRole('button', { name: /Discard changes to a\.ts/ })).toBeVisible()
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.locator('.files-tab.active')).toHaveClass(/dirty/)

    // save writes to disk
    await editor(page).click()
    await page.keyboard.press('Control+s')
    await expect.poll(() => diskText(repo, 'src/a.ts')).toContain('// my edited')
    await expect(page.locator('.files-tab.active')).not.toHaveClass(/dirty/)

    // a change on disk while editing shows the conflict bar; Reload theirs takes the disk text
    await page.keyboard.type(' mine')
    writeFileSync(join(repo, 'src', 'a.ts'), 'export const theirs = 2\n')
    await expect(page.locator('#files-conflict')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('#files-conflict')).toContainText('This file changed on disk.')
    await page.screenshot({ path: join(SCREENS, '62-files-conflict.png') })
    await page.locator('#files-reload-theirs').click()
    await expect(page.locator('#files-conflict')).toBeHidden()
    await expect(editor(page)).toContainText('export const theirs = 2')

    // Keep mine overwrites what is on disk
    await editor(page).click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('// keep')
    writeFileSync(join(repo, 'src', 'a.ts'), 'export const other = 3\n')
    await expect(page.locator('#files-conflict')).toBeVisible({ timeout: 10_000 })
    await page.locator('#files-keep-mine').click()
    await expect(page.locator('#files-conflict')).toBeHidden()
    await expect.poll(() => diskText(repo, 'src/a.ts')).toContain('// keep')

    // open tabs are remembered per project
    await expect.poll(() => JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8')).filesTabs).toEqual({ [`smoke|${repo.replace(/\\/g, '/').toLowerCase()}`]: ['src/a.ts'] })
  } finally {
    await closeApp(app)
  }
})

test('a write outside the project and a folder that is not a project are both refused', async () => {
  const sandbox = createSandbox()
  const repo = makeRepo(sandbox)
  const stranger = join(sandbox.root, 'stranger')
  mkdirSync(stranger, { recursive: true })
  writeFileSync(join(stranger, 'secret.txt'), 'untouched\n')
  const { app, page } = await launchApp(sandbox)
  try {
    const mtime = await page.evaluate(async (folder) => {
      const read = await window.gridApi.projectFile(folder, 'src/a.ts')
      return read.ok ? read.mtimeMs : -1
    }, repo)
    expect(mtime).toBeGreaterThan(0)
    const outside = await page.evaluate((folder) => window.gridApi.writeProjectFile(folder, '../x.txt', 'pwn', 0), repo)
    expect(outside.ok).toBe(false)
    const notProject = await page.evaluate(async (folder) => ({
      write: await window.gridApi.writeProjectFile(folder, 'secret.txt', 'pwn', 0),
      read: await window.gridApi.projectFile(folder, 'secret.txt'),
      list: await window.gridApi.projectFiles(folder),
      base: await window.gridApi.fileAgainstBase(folder, 'secret.txt')
    }), stranger)
    expect(notProject.write.ok).toBe(false)
    expect(notProject.read.ok).toBe(false)
    expect(notProject.list.ok).toBe(false)
    expect(notProject.base.ok).toBe(false)
    expect(readFileSync(join(stranger, 'secret.txt'), 'utf8')).toBe('untouched\n')
    const saved = await page.evaluate((folder) => window.gridApi.writeProjectFile(folder, 'src/a.ts', 'export const saved = 1\n', 0), repo)
    expect(saved).toMatchObject({ ok: false, conflict: true })
  } finally {
    await closeApp(app)
  }
})

test('Ctrl+P opens quick open from a terminal, opens files in Files and adds them to the prompt', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  makeRepo(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    await expect(page.locator('.pane')).toHaveCount(1)
    const id = await activeTermId(page)
    await page.locator('.term-host.active').click()
    await expect(page.locator('.term-host.active .xterm-helper-textarea')).toBeFocused()

    await page.keyboard.press('Control+p')
    await expect(page.locator('#quick-open-input')).toBeFocused()
    await page.keyboard.type('a.ts')
    await expect(page.locator('.qo-row').first()).toHaveAttribute('data-path', 'src/a.ts')
    await expect(page.locator('#quick-open-preview')).toContainText('export function run')
    await page.screenshot({ path: join(SCREENS, '63-files-quick-open.png') })
    await page.keyboard.press('Enter')
    await expect(page.locator('#files-view')).toBeVisible()
    await expect(page.locator('.files-tab.active')).toContainText('a.ts')
    await expect(editor(page)).toContainText('export function run')

    // Add to prompt types @path#Lx-y for a selection into the focused session and shows the grid
    await editor(page).click()
    await page.keyboard.press('Control+a')
    await page.locator('#files-send').click()
    await page.getByRole('menuitem').first().click()
    await expect(page.locator('.pane')).toBeVisible()
    await expect.poll(() => lastInput(page, id)).toBe('@src/a.ts#L1-4 ')

    // Alt+Enter adds the highlighted file instead
    await page.locator('.term-host.active').click()
    await page.keyboard.press('Control+p')
    await page.keyboard.type('helpers')
    await page.keyboard.press('Alt+Enter')
    await expect(page.locator('#quick-open-input')).toHaveCount(0)
    await expect.poll(() => lastInput(page, id)).toBe('@src/util/helpers.ts ')

    // Esc closes the overlay
    await page.locator('.term-host.active').click()
    await page.keyboard.press('Control+p')
    await expect(page.locator('#quick-open-input')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('#quick-open-input')).toHaveCount(0)

    // the Changes section lists only the modified and new files, as a flat list
    await page.locator('#files-button').click()
    await expect(page.locator('#files-changes-list .files-flat')).toHaveCount(2)
    await expect(page.locator('#files-changes-list .files-flat .files-flat-name')).toHaveText(['README.md', 'new.ts'])
    await expect(page.locator('#files-changes-list .files-flat[data-path="src/new.ts"] .files-flat-dir')).toHaveText('src')
    await page.screenshot({ path: join(SCREENS, '64-files-changed-filter.png') })
  } finally {
    await closeApp(app)
  }
})

test('closing the window with unsaved Files tabs asks first, naming the file, and Cancel keeps everything', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  const repo = makeRepo(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    await page.locator('#files-button').click()
    await openA(page)
    await editor(page).click()
    await page.keyboard.press('e')
    await page.keyboard.type('// unsaved')
    await expect(page.locator('.files-tab.active')).toHaveClass(/dirty/)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toContainText('a.ts')
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(confirm).toHaveCount(0)
    await expect(editor(page)).toContainText('// unsaved')
    expect(diskText(repo, 'src/a.ts')).not.toContain('// unsaved')
    await page.locator('#sessions-button').click()
    await expect(page.locator('.sidebar')).toBeVisible()
    // The cancellation assertions are complete; discard the fixture edit so teardown can quit normally.
    await page.locator('#files-button').click()
    await page.locator('.files-tab-close').click()
    await page.getByRole('button', { name: /^Discard changes to/ }).click()
    await expect(page.locator('.files-tab')).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})

test('a file deleted on disk while edited can be saved again, and a touched but identical file is no conflict', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  const repo = makeRepo(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    await page.locator('#files-button').click()
    await openA(page)
    // touching the file without changing it raises nothing
    writeFileSync(join(repo, 'src', 'a.ts'), A_TS)
    await page.waitForTimeout(1500)
    await expect(page.locator('#files-conflict')).toBeHidden()
    await editor(page).click()
    await page.keyboard.press('e')
    await page.keyboard.press('Control+End')
    await page.keyboard.type('// back')
    rmSync(join(repo, 'src', 'a.ts'))
    await expect(page.locator('#files-conflict')).toContainText('deleted', { timeout: 10_000 })
    await page.locator('#files-keep-mine').click()
    await expect.poll(() => {
      try {
        return diskText(repo, 'src/a.ts')
      } catch {
        return ''
      }
    }).toContain('// back')
    await expect(page.locator('#files-conflict')).toBeHidden()
  } finally {
    await closeApp(app)
  }
})
