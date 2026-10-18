import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { bufferText, closeApp, createSandbox, feedTerminal, launchApp, selectAllText } from './helpers'

const ARABIC = 'مرحبا بالعالم'
const SCREENS = resolve(__dirname, '../../test-results/screens')

test('Arabic rows are drawn as shaped right-to-left text while the buffer stays logical', async () => {
  const { app, page } = await launchApp(createSandbox())
  try {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    await page.getByRole('button', { name: 'New terminal in SMOKE' }).click()
    await page.getByRole('menuitem', { name: 'Shell' }).click()
    await expect(page.locator('.tabs [role="tab"]')).toHaveCount(2)
    await expect(page.locator('.tabs [role="tab"]').nth(1)).toHaveAttribute('aria-selected', 'true')
    const host = page.locator('.term-host.active')
    const id = (await host.getAttribute('data-term-id'))!
    await expect.poll(() => bufferText(page, id), { timeout: 30_000 }).toMatch(/>\s*$/m)

    // An English row first: it must get no overlay. Then an Arabic row with a Latin word, a number and ANSI colors.
    await feedTerminal(page, id, '\r\nplain english row\r\n')
    await feedTerminal(page, id, `\x1b[32m${ARABIC}\x1b[0m \x1b[1;31mClaude\x1b[0m 42 \x1b[44mنهاية\x1b[0m\r\n`)

    const rows = host.locator('.term-arabic-row')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toHaveAttribute('dir', 'rtl')
    await expect(rows.first()).toContainText(ARABIC)
    await expect(rows.first()).toContainText('Claude 42')
    const colored = await rows.first().locator('span').evaluateAll((spans) => spans.map((s) => (s as HTMLElement).style.color))
    expect(colored.some((c) => c !== '')).toBe(true)

    // The buffer, selection and the English row are untouched.
    const text = await bufferText(page, id)
    expect(text).toContain(`${ARABIC} Claude 42 نهاية`)
    expect(text).toContain('plain english row')
    await selectAllText(page, id)
    expect(await host.locator('.term-arabic-row span').count()).toBeGreaterThan(0)
    const selectedBg = await host.locator('.term-arabic-row span').first().evaluate((s) => (s as HTMLElement).style.background)
    expect(selectedBg).not.toBe('')

    // Scrolling the row out of view removes its overlay row.
    await feedTerminal(page, id, '\r\n'.repeat(80))
    await expect(rows).toHaveCount(0)

    mkdirSync(SCREENS, { recursive: true })
    await feedTerminal(page, id, `\x1b[2J\x1b[H${ARABIC} Claude 42\r\nمَرْحَبًا ١٢٣ abc\r\n> نص`)
    await expect(rows).toHaveCount(3)
    await host.screenshot({ path: resolve(SCREENS, 'arabic-terminal.png') })
  } finally {
    await closeApp(app)
  }
})
