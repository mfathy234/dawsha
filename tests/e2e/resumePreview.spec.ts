import { mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp, type Sandbox, QUIT_BUDGET_MS } from './helpers'

const SCREENS = 'test-results/screens'
const SESSION = '22222222-2222-4333-8444-555555555555'

function seedMessy(sandbox: Sandbox): void {
  const dir = join(sandbox.claudeHome, 'projects', sandbox.projectFolder.replace(/[^A-Za-z0-9]/g, '-'))
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${SESSION}.jsonl`)
  const reply = [
    '## Where things stand',
    '',
    '**Done**',
    '- Moved the invoice totals into `totals.ts`',
    '- Added a [regression test](https://example.test/pr/7)',
    '',
    '| file | change |',
    '|---|---|',
    '| totals.ts | new |',
    '',
    'Next I would wire the export button. ' + 'It still needs a design pass. '.repeat(30)
  ].join('\n')
  writeFileSync(
    path,
    [
      { type: 'user', timestamp: '2026-10-08T09:00:00.000Z', message: { content: '<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>' } },
      { type: 'user', isMeta: true, message: { content: '<local-command-caveat>Caveat: ignore the commands below</local-command-caveat>' } },
      { type: 'user', timestamp: '2026-10-08T09:01:00.000Z', message: { content: '<system-reminder>internal note</system-reminder>[Image #1] Move the invoice totals out of the page component and cover them with a test' } },
      { type: 'assistant', timestamp: '2026-10-08T09:02:00.000Z', message: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Looking at the page first.' }] } },
      { type: 'assistant', timestamp: '2026-10-08T09:30:00.000Z', message: { model: 'claude-opus-5-5', content: [{ type: 'text', text: reply }] } },
      { type: 'assistant', timestamp: '2026-10-08T09:31:00.000Z', message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] } },
      { type: 'ai-title', aiTitle: 'Refactor invoice totals' }
    ].map((record) => JSON.stringify(record)).join('\n') + '\n'
  )
  const when = new Date(Date.now() - 20 * 60_000)
  utimesSync(path, when, when)
}

test('the resume preview shows the real request and the last real reply, cleaned and cut at a word', async () => {
  const sandbox = createSandbox()
  seedMessy(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    await page.keyboard.press('Control+Shift+R')
    const preview = page.locator('.rp-preview')
    await expect(preview).toContainText('Refactor invoice totals')
    const about = preview.locator('.rp-field', { has: page.getByRole('heading', { name: 'What it was about' }) })
    await expect(about.locator('p')).toHaveText('Move the invoice totals out of the page component and cover them with a test')
    await expect(about.locator('p')).toHaveAttribute('dir', 'auto')
    const ended = preview.locator('.rp-field', { has: page.getByRole('heading', { name: 'Where it ended' }) })
    const text = (await ended.locator('p').textContent()) ?? ''
    expect(text.startsWith('Where things stand Done • Moved the invoice totals into totals.ts • Added a regression test')).toBe(true)
    expect(text).not.toMatch(/[*#`|]|\]\(/)
    expect(text.endsWith('…')).toBe(true)
    expect(text).not.toMatch(/\bdesig…$/)
    await expect(preview.locator('.rp-facts')).toHaveText(/^3 messages( · [^·]+)+$/)
    await expect(preview.locator('.rp-facts li, .rp-facts .chip')).toHaveCount(0)
    await expect(preview.locator('.rp-facts')).not.toContainText('Active')
    await expect(preview).not.toContainText('command-name')
    await expect(preview).not.toContainText('Caveat')
    await page.screenshot({ path: join(SCREENS, '162-resume-preview.png') })
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('the project filter is a styled menu: native select stays the value, Escape closes the menu before the picker', async () => {
  const sandbox = createSandbox()
  seedMessy(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    await page.keyboard.press('Control+Shift+R')
    await page.locator('#rp-all-projects').uncheck()
    const trigger = page.locator('#rp-project-trigger')
    await expect(trigger).toContainText('Smoke')
    await expect(page.locator('#rp-project')).toHaveValue('smoke')
    await trigger.click()
    const menu = page.getByRole('listbox', { name: 'Project filter' })
    await expect(menu).toBeVisible()
    await page.waitForTimeout(250)
    await page.screenshot({ path: join(SCREENS, '162-resume-project-menu.png') })
    await expect(menu).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(page.locator('.resume-picker')).toBeVisible()
    await expect(trigger).toBeFocused()

    await page.keyboard.press('ArrowDown')
    await expect(menu).toBeVisible()
    await expect(page.locator('.rp-row')).toHaveCount(1)
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(menu).toHaveCount(0)
    await expect(page.locator('#rp-project')).toHaveValue('gone')
    await expect(trigger).toContainText('Missing')
    await expect(page.locator('.rp-empty')).toContainText('No earlier sessions in Missing.')
    await expect(page.locator('.resume-picker')).toBeVisible()

    await page.locator('#rp-project').selectOption('smoke')
    await expect(trigger).toContainText('Smoke')
    await expect(page.locator('.rp-row')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(page.locator('.resume-picker')).toHaveCount(0)
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})
