import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { closeApp, createSandbox, launchApp, type Sandbox } from './helpers'

const git = (cwd: string, ...args: string[]): void => {
  execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid', ...args], { cwd, stdio: 'pipe' })
}

function put(root: string, rel: string, text: string): void {
  const full = join(root, ...rel.split('/'))
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, text)
}

function makeRepo(sandbox: Sandbox): string {
  const repo = sandbox.projectFolder
  git(repo, 'init', '-q', '-b', 'main')
  put(repo, '.gitignore', 'ignored/\n')
  put(repo, 'src/a.ts', 'alpha\nNeedle one\nbeta\n')
  put(repo, 'src/b.ts', 'needle two\nNEEDLE three\n')
  put(repo, 'ignored/c.ts', 'needle hidden\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'first')
  put(repo, 'fresh.md', 'a needle in an untracked file\n')
  return repo
}

const openSearch = async (page: Page): Promise<void> => {
  await page.locator('#files-button').click()
  await expect(page.locator('#files-view')).toBeVisible()
  await page.keyboard.press('Control+Shift+F')
  await expect(page.locator('#files-search-input')).toBeFocused()
}

test('Ctrl+Shift+F in Files searches the checkout: grouped results, options, ignored files left out, click opens the line', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  makeRepo(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    await page.setViewportSize({ width: 1024, height: 728 })
    await openSearch(page)
    await expect(page.locator('#files-mode-search')).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.type('needle')
    await expect(page.locator('.files-hit-group')).toHaveCount(3)
    await expect(page.locator('#files-search-summary')).toHaveText('4 results in 3 files')
    await expect(page.locator('.files-hit-group[aria-label^="ignored/"]')).toHaveCount(0)
    await expect(page.locator('.files-hit-group[aria-label^="fresh.md"]')).toHaveCount(1)
    await expect(page.locator('.files-hit-mark').first()).toHaveText(/needle/i)
    await page.screenshot({ path: 'test-results/screens/174-files-search.png' })

    await page.locator('#files-search-case').click()
    await expect(page.locator('#files-search-case')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('#files-search-summary')).toHaveText('2 results in 2 files')

    await page.locator('#files-search-case').click()
    await page.locator('#files-search-word').click()
    await page.locator('#files-search-include').click()
    await page.keyboard.type('*.ts')
    await expect(page.locator('.files-hit-group')).toHaveCount(2)
    await expect(page.locator('.files-hit-group[aria-label^="fresh.md"]')).toHaveCount(0)

    await page.locator('#files-search-regex').click()
    await page.locator('#files-search-input').fill('(')
    await expect(page.locator('#files-search-summary')).toContainText('regular expression')
    await page.locator('#files-search-input').fill('Needle (one|two)')
    await expect(page.locator('.files-hit')).toHaveCount(2)

    await page.locator('.files-hit[data-path="src/a.ts"]').click()
    await expect(page.locator('.files-tab.active')).toContainText('a.ts')
    await expect(page.locator('#files-status')).toContainText('Ln 2')
  } finally {
    await closeApp(app)
  }
})

test('search says when it hit the cap', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  const repo = makeRepo(sandbox)
  put(repo, 'big.txt', `${'zzz line\n'.repeat(700)}`)
  const { app, page } = await launchApp(sandbox)
  try {
    await openSearch(page)
    await page.keyboard.type('zzz')
    await expect(page.locator('#files-search-summary')).toContainText('Showing the first')
    await expect(page.locator('#files-search-summary')).toContainText('Narrow the search')
  } finally {
    await closeApp(app)
  }
})

test('a folder that is not a git repository is searched with the bounded walker, skipping node_modules', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  const root = sandbox.projectFolder
  put(root, 'src/app.js', 'const marker = 1\n')
  put(root, 'node_modules/dep/index.js', 'const marker = 2\n')
  put(root, 'dist/out.js', 'const marker = 3\n')
  const { app, page } = await launchApp(sandbox)
  try {
    await openSearch(page)
    await page.keyboard.type('marker')
    await expect(page.locator('.files-hit-group')).toHaveCount(1)
    await expect(page.locator('.files-hit-group[aria-label^="src/app.js"]')).toHaveCount(1)
    await expect(page.locator('#files-search-summary')).toHaveText('1 result in 1 file')
  } finally {
    await closeApp(app)
  }
})

test('the search IPC only answers for known project folders and refuses unsafe globs', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  const repo = makeRepo(sandbox)
  const stranger = join(sandbox.root, 'stranger')
  put(stranger, 'secret.txt', 'needle\n')
  const { app, page } = await launchApp(sandbox)
  try {
    const result = await page.evaluate(async ({ repo, stranger }) => {
      const request = { query: 'needle', matchCase: false, wholeWord: false, regex: false, include: '' }
      return {
        outside: await window.gridApi.searchFiles(stranger, request),
        escape: await window.gridApi.searchFiles(repo, { ...request, include: '../*' }),
        empty: await window.gridApi.searchFiles(repo, { ...request, query: '' }),
        fine: await window.gridApi.searchFiles(repo, request)
      }
    }, { repo, stranger })
    expect(result.outside.ok).toBe(false)
    expect(result.escape.ok).toBe(false)
    expect(result.empty.ok).toBe(false)
    expect(result.fine.ok).toBe(true)
  } finally {
    await closeApp(app)
  }
})
