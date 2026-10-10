import { readFileSync, writeFileSync, existsSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { closeApp, createSandbox, launchApp, QUIT_BUDGET_MS } from './helpers'

const START = '<!-- dawsha:shared:start -->'
const END = '<!-- dawsha:shared:end -->'
const ORIGINAL = '# acme-web\r\nUse tabs.\r\n'

const count = (text: string, needle: string): number => text.split(needle).length - 1

function writeExternal(path: string, text: string): void {
  writeFileSync(path, text, 'utf8')
  const later = new Date(Date.now() + 10_000)
  utimesSync(path, later, later)
}

async function openTab(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Projects', exact: true }).click()
  await page.getByRole('tab', { name: 'Instructions' }).click()
  await expect(page.getByRole('tab', { name: 'Instructions' })).toHaveAttribute('aria-selected', 'true')
}

test('project instructions are listed, edited with their line endings kept and guarded against outside changes', async () => {
  const sandbox = createSandbox()
  const claude = join(sandbox.projectFolder, 'CLAUDE.md')
  const agents = join(sandbox.projectFolder, 'AGENTS.md')
  writeFileSync(claude, ORIGINAL, 'utf8')
  const { app, page } = await launchApp(sandbox)
  try {
    await openTab(page)
    await expect(page.locator('#instr-project')).toHaveValue('smoke')
    await expect(page.locator('.instr-row[data-file="CLAUDE.md"]')).toHaveAttribute('data-status', 'exists')
    await expect(page.locator('.instr-row[data-file="CLAUDE.md"]')).toContainText('Claude Code')
    await expect(page.locator('.instr-row[data-file="CLAUDE.md"]')).toContainText('modified')
    await expect(page.locator('.instr-row[data-file="AGENTS.md"]')).toHaveAttribute('data-status', 'missing')
    await expect(page.locator('.instr-row[data-file="GEMINI.md"]')).toHaveAttribute('data-status', 'missing')
    await expect(page.locator('[data-vscode="AGENTS.md"]')).toHaveCount(0)

    await page.locator('[data-edit="CLAUDE.md"]').click()
    const area = page.locator('#instr-editor')
    await expect(area).toHaveValue('# acme-web\nUse tabs.\n')
    await expect(page.locator('#instr-dirty')).toHaveText('No changes')
    await area.fill('# acme-web\nUse tabs.\nRun the tests first.\n')
    await expect(page.locator('#instr-dirty')).toHaveText('Unsaved changes')
    await area.press('Control+s')
    await expect(page.locator('#instr-dirty')).toHaveText('No changes')
    expect(readFileSync(claude, 'utf8')).toBe('# acme-web\r\nUse tabs.\r\nRun the tests first.\r\n')

    await area.fill('# acme-web\nMine.\n')
    writeExternal(claude, 'edited elsewhere\r\n')
    await page.locator('#instr-save').click()
    await expect(page.locator('#instr-conflict')).toContainText('CLAUDE.md changed on disk')
    expect(readFileSync(claude, 'utf8')).toBe('edited elsewhere\r\n')
    await page.locator('#instr-reload').click()
    await expect(page.locator('#instr-conflict')).toBeHidden()
    await expect(area).toHaveValue('edited elsewhere\n')

    await area.fill('edited elsewhere\nand mine\n')
    writeExternal(claude, 'second outside edit, longer than before\r\n')
    await page.locator('#instr-save').click()
    await expect(page.locator('#instr-conflict')).toBeVisible()
    await page.locator('#instr-overwrite').click()
    const dialog = page.getByRole('alertdialog', { name: 'Overwrite CLAUDE.md?' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    expect(readFileSync(claude, 'utf8')).toBe('second outside edit, longer than before\r\n')
    await page.locator('#instr-overwrite').click()
    await page.getByRole('alertdialog', { name: 'Overwrite CLAUDE.md?' }).getByRole('button', { name: 'Overwrite CLAUDE.md' }).click()
    await expect(page.locator('#instr-conflict')).toBeHidden()
    expect(readFileSync(claude, 'utf8')).toBe('edited elsewhere\r\nand mine\r\n')

    await area.fill('scratch\n')
    await page.locator('#instr-revert').click()
    await page.getByRole('alertdialog', { name: 'Revert CLAUDE.md?' }).getByRole('button', { name: 'Revert CLAUDE.md' }).click()
    await expect(area).toHaveValue('edited elsewhere\nand mine\n')

    await page.locator('[data-vscode="CLAUDE.md"]').click()
    await expect.poll(() => (existsSync(sandbox.openLog) ? readFileSync(sandbox.openLog, 'utf8') : '')).toContain('CLAUDE.md')
    expect(existsSync(agents)).toBe(false)
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('shared instructions are written between markers, create only ticked files and replace on re-apply', async () => {
  const sandbox = createSandbox()
  const claude = join(sandbox.projectFolder, 'CLAUDE.md')
  const agents = join(sandbox.projectFolder, 'AGENTS.md')
  const gemini = join(sandbox.projectFolder, 'GEMINI.md')
  writeFileSync(claude, ORIGINAL, 'utf8')
  const { app, page } = await launchApp(sandbox)
  try {
    await openTab(page)
    await expect(page.locator('#instr-apply')).toBeDisabled()
    await page.locator('#instr-shared-text').fill('Always run lint.\nNo default exports.')
    await expect(page.locator('[data-preview="CLAUDE.md"]')).toContainText('will be updated')
    await expect(page.locator('[data-preview="AGENTS.md"]')).toContainText('will not be created')
    await expect(page.locator('[data-preview="GEMINI.md"]')).toContainText('will not be created')
    await page.locator('#instr-create-AGENTS\\.md').check()
    await expect(page.locator('[data-preview="AGENTS.md"]')).toContainText('will be created')
    await page.locator('#instr-apply').click()

    await expect(page.locator('.instr-row[data-file="AGENTS.md"]')).toHaveAttribute('data-status', 'exists')
    const first = readFileSync(claude, 'utf8')
    expect(first).toBe(`${ORIGINAL}\r\n${START}\r\nAlways run lint.\r\nNo default exports.\r\n${END}\r\n`)
    expect(readFileSync(agents, 'utf8')).toBe(`${START}\nAlways run lint.\nNo default exports.\n${END}\n`)
    expect(existsSync(gemini)).toBe(false)

    await page.locator('#instr-shared-text').fill('Prefer small commits.')
    await expect(page.locator('[data-preview="CLAUDE.md"]')).toContainText('will be updated')
    await expect(page.locator('[data-preview="AGENTS.md"]')).toContainText('will be updated')
    await page.locator('#instr-apply').click()
    await expect.poll(() => readFileSync(claude, 'utf8')).toContain('Prefer small commits.')
    const second = readFileSync(claude, 'utf8')
    expect(second).toBe(`${ORIGINAL}\r\n${START}\r\nPrefer small commits.\r\n${END}\r\n`)
    expect(count(second, START)).toBe(1)
    expect(count(readFileSync(agents, 'utf8'), END)).toBe(1)
    await expect(page.locator('[data-preview="CLAUDE.md"]')).toContainText('already up to date')

    writeFileSync(claude, `${START}\none\n${END}\n${START}\ntwo\n${END}\n`, 'utf8')
    await page.getByRole('tab', { name: 'Projects', exact: true }).click()
    await page.getByRole('tab', { name: 'Instructions' }).click()
    await expect(page.locator('[data-preview="CLAUDE.md"]')).toContainText('more than once')
    await expect(page.locator('#instr-apply')).toBeDisabled()
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('the palette command opens the instructions of the focused pane project', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    await expect(page.locator('.pane')).toHaveCount(1, { timeout: 20_000 })
    await page.locator('.term-host.active').click()
    await page.keyboard.press('Control+k')
    await expect(page.locator('#palette-input')).toBeFocused()
    await page.keyboard.type('project instructions')
    await page.locator('.palette-row', { hasText: 'Edit project instructions' }).click()
    await expect(page.getByRole('tab', { name: 'Instructions' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('#instr-project')).toHaveValue('smoke')
    await expect(page.locator('.instr-row[data-file="CLAUDE.md"]')).toHaveAttribute('data-status', 'missing')
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})
