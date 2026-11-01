import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { closeApp, createSandbox, launchApp, type Sandbox } from './helpers'

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid', ...args], { cwd, encoding: 'utf8' }).trim()

function put(root: string, rel: string, text: string): void {
  const full = join(root, ...rel.split('/'))
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, text)
}

const read = (root: string, rel: string): string => readFileSync(join(root, ...rel.split('/')), 'utf8')

const STORE = "export interface ThemeStore {\n  read(): string\n}\n\nexport function makeStore(): ThemeStore {\n  return { read: () => 'x' }\n}\n"
const APP = "import { makeStore } from './store'\n\nconst store = makeStore()\nexport const value = store.read()\nexport const first = makeStore()\nexport const second = bad(1)\nexport const third = bad(2)\n"

function makeProject(sandbox: Sandbox): void {
  const root = sandbox.projectFolder
  put(root, 'tsconfig.json', JSON.stringify({ compilerOptions: { target: 'es2020', module: 'esnext', strict: true, noEmit: true }, include: ['src'] }))
  put(root, 'src/store.ts', STORE)
  put(root, 'src/app.ts', APP)
}

const editor = (page: Page) => page.locator('.files-editor:not([hidden]) .cm-content')
const token = (page: Page, name: string, line = name) => page.locator('.files-editor:not([hidden]) .cm-line', { hasText: line }).locator('span', { hasText: new RegExp(`^${name}$`) }).first()

async function openFile(page: Page, path: string): Promise<void> {
  const row = page.locator(`.files-row[data-path="${path}"]`)
  if (!(await row.isVisible())) await page.locator('.files-row[data-path="src"]').click()
  await row.click()
  await expect(page.locator('.files-tab.active')).toContainText(path.split('/').pop() as string)
  await expect(editor(page)).toBeVisible()
}

async function startFiles(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1024, height: 728 })
  await page.locator('#files-button').click()
  await page.locator('.files-row[data-path="src"]').click()
}

// The language service starts in the background: ask for the rename until it answers instead of the "needs a language server" note.
async function previewRename(page: Page, newName: string, place: () => Promise<void>): Promise<void> {
  const dialog = page.locator('.edit-preview')
  for (let attempt = 0; attempt < 30 && !(await dialog.isVisible()); attempt += 1) {
    await page.keyboard.press('F2')
    const input = page.locator('.dialog input.text-input')
    await expect(input).toBeVisible()
    await input.fill(newName)
    await page.keyboard.press('Enter')
    await dialog.waitFor({ state: 'visible', timeout: 4000 }).catch(async () => {
      await page.waitForTimeout(1500)
      await place()
    })
  }
  await expect(dialog).toBeVisible()
}

test('F2 previews a rename across files and writes nothing until the confirmation names the files and counts', async () => {
  test.setTimeout(240_000)
  const sandbox = createSandbox()
  makeProject(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    await startFiles(page)
    await openFile(page, 'src/store.ts')
    const place = () => token(page, 'makeStore', 'export function').click()
    await place()

    await previewRename(page, 'buildStore', place)
    const dialog = page.locator('.edit-preview')
    await expect(dialog).toContainText('Rename makeStore to buildStore')
    await expect(dialog.locator('.edit-preview-file')).toHaveCount(2)
    await dialog.locator('.edit-preview-file').first().click()
    await expect(dialog.locator('.edit-preview-row.after').first()).toContainText('buildStore')
    await page.screenshot({ path: 'test-results/screens/183-rename-preview.png' })

    await page.locator('#edit-preview-apply').click()
    const confirm = page.locator('[role="alertdialog"]')
    await expect(confirm).toContainText('Rename makeStore to buildStore?')
    await expect(confirm).toContainText('src/store.ts')
    await expect(confirm).toContainText('src/app.ts')
    await expect(confirm.locator('[data-confirm]')).toHaveText(/^Rename in 2 files \(\d+ places\)$/)
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    expect(read(sandbox.projectFolder, 'src/store.ts')).toBe(STORE)
    expect(read(sandbox.projectFolder, 'src/app.ts')).toBe(APP)

    await place()
    await previewRename(page, 'buildStore', place)
    await page.locator('#edit-preview-apply').click()
    await page.locator('[role="alertdialog"] [data-confirm]').click()
    await expect.poll(() => read(sandbox.projectFolder, 'src/app.ts')).toContain('buildStore()')
    expect(read(sandbox.projectFolder, 'src/store.ts')).toContain('export function buildStore()')
    expect(read(sandbox.projectFolder, 'src/app.ts')).not.toContain('makeStore')

    await token(page, 'buildStore', 'export function').hover()
    await expect(page.locator('.cm-hover-tip')).toContainText('buildStore', { timeout: 15_000 })
  } finally {
    await closeApp(app)
  }
})

test('Replace in files previews every match and only writes after a confirmation naming the files and counts', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  makeProject(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    await startFiles(page)
    await page.keyboard.press('Control+Shift+h')
    await expect(page.locator('#files-search-input')).toBeFocused()
    await page.locator('#files-search-input').fill('makeStore')
    await page.locator('#files-search-replace').fill('createStore')
    await page.locator('#files-search-replace-go').click()

    const dialog = page.locator('.edit-preview')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.edit-preview-file')).toHaveCount(2)
    await dialog.locator('.edit-preview-file', { hasText: 'src/app.ts' }).click()
    await expect(dialog.locator('.edit-preview-row.before').first()).toContainText('makeStore')
    await expect(dialog.locator('.edit-preview-row.after').first()).toContainText('createStore')

    await page.locator('#edit-preview-apply').click()
    const confirm = page.locator('[role="alertdialog"]')
    await expect(confirm).toContainText('Replace "makeStore" with "createStore" in 2 files?')
    await expect(confirm).toContainText('src/app.ts  3 places')
    await expect(confirm.locator('[data-confirm]')).toHaveText('Replace 4 matches in 2 files')
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    expect(read(sandbox.projectFolder, 'src/app.ts')).toBe(APP)

    await page.locator('#files-search-replace-go').click()
    await page.locator('#edit-preview-apply').click()
    await page.locator('[role="alertdialog"] [data-confirm]').click()
    await expect.poll(() => read(sandbox.projectFolder, 'src/app.ts')).toContain('createStore()')
    await expect.poll(() => read(sandbox.projectFolder, 'src/store.ts')).toContain('export function createStore()')
    expect(read(sandbox.projectFolder, 'src/app.ts')).not.toContain('makeStore')
  } finally {
    await closeApp(app)
  }
})

test('Revert one change from the gutter asks first, naming the lines, and Cancel leaves the file alone', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  const root = sandbox.projectFolder
  const base = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join('\n') + '\n'
  put(root, 'notes.txt', base)
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'config', 'core.autocrlf', 'false')
  git(root, 'add', '.')
  git(root, 'commit', '-q', '-m', 'first')
  const changed = base.replace('line 5\n', 'line five\n').replace('line 25\n', 'line twenty-five\n')
  put(root, 'notes.txt', changed)
  const { app, page } = await launchApp(sandbox)
  try {
    await page.setViewportSize({ width: 1024, height: 728 })
    await page.locator('#files-button').click()
    await page.locator('.files-row[data-path="notes.txt"]').click()
    await page.locator('#files-changes').click()
    await expect(page.locator('.files-editor:not([hidden]) .cm-hunk-btn')).toHaveCount(2)

    await page.locator('.files-editor:not([hidden]) .cm-hunk-btn').first().click()
    await page.getByRole('menuitem', { name: 'Revert this change…' }).click()
    const confirm = page.locator('[role="alertdialog"]')
    await expect(confirm).toContainText('Revert the change at line 5 in notes.txt?')
    await expect(confirm).toContainText('-line 5')
    await expect(confirm).toContainText('+line five')
    await expect(confirm.locator('[data-confirm]')).toHaveText('Revert line 5 in notes.txt')
    await page.screenshot({ path: 'test-results/screens/183-revert-confirm.png' })
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    expect(read(root, 'notes.txt')).toBe(changed)

    await page.locator('.files-editor:not([hidden]) .cm-hunk-btn').first().click()
    await page.getByRole('menuitem', { name: 'Revert this change…' }).click()
    await page.locator('[role="alertdialog"] [data-confirm]').click()
    await expect.poll(() => read(root, 'notes.txt')).toBe(base.replace('line 25\n', 'line twenty-five\n'))
    await expect(page.locator('.files-editor:not([hidden]) .cm-hunk-btn')).toHaveCount(1)

    await page.locator('.files-editor:not([hidden]) .cm-hunk-btn').first().click()
    await page.getByRole('menuitem', { name: 'Stage this change' }).click()
    await expect.poll(() => git(root, 'diff', '--cached', '--stat')).toContain('notes.txt')
  } finally {
    await closeApp(app)
  }
})

test('F8 and Shift+F8 move between the problems marked in a file', async () => {
  test.setTimeout(180_000)
  const sandbox = createSandbox()
  makeProject(sandbox)
  put(sandbox.projectFolder, 'package.json', JSON.stringify({ name: 'tools-fixture', private: true, scripts: { dev: 'node report.cjs' } }))
  put(sandbox.projectFolder, 'report.cjs', "console.log('src/app.ts(6,23): error TS2304: Cannot find name bad.')\nconsole.log('src/app.ts(7,22): error TS2304: Cannot find name bad.')\n")
  const { app, page } = await launchApp(sandbox)
  try {
    await startFiles(page)
    await openFile(page, 'src/store.ts')
    await page.locator('#files-run-toggle').click()
    const id = await page.locator('#run-command').evaluate((node) => [...(node as HTMLSelectElement).options].find((option) => /dev/i.test(option.textContent ?? ''))?.value)
    await page.locator('#run-command').selectOption(id!)
    await page.locator('#run-start').click()
    await page.locator('#files-ptab-problems').click()
    await expect(page.locator('.files-problem')).toHaveCount(2, { timeout: 30_000 })
    await page.locator('.files-problem-open').first().click()
    await expect(page.locator('.files-tab.active')).toContainText('app.ts')
    await expect(page.locator('.cm-lintRange-error')).toHaveCount(2)

    await editor(page).click()
    await page.keyboard.press('Control+Home')
    await page.keyboard.press('F8')
    await expect(page.locator('#files-status-pos')).toContainText('Ln 6')
    await page.keyboard.press('F8')
    await expect(page.locator('#files-status-pos')).toContainText('Ln 7')
    await page.keyboard.press('Shift+F8')
    await expect(page.locator('#files-status-pos')).toContainText('Ln 6')
  } finally {
    await closeApp(app)
  }
})

test('Side by side shows the file next to main in two panes and returns to one column', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  const root = sandbox.projectFolder
  put(root, 'a.txt', 'one\ntwo\nthree\n')
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'config', 'core.autocrlf', 'false')
  git(root, 'add', '.')
  git(root, 'commit', '-q', '-m', 'first')
  put(root, 'a.txt', 'one\n2\nthree\n')
  const { app, page } = await launchApp(sandbox)
  try {
    await page.setViewportSize({ width: 1024, height: 728 })
    await page.locator('#files-button').click()
    await page.locator('.files-row[data-path="a.txt"]').click()
    await expect(page.locator('#files-side-by-side')).toBeHidden()
    await page.locator('#files-changes').click()
    await page.locator('#files-side-by-side').click()
    const pane = page.locator('.files-editor:not([hidden]) .cm-mergeView.side-by-side')
    await expect(pane).toBeVisible()
    await expect(pane.locator('.cm-editor')).toHaveCount(2)
    await expect(pane.locator('.cm-editor').first()).toContainText('two')
    await expect(pane.locator('.cm-editor').last()).toContainText('2')
    await page.screenshot({ path: 'test-results/screens/183-side-by-side.png' })

    await page.locator('#files-side-by-side').click()
    await expect(pane).toHaveCount(0)
    await expect(page.locator('.files-editor:not([hidden]) .cm-hunk-btn')).toHaveCount(1)
  } finally {
    await closeApp(app)
  }
})

test('sticky scroll keeps the class and method headers while their body scrolls by', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  const body = Array.from({ length: 60 }, (_, index) => `    this.items.push(${index})`).join('\n')
  put(sandbox.projectFolder, 'src/big.ts', `export class Big {\n  items: number[] = []\n\n  fill(): void {\n${body}\n  }\n}\n`)
  const { app, page } = await launchApp(sandbox)
  try {
    await startFiles(page)
    await openFile(page, 'src/big.ts')
    await expect(page.locator('.cm-sticky-row')).toHaveCount(0)
    await page.locator('.files-editor:not([hidden]) .cm-scroller').evaluate((node) => { node.scrollTop = 600 })
    await expect(page.locator('.files-editor:not([hidden]) .cm-sticky-row')).toHaveCount(2)
    await expect(page.locator('.files-editor:not([hidden]) .cm-sticky-row').first()).toContainText('export class Big')
    await expect(page.locator('.files-editor:not([hidden]) .cm-sticky-row').last()).toContainText('fill(): void')
  } finally {
    await closeApp(app)
  }
})

test('Review: F7 walks the changes across files, V marks the file viewed', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  const root = sandbox.projectFolder
  const base = Array.from({ length: 40 }, (_, index) => `row ${index + 1}`).join('\n') + '\n'
  put(root, 'a.txt', base)
  put(root, 'b.txt', base)
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'config', 'core.autocrlf', 'false')
  git(root, 'add', '.')
  git(root, 'commit', '-q', '-m', 'first')
  put(root, 'a.txt', base.replace('row 4\n', 'four\n').replace('row 30\n', 'thirty\n'))
  put(root, 'b.txt', base.replace('row 10\n', 'ten\n'))
  const { app, page } = await launchApp(sandbox)
  try {
    await page.setViewportSize({ width: 1024, height: 728 })
    await page.locator('#files-button').click()
    await page.locator('#files-mode-review').click()
    await page.locator('.files-review-row[data-path="a.txt"] .files-review-open').click()
    await expect(page.locator('.files-editor:not([hidden]) .cm-changedLine').first()).toBeVisible()
    await page.locator('.files-editor:not([hidden]) .cm-content').click()
    await page.keyboard.press('Control+Home')
    await page.keyboard.press('F7')
    await expect(page.locator('#files-status-pos')).toContainText('Ln 4')
    await page.keyboard.press('F7')
    await expect(page.locator('#files-status-pos')).toContainText('Ln 30')
    await page.keyboard.press('F7')
    await expect(page.locator('.files-tab.active')).toContainText('b.txt')
    await expect(page.locator('#files-status-pos')).toContainText('Ln 10')
    await page.keyboard.press('Shift+F7')
    await expect(page.locator('.files-tab.active')).toContainText('a.txt')
    await expect(page.locator('#files-status-pos')).toContainText('Ln 30')

    await page.locator('.files-review-row.current .files-review-open').focus()
    await page.keyboard.press('v')
    await expect(page.locator('#files-review-progress')).toHaveText('1 of 2 viewed')
    await page.keyboard.press('v')
    await expect(page.locator('#files-review-progress')).toHaveText('0 of 2 viewed')
  } finally {
    await closeApp(app)
  }
})

test('Call hierarchy lists the callers of the name under the caret', async () => {
  test.setTimeout(180_000)
  const sandbox = createSandbox()
  makeProject(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    await startFiles(page)
    await openFile(page, 'src/store.ts')
    const place = () => token(page, 'makeStore', 'export function').click()
    await place()
    const panel = page.locator('.call-panel')
    for (let attempt = 0; attempt < 20 && !(await panel.locator('.call-row').count()); attempt += 1) {
      await page.keyboard.press('Control+Shift+Alt+h')
      await expect(panel).toBeVisible()
      await panel.locator('.call-row').first().waitFor({ state: 'visible', timeout: 5000 }).catch(async () => {
        await page.keyboard.press('Escape')
        await page.waitForTimeout(1500)
        await place()
      })
    }
    await expect(panel).toContainText('Callers of makeStore')
    await expect(panel.locator('.call-row').first()).toBeVisible()
    await page.screenshot({ path: 'test-results/screens/183-call-hierarchy.png' })
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})
