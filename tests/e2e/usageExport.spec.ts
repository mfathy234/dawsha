import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp, openMore, QUIT_BUDGET_MS } from './helpers'

const SCREENS = 'test-results/screens'
const CLAUDE_ID = '11111111-2222-4333-8444-555555555555'

function seedClaude(claudeHome: string, cwd: string): void {
  const dir = join(claudeHome, 'projects', 'smoke-slug')
  mkdirSync(dir, { recursive: true })
  const record = (id: string, usage: Record<string, number>) =>
    JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), cwd, sessionId: CLAUDE_ID, message: { id, model: 'claude-opus', usage } })
  writeFileSync(
    join(dir, `${CLAUDE_ID}.jsonl`),
    `${record('m1', { input_tokens: 100, output_tokens: 400, cache_creation_input_tokens: 500, cache_read_input_tokens: 9000 })}\n`
  )
}

test('Export CSV saves the chosen range as a spreadsheet-safe file and offers to show it', async () => {
  const sandbox = createSandbox()
  // A project name that a spreadsheet would run as a formula.
  const settingsPath = join(sandbox.userData, 'settings.json')
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
  settings.projects[0].name = '=Smoke'
  writeFileSync(settingsPath, JSON.stringify(settings), 'utf8')
  seedClaude(sandbox.claudeHome, sandbox.projectFolder)
  const out = join(sandbox.root, 'usage.csv')
  const { app, page } = await launchApp(sandbox, { DAWSHA_SAVE_PATH: out })
  try {
    await openMore(page, 'usage')
    await page.getByRole('button', { name: 'Export CSV' }).click()
    const dialog = page.getByRole('dialog', { name: 'Export usage' })
    await expect(dialog).toContainText('Columns: date, project, agent, model, input, output, cache read, cache write, cost.')
    await expect(dialog.getByRole('button', { name: 'Range' })).toContainText('This month')
    await expect(dialog.getByRole('button', { name: 'One row per' })).toContainText('Day, project and agent')
    await page.screenshot({ path: join(SCREENS, '88-usage-export.png') })
    await dialog.getByRole('button', { name: 'Save CSV…' }).click()
    await expect(page.locator('.toast', { hasText: 'Saved usage.csv.' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Show in folder' })).toBeVisible()
    expect(existsSync(out)).toBe(true)
    const csv = readFileSync(out, 'utf8').replace(/^﻿/, '')
    const [header, row] = csv.split('\r\n')
    expect(header).toBe('date,project,agent,model,input,output,cache read,cache write,cost')
    expect(row).toMatch(/^\d{4}-\d{2}-\d{2},'=Smoke,Claude,claude-opus,100,400,9000,500,$/)
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})
