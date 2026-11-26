import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test } from '@playwright/test'
import { bufferText, closeApp, createSandbox, feedTerminal, launchApp, openTerminalPicker } from './helpers'

async function oscApp() {
  const sandbox = createSandbox()
  const fixture = join(sandbox.root, 'osc-agent.cjs')
  writeFileSync(fixture, "process.stdin.setRawMode(true); process.stdout.write('Ready>'); setInterval(() => {}, 60000);")
  const launched = await launchApp(sandbox, { DAWSHA_CLAUDE_COMMAND: process.execPath, DAWSHA_CLAUDE_ARGS: JSON.stringify([fixture]) })
  await launched.page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
  const id = (await launched.page.locator('.term-host.active').getAttribute('data-term-id'))!
  await expect.poll(() => bufferText(launched.page, id)).toContain('Ready>')
  return { ...launched, sandbox, id }
}

test('OSC 52 asks once per session, refuses reads, and remembers Allow and Deny', async () => {
  const { app, page, id } = await oscApp()
  const original = await app.evaluate(({ clipboard }) => clipboard.readText())
  try {
    await app.evaluate(({ clipboard }) => clipboard.writeText('original'))
    await feedTerminal(page, id, '\x1b]52;c;?\x07')
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await feedTerminal(page, id, '\x1b]52;c;' + Buffer.from('copied over SSH').toString('base64') + '\x07')
    const dialog = page.getByRole('alertdialog', { name: 'Allow this session to set your clipboard?' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Allow', exact: true }).click()
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('copied over SSH')
    await feedTerminal(page, id, '\x1b]52;c;' + Buffer.from('second copy').toString('base64') + '\x07')
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('second copy')
    await expect(dialog).toHaveCount(0)
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    const next = (await page.locator('.pane').last().locator('.term-host').getAttribute('data-term-id'))!
    await feedTerminal(page, next, '\x1b]52;c;eA==\x07')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Deny', exact: true }).click()
    await feedTerminal(page, next, '\x1b]52;c;eQ==\x07')
    await page.waitForTimeout(150)
    await expect(dialog).toHaveCount(0)
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('second copy')
  } finally { await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), original); await closeApp(app) }
})

test('OSC progress follows the session tab and clears the Windows taskbar', async () => {
  const { app, page, id } = await oscApp()
  try {
    const window = await app.browserWindow(page)
    await window.evaluate((win) => {
      const original = win.setProgressBar.bind(win)
      ;(win as unknown as { values: number[] }).values = []
      win.setProgressBar = (value: number, options?: Electron.ProgressBarOptions) => { (win as unknown as { values: number[] }).values.push(value); original(value, options) }
    })
    await page.locator('.pane').getByRole('button', { name: 'Maximize pane', exact: true }).click()
    await feedTerminal(page, id, '\x1b]9;4;1;64\x07')
    await expect(page.locator('.strip-tab .terminal-progress')).toHaveAttribute('aria-valuenow', '64')
    await expect.poll(() => window.evaluate((win) => (win as unknown as { values: number[] }).values.at(-1))).toBe(.64)
    await feedTerminal(page, id, '\x1b]9;4;0\x07')
    await expect(page.locator('.strip-tab .terminal-progress')).toHaveCount(0)
    await expect.poll(() => window.evaluate((win) => (win as unknown as { values: number[] }).values.at(-1))).toBe(-1)
  } finally { await closeApp(app) }
})

test('OSC hyperlinks show their URL and require Ctrl+click', async () => {
  const { app, page, id, sandbox } = await oscApp()
  try {
    await app.evaluate(({ shell }) => {
      const target = globalThis as unknown as { links: string[] }
      target.links = []
      shell.openExternal = async (url: string) => { target.links.push(url) }
    })
    await feedTerminal(page, id, '\x1b[2J\x1b[H\x1b]8;;https://example.com/terminal\x07View run\x1b]8;;\x07\r\n')
    await expect.poll(() => bufferText(page, id)).toContain('View run')
    const screen = page.locator('.term-host.active .xterm-screen')
    const bounds = (await screen.boundingBox())!
    await page.mouse.move(bounds.x + 20, bounds.y + 8)
    const tooltip = page.getByRole('tooltip')
    await expect(tooltip).toContainText('https://example.com/terminal')
    await page.mouse.click(bounds.x + 20, bounds.y + 8)
    expect(await app.evaluate(() => (globalThis as unknown as { links: string[] }).links)).toEqual([])
    await page.keyboard.down('Control')
    await page.mouse.click(bounds.x + 20, bounds.y + 8)
    await page.keyboard.up('Control')
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { links: string[] }).links)).toEqual(['https://example.com/terminal'])
  } finally { await closeApp(app) }
})

test('OSC 7 resolves relative file links and starts a new session in the current folder', async () => {
  const { app, page, id, sandbox } = await oscApp()
  const folder = join(sandbox.projectFolder, 'nested')
  mkdirSync(folder)
  writeFileSync(join(folder, 'inside.ts'), 'export const inside = 1\n')
  try {
    await feedTerminal(page, id, `\x1b]7;${pathToFileURL(folder).href}\x07\x1b[2J\x1b[Hinside.ts:1\r\n`)
    await expect.poll(() => bufferText(page, id)).toContain('inside.ts:1')
    const bounds = (await page.locator('.term-host.active .xterm-screen').boundingBox())!
    await page.mouse.move(bounds.x + 6, bounds.y + 5)
    await expect(page.locator('.term-host.active .xterm-cursor-pointer')).toHaveCount(1)
    await page.keyboard.down('Control')
    await page.mouse.click(bounds.x + 6, bounds.y + 5)
    await page.keyboard.up('Control')
    await expect(page.locator('#files-view')).toBeVisible()
    await expect(page.locator('.files-tab.active')).toContainText('inside.ts')
    await page.locator('#sessions-button').click()
    await openTerminalPicker(page.locator('.pane'))
    await page.getByRole('menuitem', { name: 'New session here', exact: true }).click()
    await expect(page.locator('.pane')).toHaveCount(2)
    const nextId = (await page.locator('.pane').last().locator('.term-host').getAttribute('data-term-id'))!
    await expect.poll(() => bufferText(page, nextId)).toContain('Ready>')
    await expect.poll(async () => {
      const settings = await page.evaluate(async () => (await window.gridApi.getSettings()).settings)
      return settings.workspace.panes.at(-1)?.folder?.replaceAll('\\', '/')
    }).toBe(folder.replaceAll('\\', '/'))
  } finally { await closeApp(app) }
})
