import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { closeApp, createSandbox, launchApp } from './helpers'

// A project that is a sub folder of its git repository (a monorepo): Files lists repo-relative paths, so the code
// navigation, rename and gutter requests must use them too. They once sent project-relative paths and found nothing.

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.invalid', ...args], { cwd, encoding: 'utf8' }).trim()

function put(root: string, rel: string, text: string): void {
  const full = join(root, ...rel.split('/'))
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, text)
}

const PROJECT = 'Smoke Project'
const editor = (page: Page) => page.locator('.files-editor:not([hidden]) .cm-content')
const token = (page: Page, name: string, line = name) => page.locator('.files-editor:not([hidden]) .cm-line', { hasText: line }).locator('span', { hasText: new RegExp(`^${name}$`) }).first()
const read = (root: string, rel: string): string => readFileSync(join(root, ...rel.split('/')), 'utf8')

// The language service starts in the background: keep asking until the answer jumps to the file.
async function jumpTo(page: Page, file: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await page.keyboard.press('F12')
    await page.waitForTimeout(2000)
    if (await page.locator('.files-tab.active', { hasText: file }).count()) return
    await page.keyboard.press('Escape')
  }
  await expect(page.locator('.files-tab.active')).toContainText(file)
}

test('in a project below the git root F12, Back, Ctrl+D, F2 and Stage from the gutter all find their files', async () => {
  test.setTimeout(240_000)
  const sandbox = createSandbox()
  const repo = sandbox.root
  const root = sandbox.projectFolder
  git(repo, 'init', '-q', '-b', 'main')
  put(root, 'tsconfig.json', JSON.stringify({ compilerOptions: { target: 'es2020', module: 'esnext', strict: true, noEmit: true }, include: ['src'] }))
  put(root, 'src/store.ts', 'export function makeStore(): number {\n  return 1\n}\n')
  put(root, 'src/app.ts', "import { makeStore } from './store'\n\nconst a = makeStore()\nconst b = makeStore()\n")
  git(repo, 'add', PROJECT)
  git(repo, 'commit', '-q', '-m', 'one')
  const { app, page } = await launchApp(sandbox)
  try {
    await page.setViewportSize({ width: 1024, height: 728 })
    await page.locator('#files-button').click()
    await page.locator(`.files-row[data-path="${PROJECT}"]`).click()
    await page.locator(`.files-row[data-path="${PROJECT}/src"]`).click()
    await page.locator(`.files-row[data-path="${PROJECT}/src/app.ts"]`).click()
    await expect(editor(page)).toBeVisible()

    await token(page, 'makeStore', 'const a').click()
    await jumpTo(page, 'store.ts')
    await expect(page.locator('#files-status-pos')).toContainText('Ln 1')
    await page.keyboard.press('Alt+ArrowLeft')
    await expect(page.locator('.files-tab.active')).toContainText('app.ts')

    await token(page, 'makeStore', 'const a').click()
    await page.keyboard.press('Control+d')
    await page.keyboard.press('Control+d')
    expect(await page.locator('.files-editor:not([hidden]) .cm-selectionBackground').count()).toBeGreaterThanOrEqual(2)
    await page.keyboard.press('Escape')

    await token(page, 'makeStore', 'const a').click()
    const dialog = page.locator('.edit-preview')
    for (let attempt = 0; attempt < 30 && !(await dialog.isVisible()); attempt += 1) {
      await page.keyboard.press('F2')
      await page.locator('.dialog input.text-input').fill('buildStore')
      await page.keyboard.press('Enter')
      await dialog.waitFor({ state: 'visible', timeout: 4000 }).catch(() => page.waitForTimeout(1500))
    }
    await expect(dialog.locator('.edit-preview-file')).toHaveCount(2)
    await page.locator('#edit-preview-apply').click()
    await page.locator('.overlay:not(.leaving) [role="alertdialog"] [data-confirm]').click()
    await expect.poll(() => read(root, 'src/app.ts')).toContain('buildStore()')
    await expect.poll(() => read(root, 'src/store.ts')).toContain('export function buildStore()')

    await expect(page.locator('.overlay')).toHaveCount(0)
    writeFileSync(join(root, 'src/store.ts'), 'export function buildStore(): number {\n  return 2\n}\n')
    await page.locator(`.files-row[data-path="${PROJECT}/src/store.ts"]`).click()
    await page.locator('#files-changes').click()
    await expect(page.locator('.files-editor:not([hidden]) .cm-hunk-btn')).toHaveCount(1, { timeout: 15_000 })
    await page.locator('.files-editor:not([hidden]) .cm-hunk-btn').first().click()
    await page.getByRole('menuitem', { name: 'Stage this change' }).click()
    await expect.poll(() => git(repo, 'diff', '--cached', '--stat')).toContain('store.ts')
  } finally {
    await closeApp(app)
  }
})
