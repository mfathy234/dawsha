import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { APP_VERSION, bufferText, closeApp, createSandbox, feedTerminal, launchApp, type Sandbox } from './helpers'

const SHOTS = process.env.DAWSHA_SHOTS ?? ''
const A_TS = 'export const one = 1\nexport function run() {\n  return one\n}\n'

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid', ...args], { cwd, encoding: 'utf8' }).trim()

function makeRepo(sandbox: Sandbox): string {
  const repo = sandbox.projectFolder
  mkdirSync(join(repo, 'src', 'util'), { recursive: true })
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'src', 'a.ts'), A_TS)
  writeFileSync(join(repo, 'src', 'util', 'helpers.ts'), 'export const help = true\n')
  writeFileSync(join(repo, 'README.md'), '# hello\n')
  writeFileSync(join(repo, 'package.json'), '{ "name": "acme", "version": 1, "ok": true }\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'first')
  writeFileSync(join(repo, 'README.md'), '# hello again\n')
  return repo
}

function openedTargets(sandbox: Sandbox): { kind: string; path: string; line?: number }[] {
  try {
    return readFileSync(sandbox.openLog, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as { kind: string; path: string; line?: number })
  } catch {
    return []
  }
}

const row = (page: Page, path: string) => page.locator(`.files-row[data-path="${path}"]`)
const tabs = (page: Page) => page.locator('.files-tab')
const menuItems = (page: Page) => page.locator('.ctx-menu:not(.leaving) .ctx-label')
const clipboard = (app: ElectronApplication): Promise<string> => app.evaluate(({ clipboard }) => clipboard.readText())

async function openFiles(page: Page): Promise<void> {
  await page.locator('#files-button').click()
  await expect(page.locator('#files-view')).toBeVisible()
  await row(page, 'src').click()
  await row(page, 'src/util').click()
}

test('a click previews, Ctrl+click opens a pinned tab and keeps the current one, a double click pins, Ctrl+Enter in Ctrl+P does the same', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  makeRepo(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    await openFiles(page)
    await row(page, 'src/a.ts').click()
    await expect(tabs(page)).toHaveCount(1)
    await expect(page.locator('.files-tab.active')).toHaveClass(/preview/)
    await expect(page.locator('.files-tab.active .files-tab-name')).toHaveCSS('font-style', 'italic')

    await row(page, 'README.md').click()
    await expect(tabs(page)).toHaveCount(1)
    await expect(page.locator('.files-tab.active')).toContainText('README.md')
    await expect(page.locator('.files-tab.active')).toHaveClass(/preview/)

    await row(page, 'src/util/helpers.ts').click({ modifiers: ['Control'] })
    await expect(tabs(page)).toHaveCount(2)
    await expect(page.locator('.files-tab.active')).toContainText('helpers.ts')
    await expect(page.locator('.files-tab.active')).not.toHaveClass(/preview/)
    await expect(tabs(page).filter({ hasText: 'README.md' })).toHaveClass(/preview/)

    await row(page, 'src/a.ts').click()
    await expect(tabs(page)).toHaveCount(2)
    await expect(tabs(page).filter({ hasText: 'README.md' })).toHaveCount(0)
    await expect(tabs(page).filter({ hasText: 'helpers.ts' })).toHaveCount(1)
    await expect(tabs(page).filter({ hasText: 'a.ts' })).toHaveClass(/preview/)

    await tabs(page).filter({ hasText: 'a.ts' }).dblclick()
    await expect(tabs(page).filter({ hasText: 'a.ts' })).not.toHaveClass(/preview/)
    await row(page, 'README.md').click()
    await expect(tabs(page)).toHaveCount(3)
    await expect(tabs(page).filter({ hasText: 'README.md' })).toHaveClass(/preview/)

    await page.locator('#files-tree').focus()
    await page.keyboard.press('Control+p')
    await expect(page.locator('#quick-open-input')).toBeFocused()
    await page.keyboard.type('package')
    await expect(page.locator('.qo-row').first()).toHaveAttribute('data-path', 'package.json')
    await page.keyboard.press('Control+Enter')
    await expect(page.locator('#quick-open-input')).toHaveCount(0)
    await expect(tabs(page)).toHaveCount(4)
    await expect(page.locator('.files-tab.active')).toContainText('package.json')
    await expect(page.locator('.files-tab.active')).not.toHaveClass(/preview/)
    await expect(tabs(page).filter({ hasText: 'README.md' })).toHaveClass(/preview/)
  } finally {
    await closeApp(app)
  }
})

test('right-click menus on a file, a folder and a tab: items, keyboard, clipboard, reveal, VS Code, closing', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  const repo = makeRepo(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    await openFiles(page)
    await row(page, 'src/a.ts').click({ button: 'right' })
    const menu = page.getByRole('menu', { name: 'File actions' })
    await expect(menu).toBeVisible()
    await expect(menuItems(page)).toHaveText(['Open', 'Open in new tab', 'Add to prompt', 'Copy path', 'Copy relative path', 'Open in VS Code', 'Reveal in File Explorer', 'Show changes'])
    await expect(menu.locator('.ctx-keys')).toHaveText(['Enter', 'Ctrl+click', 'Alt+Enter', 'Shift+Alt+C', 'Ctrl+Shift+Alt+C', 'Ctrl+Enter', 'Shift+Alt+R'])
    await expect(menu.getByRole('menuitem').first()).toBeFocused()
    await expect(menu.getByRole('separator')).toHaveCount(2)

    await page.keyboard.press('ArrowDown')
    await expect(menu.getByRole('menuitem', { name: /^Open in new tab/ })).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await expect(menu.getByRole('menuitem', { name: /^Show changes/ })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.locator('.ctx-menu:not(.leaving)')).toHaveCount(0)
    await expect(page.locator('#files-tree')).toBeFocused()

    await row(page, 'src/a.ts').click({ button: 'right' })
    await menu.getByRole('menuitem', { name: /^Copy path/ }).click()
    await expect(page.locator('.ctx-menu:not(.leaving)')).toHaveCount(0)
    expect(await clipboard(app)).toBe(join(repo, 'src', 'a.ts'))

    await row(page, 'src/a.ts').click({ button: 'right' })
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect.poll(() => clipboard(app)).toBe('src/a.ts')

    await row(page, 'src/a.ts').click({ button: 'right' })
    await menu.getByRole('menuitem', { name: /^Reveal in File Explorer/ }).click()
    await expect.poll(() => openedTargets(sandbox).at(-1)?.kind).toBe('reveal')
    expect(openedTargets(sandbox).at(-1)?.path.toLowerCase().endsWith(join('src', 'a.ts').toLowerCase())).toBe(true)

    await row(page, 'src/a.ts').click({ button: 'right' })
    await menu.getByRole('menuitem', { name: /^Open in VS Code/ }).click()
    await expect.poll(() => openedTargets(sandbox).at(-1)?.kind).toBe('vscode-file')

    await row(page, 'src/util/helpers.ts').click({ button: 'right' })
    await menu.getByRole('menuitem', { name: /^Open in new tab/ }).click()
    await expect(tabs(page)).toHaveCount(1)
    await expect(page.locator('.files-tab.active')).toContainText('helpers.ts')
    await expect(page.locator('.files-tab.active')).not.toHaveClass(/preview/)

    await row(page, 'README.md').click({ button: 'right' })
    await menu.getByRole('menuitem', { name: /^Show changes/ }).click()
    await expect(page.locator('.files-tab.active')).toContainText('README.md')
    await expect(page.locator('#files-changes')).toHaveAttribute('aria-pressed', 'true')

    await row(page, 'src').click({ button: 'right' })
    const folder = page.getByRole('menu', { name: 'Folder actions' })
    await expect(menuItems(page)).toHaveText(['Collapse', 'Copy path', 'Copy relative path', 'Reveal in File Explorer'])
    await folder.getByRole('menuitem', { name: /^Copy relative path/ }).click()
    await expect.poll(() => clipboard(app)).toBe('src')
    await row(page, 'src').click({ button: 'right' })
    await folder.getByRole('menuitem', { name: /^Collapse/ }).click()
    await expect(row(page, 'src/a.ts')).toHaveCount(0)
    await row(page, 'src').click()

    await row(page, 'README.md').click({ button: 'right' })
    await expect(menu).toBeVisible()
    await page.locator('#files-crumb, .files-crumb').first().click({ position: { x: 4, y: 4 } })
    await expect(page.locator('.ctx-menu:not(.leaving)')).toHaveCount(0)

    await page.locator('#files-tree').focus()
    await page.keyboard.press('Shift+F10')
    await expect(page.locator('.ctx-menu:not(.leaving)')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('#files-tree')).toBeFocused()
    await page.keyboard.press('Shift+Alt+C')
    await expect.poll(() => clipboard(app)).toContain('README.md')
  } finally {
    await closeApp(app)
  }
})

test('the menu stays inside a short window', async () => {
  const sandbox = createSandbox()
  makeRepo(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    await openFiles(page)
    await page.setViewportSize({ width: 1024, height: 360 })
    const last = row(page, 'README.md')
    await last.scrollIntoViewIfNeeded()
    const box = (await last.boundingBox())!
    await page.mouse.click(box.x + box.width - 4, box.y + box.height - 2, { button: 'right' })
    const menu = page.locator('.ctx-menu:not(.leaving)')
    await expect(menu).toBeVisible()
    const placed = (await menu.boundingBox())!
    expect(placed.y).toBeGreaterThanOrEqual(0)
    expect(placed.y + placed.height).toBeLessThanOrEqual(360)
    expect(placed.x + placed.width).toBeLessThanOrEqual(1024)
  } finally {
    await closeApp(app)
  }
})

test('tab menu closes the others or the tabs to the right and copies the path', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  const repo = makeRepo(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    await openFiles(page)
    for (const path of ['src/a.ts', 'src/util/helpers.ts', 'README.md']) await row(page, path).click({ modifiers: ['Control'] })
    await expect(tabs(page)).toHaveCount(3)
    const menu = page.getByRole('menu', { name: 'Tab actions' })
    await tabs(page).nth(2).click({ button: 'right' })
    await expect(menuItems(page)).toHaveText(['Close', 'Close others', 'Close to the right', 'Copy path', 'Copy relative path', 'Reveal in File Explorer', 'Open in VS Code'])
    await expect(menu.getByRole('menuitem', { name: 'Close to the right' })).toBeDisabled()
    await menu.getByRole('menuitem', { name: /^Copy path/ }).click()
    expect(await clipboard(app)).toBe(join(repo, 'README.md'))

    await tabs(page).nth(0).click({ button: 'right' })
    await menu.getByRole('menuitem', { name: 'Close to the right' }).click()
    await expect(tabs(page)).toHaveCount(1)
    await expect(tabs(page).first()).toContainText('a.ts')

    for (const path of ['src/util/helpers.ts', 'README.md']) await row(page, path).click({ modifiers: ['Control'] })
    await expect(tabs(page)).toHaveCount(3)
    await tabs(page).nth(1).click({ button: 'right' })
    await menu.getByRole('menuitem', { name: 'Close others' }).click()
    await expect(tabs(page)).toHaveCount(1)
    await expect(tabs(page).first()).toContainText('helpers.ts')

    await tabs(page).first().focus()
    await page.keyboard.press('Shift+F10')
    await expect(menu).toBeVisible()
    await menu.getByRole('menuitem', { name: 'Close', exact: true }).click()
    await expect(tabs(page)).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})

test('the editor uses the VS Code Dark+ colours and the tree and tabs carry file-type icons', async () => {
  const sandbox = createSandbox()
  makeRepo(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    await openFiles(page)
    await expect(row(page, 'src').locator('.fi-folder')).toBeVisible()
    await expect(row(page, 'src/a.ts').locator('.fi-ts')).toHaveText('TS')
    await expect(row(page, 'README.md').locator('.fi-md')).toBeVisible()
    await expect(row(page, 'package.json').locator('.fi-json')).toBeVisible()
    await row(page, 'src/a.ts').click()
    await expect(page.locator('.files-tab.active .fi-ts')).toBeVisible()

    const code = page.locator('.files-editor:not([hidden])')
    const token = (text: string) => code.locator('.cm-line span').filter({ hasText: new RegExp(`^${text}$`) }).first()
    await expect(token('const')).toHaveCSS('color', 'rgb(86, 156, 214)')
    await expect(token('function')).toHaveCSS('color', 'rgb(86, 156, 214)')
    await expect(token('export')).toHaveCSS('color', 'rgb(197, 134, 192)')
    await expect(token('return')).toHaveCSS('color', 'rgb(197, 134, 192)')
    await expect(token('1')).toHaveCSS('color', 'rgb(181, 206, 168)')
    await expect(token('run')).toHaveCSS('color', 'rgb(220, 220, 170)')
    await expect(token('one').first()).toHaveCSS('color', 'rgb(156, 220, 254)')
    await expect(code.locator('.cm-editor')).toHaveCSS('background-color', 'rgb(30, 30, 30)')
    await expect(code.locator('.cm-gutterElement', { hasText: /^2$/ })).toHaveCSS('color', 'rgb(133, 133, 133)')
    const font = await code.locator('.cm-scroller').evaluate((el) => getComputedStyle(el).fontFamily)
    expect(font).toMatch(/Cascadia Code/)
    await expect(code.locator('.cm-content')).toHaveCSS('font-variant-ligatures', 'none')

    await row(page, 'package.json').click()
    await expect(code.locator('.cm-line span').filter({ hasText: '"name"' }).first()).toHaveCSS('color', 'rgb(156, 220, 254)')
    await expect(code.locator('.cm-line span').filter({ hasText: '"acme"' }).first()).toHaveCSS('color', 'rgb(206, 145, 120)')
    await expect(token('true')).toHaveCSS('color', 'rgb(86, 156, 214)')
  } finally {
    await closeApp(app)
  }
})

test('light themes get the VS Code Light+ colours', async () => {
  const sandbox = createSandbox()
  makeRepo(sandbox)
  writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify({ version: 2, lastSeenVersion: APP_VERSION, projects: [{ id: 'smoke', name: 'Smoke', folder: sandbox.projectFolder }], theme: { id: 'dawsha-daylight' } }), 'utf8')
  const { app, page } = await launchApp(sandbox)
  try {
    await openFiles(page)
    await row(page, 'src/a.ts').click()
    const code = page.locator('.files-editor:not([hidden])')
    const token = (text: string) => code.locator('.cm-line span').filter({ hasText: new RegExp(`^${text}$`) }).first()
    await expect(token('const')).toHaveCSS('color', 'rgb(0, 0, 255)')
    await expect(token('export')).toHaveCSS('color', 'rgb(175, 0, 219)')
    await expect(token('1')).toHaveCSS('color', 'rgb(9, 134, 88)')
    await expect(token('run')).toHaveCSS('color', 'rgb(121, 94, 38)')
    await expect(code.locator('.cm-editor')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await expect(row(page, 'src/a.ts').locator('.fi-ts')).toHaveCSS('color', 'rgb(29, 95, 168)')
  } finally {
    await closeApp(app)
  }
})

for (const [mode, themeId] of [['dark', undefined], ['light', 'dawsha-daylight']] as const) {
  test(`screenshots of Files, the menus and the terminal path menu (${mode})`, async () => {
    test.skip(!SHOTS, 'Set DAWSHA_SHOTS to a folder to capture screenshots')
    test.setTimeout(120_000)
    const sandbox = createSandbox()
    makeRepo(sandbox)
    mkdirSync(join(sandbox.projectFolder, 'src', 'invoices'), { recursive: true })
    writeFileSync(join(sandbox.projectFolder, 'src', 'invoices', 'totals.ts'), Array.from({ length: 30 }, (_, i) => `export const total${i + 1} = ${i + 1}`).join('\n') + '\n')
    writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify({ version: 2, lastSeenVersion: APP_VERSION, projects: [{ id: 'smoke', name: 'Smoke', folder: sandbox.projectFolder }], ...(themeId ? { theme: { id: themeId } } : {}) }), 'utf8')
    const { app, page } = await launchApp(sandbox)
    try {
      mkdirSync(SHOTS, { recursive: true })
      await page.setViewportSize({ width: 1440, height: 880 })
      await openFiles(page)
      await row(page, 'src/a.ts').click({ modifiers: ['Control'] })
      await row(page, 'package.json').click({ modifiers: ['Control'] })
      await row(page, 'README.md').click()
      await row(page, 'src/a.ts').click({ modifiers: ['Control'] })
      const code = page.locator('.files-editor:not([hidden])')
      await expect(code.locator('.cm-line span').filter({ hasText: /^const$/ }).first()).toBeVisible()
      await page.screenshot({ path: join(SHOTS, `files-${mode}-tabs-syntax.png`) })
      await row(page, 'src/util/helpers.ts').click({ button: 'right' })
      await expect(page.locator('.ctx-menu:not(.leaving)')).toBeVisible()
      await page.waitForTimeout(300)
      await page.screenshot({ path: join(SHOTS, `files-${mode}-tree-menu-open.png`) })
      await page.keyboard.press('Escape')
      await tabs(page).nth(1).click({ button: 'right' })
      await expect(page.locator('.ctx-menu:not(.leaving)')).toBeVisible()
      await page.waitForTimeout(300)
      await page.screenshot({ path: join(SHOTS, `files-${mode}-tab-menu-open.png`) })
      await page.keyboard.press('Escape')
      await page.setViewportSize({ width: 1024, height: 728 })
      await page.screenshot({ path: join(SHOTS, `files-${mode}-ci-size.png`) })
      await page.setViewportSize({ width: 1440, height: 880 })

      await page.locator('#sessions-button').click()
      await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
      const host = page.locator('.term-host.active')
      const id = (await host.getAttribute('data-term-id'))!
      await expect.poll(() => bufferText(page, id), { timeout: 30_000 }).toMatch(/>\s*$/m)
      await feedTerminal(page, id, '\x1b[2J\x1b[H')
      await feedTerminal(page, id, '  └ Update src/invoices/totals.ts:12  (+18 -3)\r\n')
      await expect.poll(() => bufferText(page, id)).toContain('Update src/invoices')
      const screen = (await page.locator('.term-host.active .xterm-screen').boundingBox())!
      const at = { x: screen.x + 180, y: screen.y + 4 }
      await page.mouse.move(at.x + 300, at.y + 300)
      await page.mouse.move(at.x + 300, at.y + 310)
      await page.mouse.move(at.x, at.y)
      await page.mouse.move(at.x + 1, at.y)
      await expect(page.locator('.term-host.active .xterm-cursor-pointer')).toHaveCount(1)
      await page.mouse.click(at.x, at.y, { button: 'right' })
      await expect(page.getByRole('menu', { name: 'Path actions' })).toBeVisible()
      await page.waitForTimeout(300)
      await page.screenshot({ path: join(SHOTS, `terminal-${mode}-path-menu-open.png`) })
    } finally {
      await closeApp(app)
    }
  })
}
