import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { APP_VERSION, activeTermId, bufferText, closeApp, createSandbox, feedTerminal, launchApp, selectAllText, QUIT_BUDGET_MS } from './helpers'

const SLOW = 30_000
const flat = async (page: Page, id: string): Promise<string> => (await bufferText(page, id)).replace(/[\r\n]/g, '')
const SCREENS = 'test-results/screens'
const ECHO = resolve(__dirname, '../support/echoInput.cjs')
const readSettings = (userData: string): any => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))

function seedSnippets(userData: string): void {
  const path = join(userData, 'settings.json')
  const stored = JSON.parse(readFileSync(path, 'utf8'))
  const snippets = [
    { id: 's1', name: 'Review the diff', text: 'Review the staged changes and list risks.', projectId: null, shortcut: 1 },
    { id: 's2', name: 'Describe the branch', text: 'Describe {{branch}} of {{project}} in {{folder}}', projectId: 'smoke', shortcut: 2 },
    { id: 's3', name: 'Explain this error', text: 'Explain this error and suggest a fix:\n{{selection}}', projectId: null, shortcut: 3 },
    { id: 's4', name: 'Commit message', text: 'Write a short commit message for the staged diff.', projectId: 'gone', shortcut: null }
  ]
  writeFileSync(path, JSON.stringify({ ...stored, lastSeenVersion: APP_VERSION, snippets }), 'utf8')
}

async function selectOnly(page: Page, id: string, text: string): Promise<void> {
  await feedTerminal(page, id, `\x1b[2J\x1b[H${text}`)
  await expect.poll(() => flat(page, id), { timeout: SLOW }).not.toContain('GOT')
  await expect.poll(() => flat(page, id), { timeout: SLOW }).toContain(text)
  await selectAllText(page, id)
}

test('snippets are managed in the Projects view with a confirmation naming the one deleted', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: 'Projects', exact: true }).click()
    await page.getByRole('tab', { name: 'Snippets' }).click()
    await expect(page.getByRole('tab', { name: 'Snippets' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.proj-empty')).toContainText('No snippets yet')

    await page.locator('#add-snippet').click()
    const dialog = page.getByRole('dialog', { name: 'New snippet' })
    await expect(dialog).toContainText('{{selection}}')
    await dialog.getByRole('button', { name: 'Save snippet' }).click()
    await expect(dialog.getByRole('alert')).toHaveText('Enter a name.')
    await dialog.getByLabel('Name').fill('Review the diff')
    await dialog.getByLabel('Text').fill('Review the staged changes and list risks.')
    await dialog.getByLabel('Shortcut').selectOption('1')
    await page.screenshot({ path: join(SCREENS, '35-snippet-dialog.png') })
    await dialog.getByRole('button', { name: 'Save snippet' }).click()
    await expect(page.locator('.snippet-row')).toHaveCount(1)
    await expect(page.locator('.snippet-row')).toContainText('Review the diff')
    await expect(page.locator('.snippet-row')).toContainText('all projects')
    await expect(page.locator('.snippet-row .snippet-key')).toHaveText('Alt+1')

    await page.locator('#add-snippet').click()
    const second = page.getByRole('dialog', { name: 'New snippet' })
    await second.getByLabel('Name').fill('Write tests')
    await second.getByLabel('Text').fill('Write tests for the files changed on {{branch}}.')
    await second.getByLabel('Scope').selectOption('smoke')
    await second.getByLabel('Shortcut').selectOption('1')
    await second.getByRole('button', { name: 'Save snippet' }).click()
    await expect(second.getByRole('alert')).toHaveText("Alt+1 is already used by 'Review the diff'.")
    await second.getByLabel('Shortcut').selectOption('2')
    await second.getByRole('button', { name: 'Save snippet' }).click()
    await expect(page.locator('.snippet-row')).toHaveCount(2)
    await expect(page.locator('.snippet-row').nth(1)).toContainText('Smoke')
    await page.screenshot({ path: join(SCREENS, '36-snippets-list.png') })

    await page.getByRole('button', { name: 'Edit snippet Write tests' }).click()
    const edit = page.getByRole('dialog', { name: 'Edit snippet' })
    await expect(edit.getByLabel('Name')).toHaveValue('Write tests')
    await expect(edit.getByLabel('Shortcut')).toHaveValue('2')
    await edit.getByLabel('Name').fill('Write tests for the branch')
    await edit.getByRole('button', { name: 'Save snippet' }).click()
    await expect(page.locator('.snippet-row').nth(1)).toContainText('Write tests for the branch')
    await expect.poll(() => readSettings(sandbox.userData).snippets.map((s: any) => s.name)).toEqual([
      'Review the diff',
      'Write tests for the branch'
    ])
    expect(readSettings(sandbox.userData).snippets[1]).toMatchObject({ projectId: 'smoke', shortcut: 2 })

    await page.getByRole('button', { name: 'Delete snippet Review the diff' }).click()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm.getByRole('heading')).toHaveText('Delete snippet "Review the diff"?')
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.locator('.snippet-row')).toHaveCount(2)
    await page.getByRole('button', { name: 'Delete snippet Review the diff' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete "Review the diff"' }).click()
    await expect(page.locator('.snippet-row')).toHaveCount(1)
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('inserting a snippet types it into the focused terminal without sending it and fills the variables', async () => {
  const sandbox = createSandbox()
  seedSnippets(sandbox.userData)
  execFileSync('git', ['init', '-q', '-b', 'feature/dark-mode'], { cwd: sandbox.projectFolder })
  const { app, page } = await launchApp(sandbox, {
    DAWSHA_CLAUDE_COMMAND: process.execPath,
    DAWSHA_CLAUDE_ARGS: JSON.stringify([ECHO])
  })
  try {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    const id = await activeTermId(page)
    await expect.poll(() => flat(page, id), { timeout: 20_000 }).toContain('echo-input ready')
    await expect(page.locator('.pane .chip-text')).toHaveText('feature/dark-mode')
    await page.locator('.term-host.active').click()
    await expect(page.locator('.term-host.active .xterm-helper-textarea')).toBeFocused()

    await page.keyboard.press('Alt+1')
    await expect(page.locator('.toast').last()).toContainText("Inserted 'Review the diff'. Press Enter to send it.")
    await expect.poll(() => flat(page, id), { timeout: SLOW }).toContain('GOT "Review the staged changes and list risks."')

    await page.keyboard.press('Alt+2')
    await expect.poll(() => flat(page, id), { timeout: SLOW }).toContain(
      `GOT "Describe feature/dark-mode of Smoke in ${sandbox.projectFolder.replace(/\\/g, '\\\\')}"`
    )

    await page.keyboard.press('Alt+3')
    await expect(page.locator('.toast').last()).toContainText("Select some text in the terminal first, then insert 'Explain this error' again.")
    expect(await bufferText(page, id)).not.toContain('Explain this error')

    await selectOnly(page, id, 'TypeError: boom')
    await page.keyboard.press('Alt+3')
    await expect.poll(() => flat(page, id), { timeout: SLOW }).toContain('GOT "Explain this error and suggest a fix: TypeError: boom"')
    await expect(page.locator('.toast').last()).toContainText('line breaks were joined')

    await feedTerminal(page, id, '\x1b[?2004h')
    await selectOnly(page, id, 'TypeError: boom')
    await page.keyboard.press('Alt+3')
    await expect
      .poll(() => flat(page, id), { timeout: SLOW })
      .toContain('GOT "\\u001b[200~Explain this error and suggest a fix:\\rTypeError: boom\\u001b[201~"')

    await page.keyboard.press('Control+k')
    await expect(page.locator('#palette-input')).toBeFocused()
    await page.keyboard.type('zebra')
    await expect(page.locator('.palette-row')).toHaveCount(0)
    await page.locator('#palette-input').fill('review')
    await expect(page.locator('.palette-group')).toHaveText(['Snippets'])
    await expect(page.locator('.palette-row')).toContainText('Insert "Review the diff"')
    await expect(page.locator('.palette-row .palette-kbd')).toHaveText('Alt+1')
    await page.screenshot({ path: join(SCREENS, '37-palette-snippets.png') })
    await page.keyboard.press('Enter')
    await expect.poll(() => flat(page, id), { timeout: SLOW }).toContain('GOT "Review the staged changes and list risks."')
    expect(await bufferText(page, id)).not.toContain('is not recognized')
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})
