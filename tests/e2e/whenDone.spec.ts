import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { bufferText, closeApp, createSandbox, launchApp, type Sandbox } from './helpers'

const readSettings = (userData: string): any => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))

function writeSession(sandbox: Sandbox, status: 'busy' | 'idle'): void {
  const now = Date.now()
  writeFileSync(
    join(sandbox.sessionsDir, 'rule-session.json'),
    JSON.stringify({ pid: process.pid, sessionId: 'rule-session', cwd: sandbox.projectFolder, name: 'Fix the invoice export', nameSource: 'user', status, startedAt: now + 1000, updatedAt: now + 1000 }),
    'utf8'
  )
}

async function openPanes(page: Page, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await page.keyboard.press('Control+n')
    await expect(page.locator('.quickpick')).toHaveCount(1)
    await page.keyboard.press('Enter')
    await expect(page.locator('.pane')).toHaveCount(index + 1, { timeout: 20_000 })
  }
}

test('a when-done rule runs the checks after a turn, sends a failure back, and stops when you type', async () => {
  test.setTimeout(180_000)
  const sandbox = createSandbox()
  writeFileSync(join(sandbox.projectFolder, 'package.json'), JSON.stringify({ name: 'rule-check', version: '1.0.0', packageManager: 'npm@10.8.2', scripts: { test: 'node -e "console.error(\'boom from check\'); process.exit(1)"' } }))
  const { app, page } = await launchApp(sandbox)
  try {
    await openPanes(page, 2)
    writeSession(sandbox, 'busy')
    const working = page.locator('.pane[data-state="working"]')
    await expect(working).toHaveCount(1, { timeout: 20_000 })
    const paneId = (await working.getAttribute('data-pane-id')) ?? ''
    const pane = page.locator(`.pane[data-pane-id="${paneId}"]`)
    const termId = (await pane.locator('.term-host').first().getAttribute('data-term-id')) ?? ''

    await pane.getByRole('button', { name: 'Pane actions' }).click()
    await page.getByRole('menuitem', { name: 'When done…', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: /is done$/ })
    await dialog.getByRole('group', { name: 'Run commands' }).getByRole('checkbox').first().check()
    await dialog.getByLabel('Times a failure goes back to the agent').fill('1')
    await dialog.getByLabel('If the commands pass').selectOption('notify')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(pane.locator('.pane-rule')).toHaveText('When done: checks on')
    await expect.poll(() => (readSettings(sandbox.userData).workspace?.panes ?? []).map((saved: any) => saved.care?.rule).filter(Boolean)).toMatchObject([{ tries: 1, onPass: 'notify' }])

    writeSession(sandbox, 'idle')
    await expect(pane.locator('.pane-rule')).toHaveText('Sent the failure back, 1 of 1', { timeout: 60_000 })
    await expect.poll(async () => (await bufferText(page, termId)).replace(/\s+/g, ''), { timeout: 20_000 }).toContain('Thesechecksfailedafteryourlastreply')

    await pane.locator('.term-host.active').click()
    await page.keyboard.type('x')
    await expect(pane.locator('.pane-rule')).toHaveText('When done: checks on')
  } finally {
    await closeApp(app)
  }
})
