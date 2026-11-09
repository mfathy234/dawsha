import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp, openSettings } from './helpers'

const SECRET = 'abcdefghijklmnopqrstuvwxyz0123456789'

test('Settings > MCP lists servers, masks secrets until asked, and switches a Codex server in its file', async () => {
  const sandbox = createSandbox()
  const codexFile = join(sandbox.codexHome, 'config.toml')
  writeFileSync(codexFile, `[mcp_servers.docs]\ncommand = "docs-mcp"\nargs = ["--stdio"]\n\n[mcp_servers.docs.env]\nAPI_KEY = "${SECRET}"\n`)
  writeFileSync(join(sandbox.claudeHome, '.claude.json'), JSON.stringify({ mcpServers: { memory: { command: 'memory-mcp' } } }))
  const { app, page } = await launchApp(sandbox)
  try {
    await openSettings(page, 'mcp')
    const row = page.locator('.mcp-row[data-server="codex:user:docs"]')
    await expect(row).toBeVisible()
    await expect(row).toContainText('docs-mcp --stdio')
    await row.locator('summary').click()
    await expect(row).not.toContainText(SECRET)
    await row.getByRole('button', { name: 'Show API_KEY' }).click()
    await expect(row.locator('.mcp-entry')).toContainText(SECRET)

    const memory = page.locator('.mcp-row[data-server="claude:user:memory"]')
    await expect(memory).toContainText('Edit in file')

    await row.getByRole('switch').click()
    await expect(row.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
    expect(readFileSync(codexFile, 'utf8')).toContain('[mcp_servers.docs]\nenabled = false\ncommand = "docs-mcp"')
    expect(existsSync(`${codexFile}.dawsha-bak`)).toBe(true)
  } finally {
    await closeApp(app)
  }
})
