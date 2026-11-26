import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { bufferText, closeApp, createSandbox, feedTerminal, lastInput, launchApp, openTerminalPicker } from './helpers'

test('PowerShell commands get status, duration, output actions and shared project history', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, { DAWSHA_SHELL: 'powershell.exe', DAWSHA_SHELL_ARGS: '-NoProfile' })
  try {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    const pane = page.locator('.pane')
    await openTerminalPicker(pane)
    await pane.getByRole('menuitem', { name: 'Shell', exact: true }).click()
    const host = pane.locator('.term-host.active')
    const id = (await host.getAttribute('data-term-id'))!
    await expect.poll(() => bufferText(page, id), { timeout: 30_000 }).toMatch(/PS .*?>\s*$/m)
    await host.click()
    await page.keyboard.type('Write-Output shell-integration-ok')
    await page.keyboard.press('Enter')
    const command = host.getByRole('button', { name: /shell-integration-ok.*Command actions/ }).first()
    await expect(command).toBeVisible({ timeout: 30_000 })
    await expect(command).toContainText('✓')
    await command.click()
    await page.getByRole('menuitem', { name: 'Copy output', exact: true }).click()
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('shell-integration-ok')
    await host.click()
    await page.keyboard.press('Control+Shift+R')
    const history = page.getByRole('dialog', { name: 'Project shell history' })
    await expect(history).toBeVisible()
    await expect(history.getByRole('option').first()).toContainText('Write-Output shell-integration-ok')
    await page.keyboard.press('Enter')
    await expect(history).toHaveCount(0)
    await expect.poll(() => lastInput(page, id)).toContain('Write-Output shell-integration-ok')
    const persisted = (): string => existsSync(join(sandbox.userData, 'shell-history.json')) ? readFileSync(join(sandbox.userData, 'shell-history.json'), 'utf8') : ''
    expect(persisted()).toContain('Write-Output shell-integration-ok')
    for (const _ of 'Write-Output shell-integration-ok') await page.keyboard.press('Backspace')
    await expect.poll(() => bufferText(page, id)).toMatch(/PS [^\r\n]*>\s*$/)
    await page.keyboard.type('Write-Host -NoNewline final-row')
    await page.keyboard.press('Enter')
    const finalRow = host.getByRole('button', { name: /Write-Host -NoNewline final-row.*Command actions/ }).last()
    await expect(finalRow).toBeVisible()
    await finalRow.click()
    await page.getByRole('menuitem', { name: 'Copy output', exact: true }).click()
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('final-row')
    await host.click()
    await page.keyboard.type('do-not-run')
    await page.keyboard.press('Home')
    await command.click()
    await expect(page.getByRole('menuitem', { name: 'Rerun', exact: true })).toBeDisabled()
    await page.keyboard.press('Escape')
    await page.keyboard.press('End')
    for (const _ of 'do-not-run') await page.keyboard.press('Backspace')
    await expect.poll(() => bufferText(page, id)).toMatch(/PS [^\r\n]*>\s*$/)
    await command.click()
    await page.getByRole('menuitem', { name: 'Rerun', exact: true }).click()
    await expect(host.getByRole('button', { name: /Write-Output shell-integration-ok.*Command actions/ })).toHaveCount(2)
    await host.getByRole('button', { name: /Write-Output shell-integration-ok.*Command actions/ }).last().click()
    await page.getByRole('menuitem', { name: 'Send to a session…', exact: true }).click()
    const picker = page.getByRole('alertdialog', { name: 'Send to a session' })
    await expect(picker).toBeVisible()
    await picker.getByRole('button', { name: /Claude/ }).click()
    const agentId = (await pane.locator('.term-host').first().getAttribute('data-term-id'))!
    await expect.poll(() => lastInput(page, agentId)).toContain('Shell command and output:')
    await expect.poll(() => bufferText(page, agentId)).toContain('Shell command and output:')
  } finally { await closeApp(app) }
})

test('an unseen long command notifies with its result and duration', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    const pane = page.locator('.pane')
    await openTerminalPicker(pane)
    await pane.getByRole('menuitem', { name: 'Shell', exact: true }).click()
    const id = (await pane.locator('.term-host.active').getAttribute('data-term-id'))!
    await expect.poll(() => bufferText(page, id)).toMatch(/>\s*$/m)
    await page.clock.install()
    await feedTerminal(page, id, '\x1b[2J\x1b[H\x1b]133;A\x07$ \x1b]133;B\x07npm test\r\n\x1b]133;C\x07')
    await page.clock.runFor(100)
    await page.evaluate(() => { document.hasFocus = () => false; window.dispatchEvent(new Event('blur')) })
    await page.clock.fastForward(31_000)
    await feedTerminal(page, id, 'Passed\r\n\x1b]133;D;0\x07')
    await page.clock.runFor(100)
    await expect.poll(() => { try { return readFileSync(sandbox.notifyLog, 'utf8') } catch { return '' } }).toContain('✓ npm test')
    expect(readFileSync(sandbox.notifyLog, 'utf8')).toContain('31s')
  } finally { await closeApp(app) }
})

test('bash starts with integration and preserves command exit status', async () => {
  const bash = 'C:\\Program Files\\Git\\usr\\bin\\bash.exe'
  test.skip(!existsSync(bash), 'Git bash is not installed')
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, { DAWSHA_SHELL: bash, HOME: sandbox.root.replaceAll('\\', '/') })
  try {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    const pane = page.locator('.pane')
    await openTerminalPicker(pane)
    await pane.getByRole('menuitem', { name: 'Shell', exact: true }).click()
    const host = pane.locator('.term-host.active')
    const id = (await host.getAttribute('data-term-id'))!
    await expect.poll(() => bufferText(page, id), { timeout: 30_000 }).toMatch(/[$#]\s*$/m)
    await host.click()
    await page.keyboard.type('printf bash-ok; false')
    await page.keyboard.press('Enter')
    const command = host.getByRole('button', { name: /printf bash-ok; false.*Command actions/ })
    await expect(command).toBeVisible()
    await expect(command).toContainText('✗')
    await command.click()
    await page.getByRole('menuitem', { name: 'Copy output', exact: true }).click()
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('bash-ok')
  } finally { await closeApp(app) }
})
