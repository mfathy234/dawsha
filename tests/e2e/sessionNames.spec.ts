import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp, type Sandbox } from './helpers'

const SESSION = 'ab112233-4455-4677-8899-aabbccddeeff'
const PROMPT = String.raw`based on stage read this repo "C:\Users\tuy_2\Downloads\security-report.html" and fix every finding`
const TITLE = 'Fix every security report finding'

function seedPrompt(sandbox: Sandbox): void {
  const dir = join(sandbox.claudeHome, 'projects', sandbox.projectFolder.replace(/[^A-Za-z0-9]/g, '-'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${SESSION}.jsonl`), JSON.stringify({ type: 'user', message: { content: PROMPT } }) + '\n')
  const now = Date.now() + 1000
  writeFileSync(join(sandbox.sessionsDir, `${SESSION}.json`), JSON.stringify({ pid: process.pid, sessionId: SESSION, cwd: sandbox.projectFolder, name: 'smoke-123', nameSource: 'derived', status: 'idle', startedAt: now, updatedAt: now }))
}

test('an unnamed long prompt has one short title, full hover text, and Rename survives restart', async () => {
  const sandbox = createSandbox()
  let running = await launchApp(sandbox, {}, ['--new-session=smoke'])
  try {
    await expect(running.page.locator('.pane')).toHaveCount(1)
    seedPrompt(sandbox)
    const page = running.page
    const row = page.locator('.sess-row[data-nav^="s:"]')
    await expect(row.locator('.sess-name')).toHaveText(TITLE, { timeout: 15_000 })
    await expect(row).toHaveAttribute('title', new RegExp('security-report\\.html'))
    expect(await row.getAttribute('title')).toContain(PROMPT)
    await page.locator('.pane').getByRole('button', { name: 'Maximize pane', exact: true }).click()
    await expect(page.locator('.strip-name')).toHaveText(TITLE)
    expect(await page.locator('.strip-label').getAttribute('title')).toContain(PROMPT)
    await expect(page.locator('.pane-title bdi')).toHaveText(TITLE)
    await page.locator('.pane').getByRole('button', { name: 'Restore pane to grid', exact: true }).click()
    await row.dblclick()
    await expect(page.locator('.sess-rename')).toHaveValue(PROMPT)
    await page.locator('.sess-rename').press('Enter')
    await expect(row.locator('.sess-name')).toHaveText(TITLE)
    await row.dblclick()
    await expect(page.locator('.sess-rename')).toHaveValue(PROMPT)
    await page.locator('.sess-rename').fill('My security review')
    await page.locator('.sess-rename').press('Enter')
    await expect(page.locator('.sess-name')).toHaveText('My security review')
    await expect.poll(() => JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8'))?.workspace?.panes?.[0]?.tabs?.[0]?.name).toBe('My security review')
    await closeApp(running.app)
    running = await launchApp(sandbox)
    await expect(running.page.locator('.sess-name')).toHaveText('My security review')
    await running.page.keyboard.press('Control+Shift+R')
    await expect(running.page.locator('.rp-title')).toHaveText(TITLE)
    expect(await running.page.locator('.rp-title').getAttribute('title')).toContain(PROMPT)
  } finally { await closeApp(running.app) }
})
