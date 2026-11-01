import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { closeApp, createSandbox, launchApp, type Sandbox } from './helpers'

function put(root: string, rel: string, text: string): void {
  const full = join(root, ...rel.split('/'))
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, text)
}

function makeProject(sandbox: Sandbox): void {
  const root = sandbox.projectFolder
  put(root, '.editorconfig', 'root = true\n\n[*.ts]\nindent_style = tab\ntab_width = 8\n')
  put(root, 'tsconfig.json', JSON.stringify({ compilerOptions: { target: 'es2020', module: 'esnext', strict: true, noEmit: true }, include: ['src'] }))
  put(root, 'src/store.ts', "export interface ThemeStore {\n  read(): string\n}\n\nexport function makeStore(): ThemeStore {\n  return { read: () => 'x' }\n}\n")
  put(root, 'src/local.ts', "import { ThemeStore } from './store'\n\nexport class LocalStore implements ThemeStore {\n  read(): string {\n    return 'a'\n  }\n}\n")
  put(root, 'src/memory.ts', "import { ThemeStore } from './store'\n\nexport class MemoryStore implements ThemeStore {\n  read(): string {\n    return 'b'\n  }\n}\n")
  put(root, 'src/app.ts', "import { makeStore } from './store'\n\nconst store = makeStore()\nexport const value = store.read()\nexport const none = nothingAnywhere(1)\n")
}

const editor = (page: Page) => page.locator('.files-editor:not([hidden]) .cm-content')
const token = (page: Page, name: string, line = name) => page.locator('.files-editor:not([hidden]) .cm-line', { hasText: line }).locator('span', { hasText: new RegExp(`^${name}$`) }).first()
const active = (page: Page, name: string) => expect(page.locator('.files-tab.active')).toContainText(name)

// One exact answer jumps; by-name answers (the language service is still starting) open the peek, where Enter takes the first result.
async function settleJump(page: Page): Promise<void> {
  const jumped = page.locator('.files-tab.active', { hasText: 'store.ts' })
  const peek = page.locator('.nav-peek')
  await expect(jumped.or(peek)).toBeVisible({ timeout: 15_000 })
  if (await peek.isVisible()) await page.keyboard.press('Enter')
}

async function openFile(page: Page, path: string): Promise<void> {
  const row = page.locator(`.files-row[data-path="${path}"]`)
  if (!(await row.isVisible())) await page.locator('.files-row[data-path="src"]').click()
  await row.click()
  await expect(page.locator('.files-tab.active')).toContainText(path.split('/').pop() as string)
  await expect(editor(page)).toBeVisible()
}

test('F12, Back and Forward, the peek, Ctrl+click and the messages work from the keyboard', async () => {
  test.setTimeout(180_000)
  const sandbox = createSandbox()
  makeProject(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    await page.setViewportSize({ width: 1024, height: 728 })
    await page.locator('#files-button').click()
    await page.locator('.files-row[data-path="src"]').click()
    await openFile(page, 'src/app.ts')

    await token(page, 'makeStore', 'const store').click()
    await page.keyboard.press('F12')
    await settleJump(page)
    await active(page, 'store.ts')
    await expect(page.locator('#files-status-pos')).toContainText('Ln 5')
    await expect(page.locator('#files-back')).toBeEnabled()

    await page.keyboard.press('Alt+ArrowLeft')
    await active(page, 'app.ts')
    await expect(page.locator('#files-status-pos')).toContainText('Ln 3')
    await expect(page.locator('#files-back')).toBeDisabled()
    await expect(page.locator('#files-forward')).toBeEnabled()
    await page.keyboard.press('Alt+ArrowRight')
    await active(page, 'store.ts')

    await token(page, 'ThemeStore').first().click()
    await page.keyboard.press('Control+F12')
    const peek = page.locator('.nav-peek')
    await expect(peek).toBeVisible()
    await expect.poll(() => peek.locator('.nav-peek-row').count()).toBeGreaterThanOrEqual(2)
    await expect(peek.locator('.nav-peek-note')).toHaveText(/Best match by name|\d+ implementations/)
    await expect(peek.locator('.nav-peek-code .cm-content')).toContainText('ThemeStore')
    await page.screenshot({ path: 'test-results/screens/183-peek.png' })

    await page.keyboard.press('e')
    await expect(page.locator('#files-edit')).toBeHidden()
    await page.keyboard.press('ArrowDown')
    await expect(peek.locator('.nav-peek-row.sel')).toHaveAttribute('data-index', '1')
    await page.keyboard.press('Enter')
    await expect(peek).toHaveCount(0)
    await expect(page.locator('.files-tab.active')).not.toContainText('store.ts')
    await expect(editor(page)).toContainText('implements ThemeStore')
    await expect(page.locator('#files-status-pos')).not.toContainText('Ln 1,')
    await page.keyboard.press('Alt+ArrowLeft')
    await active(page, 'store.ts')

    await token(page, 'ThemeStore').first().click()
    await page.keyboard.press('Control+F12')
    await expect(peek).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(peek).toHaveCount(0)

    await page.keyboard.press('Shift+F12')
    await expect(peek).toBeVisible()
    await page.keyboard.press('Escape')

    await openFile(page, 'src/app.ts')
    await token(page, 'nothingAnywhere').click()
    await page.keyboard.press('F12')
    await expect(page.locator('.nav-bubble')).toContainText('No definition found for nothingAnywhere')
    await page.keyboard.press('Escape')
    await expect(page.locator('.nav-bubble')).toHaveCount(0)

    await token(page, 'makeStore', 'const store').click({ modifiers: ['Control'] })
    await settleJump(page)
    await active(page, 'store.ts')
  } finally {
    await closeApp(app)
  }
})

test('Go to Everything, Go to Line and Go to Symbol open from their keys', async () => {
  test.setTimeout(180_000)
  const sandbox = createSandbox()
  makeProject(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    await page.setViewportSize({ width: 1024, height: 728 })
    await page.locator('#files-button').click()
    await page.locator('.files-row[data-path="src"]').click()
    await openFile(page, 'src/store.ts')

    await page.keyboard.press('Control+t')
    await expect(page.locator('.nav-pick-input')).toBeFocused()
    await page.keyboard.type('local')
    await expect(page.locator('.nav-pick-row').first()).toContainText('local.ts')
    await page.keyboard.press('Enter')
    await active(page, 'local.ts')
    await expect(editor(page)).toContainText('LocalStore')

    await page.keyboard.press('Control+g')
    await page.keyboard.type('4')
    await page.keyboard.press('Enter')
    await expect(page.locator('#files-status-pos')).toContainText('Ln 4')

    await page.locator('#files-status-pos').click()
    await expect(page.locator('.nav-pick-input')).toBeFocused()
    await page.keyboard.press('Escape')

    await page.keyboard.press('Control+Shift+o')
    await page.keyboard.type('Local')
    await page.keyboard.press('Enter')
    await expect(page.locator('#files-status-pos')).toContainText('Ln 3')
    await expect(page.locator('.files-crumb-symbol').first()).toHaveText('LocalStore')
  } finally {
    await closeApp(app)
  }
})

test('.editorconfig sets the tab width and a Problems row opens at its column with the error in the code', async () => {
  test.setTimeout(180_000)
  const sandbox = createSandbox()
  makeProject(sandbox)
  put(sandbox.projectFolder, 'package.json', JSON.stringify({ name: 'nav-fixture', private: true, scripts: { dev: 'node report.cjs' } }))
  put(sandbox.projectFolder, 'report.cjs', "console.log('src/app.ts(5,23): error TS2554: Expected 0 arguments, but got 1.')\n")
  const { app, page } = await launchApp(sandbox)
  try {
    await page.setViewportSize({ width: 1024, height: 728 })
    await page.locator('#files-button').click()
    await page.locator('.files-row[data-path="src"]').click()
    await openFile(page, 'src/store.ts')
    await expect.poll(() => editor(page).evaluate((node) => getComputedStyle(node).tabSize)).toBe('8')

    await page.locator('#files-run-toggle').click()
    const id = await page.locator('#run-command').evaluate((node) => [...(node as HTMLSelectElement).options].find((option) => /dev/i.test(option.textContent ?? ''))?.value)
    await page.locator('#run-command').selectOption(id!)
    await page.locator('#run-start').click()
    await page.locator('#files-ptab-problems').click()
    await expect(page.locator('.files-problem')).toHaveCount(1, { timeout: 30_000 })
    await page.locator('.files-problem-open').click()
    await active(page, 'app.ts')
    await expect(page.locator('#files-status-pos')).toContainText('Ln 5, Col 23')
    await expect(page.locator('.cm-problem-text')).toContainText('Expected 0 arguments')
    await expect(page.locator('.cm-lintRange-error')).toHaveCount(1)
  } finally {
    await closeApp(app)
  }
})
