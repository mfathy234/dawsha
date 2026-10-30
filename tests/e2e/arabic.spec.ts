import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { APP_VERSION, bufferText, closeApp, createSandbox, feedTerminal, launchApp, openTerminalPicker, selectAllText } from './helpers'

const ARABIC = 'مرحبا بالعالم'
const SCREENS = resolve(__dirname, '../../test-results/screens')

test('Arabic rows are drawn as shaped right-to-left text while the buffer stays logical', async () => {
  const { app, page } = await launchApp(createSandbox())
  try {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    await openTerminalPicker(page.locator('.pane').first())
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
    // The overlay repaints on the next animation frame after the selection changes.
    await expect
      .poll(() => host.locator('.term-arabic-row span').first().evaluate((s) => (s as HTMLElement).style.background))
      .not.toBe('')

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

// Claude Code runs the BiDi algorithm itself and writes Arabic already in visual order. These rows are exactly what it
// wrote for the reply 'مَرْحَبًا بالعالم 42 develop يا صديقي' and the typed prompt 'مساء الخير abc'.
const CLAUDE_REPLY = 'يقيدص اي develop 42 ملاعلاب ابًحَرْمَ'
const CLAUDE_PROMPT = ' abc ريخلا ءاسم'

test('Claude rows, already in visual order, keep their layout and get their Arabic joined', async () => {
  const { app, page } = await launchApp(createSandbox())
  try {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    const host = page.locator('.term-host.active')
    const id = (await host.getAttribute('data-term-id'))!
    await expect.poll(() => bufferText(page, id), { timeout: 30_000 }).toMatch(/>\s*$/m)

    await feedTerminal(page, id, `\x1b[2J\x1b[H\x1b[37m● \x1b[0m${CLAUDE_REPLY}\r\n\r\n\x1b[1m❯\x1b[0m${CLAUDE_PROMPT}\r\n`)
    const rows = host.locator('.term-arabic-row')
    await expect(rows).toHaveCount(2)
    for (const row of await rows.all()) await expect(row).toHaveAttribute('dir', 'ltr')
    const stretches = (index: number): Promise<string[]> =>
      rows.nth(index).locator('.term-arabic-rtl').evaluateAll((spans) => spans.map((s) => `${(s as HTMLElement).dir}:${s.textContent}`))
    expect(await stretches(0)).toEqual(['rtl:يا صديقي', 'rtl:مَرْحَبًا بالعالم'])
    await expect(rows.nth(0)).toContainText('develop 42')
    expect(await stretches(1)).toEqual(['rtl:مساء الخير'])

    // Text read from the pane (copy, transcripts) is back in reading order; the screen buffer itself is untouched.
    const text = await bufferText(page, id)
    expect(text).toContain('● مَرْحَبًا بالعالم')
    expect(text).toContain('يا صديقي')
    expect(text).toContain('❯ مساء الخير abc')
    expect(text).not.toContain(CLAUDE_REPLY)

    // Finding an Arabic word typed in reading order matches Claude's visual-order row.
    await host.click()
    await page.keyboard.press('Control+Shift+F')
    const bar = page.getByRole('search')
    await bar.getByLabel('Find in terminal').fill('بالعالم')
    await expect(bar.locator('.term-find-count')).toHaveText('1 of 1')
    await page.keyboard.press('Escape')

    mkdirSync(SCREENS, { recursive: true })
    await host.screenshot({ path: resolve(SCREENS, 'arabic-claude-terminal.png') })
  } finally {
    await closeApp(app)
  }
})

test('Arabic typed into a text box reads right-to-left with the bundled Arabic font', async () => {
  const { app, page } = await launchApp(createSandbox())
  try {
    await page.getByRole('button', { name: 'Filter projects and sessions' }).click()
    const filter = page.getByRole('textbox', { name: 'Filter projects' })
    await filter.fill('مشروع الفواتير')
    const style = await filter.evaluate((el) => {
      const computed = getComputedStyle(el)
      return { bidi: computed.unicodeBidi, font: computed.fontFamily }
    })
    expect(style.bidi).toBe('plaintext')
    expect(style.font).toContain('Dawsha Arabic')
    expect(await page.evaluate(() => document.fonts.check("13px 'Dawsha Arabic'", 'مشروع'))).toBe(true)
    mkdirSync(SCREENS, { recursive: true })
    await page.locator('.sidebar').screenshot({ path: resolve(SCREENS, 'arabic-input.png') })
  } finally {
    await closeApp(app)
  }
})

test('an Arabic session title reads right to left without jumbling the number or the project beside it', async () => {
  const sandbox = createSandbox()
  const title = 'مراجعة الفواتير'
  const folder = join(sandbox.root, 'arabic-project')
  mkdirSync(folder, { recursive: true })
  writeFileSync(
    join(sandbox.userData, 'settings.json'),
    JSON.stringify({ version: 2, lastSeenVersion: APP_VERSION, projects: [{ id: 'ar', name: title, folder }] }),
    'utf8'
  )
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: new RegExp(`^New (Claude|Codex|Gemini) session in ${title}$`) }).click()
    await page.getByRole('button', { name: new RegExp(`^New (Claude|Codex|Gemini) session in ${title}$`) }).click()
    await expect(page.locator('.pane')).toHaveCount(2)
    const bidi = (selector: string): Promise<string> =>
      page.locator(selector).first().evaluate((el) => `${getComputedStyle(el).unicodeBidi}`)

    // Pane header: the number prefix is plain text, only the name gets its own direction.
    const headerName = page.locator('.pane-title bdi').first()
    await expect(headerName).toHaveAttribute('dir', 'auto')
    await expect(page.locator('.pane-title').first()).toHaveText(`1 · ${title}`)
    expect(await bidi('.pane-title bdi')).toBe('isolate')
    expect(await page.locator('.pane-title').first().evaluate((el) => getComputedStyle(el).direction)).toBe('ltr')

    await expect(page.locator('.sess-name').first()).toHaveAttribute('dir', 'auto')
    expect(await bidi('.sess-name')).toBe('isolate')

    await page.keyboard.press('Control+Enter')
    await expect(page.locator('.pane.maximized')).toHaveCount(1)
    await expect(page.locator('.strip-name').first()).toHaveAttribute('dir', 'auto')
    expect(await bidi('.strip-name')).toBe('isolate')
    await expect(page.locator('.others-title bdi').first()).toHaveAttribute('dir', 'auto')

    await page.keyboard.press('Control+Enter')
    await page.getByRole('button', { name: 'Board' }).click()
    const cardTitle = page.locator('.board-card-title').first()
    await expect(cardTitle).toHaveAttribute('dir', 'auto')
    await expect(cardTitle).toHaveText(title)
    expect(await bidi('.board-card-title')).toBe('plaintext')
    await page.screenshot({ path: join(SCREENS, 'arabic-session-titles.png') })
  } finally {
    await closeApp(app)
  }
})
