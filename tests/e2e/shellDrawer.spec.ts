import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { bufferText, lineText, closeApp, createSandbox, launchApp } from './helpers'

test('shell drawer toggles without restarting and remembers its dragged height', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  const resizes: string[] = []
  page.on('console', (message) => { if (message.text().startsWith('[term] resize')) resizes.push(message.text()) })
  try {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    const agentId = (await page.locator('.term-host.active').getAttribute('data-term-id'))!
    await expect.poll(() => bufferText(page, agentId)).toMatch(/>\s*$/m)
    await page.keyboard.press('Control+Backquote')
    const drawer = page.locator('.shell-drawer')
    await expect(drawer).toBeVisible()
    const shell = drawer.locator('.term-host')
    const id = (await shell.getAttribute('data-term-id'))!
    await expect.poll(() => lineText(page, id)).toContain(sandbox.projectFolder)
    const initial = resizes.filter((text) => text.includes(agentId)).length
    await page.keyboard.press('Control+Backquote')
    await expect(drawer).toBeHidden()
    await page.keyboard.type('drawer-hidden-input')
    // On CI's long temp paths ConPTY can break the prompt line with a real newline, so read it as one line.
    await expect.poll(async () => (await lineText(page, agentId)).replace(/\r?\n/g, '')).toContain('drawer-hidden-input')
    await page.keyboard.press('Control+c')
    await page.waitForTimeout(250)
    expect(resizes.filter((text) => text.includes(agentId)).length - initial).toBeLessThanOrEqual(1)
    await page.keyboard.press('Control+Backquote')
    await expect(drawer).toBeVisible()
    expect(await shell.getAttribute('data-term-id')).toBe(id)
    const handle = drawer.getByRole('separator')
    const bounds = (await handle.boundingBox())!
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    await page.mouse.down()
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y - 35)
    await page.mouse.up()
    await expect.poll(() => JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8')).shellDrawerHeight).toBeGreaterThan(240)
  } finally { await closeApp(app) }
})
