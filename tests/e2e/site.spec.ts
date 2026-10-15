import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test } from '@playwright/test'

const url = pathToFileURL(resolve(__dirname, '../../site/index.html')).href
const arabicUrl = pathToFileURL(resolve(__dirname, '../../site/ar/index.html')).href

test('the Arabic page is readable without JavaScript and has Arabic share metadata', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto(arabicUrl)
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page).toHaveTitle(/دوشة/)
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /دوشة/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('وكلاء')
  await expect(page.getByText('استيراد إعدادات سابقة')).toBeVisible()
  await expect(page.getByText('الوكلاء المثبتون.')).toBeVisible()
  await expect(page.locator('#windows-download p')).toContainText('ويندوز')
  await expect(page.locator('.code .c').first()).toContainText('أضف هذا المجلد')
  await expect(page.locator('.hero-shot img')).toHaveJSProperty('complete', true)
  await expect(page.getByRole('link', { name: 'English' })).toHaveAttribute('href', '../index.html')
  expect(await page.locator('a[href^="https://github.com/"]').evaluateAll(links => links.every(link => (link as HTMLAnchorElement).target === '_blank'))).toBe(true)
  await context.close()
})

test('the site switches between Arabic RTL and English LTR with translated navigation, CTA and images', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(url)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Every AI coding agent')
  expect(await page.locator('a[href^="https://github.com/"]').evaluateAll(links => links.every(link => (link as HTMLAnchorElement).target === '_blank'))).toBe(true)
  await page.screenshot({ path: 'test-results/site-en.png' })
  await page.getByRole('link', { name: 'العربية' }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('وكلاء')
  await expect(page.locator('nav a[href="#features"]')).toContainText('المميزات')
  await expect(page.locator('.hero [data-main-download]')).toContainText(/حمّل لويندوز|macOS|لينكس/)
  await expect(page.locator('.hero-shot img')).toHaveAttribute('alt', /دوشة/)
  await expect(page.locator('#cli-h')).toHaveText(/أمر\s*dawsha\s*$/)
  await page.screenshot({ path: 'test-results/site-ar.png' })
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
  await page.getByRole('link', { name: 'English' }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Every AI coding agent')
  for (const image of await page.locator('.shot img').all()) {
    await image.scrollIntoViewIfNeeded()
    await expect(image).toHaveJSProperty('complete', true)
    expect(await image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0)
  }
})

test('English content and screenshots remain available without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto(url)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Every AI coding agent')
  await expect(page.locator('.hero-shot img')).toHaveJSProperty('complete', true)
  await context.close()
})

test('resolves the Apple Silicon download when the latest release has a Mac DMG', async ({ page }) => {
  await page.route('https://api.github.com/repos/mfathy234/dawsha/releases/latest', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      tag_name: 'v0.3.0',
      assets: [{
        name: 'Dawsha-0.3.0-mac-arm64.dmg',
        browser_download_url: 'https://github.com/mfathy234/dawsha/releases/download/v0.3.0/Dawsha-0.3.0-mac-arm64.dmg'
      }]
    })
  }))
  await page.goto(url)
  const card = page.locator('[data-platform-card="mac"]')
  await expect(card).toBeVisible()
  await expect(card.locator('[data-dl="mac"]')).toHaveAttribute(
    'href',
    'https://github.com/mfathy234/dawsha/releases/download/v0.3.0/Dawsha-0.3.0-mac-arm64.dmg'
  )
})

test('keeps platform choices linked to releases when assets are missing', async ({ page }) => {
  await page.route('https://api.github.com/repos/mfathy234/dawsha/releases/latest', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ tag_name: 'v0.2.1', assets: [] })
  }))
  await page.goto(url)
  await expect(page.locator('[data-platform-card="mac"]')).toBeVisible()
  await expect(page.locator('[data-platform-card="mac"] [data-dl="mac"]')).toHaveAttribute('href', 'https://github.com/mfathy234/dawsha/releases/latest')
})

test('the main download button offers the installer, the version and links to the other platforms', async ({ page }) => {
  const base = 'https://github.com/mfathy234/dawsha/releases/download/v0.3.0/'
  const packages = {
    setup: 'Dawsha-Setup-0.3.0.exe', portable: 'Dawsha-Portable-0.3.0.exe',
    mac: 'Dawsha-0.3.0-mac-arm64.dmg',
    'linux-appimage': 'Dawsha-0.3.0-linux-x86_64.AppImage', 'linux-deb': 'Dawsha-0.3.0-linux-amd64.deb'
  }
  await page.route('https://api.github.com/repos/mfathy234/dawsha/releases/latest', route => route.fulfill({
    json: { tag_name: 'v0.3.0', assets: Object.values(packages).map(name => ({ name, browser_download_url: base + name })) }
  }))
  await page.goto(url)
  const main = page.locator('.hero [data-main-download]')
  await expect(main).toContainText('Download for Windows')
  await expect(main).toHaveAttribute('href', base + packages.setup)
  await expect(main.locator('[data-version-tag]')).toHaveText('v0.3.0')
  const alt = page.locator('.hero .download-alt')
  await expect(alt.locator('.download-alt-link:visible')).toHaveCount(4)
  for (const key of ['mac', 'linux-appimage', 'linux-deb', 'portable'] as const) {
    await expect(alt.locator(`[data-dl="${key}"]`)).toHaveAttribute('href', base + packages[key])
  }
  for (const [key, name] of Object.entries(packages)) {
    await expect(page.locator(`#download [data-dl="${key}"]`)).toHaveAttribute('href', base + name)
  }
  const link = alt.locator('[data-dl="linux-appimage"]')
  await link.focus()
  await expect(link).toBeFocused()
})

test('a Mac visitor is offered the Mac download first, with Windows among the other platforms', async ({ browser }) => {
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' })
  const page = await context.newPage()
  const dmg = 'https://github.com/mfathy234/dawsha/releases/download/v0.3.0/Dawsha-0.3.0-mac-arm64.dmg'
  await page.route('https://api.github.com/repos/mfathy234/dawsha/releases/latest', route => route.fulfill({
    json: { tag_name: 'v0.3.0', assets: [{ name: 'Dawsha-0.3.0-mac-arm64.dmg', browser_download_url: dmg }] }
  }))
  for (const address of [url, arabicUrl]) {
    await page.goto(address)
    const main = page.locator('.hero [data-main-download]')
    await expect(main).toHaveAttribute('data-dl', 'mac')
    await expect(main).toHaveAttribute('href', dmg)
    await expect(main.locator('.apple-icon')).toHaveCount(1)
    await expect(page.locator('.hero .download-alt [data-dl="mac"]')).toBeHidden()
    await expect(page.locator('.hero .download-alt [data-dl="setup"]')).toBeVisible()
  }
  await expect(page.locator('.hero [data-main-download]')).toContainText('macOS')
  await context.close()
})

test('API failure retains working release links for every platform', async ({ page }) => {
  await page.route('https://api.github.com/repos/mfathy234/dawsha/releases/latest', route => route.fulfill({ status: 403, body: '{}' }))
  await page.goto(url)
  for (const link of await page.locator('[data-dl]').all()) {
    await expect(link).toHaveAttribute('href', 'https://github.com/mfathy234/dawsha/releases/latest')
  }
})

test('download links stay usable on mobile without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  for (const address of [url, arabicUrl]) {
    await page.goto(address)
    await expect(page.locator('.hero [data-main-download]')).toHaveAttribute('data-dl', 'setup')
    await expect(page.locator('.hero .download-alt [data-dl="linux-appimage"]')).toBeVisible()
    await expect(page.locator('.hero .download-alt [data-dl="mac"]')).toBeVisible()
    await expect(page.locator('#download .platform-download')).toHaveCount(5)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  }
  await context.close()
})

test('Arabic fits a mobile viewport and keeps the language switch keyboard accessible', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(url)
  const switcher = page.getByRole('link', { name: 'العربية' })
  await switcher.focus()
  await expect(switcher).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await expect(page.locator('.hero-shot img')).toHaveJSProperty('complete', true)
  await page.screenshot({ path: 'test-results/site-ar-mobile.png' })
})

test('Arabic has a shareable static URL and explains the release features in both languages', async ({ page }) => {
  await page.goto(arabicUrl)
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page).toHaveTitle(/دوشة/)
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /دوشة/)
  await expect(page.locator('meta[name="twitter:description"]')).toHaveAttribute('content', /دوشة/)
  await expect(page.getByText('العد التنازلي لتجديد الحدود')).toBeVisible()
  await expect(page.getByText('استيراد إعدادات سابقة')).toBeVisible()
  await expect(page.locator('.fgroup').nth(1).locator('li').filter({ hasText: '\u0627\u0644\u062a\u062d\u0643\u0645 \u0639\u0646 \u0628\u064f\u0639\u062f' })).toBeVisible()
  await expect(page.getByText('\u0644\u0648\u062d\u0629 \u0645\u0634\u0627\u0631\u064a\u0639 \u0642\u0627\u0628\u0644\u0629 \u0644\u062a\u063a\u064a\u064a\u0631 \u0627\u0644\u062d\u062c\u0645')).toBeVisible()
  await expect(page.locator('link[rel="alternate"][hreflang="ar"]')).toHaveAttribute('href', /\/ar\/$/)

  await page.getByRole('link', { name: 'English' }).click()
  await expect(page).toHaveURL(url)
  await expect(page.getByText('Reset countdowns', { exact: true })).toBeVisible()
  await expect(page.getByText('Import existing settings', { exact: true })).toBeVisible()
  await expect(page.locator('.fgroup').nth(1).locator('li').filter({ hasText: 'Remote Control' })).toBeVisible()
  await expect(page.getByText('Resizable Projects panel')).toBeVisible()
})

const countPlays = (): void => {
  const w = window as unknown as { __plays: number }
  w.__plays = 0
  const original = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    w.__plays += 1
    return original.call(this)
  }
}

test('the demo clip stays out of the first load and plays only once it is on screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(countPlays)
  await page.goto(url)
  await page.waitForLoadState('load')
  const video = page.locator('.demo-video')
  await expect(video).toHaveAttribute('preload', 'none')
  await expect(video).toHaveAttribute('poster', 'assets/demo-poster.jpg')
  expect(await video.evaluate((el: HTMLVideoElement) => el.autoplay)).toBe(false)
  await page.waitForTimeout(600)
  expect(await page.evaluate(() => (window as unknown as { __plays: number }).__plays)).toBe(0)

  await video.scrollIntoViewIfNeeded()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __plays: number }).__plays)).toBeGreaterThan(0)
  const toggle = page.locator('.demo-toggle')
  await expect(toggle).toBeVisible()
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-label', 'Play the demo')
  expect(await video.evaluate((el: HTMLVideoElement) => el.paused)).toBe(true)
})

test('with reduced motion the demo shows its poster and never starts', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(countPlays)
  await page.goto(url)
  await page.locator('.demo-video').scrollIntoViewIfNeeded()
  await page.waitForTimeout(800)
  expect(await page.evaluate(() => (window as unknown as { __plays: number }).__plays)).toBe(0)
  await expect(page.locator('.demo-toggle')).toBeHidden()
})

const newSections = ['board', 'timeline', 'search', 'replay']

test('New in 1.0 shows four feature rows with sized lazy images and a phone approvals point', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(url)
  await expect(page.locator('.new-pill')).toContainText('New in 1.0')
  await expect(page.locator('.new-pill')).toHaveAttribute('href', '#new')
  await expect(page.locator('#new-h')).toHaveText('New in 1.0')
  for (const id of newSections) {
    const row = page.locator(`#new #${id}`)
    await expect(row).toHaveCount(1)
    const image = row.locator('img')
    await expect(image).toHaveAttribute('loading', 'lazy')
    await expect(image).toHaveAttribute('width', '1600')
    await expect(image).toHaveAttribute('height', '1000')
    expect(((await image.getAttribute('alt')) ?? '').length).toBeGreaterThan(20)
  }
  const phone = page.locator('#remote .phone img').first()
  await expect(phone).toHaveAttribute('src', 'assets/remote-approvals.png')
  await expect(phone).toHaveAttribute('width', '780')
  await expect(phone).toHaveAttribute('height', '1688')
  await expect(page.locator('#remote')).toContainText('Approve from your phone')
  await expect(page.locator('#remote')).toContainText('Only a plain Yes can be allowed from the phone')
  for (const image of await page.locator('#new img, #remote .phone img').all()) {
    await image.scrollIntoViewIfNeeded()
    await expect(image).toHaveJSProperty('complete', true)
    expect(await image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0)
  }
})

test('the Arabic page translates the new sections and the English page has no horizontal scroll at 375px', async ({ page }) => {
  await page.goto(arabicUrl)
  await expect(page.locator('#new-h')).toHaveText('الجديد في 1.0')
  await expect(page.locator('#board h3')).toHaveText('لوحة الجلسات')
  await expect(page.locator('#timeline h3')).toHaveText('الخط الزمني للجلسة')
  await expect(page.locator('#search h3')).toContainText('ابحث في كل الجلسات')
  await expect(page.locator('#replay h3')).toHaveText('إعادة التشغيل')
  await expect(page.locator('#remote')).toContainText('وافق من هاتفك')
  await expect(page.getByText('انسخ احتياطيًا وانقل')).toBeVisible()
  await expect(page.locator('.new-pill')).toContainText('الجديد في 1.0')
  const english = await page.locator('#new, #remote, .new-pill').evaluateAll((nodes) => nodes.map((node) => node.textContent ?? '').join(' '))
  expect(english).not.toMatch(/Sessions board|Approve from your phone|Session timeline/)
  await expect(page.locator('#board img')).toHaveAttribute('alt', /لوحة الجلسات/)
  for (const address of [url, arabicUrl]) {
    await page.setViewportSize({ width: 375, height: 800 })
    await page.goto(address)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  }
})
