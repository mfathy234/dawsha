import { expect, test, type Page } from '@playwright/test'
import { bufferText, closeApp, closeSettings, createSandbox, feedTerminal, launchApp, openSettings } from './helpers'

const SESSION = [
  '> run the unit tests',
  '',
  '● Bash(npm test)',
  '  ⎿  Test Files  1 failed | 4 passed',
  '     ✗ tests/unit/a.test.ts > keeps focus',
  '     Duration 8.2s',
  '',
  '● Update(src/a.ts)',
  '  ⎿  Updated src/a.ts with 1 addition and 1 removal',
  '      4 -  old',
  '      4 +  new',
  '',
  '● All done.',
  ''
].join('\r\n')

async function openReading(page: Page, id: string): Promise<void> {
  const reading = page.locator('.term-host.active .term-reading')
  await expect
    .poll(
      async () => {
        if (await reading.isHidden()) {
          await feedTerminal(page, id, `\r\n${SESSION}`)
          await page.locator('.term-host.active').click()
          await page.keyboard.press('Control+Shift+R')
        }
        return reading.locator('.rd-row').count()
      },
      { timeout: 30_000 }
    )
    .toBeGreaterThanOrEqual(2)
}

test('the reading view folds output into one row per command and leaves the terminal alone', async () => {
  const { app, page } = await launchApp(createSandbox())
  try {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    const id = (await page.locator('.term-host.active').getAttribute('data-term-id'))!
    await expect.poll(() => bufferText(page, id), { timeout: 30_000 }).toMatch(/>\s*$/m)
    await openReading(page, id)
    const reading = page.locator('.term-host.active .term-reading')

    const test = reading.locator('.rd-row', { hasText: 'npm test' }).first()
    const update = reading.locator('.rd-row', { hasText: 'Update src/a.ts' }).first()
    await expect(test).toHaveAttribute('aria-expanded', 'false')
    await expect(update).toHaveAttribute('aria-expanded', 'true')
    await expect(reading.locator('.rd-error-line').first()).toContainText('keeps focus')
    await expect(reading.getByRole('button', { name: /^Send to / }).first()).toBeVisible()

    await test.click()
    await expect(test).toHaveAttribute('aria-expanded', 'true')
    await expect(reading.locator('.rd-body').first()).toContainText('Duration 8.2s')
    await reading.getByRole('button', { name: 'Fold all', exact: true }).click()
    await expect(update).toHaveAttribute('aria-expanded', 'false')
    await reading.getByRole('button', { name: 'Unfold all', exact: true }).click()
    await expect(test).toHaveAttribute('aria-expanded', 'true')

    await page.keyboard.press('Escape')
    await expect(reading).toBeHidden()
    await expect(page.locator('.term-host.active .xterm-helper-textarea')).toBeFocused()
    expect(await bufferText(page, id)).toContain('● Bash(npm test)')
  } finally {
    await closeApp(app)
  }
})

test('typing or Back to live leaves the reading view', async () => {
  const { app, page } = await launchApp(createSandbox())
  try {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    const id = (await page.locator('.term-host.active').getAttribute('data-term-id'))!
    await expect.poll(() => bufferText(page, id), { timeout: 30_000 }).toMatch(/>\s*$/m)
    await openReading(page, id)
    const reading = page.locator('.term-host.active .term-reading')
    await reading.getByRole('button', { name: 'Back to live ↓' }).click()
    await expect(reading).toBeHidden()
    await openReading(page, id)
    await page.keyboard.press('x')
    await expect(reading).toBeHidden()
    await expect.poll(() => page.evaluate((term) => (window as unknown as { __grid: { lastInput(id: string): string } }).__grid.lastInput(term), id)).toBe('x')
  } finally {
    await closeApp(app)
  }
})

test('the block outline lists prompts, commands and errors, filters and jumps', async () => {
  const { app, page } = await launchApp(createSandbox())
  try {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    const id = (await page.locator('.term-host.active').getAttribute('data-term-id'))!
    await expect.poll(() => bufferText(page, id), { timeout: 30_000 }).toMatch(/>\s*$/m)
    const outline = page.locator('.term-host.active .term-outline')
    await expect
      .poll(
        async () => {
          if (await outline.isHidden()) {
            await feedTerminal(page, id, `\r\n${SESSION}`)
            await page.locator('.term-host.active').click()
            await page.keyboard.press('Control+Shift+O')
          }
          return outline.locator('.ol-row').count()
        },
        { timeout: 30_000 }
      )
      .toBeGreaterThanOrEqual(4)
    await expect(outline.locator('.ol-row.error').first()).toContainText('keeps focus')
    await outline.getByLabel('Find a block').fill('npm')
    await expect(outline.locator('.ol-row')).toHaveCount(1)
    await page.keyboard.press('Enter')
    await expect(outline).toBeHidden()
    await expect(page.locator('.term-host.active .xterm-helper-textarea')).toBeFocused()
  } finally {
    await closeApp(app)
  }
})

test('scrollbar ticks mark prompts, commands and errors', async () => {
  const { app, page } = await launchApp(createSandbox())
  try {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    const id = (await page.locator('.term-host.active').getAttribute('data-term-id'))!
    await expect.poll(() => bufferText(page, id), { timeout: 30_000 }).toMatch(/>\s*$/m)
    const marks = page.locator('.term-host.active .term-marks')
    await expect
      .poll(
        async () => {
          await feedTerminal(page, id, `\r\n${SESSION}`)
          return marks.locator('.term-mark.error').count()
        },
        { timeout: 30_000 }
      )
      .toBeGreaterThan(0)
    await expect(marks.locator('.term-mark.prompt').first()).toBeAttached()
    await expect(marks.locator('.term-mark.command').first()).toBeAttached()
  } finally {
    await closeApp(app)
  }
})

test('the reading view setting sits in General without wrapping at 1024', async () => {
  const { app, page } = await launchApp(createSandbox())
  try {
    const frame = await app.browserWindow(page)
    await frame.evaluate((browserWindow) => browserWindow.setSize(1024, 768))
    await openSettings(page)
    const toggle = page.getByRole('switch', { name: 'Open it when I scroll far back', exact: true })
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await expect.poll(async () => page.evaluate(async () => (await window.gridApi.getSettings()).settings?.readingOnScroll)).toBe(true)
    const label = page.locator('.set-name', { hasText: /^Reading view$/ })
    expect(await label.evaluate((element) => {
      const range = document.createRange()
      range.selectNodeContents(element)
      return range.getClientRects().length
    })).toBe(1)
    await closeSettings(page)
  } finally {
    await closeApp(app)
  }
})
