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

test('the main download button offers the installer and the version, and the download section links every platform', async ({ page }) => {
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
  await expect(page.locator('.hero a[href="#download"]')).toBeVisible()
  for (const [key, name] of Object.entries(packages)) {
    await expect(page.locator(`#download [data-dl="${key}"]`)).toHaveAttribute('href', base + name)
  }
  const link = page.locator('#download [data-dl="linux-appimage"]')
  await link.focus()
  await expect(link).toBeFocused()
})

test('a Mac visitor is offered the Mac download first, with Windows still in the download section', async ({ browser }) => {
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
    await expect(page.locator('.hero-copy .platform-icon')).toHaveCount(1)
    await expect(page.locator('#windows-download [data-dl="setup"]')).toBeVisible()
    await expect(page.locator('#mac-download [data-dl="mac"]')).toHaveAttribute('href', dmg)
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
    await expect(page.locator('#download [data-dl="linux-appimage"]')).toBeVisible()
    await expect(page.locator('#download [data-dl="mac"]')).toBeVisible()
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
  await page.setViewportSize({ width: 390, height: 560 })
  await page.addInitScript(countPlays)
  await page.goto(url)
  await page.waitForLoadState('load')
  const video = page.locator('.demo .demo-video')
  await expect(video).toHaveAttribute('preload', 'none')
  await expect(video).toHaveAttribute('poster', 'assets/demo-poster.jpg')
  expect(await video.evaluate((el: HTMLVideoElement) => el.autoplay)).toBe(false)
  await page.waitForTimeout(600)
  expect(await page.evaluate(() => (window as unknown as { __plays: number }).__plays)).toBe(0)

  await video.scrollIntoViewIfNeeded()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __plays: number }).__plays)).toBeGreaterThan(0)
  const toggle = page.locator('.demo .demo-toggle')
  await expect(toggle).toBeVisible()
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-label', 'Play the demo')
  expect(await video.evaluate((el: HTMLVideoElement) => el.paused)).toBe(true)
})

test('with reduced motion the demo shows its poster and never starts', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(countPlays)
  await page.goto(url)
  for (const video of await page.locator('.demo-video').all()) {
    await video.scrollIntoViewIfNeeded()
    await page.waitForTimeout(800)
  }
  expect(await page.evaluate(() => (window as unknown as { __plays: number }).__plays)).toBe(0)
  for (const toggle of await page.locator('.demo-toggle').all()) await expect(toggle).toBeHidden()
})

const releaseRows = ['files-review', 'agents-details', 'dawsha-cards', 'projects-sidebar']

test('the hero is three text elements with a readable crop of the app and no pill or platform row', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const address of [url, arabicUrl]) {
    await page.goto(address)
    expect(await page.locator('.hero-copy > *').count()).toBeLessThanOrEqual(4)
    await expect(page.locator('.hero .new-pill, .hero .eyebrow, .hero .download-alt, .hero-logo')).toHaveCount(0)
    const image = page.locator('.hero-shot img')
    await expect(image).toHaveAttribute('width', '920')
    await expect(image).toHaveAttribute('height', '445')
    expect(await image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(920)
    const shown = await image.evaluate((el) => el.getBoundingClientRect().width)
    expect(shown).toBeGreaterThan(500)
  }
})

test('the page has no em or en dashes, no uppercase labels and no decorative badges', async ({ page }) => {
  for (const address of [url, arabicUrl]) {
    await page.goto(address)
    const text = await page.evaluate(() => `${document.title}\n${document.documentElement.outerHTML.replace(/<script[\s\S]*?<\/script>/g, '')}`)
    expect(text).not.toMatch(/[–—]/)
    const uppercase = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((el) => getComputedStyle(el).textTransform === 'uppercase').length)
    expect(uppercase).toBe(0)
    await expect(page.locator('.beta-badge, .remote-eyebrow, .small-h')).toHaveCount(0)
  }
})

test('New in 1.7.4 leads the page with sized lazy screenshots and no run of three splits', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(url)
  await expect(page.locator('nav[aria-label="Primary"] a').first()).toHaveText('New in 1.7.4')
  await expect(page.locator('#new-h')).toHaveText('New in 1.7.4')
  await expect(page.locator('#new #files-review h3')).toHaveText('Search and review in Files')
  await expect(page.locator('#new #files-review')).toContainText('Send to agent types every comment')
  await expect(page.locator('#new #agents-details')).toContainText('Timeline shows which agents ran side by side')
  await expect(page.locator('#new #dawsha-cards')).toContainText('solid orange ring')
  await expect(page.locator('#new #projects-sidebar')).toContainText('Waiting on you')
  const order = await page.locator('#new .wrap > div').evaluateAll((nodes) => nodes.map((n) => n.id))
  expect(order).toEqual(releaseRows)
  const splits = await page.locator('#new .wrap > div').evaluateAll((nodes) => nodes.map((n) => n.classList.contains('feat-row')))
  for (let i = 0; i + 2 < splits.length; i += 1) expect(splits.slice(i, i + 3).every(Boolean)).toBe(false)
  await expect(page.locator('#new li')).not.toHaveCount(0)
  expect(await page.locator('#new li').first().evaluate((el) => getComputedStyle(el).borderInlineStartWidth)).toBe('0px')
  for (const id of releaseRows) {
    const images = await page.locator(`#new #${id} img`).all()
    expect(images.length).toBeGreaterThan(0)
    for (const image of images) {
      await expect(image).toHaveAttribute('loading', 'lazy')
      const width = Number(await image.getAttribute('width'))
      expect(width).toBeGreaterThan(0)
      expect(Number(await image.getAttribute('height'))).toBeGreaterThan(0)
      expect(((await image.getAttribute('alt')) ?? '').length).toBeGreaterThan(20)
      await image.scrollIntoViewIfNeeded()
      await expect(image).toHaveJSProperty('complete', true)
      expect(await image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(width)
      expect(await image.evaluate((el) => getComputedStyle(el.closest('figure') as Element).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')
    }
  }
  expect(await page.locator('#new').evaluate((el) => el.compareDocumentPosition(document.getElementById('earlier') as Element) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy()
})

test('Earlier releases is one compact section that keeps the old release anchors and links to the changelog', async ({ page }) => {
  await page.goto(url)
  await expect(page.locator('#earlier-h')).toHaveText('Earlier releases')
  await expect(page.locator('#earlier #new-1-7, #earlier #new-1-6, #earlier #new-1-5, #earlier #new-1-0')).toHaveCount(4)
  await expect(page.locator('#earlier #new-1-7')).toContainText('Files view')
  await expect(page.locator('#earlier #new-1-7 a')).toHaveAttribute('href', 'https://github.com/mfathy234/dawsha/releases/tag/v1.7.3')
  await expect(page.locator('#earlier #new-1-6')).toContainText('Arabic in every session')
  await expect(page.locator('#earlier #new-1-5')).toContainText('Orchestrator')
  await expect(page.locator('#earlier #new-1-0')).toContainText('sessions board')
  await expect(page.locator('#earlier a[href$="/releases"]')).toHaveCount(1)
  await expect(page.locator('#earlier a[href*="/releases/tag/"]')).toHaveCount(4)
  await expect(page.locator('#earlier img, #earlier video')).toHaveCount(0)
  await expect(page.locator('section[id^="new-1"]')).toHaveCount(0)
  expect(await page.locator('#earlier').evaluate((el) => el.textContent?.length ?? 0)).toBeLessThan(1500)
  await expect(page.locator('body')).not.toContainText(/snippet/i)
  await expect(page.locator('#features')).toContainText('Voice dictation')
})

test('the remote section keeps its phone screenshots and says Remote Control is beta in plain text', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(url)
  const phone = page.locator('#remote .phone img').first()
  await expect(phone).toHaveAttribute('src', 'assets/remote-approvals.png')
  await expect(phone).toHaveAttribute('width', '780')
  await expect(phone).toHaveAttribute('height', '1688')
  await expect(page.locator('#remote')).toContainText('Approve from your phone')
  await expect(page.locator('#remote')).toContainText('Only a plain Yes can be allowed from the phone')
  await expect(page.locator('#remote')).toContainText('Remote Control is a beta feature.')
  for (const image of await page.locator('#remote .phone img').all()) {
    await image.scrollIntoViewIfNeeded()
    await expect(image).toHaveJSProperty('complete', true)
    expect(await image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0)
  }
})

test('the Arabic page translates the 1.7.4 section, the earlier releases and the demo, and neither page scrolls sideways at 375px', async ({ page }) => {
  await page.goto(arabicUrl)
  await expect(page.locator('#new-h')).toHaveText('الجديد في 1.7.4')
  await expect(page.locator('#files-review h3')).toHaveText('البحث والمراجعة في الملفات')
  await expect(page.locator('#agents-details h3')).toHaveText('تفاصيل الوكيل وخط زمني')
  await expect(page.locator('#dawsha-cards h3')).toContainText('الصقل')
  await expect(page.locator('#projects-sidebar h3')).toHaveText('شريط جانبي مبني حولك')
  await expect(page.locator('#files-review img').first()).toHaveAttribute('alt', /وضع المراجعة/)
  await expect(page.locator('#earlier-h')).toHaveText('الإصدارات السابقة')
  await expect(page.locator('#earlier')).toContainText('الخط الزمني للجلسة')
  await expect(page.locator('#earlier #new-1-7 a')).toContainText('ملاحظات الإصدار 1.7')
  await expect(page.locator('#earlier #new-1-6 a')).toContainText('ملاحظات الإصدار 1.6')
  await expect(page.locator('#remote')).toContainText('وافق من هاتفك')
  await expect(page.locator('#remote')).toContainText('في مرحلة بيتا')
  await expect(page.getByText('انسخ احتياطيًا وانقل')).toBeVisible()
  await expect(page.locator('.demo-video')).toHaveAttribute('poster', '../assets/demo-poster-ar.jpg')
  const english = await page.locator('#new, #earlier, #remote').evaluateAll((nodes) => nodes.map((node) => node.textContent ?? '').join(' '))
  expect(english).not.toMatch(/Sessions board|Approve from your phone|Session timeline|Work dashboard|Earlier releases|beta feature/)
  const names = await page.locator('.works .badges bdi').allTextContents()
  expect(names).toEqual(['Claude Code', 'Codex CLI', 'Gemini CLI'])
  expect(await page.locator('.hero .lead').textContent()).toMatch(/⁨Claude Code⁩/)
  for (const address of [url, arabicUrl]) {
    await page.setViewportSize({ width: 375, height: 800 })
    await page.goto(address)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  }
})
