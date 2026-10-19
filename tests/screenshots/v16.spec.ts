import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { activeTermId, bufferText, closeApp, createSandbox, feedTerminal, launchApp, APP_VERSION } from '../e2e/helpers'
import { DEMO_ROOT, demoEnv, resize, seed, settle } from './harness'
import { shrinkTo } from './v1Fixtures'

const SITE_ASSETS = resolve(__dirname, '../../site/assets')
const OUT = process.env.DAWSHA_SHOTS_OUT ?? SITE_ASSETS

// Claude Code writes Arabic already in visual order: words reversed, Latin words and numbers kept, line order flipped.
const ARABIC_RUN = /[؀-ۿ]/
const visual = (logical: string): string =>
  logical
    .split(' ')
    .reverse()
    .map((word) => (ARABIC_RUN.test(word) ? [...word].reverse().join('') : word))
    .join(' ')

const REPLY = [
  'عدّلت الملف src/context/theme.tsx وأضفت زر الوضع الداكن.',
  'حفظت الاختيار في localStorage وصارت الصفحة تتذكره.',
  'نجح 41 اختبارًا من 41 ولم يتغير أي سلوك آخر.'
]
const PROMPT = 'أضف زرًا للوضع الداكن في صفحة الإعدادات'

const LONG_NAMES = [
  'Invoice export refactor with separate query and format steps',
  'Customer portal login flow and password reset emails',
  'Warehouse stock movements report for the finance team',
  'Payroll monthly close and tax declarations for all branches',
  'Mobile app push notifications and deep links to orders',
  'Supplier onboarding wizard with document uploads and checks'
]

test.afterAll(() => rmSync(DEMO_ROOT, { recursive: true, force: true }))

test('generates the 1.6 screenshots from fake projects only', async () => {
  mkdirSync(OUT, { recursive: true })
  const sandbox = createSandbox()
  seed(sandbox, true)
  const settingsPath = join(sandbox.userData, 'settings.json')
  const stored = JSON.parse(readFileSync(settingsPath, 'utf8'))
  writeFileSync(settingsPath, JSON.stringify({ ...stored, onboardingDismissed: true, dictation: { introShown: true, language: 'ar' } }), 'utf8')
  const { app, page } = await launchApp(sandbox, demoEnv(), ['--use-fake-device-for-media-stream'])
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await resize(app)

    // Arabic reply in a Claude pane.
    await page.getByRole('button', { name: 'New Claude session in acme-web', exact: true }).click()
    const id = await activeTermId(page)
    await expect.poll(() => bufferText(page, id), { timeout: 30_000 }).toContain('Add a dark mode toggle')
    const reply = () => [
      `\x1b[2J\x1b[H\x1b[1m>\x1b[0m ${visual(PROMPT)}`,
      '',
      ...REPLY.map((line) => `\x1b[32m●\x1b[0m ${visual(line)}`),
      '',
      '\x1b[2m  ⎿  Update src/context/theme.tsx  (+18 -3)\x1b[0m',
      '\x1b[2m  ⎿  Create src/components/ThemeToggle.tsx  (+42)\x1b[0m',
      ''
    ].join('\r\n') + '\r\n'
    await feedTerminal(page, id, reply())
    await expect(page.locator('.term-host.active .term-arabic-row').first()).toBeVisible()
    await settle(page, 1200)
    writeFileSync(join(OUT, 'arabic-reply.png'), await shrinkTo(await page.screenshot(), 1600, 1000))

    // Dictation listening with the level meter.
    await page.locator('.pane-mic').click()
    const meter = page.locator('.pane-dictation .dictation-meter')
    await expect(meter).toBeVisible()
    await expect.poll(async () => Number(await meter.getAttribute('aria-valuenow')), { timeout: 10_000 }).toBeGreaterThan(0)
    await feedTerminal(page, id, reply())
    await expect(page.locator('.term-host.active .term-arabic-row').first()).toBeVisible()
    await settle(page, 600)
    writeFileSync(join(OUT, 'dictation.png'), await shrinkTo(await page.screenshot(), 1600, 1000))
    await page.keyboard.press('Escape')
    await expect(page.locator('.pane-mic')).not.toHaveClass(/recording/)

    // Keyboard shortcuts sheet.
    await page.locator('.term-host.active').click()
    await page.keyboard.press('Control+/')
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
    await settle(page, 800)
    writeFileSync(join(OUT, 'shortcuts.png'), await shrinkTo(await page.screenshot(), 1600, 1000))
    await page.keyboard.press('Escape')
  } finally {
    await closeApp(app)
  }
})

test('generates the full mode screenshot with long session names', async () => {
  const sandbox = createSandbox()
  const projects = LONG_NAMES.map((name, index) => {
    const dir = join(DEMO_ROOT, `long-${index}`)
    mkdirSync(dir, { recursive: true })
    return { id: `p${index}`, name, folder: dir, defaultAgent: index % 3 === 1 ? 'codex' : index % 3 === 2 ? 'gemini' : 'claude' }
  })
  writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify({ version: 2, lastSeenVersion: APP_VERSION, onboardingDismissed: true, projects }), 'utf8')
  const { app, page } = await launchApp(sandbox, demoEnv())
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await resize(app)
    for (const name of LONG_NAMES) {
      await page.getByRole('button', { name: new RegExp(`^New (Claude|Codex|Gemini) session in ${name}$`) }).click()
    }
    await expect(page.locator('.pane')).toHaveCount(LONG_NAMES.length)
    await page.keyboard.press('Control+Enter')
    await expect(page.locator('.pane.maximized')).toHaveCount(1)
    await expect(page.locator('.pane-strip .strip-tab')).toHaveCount(LONG_NAMES.length)
    await settle(page, 2500)
    writeFileSync(join(OUT, 'full-mode.png'), await shrinkTo(await page.screenshot(), 1600, 1000))
  } finally {
    await closeApp(app)
  }
})

test('generates the native Arabic screenshot: Arabic session titles and a right-to-left text box', async () => {
  const sandbox = createSandbox()
  const names = ['بوابة العملاء', 'تقارير المخزون', 'billing-api']
  const projects = names.map((name, index) => {
    const dir = join(DEMO_ROOT, `native-${index}`)
    mkdirSync(dir, { recursive: true })
    return { id: `n${index}`, name, folder: dir, defaultAgent: 'claude' }
  })
  writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify({ version: 2, lastSeenVersion: APP_VERSION, onboardingDismissed: true, projects }), 'utf8')
  const { app, page } = await launchApp(sandbox, demoEnv())
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await resize(app)
    for (const name of names) await page.getByRole('button', { name: `New Claude session in ${name}`, exact: true }).click()
    await expect(page.locator('.pane')).toHaveCount(names.length)
    await page.locator('#project-filter').first().fill('ال')
    await settle(page, 2000)
    writeFileSync(join(OUT, 'arabic-native.png'), await shrinkTo(await page.screenshot(), 1600, 1000))
  } finally {
    await closeApp(app)
  }
})
