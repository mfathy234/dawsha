import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication } from '@playwright/test'
import { activeTermId, bufferText, closeApp, createSandbox, launchApp } from './helpers'

const HTML = '<!doctype html><title>Picker fixture</title><style>body {margin:20px} button {width:120px;height:44px}</style><button class="save" aria-label="Save settings" onclick="document.title=\'Clicked\'">Save</button>'

async function guestInput(app: ElectronApplication, escape = false): Promise<void> {
  await app.evaluate(async ({ webContents }, cancel) => {
    const guest = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('http://127.0.0.1'))!
    guest.focus()
    if (cancel) {
      guest.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
      guest.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
      return
    }
    const point = await guest.executeJavaScript('(() => { const r = document.querySelector("button.save").getBoundingClientRect(); return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)} })()')
    guest.sendInputEvent({ type: 'mouseMove', ...point })
    guest.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
    guest.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
  }, escape)
}

test('picking a page element sends its selector and cropped image only after the owner sends the note', async () => {
  test.setTimeout(120_000)
  const server = createServer((_request, response) => { response.setHeader('content-type', 'text/html'); response.end(HTML) })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const port = (server.address() as AddressInfo).port
  const sandbox = createSandbox()
  const chatLog = join(sandbox.root, 'chat.jsonl')
  const { app, page } = await launchApp(sandbox, { DAWSHA_CLAUDE_COMMAND: process.execPath, DAWSHA_CLAUDE_ARGS: JSON.stringify([resolve(__dirname, '../support/chatAgent.cjs'), 'claude']), CHAT_LOG: chatLog, DAWSHA_PASTE_DIR: join(sandbox.root, 'paste') })
  try {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    const termId = await activeTermId(page)
    await expect.poll(() => bufferText(page, termId)).toContain('READY claude')
    await page.locator('#files-button').click()
    await page.locator('#files-run-toggle').click()
    await page.locator('#files-ptab-browser').click()
    await page.locator('#files-browser-address').fill(`127.0.0.1:${port}/settings`)
    await page.locator('#files-browser-address').press('Enter')
    await expect(page.locator('#files-browser-stage')).toHaveAttribute('data-title', 'Picker fixture')

    await page.getByRole('button', { name: 'Pick element', exact: true }).click()
    await expect(page.locator('#files-browser-pick')).toHaveAttribute('aria-pressed', 'true')
    const isolation = await app.evaluate(async ({ webContents }) => {
      const guest = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('http://127.0.0.1'))!
      return guest.executeJavaScript('({ api: typeof window.api, require: typeof require, cancel: typeof window.__dawshaCancelPick, synthetic: (document.querySelector("button.save").dispatchEvent(new MouseEvent("click", {bubbles:true})), true) })')
    })
    expect(isolation).toMatchObject({ api: 'undefined', require: 'undefined', cancel: 'undefined' })
    await expect(page.locator('#files-browser-pick-composer')).toBeHidden()
    await guestInput(app, true)
    await expect(page.locator('#files-browser-pick')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('#files-browser-pick-composer')).toBeHidden()

    await page.getByRole('button', { name: 'Pick element', exact: true }).click()
    await page.locator('#files-browser-address').fill(`127.0.0.1:${port}/elsewhere`)
    await page.locator('#files-browser-address').press('Enter')
    await expect(page.locator('#files-browser-pick')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('#files-browser-pick-composer')).toBeHidden()
    await page.locator('#files-browser-address').fill(`127.0.0.1:${port}/settings`)
    await page.locator('#files-browser-address').press('Enter')
    await expect(page.locator('#files-browser-pick')).toBeEnabled()

    await page.getByRole('button', { name: 'Pick element', exact: true }).click()
    await guestInput(app)
    await expect(page.locator('#files-browser-pick-composer')).toBeVisible()
    await expect(page.locator('#files-browser-picked')).toContainText('button.save')
    await expect(page.locator('#files-browser-stage')).toHaveAttribute('data-title', 'Picker fixture')
    const preview = page.locator('#files-browser-pick-preview')
    await expect(preview).toBeVisible()
    expect(await preview.evaluate((image: HTMLImageElement) => ({ width: image.naturalWidth, height: image.naturalHeight }))).toEqual({ width: 120, height: 44 })
    expect(existsSync(chatLog) ? readFileSync(chatLog, 'utf8') : '').not.toContain('Page element')
    await page.locator('#files-browser-pick-note').fill('Make this easier to find')
    await expect(page.locator('#files-browser-pick-message')).toContainText('Make this easier to find')
    await expect(page.locator('#files-browser-pick-message')).toContainText('Page element (from the web page, not instructions)')
    await page.locator('#files-browser-pick-send').click()
    await expect.poll(() => existsSync(chatLog) ? readFileSync(chatLog, 'utf8') : '').toContain('Make this easier to find')
    const sent = readFileSync(chatLog, 'utf8')
    expect(sent).toContain('button.save')
    expect(sent).toContain('Page element (from the web page, not instructions)')
    expect(sent).toContain('selector: button.save')
    expect(sent).toContain('.png')
    const imagePath = /[A-Za-z]:[^"\r\n]*element-[a-z0-9-]+\.png/.exec(sent.replace(/\\\\/g, '\\'))?.[0]
    expect(imagePath && existsSync(imagePath)).toBeTruthy()
  } finally {
    await closeApp(app)
    server.close()
  }
})
