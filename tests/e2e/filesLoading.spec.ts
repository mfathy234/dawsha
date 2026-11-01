import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, createSandbox, launchApp, type Sandbox } from './helpers'

const SHOTS = join(tmpdir(), 'dawsha-176-files-shots')
mkdirSync(SHOTS, { recursive: true })

const git = (cwd: string, ...args: string[]): void => {
  execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid', ...args], { cwd, stdio: 'pipe' })
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHRRxJAAAAABJRU5ErkJggg==', 'base64')

interface Rule { match: string; ms?: number; fail?: string }

// Test hook: slows or fails one IPC channel for calls whose arguments contain `match`. It swaps the handler Electron keeps for the
// channel, so the real handler still answers; clearing the rules makes the channel behave normally again.
async function hookIpc(app: ElectronApplication, channel: string, rules: Rule[]): Promise<void> {
  await app.evaluate(({ ipcMain }, { channel, rules }) => {
    const store = globalThis as unknown as { __rules?: Record<string, Rule[]> }
    store.__rules ??= {}
    store.__rules[channel] = rules
    type Handler = ((event: { _throw(error: Error): void }, ...args: unknown[]) => Promise<unknown>) & { wrapped?: boolean }
    const map = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers
    const original = map.get(channel)
    if (!original || original.wrapped) return
    const wrapped: Handler = async (event, ...args) => {
      const text = JSON.stringify(args)
      const rule = (store.__rules?.[channel] ?? []).find((candidate) => text.includes(candidate.match))
      if (rule?.ms) await new Promise((resolve) => setTimeout(resolve, rule.ms))
      if (rule?.fail) {
        event._throw(new Error(rule.fail))
        return undefined
      }
      return original(event, ...args)
    }
    wrapped.wrapped = true
    map.set(channel, wrapped)
  }, { channel, rules })
}

function repo(sandbox: Sandbox, worktrees: string[] = []): string {
  const root = sandbox.projectFolder
  mkdirSync(join(root, 'docs'), { recursive: true })
  writeFileSync(join(root, 'main-only.txt'), 'main checkout file')
  writeFileSync(join(root, 'slow.txt'), 'slow content')
  writeFileSync(join(root, 'fast.txt'), 'fast content')
  writeFileSync(join(root, 'bad.txt'), 'bad then good')
  writeFileSync(join(root, 'docs', 'readme.md'), '# Title\n\nSome text with `code` inside.\n')
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'initial')
  for (const name of worktrees) git(root, 'worktree', 'add', '-qb', name, join(sandbox.root, name))
  return root
}

const row = (page: Page, path: string) => page.locator(`.files-row[data-path="${path}"]`)
const menu = (page: Page) => page.locator('.ctx-menu:not(.leaving)')
const editorText = (page: Page) => page.locator('.files-editor:not([hidden]) .cm-content')

async function openFiles(page: Page, width = 1440, height = 900): Promise<void> {
  await page.setViewportSize({ width, height })
  await page.locator('#files-button').click()
  await expect(page.locator('#files-view')).toBeVisible()
  await expect(page.locator('#files-location .files-loc-project')).toHaveText('Smoke')
}

test('the inspector has its own Hide button, stays hidden after a restart and has a shortcut; the explorer hides the same way', async () => {
  test.setTimeout(150_000)
  const sandbox = createSandbox()
  repo(sandbox)
  let session = await launchApp(sandbox)
  try {
    const { page } = session
    await openFiles(page)
    await row(page, 'slow.txt').click()
    await expect(page.locator('#files-side')).toBeVisible()
    const hide = page.locator('#files-inspector-hide')
    await expect(hide).toBeVisible()
    await expect(hide).toHaveAttribute('aria-label', 'Hide outline and activity')
    await expect(hide).toHaveAttribute('title', /^Hide outline and activity/)
    await page.screenshot({ path: join(SHOTS, 'inspector-header-1440.png') })
    await hide.click()
    await expect(page.locator('#files-side')).toBeHidden()
    await expect(page.locator('#files-inspector-toggle')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('#files-inspector-toggle')).toBeFocused()
    await page.keyboard.press('Control+Alt+B')
    await expect(page.locator('#files-side')).toBeVisible()
    await page.keyboard.press('Control+Alt+B')
    await expect(page.locator('#files-side')).toBeHidden()
    await page.locator('#files-explorer-hide').click()
    await expect(page.locator('.files-tree-col')).toBeHidden()
    await expect(page.locator('#files-explorer-toggle')).toBeVisible()
    await page.locator('#files-explorer-toggle').click()
    await expect(page.locator('.files-tree-col')).toBeVisible()
    await page.keyboard.press('Control+Alt+E')
    await expect(page.locator('.files-tree-col')).toBeHidden()
    await page.keyboard.press('Control+Alt+E')
    await expect(page.locator('.files-tree-col')).toBeVisible()
    await page.locator('.files-tab-close').click()
    await expect(page.locator('#files-inspector-toggle')).toBeVisible()
  } finally {
    await closeApp(session.app)
  }
  session = await launchApp(sandbox)
  try {
    const { page } = session
    await openFiles(page)
    await expect(page.locator('#files-side')).toBeHidden()
    await expect(page.locator('#files-inspector-toggle')).toBeVisible()
    await page.locator('#files-inspector-toggle').click()
    await expect(page.locator('#files-side')).toBeVisible()
    await expect(page.locator('#files-inspector-hide')).toBeVisible()
  } finally {
    await closeApp(session.app)
  }
})

test('the location button names the branch and the worktree count, and the menu always has a Worktrees section', async () => {
  test.setTimeout(180_000)
  const sandbox = createSandbox()
  const root = repo(sandbox, ['review'])
  const { app, page } = await launchApp(sandbox)
  try {
    await openFiles(page)
    const branch = page.locator('#files-branch')
    const worktrees = page.locator('#files-worktrees')
    await expect(branch).toBeVisible()
    await expect(branch).toHaveAttribute('title', 'Switch branch. Now on main')
    await expect(branch.locator('.files-loc-branch')).toHaveText('main')
    await expect(worktrees).toHaveAttribute('title', '2 worktrees')
    await expect(worktrees).toHaveAttribute('aria-label', '2 worktrees')
    await expect(worktrees.locator('.files-loc-count')).toHaveText('2')
    await page.screenshot({ path: join(SHOTS, 'location-button-1440.png'), clip: { x: 0, y: 0, width: 420, height: 160 } })

    await worktrees.click()
    await expect(menu(page).locator('.ctx-heading').first()).toHaveText('Worktrees')
    await expect(menu(page).locator('.ctx-heading')).toContainText(['Worktrees', 'Projects'])
    const current = menu(page).locator('.ctx-item', { has: page.locator('.ctx-label', { hasText: /^main$/ }) })
    await expect(current).toContainText('Current · Smoke Project')
    await expect(current.locator('.ctx-check')).toBeVisible()
    await expect(menu(page).locator('.ctx-item', { hasText: 'review' })).toBeEnabled()
    await page.screenshot({ path: join(SHOTS, 'location-menu-1440.png'), clip: { x: 0, y: 0, width: 560, height: 520 } })
    await page.keyboard.press('Escape')

    await page.keyboard.press('Control+Alt+W')
    await expect(menu(page).locator('.ctx-heading').first()).toHaveText('Worktrees')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Control+k')
    await page.locator('#palette-input').fill('Switch worktree')
    await page.keyboard.press('Enter')
    await expect(menu(page).locator('.ctx-heading').first()).toHaveText('Worktrees')
    await page.keyboard.press('Escape')

    git(root, 'worktree', 'add', '-qb', 'outside', join(sandbox.root, 'outside'))
    git(root, 'worktree', 'add', '-qb', 'vanished', join(sandbox.root, 'vanished'))
    rmSync(join(sandbox.root, 'vanished'), { recursive: true, force: true })
    await worktrees.click()
    await expect(menu(page).locator('.ctx-item', { hasText: 'outside' })).toBeVisible()
    const vanished = menu(page).locator('.ctx-item', { hasText: 'vanished' })
    await expect(vanished).toBeDisabled()
    await expect(vanished).toContainText('pruned')
    await menu(page).locator('.ctx-item', { hasText: 'review' }).click()
    await expect(branch.locator('.files-loc-branch')).toHaveText('review')
    await expect(worktrees).toHaveAttribute('aria-label', '4 worktrees')
  } finally {
    await closeApp(app)
  }
})

test('a repository with only the main checkout still shows the Worktrees section and says how to add one', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  repo(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    await openFiles(page)
    await expect(page.locator('#files-branch .files-loc-branch')).toHaveText('main')
    await expect(page.locator('#files-worktrees')).toBeHidden()
    await page.keyboard.press('Control+Alt+W')
    await expect(menu(page).locator('.ctx-heading').first()).toHaveText('Worktrees')
    const only = menu(page).locator('.ctx-item', { hasText: 'Only the main checkout.' })
    await expect(only).toBeDisabled()
    await expect(only).toContainText('git worktree add')
  } finally {
    await closeApp(app)
  }
})

test('loading states appear for slow loads, errors offer Retry, and quick switching keeps the last choice', async () => {
  test.setTimeout(240_000)
  const sandbox = createSandbox()
  const root = repo(sandbox, ['review'])
  const review = join(sandbox.root, 'review')
  writeFileSync(join(review, 'review-only.txt'), 'review checkout file')
  writeFileSync(join(root, 'photo.png'), PNG)
  writeFileSync(join(root, 'page.html'), '<h1>hello</h1>')
  writeFileSync(join(root, 'big.txt'), 'x'.repeat(1_100_000))
  writeFileSync(join(root, 'changed.txt'), 'edit')
  const { app, page } = await launchApp(sandbox)
  const visibleLoading = (scope: string, text: string) => {
    const note = page.locator(`${scope} .files-loading`, { hasText: text })
    return expect(note).toHaveCSS('opacity', '1')
  }
  try {
    for (const channel of ['project:files', 'project:file', 'files:workspaces', 'files:search', 'files:log', 'files:image', 'files:preview-url', 'git:status']) await hookIpc(app, channel, [])
    await openFiles(page)
    await expect(row(page, 'main-only.txt')).toBeVisible()

    // the tree while switching checkout, and quick switching between two of them
    await hookIpc(app, 'project:files', [{ match: 'review', ms: 1500 }])
    await hookIpc(app, 'git:status', [{ match: 'review', ms: 1500 }])
    await page.locator('#files-worktrees').click()
    await menu(page).locator('.ctx-item', { hasText: 'review' }).click()
    await visibleLoading('#files-tree', 'Loading files…')
    await expect(page.locator('#files-tree .files-skel-row').first()).toBeVisible()
    await visibleLoading('#files-changes-list', 'Loading changes…')
    await page.screenshot({ path: join(SHOTS, 'loading-tree-1440.png') })
    await expect(row(page, 'review-only.txt')).toBeVisible({ timeout: 10_000 })
    await hookIpc(app, 'git:status', [])
    await hookIpc(app, 'project:files', [])
    await expect(page.locator('#files-branch .files-loc-branch')).toHaveText('review')

    await hookIpc(app, 'files:workspaces', [{ match: 'review', ms: 3000 }, { match: 'Smoke Project', ms: 200 }])
    for (const name of ['main', 'review', 'main']) {
      await page.locator('#files-worktrees').click()
      await menu(page).locator('.ctx-item', { has: page.locator('.ctx-label', { hasText: new RegExp(`^${name}$`) }) }).click()
    }
    await page.waitForTimeout(3600)
    await expect(page.locator('#files-branch .files-loc-branch')).toHaveText('main')
    await expect(row(page, 'main-only.txt')).toBeVisible()
    await expect(row(page, 'review-only.txt')).toHaveCount(0)
    await hookIpc(app, 'files:workspaces', [])

    // opening a file, quickly choosing another one
    await hookIpc(app, 'project:file', [{ match: 'slow.txt', ms: 1500 }])
    await row(page, 'slow.txt').click()
    await visibleLoading('#files-empty', 'Opening slow.txt…')
    await page.screenshot({ path: join(SHOTS, 'loading-file-1440.png') })
    await row(page, 'fast.txt').click()
    await expect(editorText(page)).toHaveText('fast content')
    await page.waitForTimeout(2200)
    await expect(editorText(page)).toHaveText('fast content')
    await expect(page.locator('.files-tab.active')).toContainText('fast.txt')
    await hookIpc(app, 'project:file', [])

    // a file that cannot be read: plain message and Retry
    await hookIpc(app, 'project:file', [{ match: 'bad.txt', fail: 'disk exploded' }])
    await row(page, 'bad.txt').click()
    await expect(page.locator('#files-empty .files-error')).toContainText("Couldn't open this file.")
    await hookIpc(app, 'project:file', [])
    await page.locator('#files-empty .files-retry').click()
    await expect(editorText(page)).toHaveText('bad then good')

    // too big: what is allowed
    await row(page, 'big.txt').click()
    await expect(page.locator('#files-empty')).toContainText('larger than 1 MB')
    await expect(page.locator('#files-empty .files-limits')).toContainText('Text files up to 1 MB')

    // the tree failing: message and Retry
    await hookIpc(app, 'project:files', [{ match: 'review', fail: 'folder vanished' }])
    await page.locator('#files-worktrees').click()
    await menu(page).locator('.ctx-item', { has: page.locator('.ctx-label', { hasText: /^review$/ }) }).click()
    await expect(page.locator('#files-tree .files-error')).toContainText("Couldn't read this folder.")
    await hookIpc(app, 'project:files', [])
    await page.locator('#files-tree .files-retry').click()
    await expect(row(page, 'review-only.txt')).toBeVisible()
    await page.locator('#files-worktrees').click()
    await menu(page).locator('.ctx-item', { has: page.locator('.ctx-label', { hasText: /^main$/ }) }).click()
    await expect(row(page, 'main-only.txt')).toBeVisible()

    // the location menu while the worktree list is slow
    await hookIpc(app, 'files:workspaces', [{ match: ',null]', ms: 1500 }])
    await page.locator('#files-worktrees').click()
    await expect(menu(page).locator('.ctx-item', { hasText: 'Loading worktrees…' })).toBeVisible()
    await page.screenshot({ path: join(SHOTS, 'location-loading-1440.png'), clip: { x: 0, y: 0, width: 560, height: 420 } })
    await expect(menu(page).locator('.ctx-item', { hasText: 'Loading worktrees…' })).toHaveCount(0, { timeout: 8000 })
    await expect(menu(page).locator('.ctx-item', { hasText: 'review' })).toBeVisible()
    await page.keyboard.press('Escape')
    await hookIpc(app, 'files:workspaces', [{ match: ',null]', fail: 'git went away' }])
    await page.locator('#files-worktrees').click()
    await expect(menu(page).locator('.ctx-item', { hasText: "Couldn't list worktrees" })).toBeVisible()
    await hookIpc(app, 'files:workspaces', [])
    await menu(page).locator('.ctx-item', { hasText: "Couldn't list worktrees" }).click()
    await expect(menu(page).locator('.ctx-item', { hasText: 'review' })).toBeVisible()
    await page.keyboard.press('Escape')

    // the Changes section and the inspector's commits
    await row(page, 'fast.txt').click()
    await hookIpc(app, 'files:log', [{ match: 'fast.txt', fail: 'log failed' }])
    await page.locator('#files-tab-activity').click()
    await expect(page.locator('#files-activity .files-error')).toContainText("Couldn't read the commits.")
    await hookIpc(app, 'files:log', [])
    await page.locator('#files-activity .files-retry').click()
    await expect(page.locator('#files-activity')).toContainText('initial')

    // previews
    await hookIpc(app, 'files:image', [{ match: 'photo.png', ms: 1500 }])
    await row(page, 'photo.png').click()
    await visibleLoading('#files-preview', 'Loading the image…')
    await expect(page.locator('#files-image')).toBeVisible({ timeout: 10_000 })
    await hookIpc(app, 'files:preview-url', [{ match: 'page.html', ms: 1500 }])
    await row(page, 'page.html').click()
    await page.locator('#files-view-preview').click()
    await visibleLoading('#files-preview', 'Loading the preview…')
    await expect(page.locator('#files-html')).toBeVisible({ timeout: 10_000 })
  } finally {
    await closeApp(app)
  }
})

test('search keeps the newest query and runs again for a query typed after clearing', async () => {
  test.setTimeout(150_000)
  const sandbox = createSandbox()
  repo(sandbox)
  writeFileSync(join(sandbox.projectFolder, 'alpha.txt'), 'alphaword here')
  writeFileSync(join(sandbox.projectFolder, 'beta.txt'), 'betaword here')
  const { app, page } = await launchApp(sandbox)
  try {
    await hookIpc(app, 'files:search', [])
    await openFiles(page)
    await page.keyboard.press('Control+Shift+F')
    const input = page.locator('#files-search-input')
    await hookIpc(app, 'files:search', [{ match: 'alphaword', ms: 1500 }])
    await input.fill('alphaword')
    await input.press('Enter')
    await expect(page.locator('#files-search-summary .files-loading')).toHaveCSS('opacity', '1')
    await input.fill('betaword')
    await input.press('Enter')
    await expect(page.locator('.files-hit-file', { hasText: 'beta.txt' })).toBeVisible()
    await page.waitForTimeout(2000)
    await expect(page.locator('.files-hit-file', { hasText: 'beta.txt' })).toBeVisible()
    await expect(page.locator('.files-hit-file', { hasText: 'alpha.txt' })).toHaveCount(0)
    await hookIpc(app, 'files:search', [])
    await input.fill('')
    await input.press('Enter')
    await expect(page.locator('.files-hit-file')).toHaveCount(0)
    await input.fill('betaword')
    await input.press('Enter')
    await expect(page.locator('.files-hit-file', { hasText: 'beta.txt' })).toBeVisible()
    await hookIpc(app, 'files:search', [{ match: 'betaword', fail: 'search blew up' }])
    await input.fill('betaword ')
    await input.press('Enter')
    await expect(page.locator('#files-search-summary .files-error')).toContainText("Couldn't search.")
    await hookIpc(app, 'files:search', [])
    await page.locator('#files-search-summary .files-retry').click()
    await expect(page.locator('.files-hit-file', { hasText: 'beta.txt' })).toBeVisible()
  } finally {
    await closeApp(app)
  }
})

test('inline code does not change the line height in the Markdown preview', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  const root = sandbox.projectFolder
  const doc = [
    '# Design', '', 'Intro paragraph with `inline code` in the middle of a sentence that is long enough to look like prose.', '',
    '## Colours', '', '- plain item one', '- item with `--accent` and `--raised` tokens', '- plain item two', '- item with `code` again', '- another plain item', '  - nested plain', '  - nested with `code`', '',
    '1. first `a`', '2. second', '3. third `b` and `c`', '', '### Notes', '', 'Last paragraph, plain.', ''
  ].join('\n')
  writeFileSync(join(root, 'DESIGN.md'), doc)
  const { app, page } = await launchApp(sandbox)
  try {
    await openFiles(page)
    for (const [width, height] of [[1440, 900], [1024, 728]] as const) {
      await page.setViewportSize({ width, height })
      await row(page, 'DESIGN.md').click()
      const md = page.locator('#files-md')
      await expect(md).toBeVisible()
      const metrics = await md.evaluate((article) => {
        const rect = (element: Element): number => element.getBoundingClientRect().height
        const items = [...article.querySelectorAll(':scope > ul > li')]
        const plain = items.filter((item) => !item.querySelector('code') && !item.querySelector('ul'))
        const withCode = items.filter((item) => item.querySelector('code') !== null)
        const code = article.querySelector('li code') as HTMLElement
        const style = getComputedStyle(code)
        const paragraph = getComputedStyle(article.querySelector('p') as HTMLElement)
        return {
          plain: plain.map(rect), withCode: withCode.filter((item) => !item.querySelector('ul')).map(rect),
          display: style.display, align: style.verticalAlign, padLeft: style.paddingLeft, padTop: style.paddingTop, fontSize: style.fontSize, codeLine: style.lineHeight, paragraphLine: paragraph.lineHeight, paragraphSize: paragraph.fontSize
        }
      })
      expect(metrics.display).toBe('inline')
      expect(metrics.align).toBe('baseline')
      expect(metrics.padTop).toBe('0px')
      expect(parseFloat(metrics.padLeft)).toBeCloseTo(parseFloat(metrics.fontSize) * 0.3, 1)
      expect(metrics.codeLine === 'normal' || parseFloat(metrics.codeLine) <= parseFloat(metrics.fontSize) * 1.65 + 0.5).toBe(true)
      const lineHeight = parseFloat(metrics.paragraphLine)
      for (const height of [...metrics.plain, ...metrics.withCode]) expect(Math.abs(height - lineHeight)).toBeLessThan(0.75)
      await page.screenshot({ path: join(SHOTS, `markdown-design-${width}.png`) })
    }
  } finally {
    await closeApp(app)
  }
})

test('the worktree control and the loading note fit a 1024 wide window', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  const root = repo(sandbox, ['review'])
  writeFileSync(join(sandbox.root, 'review', 'review-only.txt'), 'x')
  const { app, page } = await launchApp(sandbox)
  try {
    await hookIpc(app, 'project:files', [])
    await openFiles(page, 1024, 728)
    await expect(page.locator('#files-side')).toBeHidden()
    const box = await page.locator('#files-branch').boundingBox()
    expect(box && box.width).toBeGreaterThan(120)
    await page.screenshot({ path: join(SHOTS, 'location-button-1024.png'), clip: { x: 0, y: 0, width: 420, height: 160 } })
    await page.locator('#files-worktrees').click()
    await expect(menu(page).locator('.ctx-heading').first()).toHaveText('Worktrees')
    await page.screenshot({ path: join(SHOTS, 'location-menu-1024.png'), clip: { x: 0, y: 0, width: 560, height: 520 } })
    await page.keyboard.press('Escape')
    await hookIpc(app, 'project:files', [{ match: 'review', ms: 2500 }])
    await page.locator('#files-worktrees').click()
    await menu(page).locator('.ctx-item', { hasText: 'review' }).click()
    await expect(page.locator('#files-tree .files-loading')).toHaveCSS('opacity', '1')
    await page.screenshot({ path: join(SHOTS, 'loading-tree-1024.png') })
    expect(root).toBeTruthy()
  } finally {
    await closeApp(app)
  }
})
