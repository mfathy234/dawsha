import { expect, test, type Page } from '@playwright/test'
import { bufferText, closeApp, closeSettings, createSandbox, feedTerminal, launchApp, openSettings } from './helpers'

const SIXEL = '\x1bPq"1;1;16;6#0;2;100;0;0#0!16~\x1b\\\r\n'

async function redImagePixels(page: Page): Promise<number> {
  return page.locator('.term-host .xterm-image-layer').evaluateAll((canvases) => {
    let count = 0
    for (const element of canvases) {
      const canvas = element as HTMLCanvasElement
      const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
      for (let index = 0; index < data.length; index += 4) {
        if (data[index] > 200 && data[index + 1] < 20 && data[index + 2] < 20 && data[index + 3] > 200) count += 1
      }
    }
    return count
  })
}

test('terminal images decode, toggle live and survive renderer sleep at 1024px', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    const window = await app.browserWindow(page)
    await window.evaluate((browserWindow) => browserWindow.setSize(1024, 768))
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    const host = page.locator('.term-host.active')
    const id = (await host.getAttribute('data-term-id'))!
    await expect.poll(() => bufferText(page, id), { timeout: 30_000 }).toMatch(/>\s*$/m)
    await feedTerminal(page, id, '\x1b[2J\x1b[H😀✔日本!\x1b[1;8HX\r\n' + SIXEL)
    await expect.poll(() => bufferText(page, id)).toContain('😀✔日本X')
    await expect.poll(() => redImagePixels(page)).toBeGreaterThan(0)

    await openSettings(page)
    const toggle = page.getByRole('switch', { name: 'Show images in the terminal', exact: true })
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    const label = page.locator('.set-name', { hasText: 'Show images in the terminal' })
    expect(await label.evaluate((element) => {
      const range = document.createRange()
      range.selectNodeContents(element)
      return range.getClientRects().length
    })).toBe(1)
    await toggle.click()
    await expect(page.locator('.xterm-image-layer')).toHaveCount(0)
    await closeSettings(page)
    await feedTerminal(page, id, SIXEL + 'images-disabled')
    await expect.poll(() => bufferText(page, id)).toContain('images-disabled')
    expect(await redImagePixels(page)).toBe(0)

    await openSettings(page)
    await toggle.click()
    await closeSettings(page)
    await feedTerminal(page, id, '\x1b[2J\x1b[H' + SIXEL)
    await expect.poll(() => redImagePixels(page)).toBeGreaterThan(0)
    const renderer = page.locator(`.term-host[data-term-id="${id}"] .xterm-screen canvas:not(.xterm-image-layer)`)
    await expect(renderer).not.toHaveCount(0)
    await page.clock.install()
    // Simulate backgrounding without resizing the PTY, which would redraw over injected output.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await page.clock.fastForward(11 * 60_000)
    await expect(renderer).toHaveCount(0)
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await page.clock.runFor(100)
    await expect.poll(() => redImagePixels(page)).toBeGreaterThan(0)
    await expect(renderer).not.toHaveCount(0)
    expect(errors).toEqual([])
  } finally {
    await test.info().attach('renderer-errors', { body: JSON.stringify(errors), contentType: 'application/json' })
    await closeApp(app)
  }
})
