import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp } from './helpers'

const git = (cwd: string, ...args: string[]): void => {
  execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid', ...args], { cwd, stdio: 'pipe' })
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

// A solid-colour 4x4 PNG.
function png(red: number, green: number, blue: number): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(4, 0)
  header.writeUInt32BE(4, 4)
  header[8] = 8
  header[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: 4 }, () => [red, green, blue]).flat())])
  const raw = Buffer.concat(Array.from({ length: 4 }, () => row))
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

test('Markdown opens rendered with HTML escaped, and Source shows the file', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  const repo = sandbox.projectFolder
  mkdirSync(join(repo, 'docs'), { recursive: true })
  writeFileSync(join(repo, 'docs', 'plan.md'), '# Plan title\n\n<script>window.__pwned = 1</script>\n\n- first item\n\n[bad](javascript:alert(1)) and [good](https://example.com)\n')
  const { app, page } = await launchApp(sandbox)
  try {
    await page.locator('#files-button').click()
    await page.locator('.files-row[data-path="docs"]').click()
    await page.locator('.files-row[data-path="docs/plan.md"]').click()
    await expect(page.locator('#files-md h1')).toHaveText('Plan title')
    await expect(page.locator('#files-md li')).toHaveText('first item')
    await expect(page.locator('#files-md script')).toHaveCount(0)
    await expect(page.locator('#files-md')).toContainText('<script>window.__pwned = 1</script>')
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined()
    await expect(page.locator('#files-md a[data-href="https://example.com"]')).toHaveCount(1)
    await expect(page.locator('#files-md a[data-href^="javascript"]')).toHaveCount(0)
    await expect(page.locator('#files-view-preview')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('#files-status')).toContainText('Preview')
    await page.screenshot({ path: 'test-results/screens/174-files-markdown.png' })

    await page.locator('#files-view-source').click()
    await expect(page.locator('#files-md')).toBeHidden()
    await expect(page.locator('.files-editor:not([hidden]) .cm-content')).toContainText('# Plan title')
    await page.locator('#files-view-preview').click()
    await expect(page.locator('#files-md h1')).toBeVisible()
  } finally {
    await closeApp(app)
  }
})

test('HTML renders in a sandboxed iframe with no network, no same-origin and an Open in browser action', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  const repo = sandbox.projectFolder
  writeFileSync(join(repo, 'page.html'), '<!doctype html><title>t</title><h1 id="hello">Hello page</h1><script>document.getElementById("hello").dataset.ran = "yes"</script>')
  const { app, page } = await launchApp(sandbox)
  try {
    await page.locator('#files-button').click()
    await page.locator('.files-row[data-path="page.html"]').click()
    await expect(page.locator('.files-editor:not([hidden]) .cm-content')).toContainText('Hello page')
    await expect(page.locator('#files-html')).toHaveCount(0)
    await page.locator('#files-view-preview').click()
    const frame = page.locator('#files-html')
    await expect(frame).toBeVisible()
    await expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    await expect(page.locator('#files-open-browser')).toBeVisible()
    const inner = page.frameLocator('#files-html')
    await expect(inner.locator('#hello')).toHaveText('Hello page')
    // the app's own policy (script-src 'self') is inherited by the frame, so the page's inline script does not run
    await expect(inner.locator('#hello')).not.toHaveAttribute('data-ran', 'yes')
    const csp = await frame.evaluate((element) => (element as HTMLIFrameElement).srcdoc.slice(0, 220))
    expect(csp).toContain("default-src 'none'")
    const probe = page.frames().find((candidate) => candidate !== page.mainFrame() && candidate.parentFrame() === page.mainFrame())
    expect(probe).toBeTruthy()
    const outcome = await probe!.evaluate(async () => {
      let storage = 'blocked'
      try {
        window.localStorage.setItem('x', '1')
        storage = 'allowed'
      } catch {
        storage = 'blocked'
      }
      const network = await fetch('https://example.com/').then(() => 'allowed', () => 'blocked')
      let parentAccess = 'blocked'
      try {
        parentAccess = window.parent.document.title === undefined ? 'blocked' : 'allowed'
      } catch {
        parentAccess = 'blocked'
      }
      return { storage, network, parentAccess }
    })
    expect(outcome).toEqual({ storage: 'blocked', network: 'blocked', parentAccess: 'blocked' })
    await page.screenshot({ path: 'test-results/screens/174-files-html.png' })
  } finally {
    await closeApp(app)
  }
})

test('images preview, SVG is an img with a Source switch, and a changed image compares with main', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  const repo = sandbox.projectFolder
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'shot.png'), png(200, 30, 30))
  writeFileSync(join(repo, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#0a0"/></svg>')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'images')
  writeFileSync(join(repo, 'shot.png'), png(30, 30, 200))
  const { app, page } = await launchApp(sandbox)
  try {
    await page.setViewportSize({ width: 1024, height: 728 })
    await page.locator('#files-button').click()
    await page.locator('.files-row[data-path="shot.png"]').click()
    const image = page.locator('#files-image')
    await expect(image).toBeVisible()
    await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(4)
    await expect(page.locator('#files-view-source')).toBeHidden()

    await page.locator('#files-compare-main').click()
    await expect(page.locator('#files-compare')).toBeVisible()
    const range = page.locator('#files-compare-range')
    await range.focus()
    await page.keyboard.press('Home')
    await expect(page.locator('#files-compare')).toHaveCSS('--split', '0%')
    await page.keyboard.press('End')
    await expect(page.locator('#files-compare')).toHaveCSS('--split', '100%')
    const sources = await page.locator('.files-compare-img').evaluateAll((nodes) => nodes.map((node) => (node as HTMLImageElement).alt))
    expect(sources.sort()).toEqual(['On main', 'Your version'])
    await page.screenshot({ path: 'test-results/screens/174-files-compare.png' })

    await page.locator('.files-row[data-path="logo.svg"]').click()
    const svg = page.locator('#files-image')
    await expect(svg).toHaveAttribute('src', /^data:image\/svg\+xml;base64,/)
    await expect(page.locator('#files-view-source')).toBeVisible()
    await page.locator('#files-view-source').click()
    await expect(page.locator('.files-editor:not([hidden]) .cm-content')).toContainText('<svg')
  } finally {
    await closeApp(app)
  }
})
