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
  await expect(page.locator('.hero .download-action')).toContainText('حمّل لويندوز')
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

test('download dropdown works with the keyboard and resolves Linux assets', async ({ page }) => {
  const appImage = 'https://github.com/mfathy234/dawsha/releases/download/v0.3.0/Dawsha-0.3.0-linux-x86_64.AppImage'
  await page.route('https://api.github.com/repos/mfathy234/dawsha/releases/latest', route => route.fulfill({
    json: { tag_name: 'v0.3.0', assets: [{ name: 'Dawsha-0.3.0-linux-x86_64.AppImage', browser_download_url: appImage }] }
  }))
  await page.goto(url)
  const dropdown = page.locator('.hero .download-menu')
  await dropdown.locator('summary').focus()
  await page.keyboard.press('Enter')
  await expect(dropdown.locator('[data-dl="linux-appimage"]')).toHaveAttribute('href', appImage)
  await expect(dropdown.locator('.platform-icon')).toHaveCount(5)
  await page.keyboard.press('Escape')
  await expect(dropdown).not.toHaveAttribute('open', '')
  await expect(dropdown.locator('summary')).toBeFocused()
})

test('resolves each platform package and closes the dropdown with Escape', async ({ page }) => {
  const packages = {
    setup: 'Dawsha-Setup-0.3.0.exe', portable: 'Dawsha-Portable-0.3.0.exe',
    mac: 'Dawsha-0.3.0-mac-arm64.dmg',
    'linux-appimage': 'Dawsha-0.3.0-linux-x86_64.AppImage', 'linux-deb': 'Dawsha-0.3.0-linux-amd64.deb'
  }
  const base = 'https://github.com/mfathy234/dawsha/releases/download/v0.3.0/'
  await page.route('https://api.github.com/repos/mfathy234/dawsha/releases/latest', route => route.fulfill({
    json: { tag_name: 'v0.3.0', assets: Object.values(packages).map(name => ({ name, browser_download_url: base + name })) }
  }))
  await page.goto(url)
  await page.locator('.hero .download-menu summary').click()
  for (const [key, name] of Object.entries(packages)) {
    await expect(page.locator(`.hero .download-menu [data-dl="${key}"]`)).toHaveAttribute('href', base + name)
  }
  for (const [key, name] of Object.entries(packages)) {
    await expect(page.locator(`#download [data-dl="${key}"]`)).toHaveAttribute('href', base + name)
  }
})

test('API failure retains working release links for every platform', async ({ page }) => {
  await page.route('https://api.github.com/repos/mfathy234/dawsha/releases/latest', route => route.fulfill({ status: 403, body: '{}' }))
  await page.goto(url)
  for (const link of await page.locator('[data-dl]').all()) {
    await expect(link).toHaveAttribute('href', 'https://github.com/mfathy234/dawsha/releases/latest')
  }
})

test('platform dropdowns remain usable on mobile without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  for (const address of [url, arabicUrl]) {
    await page.goto(address)
    const dropdown = page.locator('.hero .download-menu')
    await dropdown.locator('summary').click()
    await expect(dropdown.locator('[data-dl="linux-appimage"]')).toBeVisible()
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
