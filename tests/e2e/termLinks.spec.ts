import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { bufferText, closeApp, closeSettings, createSandbox, feedTerminal, launchApp, openSettings, type Sandbox } from './helpers'

const CLEAR = '\x1b[2J\x1b[H'

const readSettings = (sandbox: Sandbox): any => JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8'))

function openedTargets(sandbox: Sandbox): { kind: string; path: string; line?: number; col?: number }[] {
  try {
    return readFileSync(sandbox.openLog, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { kind: string; path: string; line?: number; col?: number })
  } catch {
    return []
  }
}

function seedProject(sandbox: Sandbox): void {
  mkdirSync(join(sandbox.projectFolder, 'src', 'invoices'), { recursive: true })
  mkdirSync(join(sandbox.projectFolder, 'tests'), { recursive: true })
  writeFileSync(join(sandbox.projectFolder, 'src', 'invoices', 'totals.ts'), Array.from({ length: 60 }, (_, i) => `export const total${i + 1} = ${i + 1}`).join('\n') + '\n', 'utf8')
  writeFileSync(join(sandbox.projectFolder, 'tests', 'a.test.ts'), 'test\n', 'utf8')
  writeFileSync(join(sandbox.projectFolder, 'README.md'), '# acme-web\n', 'utf8')
  writeFileSync(join(sandbox.projectFolder, 'preview.html'), '<!doctype html><title>Preview</title>', 'utf8')
  writeFileSync(join(sandbox.projectFolder, 'photo.png'), Buffer.from('89504e470d0a1a0a', 'hex'))
  writeFileSync(join(sandbox.root, 'notes.md'), '# notes\n', 'utf8')
}

async function startSession(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
  const host = page.locator('.term-host.active')
  const id = (await host.getAttribute('data-term-id'))!
  await expect.poll(() => bufferText(page, id), { timeout: 30_000 }).toMatch(/>\s*$/m)
  return id
}

async function showLine(page: Page, id: string, text: string): Promise<{ x: number; y: number }> {
  await feedTerminal(page, id, CLEAR)
  await feedTerminal(page, id, text)
  await expect.poll(() => bufferText(page, id)).toContain(text.slice(0, 12))
  const box = (await page.locator('.term-host.active .xterm-screen').boundingBox())!
  return { x: box.x + 6, y: box.y + 4 }
}

async function hover(page: Page, point: { x: number; y: number }): Promise<void> {
  await page.mouse.move(point.x + 300, point.y + 300)
  await page.mouse.move(point.x + 300, point.y + 310)
  await page.mouse.move(point.x, point.y)
  await page.mouse.move(point.x + 1, point.y)
}

test('file paths in terminal output are links when the file exists; Ctrl+click opens text files in Files at the line and the rest with the system', async () => {
  const sandbox = createSandbox()
  seedProject(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    const id = await startSession(page)
    const pointer = page.locator('.term-host.active .xterm-cursor-pointer')
    const totals = join(sandbox.projectFolder, 'src', 'invoices', 'totals.ts')

    const first = await showLine(page, id, 'src/invoices/totals.ts:42:7 type mismatch\r\n')
    await hover(page, first)
    await expect(pointer).toHaveCount(1)
    await page.mouse.click(first.x, first.y)
    await page.waitForTimeout(400)
    expect(openedTargets(sandbox)).toEqual([])
    await page.keyboard.down('Control')
    await page.mouse.click(first.x, first.y)
    await page.keyboard.up('Control')
    await expect(page.locator('#files-view')).toBeVisible()
    await expect(page.locator('.files-tab.active')).toContainText('totals.ts')
    await expect(page.locator('.files-tab.active')).not.toHaveClass(/preview/)
    await expect(page.locator('#files-status')).toContainText('Ln 42')
    expect(openedTargets(sandbox)).toEqual([])

    await page.locator('#sessions-button').click()
    const windows = await showLine(page, id, 'src\\invoices\\totals.ts:9 broken\r\n')
    await hover(page, windows)
    await expect(pointer).toHaveCount(1)
    await page.keyboard.down('Control')
    await page.mouse.click(windows.x, windows.y)
    await page.keyboard.up('Control')
    await expect(page.locator('#files-view')).toBeVisible()
    await expect(page.locator('.files-tab')).toHaveCount(1)
    await expect(page.locator('#files-status')).toContainText('Ln 9')
    await page.locator('#sessions-button').click()

    const absolute = await showLine(page, id, `${join(sandbox.root, 'notes.md')}:3\r\n`)
    await hover(page, absolute)
    await expect(pointer).toHaveCount(1)
    await page.keyboard.down('Control')
    await page.mouse.click(absolute.x, absolute.y)
    await page.keyboard.up('Control')
    await expect.poll(() => openedTargets(sandbox).at(-1)).toEqual({ kind: 'default', path: join(sandbox.root, 'notes.md'), line: 3 })

    const parens = await showLine(page, id, 'tests/a.test.ts(12,4): error TS2322\r\n')
    await hover(page, parens)
    await expect(pointer).toHaveCount(1)
    await page.keyboard.down('Control')
    await page.mouse.click(parens.x, parens.y)
    await page.keyboard.up('Control')
    await expect(page.locator('#files-view')).toBeVisible()
    await expect(page.locator('.files-tab.active')).toContainText('a.test.ts')
    await expect(page.locator('.files-tab')).toHaveCount(2)
    await page.locator('#sessions-button').click()

    for (const [file, kind] of [['preview.html', 'html'], ['photo.png', 'image']] as const) {
      const point = await showLine(page, id, `${file} opens here\r\n`)
      await hover(page, point)
      await expect(pointer).toHaveCount(1)
      await page.keyboard.down('Control')
      await page.mouse.click(point.x, point.y)
      await page.keyboard.up('Control')
      await expect.poll(() => openedTargets(sandbox).at(-1)).toEqual({ kind, path: join(sandbox.projectFolder, file) })
    }
    const system = openedTargets(sandbox).length

    const picture = await showLine(page, id, 'photo.png opens here\r\n')
    await hover(page, picture)
    await expect(pointer).toHaveCount(1)
    await page.keyboard.down('Control')
    await page.keyboard.down('Shift')
    await page.mouse.click(picture.x, picture.y)
    await page.keyboard.up('Shift')
    await page.keyboard.up('Control')
    await expect(page.locator('#files-view')).toBeVisible()
    await expect(page.locator('.files-tab.active')).toContainText('photo.png')
    expect(openedTargets(sandbox)).toHaveLength(system)
    await page.locator('#sessions-button').click()

    const relative = await showLine(page, id, './README.md is the entry\r\n')
    await hover(page, relative)
    await expect(pointer).toHaveCount(1)

    const before = openedTargets(sandbox).length
    const missing = await showLine(page, id, 'src/missing/nowhere.ts:1:1 gone\r\n')
    await hover(page, missing)
    await page.waitForTimeout(800)
    await expect(pointer).toHaveCount(0)
    await page.keyboard.down('Control')
    await page.mouse.click(missing.x, missing.y)
    await page.keyboard.up('Control')
    await page.waitForTimeout(400)
    expect(openedTargets(sandbox)).toHaveLength(before)

    const outside = await showLine(page, id, '../../../../Windows/win.ini:1 outside\r\n')
    await hover(page, outside)
    await page.waitForTimeout(800)
    await expect(pointer).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})

test('right-clicking a file path in a terminal opens a path menu that opens it in Files or VS Code and copies it', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  seedProject(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    const id = await startSession(page)
    const totals = join(sandbox.projectFolder, 'src', 'invoices', 'totals.ts')
    const menu = page.getByRole('menu', { name: 'Path actions' })
    const clipboard = (): Promise<string> => app.evaluate(({ clipboard }) => clipboard.readText())
    const rightClick = async (point: { x: number; y: number }): Promise<void> => {
      await hover(page, point)
      await expect(page.locator('.term-host.active .xterm-cursor-pointer')).toHaveCount(1)
      await page.mouse.click(point.x, point.y, { button: 'right' })
      await expect(menu).toBeVisible()
    }

    const point = await showLine(page, id, 'src/invoices/totals.ts:42:7 type mismatch\r\n')
    await rightClick(point)
    await expect(page.locator('.ctx-menu:not(.leaving) .ctx-label')).toHaveText(['Open in Files', 'Open in Files, new tab', 'Open in VS Code', 'Copy path', 'Copy relative path'])
    await expect(page.locator('.ctx-menu:not(.leaving) .ctx-keys')).toHaveText(['Ctrl+click'])
    await page.keyboard.press('Escape')
    await expect(page.locator('.ctx-menu:not(.leaving)')).toHaveCount(0)
    await expect(page.locator('.term-host.active .xterm-helper-textarea')).toBeFocused()

    await page.locator('.pane.focused .maximize').click()
    await expect(page.locator('.pane.maximized')).toHaveCount(1)
    await page.waitForTimeout(600)
    await rightClick(await showLine(page, id, 'src/invoices/totals.ts:42:7 type mismatch\r\n'))
    await page.keyboard.press('Escape')
    await expect(page.locator('.ctx-menu:not(.leaving)')).toHaveCount(0)
    await expect(page.locator('.pane.maximized')).toHaveCount(1)
    await page.locator('.pane.maximized .maximize').click()
    await expect(page.locator('.pane.maximized')).toHaveCount(0)
    await page.waitForTimeout(600)

    const again = await showLine(page, id, 'src/invoices/totals.ts:42:7 type mismatch\r\n')
    await rightClick(again)
    await menu.getByRole('menuitem', { name: /^Copy path/ }).click()
    await expect.poll(clipboard).toBe(totals)
    await rightClick(point)
    await menu.getByRole('menuitem', { name: /^Copy relative path/ }).click()
    await expect.poll(clipboard).toBe('src/invoices/totals.ts')

    await rightClick(point)
    await menu.getByRole('menuitem', { name: /^Open in VS Code/ }).click()
    await expect.poll(() => openedTargets(sandbox).at(-1)).toMatchObject({ kind: 'vscode-file', line: 42 })

    await rightClick(point)
    await menu.getByRole('menuitem', { name: /^Open in Files$/ }).click()
    await expect(page.locator('#files-view')).toBeVisible()
    await expect(page.locator('.files-tab.active')).toContainText('totals.ts')
    await expect(page.locator('.files-tab.active')).toHaveClass(/preview/)
    await expect(page.locator('#files-status')).toContainText('Ln 42')
    await page.locator('#sessions-button').click()

    await rightClick(point)
    await menu.getByRole('menuitem', { name: /^Open in Files, new tab/ }).click()
    await expect(page.locator('#files-view')).toBeVisible()
    await expect(page.locator('.files-tab.active')).not.toHaveClass(/preview/)
    await page.locator('#sessions-button').click()

    const outside = await showLine(page, id, `${join(sandbox.root, 'notes.md')}:3\r\n`)
    await rightClick(outside)
    for (const name of [/^Open in Files$/, /^Open in Files, new tab/, /^Open in VS Code/, /^Copy relative path/]) await expect(menu.getByRole('menuitem', { name })).toBeDisabled()
    await expect(menu.getByRole('menuitem', { name: /^Copy path/ })).toBeEnabled()
    await page.keyboard.press('Escape')
  } finally {
    await closeApp(app)
  }
})

test('lines with error, warning and success words are highlighted, and the Highlights settings control them', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    const id = await startSession(page)
    const marks = (color: string) => page.locator(`.term-host.active .term-hl[data-hl="${color}"]`)
    await feedTerminal(page, id, CLEAR)
    await feedTerminal(page, id, `compiling step one\r\nBuild error in billing-api\r\nall good here\r\n12 passed\r\nwarning: unused import\r\n`)
    await expect(marks('red')).toHaveCount(1)
    await expect(marks('green')).toHaveCount(1)
    await expect(marks('amber')).toHaveCount(1)
    await expect(page.locator('.term-host.active .term-hl')).toHaveCount(3)

    await openSettings(page, 'highlights')
    await expect(page.locator('#highlights-toggle')).toBeChecked()
    await expect(page.locator('.hl-rule')).toHaveCount(9)
    await page.locator('#highlights-toggle').uncheck()
    await closeSettings(page)
    await expect(page.locator('.term-host.active .term-hl')).toHaveCount(0)
    await feedTerminal(page, id, 'another error while off\r\n')
    await page.waitForTimeout(500)
    await expect(page.locator('.term-host.active .term-hl')).toHaveCount(0)
    expect(readSettings(sandbox).highlights.enabled).toBe(false)

    await openSettings(page, 'highlights')
    await page.locator('#highlights-toggle').check()
    await closeSettings(page)
    await feedTerminal(page, id, 'error again after enabling\r\n')
    await expect(marks('red')).toHaveCount(1)
    expect(readSettings(sandbox).highlights.enabled).toBe(true)

    await openSettings(page, 'highlights')
    await page.locator('#hl-add-pattern').fill('(')
    await page.locator('#hl-add-regex').check()
    await page.locator('#hl-add-submit').click()
    await expect(page.locator('#hl-add-error')).toContainText('not a valid regular expression')
    await page.locator('#hl-add-regex').uncheck()
    await page.locator('#hl-add-pattern').fill('deploy')
    await page.locator('#hl-add-color').selectOption('purple')
    await page.locator('#hl-add-submit').click()
    await expect(page.locator('.hl-rule[data-rule="deploy"]')).toHaveAttribute('data-color', 'purple')
    await expect.poll(() => readSettings(sandbox).highlights.rules.at(-1)).toEqual({ pattern: 'deploy', color: 'purple' })

    await page.locator('#hl-add-pattern').fill('DEPLOY')
    await page.locator('#hl-add-submit').click()
    await expect(page.locator('#hl-add-error')).toContainText('already exists')

    await closeSettings(page)
    await feedTerminal(page, id, 'starting Deploy to staging\r\n')
    await expect(marks('purple')).toHaveCount(1)
    await page.screenshot({ path: 'test-results/screens/61-term-highlights.png' })

    await openSettings(page, 'highlights')
    await page.locator('#hl-edit-9').click()
    await page.locator('#hl-edit-pattern').fill('release')
    await page.locator('#hl-edit-color').selectOption('blue')
    await page.locator('#hl-edit-submit').click()
    await expect.poll(() => readSettings(sandbox).highlights.rules.at(-1)).toEqual({ pattern: 'release', color: 'blue' })
    await page.screenshot({ path: 'test-results/screens/62-highlight-settings.png' })

    await page.locator('#hl-remove-0').click()
    await expect(page.locator('.hl-rule')).toHaveCount(9)
    await expect.poll(() => readSettings(sandbox).highlights.rules.map((r: { pattern: string }) => r.pattern)).not.toContain('error')

    await page.locator('#highlights-reset').click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('failed')
    await expect(dialog).toContainText('release')
    await expect(dialog).toContainText('9 rules')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    expect(readSettings(sandbox).highlights.rules.at(-1)).toEqual({ pattern: 'release', color: 'blue' })

    await page.locator('#highlights-reset').click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Replace 9 rules' }).click()
    await expect.poll(() => readSettings(sandbox).highlights.rules).toHaveLength(9)
    expect(readSettings(sandbox).highlights.rules[0]).toEqual({ pattern: 'error', color: 'red' })
    await expect(page.locator('#highlights-reset')).toBeDisabled()
  } finally {
    await closeApp(app)
  }
})

test('old settings files without highlights get the default rules', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await openSettings(page, 'highlights')
    await expect(page.locator('.hl-rule')).toHaveCount(9)
    await expect(page.locator('.hl-rule[data-rule="warning"]')).toHaveAttribute('data-color', 'amber')
  } finally {
    await closeApp(app)
  }
})
