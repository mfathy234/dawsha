import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { closeApp, createSandbox, launchApp, type Sandbox } from './helpers'

const SESSION_ID = '33333333-4444-4555-8666-777777777777'

function git(folder: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd: folder, stdio: 'ignore' })
}

const stamp = (minute: number): string => new Date(Date.UTC(2026, 9, 8, 9, minute, 0)).toISOString()

// A resumable Claude session that edited a.txt here, and a file in another repository (a project) and one in a folder Dawsha does not know.
function seed(sandbox: Sandbox): { other: string; stranger: string } {
  const root = sandbox.projectFolder
  const other = join(sandbox.root, 'keycloak-providers')
  const stranger = join(sandbox.root, 'stranger-repo')
  for (const folder of [other, stranger]) {
    mkdirSync(join(folder, 'src'), { recursive: true })
    git(folder, 'init', '-q', '-b', 'main')
    writeFileSync(join(folder, 'src', 'x.cs'), 'class X {}\n')
    git(folder, 'add', '.')
    git(folder, 'commit', '-q', '-m', 'seed')
  }
  const settingsFile = join(sandbox.userData, 'settings.json')
  const settings = JSON.parse(readFileSync(settingsFile, 'utf8'))
  settings.projects.push({ id: 'kc', name: 'Keycloak', folder: other })
  writeFileSync(settingsFile, JSON.stringify(settings))

  const dir = join(sandbox.claudeHome, 'projects', root.replace(/[^A-Za-z0-9]/g, '-'))
  mkdirSync(dir, { recursive: true })
  const edit = (id: string, minute: number, file: string, from: string, to: string) => [
    { type: 'assistant', timestamp: stamp(minute), message: { content: [{ type: 'tool_use', id, name: 'Edit', input: { file_path: file, old_string: from, new_string: to } }] } },
    { type: 'user', timestamp: stamp(minute + 1), message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } }
  ]
  const records = [
    { type: 'user', timestamp: stamp(0), message: { content: 'Add retry to the webhook sender' } },
    ...edit('e1', 2, join(root, 'a.txt'), 'one', 'one\ntwo'),
    ...edit('e2', 5, join(other, 'src', 'x.cs'), 'X', 'X2'),
    ...edit('e3', 8, join(stranger, 'src', 'x.cs'), 'X', 'X3'),
    { type: 'ai-title', aiTitle: 'Add retry to the sender' }
  ]
  writeFileSync(join(dir, `${SESSION_ID}.jsonl`), records.map((record) => JSON.stringify(record)).join('\n') + '\n')
  git(root, 'init', '-q', '-b', 'main')
  writeFileSync(join(root, 'a.txt'), 'one\n')
  git(root, 'add', '.')
  git(root, 'commit', '-q', '-m', 'add a.txt')
  writeFileSync(join(root, 'a.txt'), 'one\ntwo\n')
  return { other, stranger }
}

async function resumeSeeded(page: Page): Promise<void> {
  await page.keyboard.press('Control+Shift+R')
  await expect(page.locator('.rp-row')).toHaveCount(1)
  await page.keyboard.press('Enter')
  await expect(page.locator('.pane')).toHaveCount(1, { timeout: 20_000 })
}

test('the location button, Open in sessions, linked repos and Send to agent work from the session records', async () => {
  test.setTimeout(150_000)
  const sandbox = createSandbox()
  seed(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    await page.setViewportSize({ width: 1400, height: 900 })
    await resumeSeeded(page)
    await page.locator('#files-button').click()
    await expect(page.locator('#files-view')).toBeVisible()

    await expect(page.locator('#files-location .files-loc-project')).toHaveText('Smoke')
    await expect(page.locator('#files-location .files-loc-branch')).toHaveText('main · Smoke Project')
    await expect(page.locator('#files-project, #files-checkout')).toHaveCount(0)

    await expect(page.locator('#files-open-list .files-flat[data-path="a.txt"] .files-flat-who')).toContainText('Smoke', { timeout: 20_000 })
    await expect(page.locator('#files-sec-open')).toHaveAttribute('aria-label', 'Open in sessions, 1')

    await page.locator('#files-sec-changes').click()
    await expect(page.locator('#files-sec-changes')).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('#files-changes-list')).toBeHidden()
    await page.locator('#files-sec-changes').click()
    await expect(page.locator('#files-changes-list')).toBeVisible()

    await expect.poll(async () => {
      await page.locator('#files-location').click()
      const found = await page.locator('.ctx-heading', { hasText: 'Linked repos' }).count()
      await page.keyboard.press('Escape')
      return found
    }, { timeout: 30_000 }).toBe(1)
    await page.locator('#files-location').click()
    const menu = page.locator('.ctx-menu:not(.leaving)')
    await expect(menu.locator('.ctx-heading')).toContainText(['Projects', 'Checkouts of Smoke', 'Linked repos'])
    const stranger = menu.locator('.ctx-item', { hasText: 'stranger-repo' })
    await expect(stranger).toBeDisabled()
    await expect(stranger).toContainText('Not a project')
    await expect(menu.locator('.ctx-item', { hasText: 'Copy path' })).toBeVisible()
    await expect(menu.locator('.ctx-item', { hasText: 'Reveal in File Explorer' })).toBeVisible()
    await page.screenshot({ path: 'test-results/screens/174-files-location.png' })
    await menu.locator('.ctx-item', { hasText: 'keycloak-providers' }).click()
    await expect(page.locator('#files-location .files-loc-project')).toHaveText('Keycloak')
    await expect(page.locator('.files-row[data-path="src"]')).toBeVisible()
    await page.locator('#files-location').click()
    await page.locator('.ctx-menu:not(.leaving) .ctx-item', { has: page.locator('.ctx-label', { hasText: /^Smoke$/ }) }).click()
    await expect(page.locator('#files-location .files-loc-project')).toHaveText('Smoke')

    await page.locator('.files-flat[data-path="a.txt"]').first().click()
    await expect(page.locator('.files-tab.active')).toContainText('a.txt')
    await page.locator('#files-send').click()
    await expect(page.getByRole('menuitem', { name: 'Smoke', exact: true })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'New session with this file…' })).toBeVisible()
    await page.getByRole('menuitem', { name: 'Copy as @mention' }).click()
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('@a.txt')

    await page.locator('#files-more').click()
    const items = await page.getByRole('menuitem').allTextContents()
    expect(items[0]).toContain('Edit')
    expect(items[items.length - 1]).toBe('Delete a.txt…')
    await page.keyboard.press('Escape')
  } finally {
    await closeApp(app)
  }
})

test('Changes marks the added lines with the session that wrote them, and the inspector lists agents then commits', async () => {
  test.setTimeout(150_000)
  const sandbox = createSandbox()
  seed(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    await page.setViewportSize({ width: 1400, height: 900 })
    await resumeSeeded(page)
    await page.locator('#files-button').click()
    await expect(page.locator('#files-open-list .files-flat[data-path="a.txt"]')).toBeVisible({ timeout: 20_000 })
    await page.locator('#files-open-list .files-flat[data-path="a.txt"]').click()
    await page.locator('#files-changes').click()
    await expect(page.locator('#files-changes')).toContainText('+1')
    const mark = page.locator('.files-editor:not([hidden]) .cm-blame-mark')
    await expect(mark.first()).toBeVisible({ timeout: 20_000 })
    await expect(mark.first()).toHaveAttribute('title', /Smoke: Add retry to the webhook sender/)
    await expect(page.locator('.files-editor:not([hidden]) .cm-review-add').first()).toBeVisible()

    await expect(page.locator('#files-side')).toBeVisible()
    await page.locator('#files-tab-activity').click()
    await expect(page.locator('#files-activity .files-side-row.activity')).toContainText(['Smoke'])
    await expect(page.locator('#files-activity .files-side-row.activity')).toContainText('Live')
    await expect(page.locator('#files-activity .files-side-row.commit')).toContainText('add a.txt')
    await page.screenshot({ path: 'test-results/screens/174-files-activity.png' })

    await page.locator('#files-inspector-toggle').click()
    await expect(page.locator('#files-view')).toHaveClass(/no-inspector/)
    await expect(page.locator('#files-side')).toBeHidden()
    await page.locator('#files-inspector-toggle').click()
    await expect(page.locator('#files-side')).toBeVisible()
    await expect(page.locator('#files-tab-activity')).toHaveAttribute('aria-selected', 'true')

    await page.setViewportSize({ width: 1024, height: 728 })
    await expect(page.locator('#files-side')).toBeHidden()
    await expect(page.locator('#files-inspector-toggle')).toBeHidden()
  } finally {
    await closeApp(app)
  }
})
