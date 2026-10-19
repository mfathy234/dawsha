import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { activeTermId, bufferText, closeApp, createSandbox, launchApp, type Sandbox } from '../e2e/helpers'
import {
  DEMO_ROOT,
  OUT,
  PROJECTS,
  demoEnv,
  folder,
  resize,
  seed,
  settle,
  writeClaudeSession,
  writeCodex,
  writeGemini,
  writeOps
} from './harness'
import { writeUsageDemo } from './usageFixtures'

const IDENTITY = ['-c', 'core.autocrlf=false', '-c', 'user.name=Demo User', '-c', 'user.email=demo@example.invalid']

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', [...IDENTITY, ...args], { cwd })
}

function prepareDemoRepo(): void {
  const repo = folder('acme-web')
  if (existsSync(join(repo, '.git'))) return
  mkdirSync(join(repo, 'src', 'context'), { recursive: true })
  mkdirSync(join(repo, 'src', 'components'), { recursive: true })
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'src', 'context', 'theme.tsx'), 'export const theme = "light"\n')
  writeFileSync(join(repo, 'src', 'components', 'Settings.tsx'), 'export const Settings = () => null\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'Initial commit')
  writeFileSync(join(repo, 'src', 'context', 'theme.tsx'), 'export const theme = localStorage.getItem("theme")\n')
  writeFileSync(join(repo, 'src', 'components', 'Settings.tsx'), 'export const Settings = () => <ThemeToggle />\n')
  writeFileSync(join(repo, 'src', 'components', 'ThemeToggle.tsx'), 'export const ThemeToggle = () => null\n')
  git(repo, 'switch', '-q', '-c', 'feature/dark-mode-toggle')
}

const pane = (projectId: string, agent: string) => ({ projectId, activeIndex: 0, fontSize: 15, tabs: [{ agent, label: agent }] })

function seedFeatures(sandbox: Sandbox): void {
  const path = join(sandbox.userData, 'settings.json')
  const stored = JSON.parse(readFileSync(path, 'utf8'))
  const layouts = [
    {
      id: 'l-morning',
      name: 'Morning',
      createdAt: 1,
      focusedIndex: 0,
      panes: [pane('acme-web', 'claude'), pane('billing-api', 'claude'), pane('mobile-shell', 'codex')]
    },
    { id: 'l-docs', name: 'Docs day', createdAt: 2, focusedIndex: 0, panes: [pane('docs-site', 'claude'), pane('docs-site', 'gemini')] }
  ]
  writeFileSync(path, JSON.stringify({ ...stored, layouts }), 'utf8')
}

test.afterAll(() => rmSync(DEMO_ROOT, { recursive: true, force: true }))

test('generates the palette, layouts, handoff and usage screenshots from fake projects only', async () => {
  mkdirSync(OUT, { recursive: true })
  const sandbox = createSandbox()
  seed(sandbox, true)
  prepareDemoRepo()
  seedFeatures(sandbox)
  writeUsageDemo(sandbox, Object.fromEntries(PROJECTS.map((project) => [project.name, folder(project.name)])))
  const { app, page } = await launchApp(sandbox, demoEnv())
  try {
    await resize(app)
    for (const project of PROJECTS) {
      const agent = project.defaultAgent[0].toUpperCase() + project.defaultAgent.slice(1)
      await page.getByRole('button', { name: `New ${agent} session in ${project.name}`, exact: true }).click()
    }
    await expect(page.locator('.pane')).toHaveCount(4)
    writeClaudeSession(sandbox, 'acme-web', 'Add dark mode toggle', 'busy')
    writeClaudeSession(sandbox, 'billing-api', 'Refactor invoice export', 'idle')
    writeOps(sandbox, true)
    writeCodex(sandbox)
    await writeGemini(sandbox, page)
    for (const title of ['Add dark mode toggle', 'Refactor invoice export', 'Fix flaky login test', 'Rewrite the getting started guide']) {
      await expect(page.locator('.pane-title', { hasText: title })).toHaveCount(1, { timeout: 20_000 })
    }
    await expect(page.locator('.info-plan')).toHaveText('▸ 3/6', { timeout: 20_000 })

    await page.getByRole('button', { name: 'Layouts' }).click()
    await expect(page.locator('.layout-row')).toHaveCount(2)
    await settle(page, 1200)
    await page.screenshot({ path: join(OUT, 'layouts.png') })
    await page.keyboard.press('Escape')
    await expect(page.locator('.layouts-popover')).toHaveCount(0)

    await page.keyboard.press('Control+k')
    await expect(page.locator('#palette-input')).toBeFocused()
    await page.keyboard.type('re')
    await expect(page.locator('.palette-group').first()).toBeVisible()
    await settle(page, 800)
    await page.screenshot({ path: join(OUT, 'palette.png') })
    await page.keyboard.press('Escape')
    await expect(page.locator('.palette')).toHaveCount(0)

    await page.locator('.pane').first().getByRole('button', { name: 'Pane actions' }).click()
    await page.getByRole('menuitem', { name: 'Continue in Codex' }).click()
    await expect(page.getByLabel('Handoff summary')).toHaveValue(/Files touched \(3\)/)
    await settle(page, 1000)
    await page.screenshot({ path: join(OUT, 'handoff.png') })
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.locator('.handoff-dialog')).toHaveCount(0)

    await page.locator('#usage-button').click()
    await expect(page.locator('.usage-col')).toHaveCount(7)
    await expect(page.locator('#usage-by-project tbody tr')).toHaveCount(4)
    await settle(page, 1200)
    await page.screenshot({ path: join(OUT, 'usage.png') })
  } finally {
    await closeApp(app)
  }
})

test('generates the compare screenshot from a fake repository', async () => {
  mkdirSync(OUT, { recursive: true })
  const sandbox = createSandbox()
  seed(sandbox, true)
  prepareDemoRepo()
  const { app, page } = await launchApp(sandbox, demoEnv())
  try {
    await resize(app)
    await page.keyboard.press('Control+Shift+a')
    const dialog = page.getByRole('dialog', { name: 'Ask two agents' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Ask both' })).toBeEnabled()
    await dialog.getByLabel('Prompt').fill('Why does the login test fail on CI but not locally?')
    await dialog.getByRole('button', { name: 'Ask both' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('.compare-group .pane')).toHaveCount(2)
    const first = await activeTermId(page)
    await expect.poll(() => bufferText(page, first), { timeout: 20_000 }).toContain('waitForURL')
    await settle(page, 2500)
    await page.screenshot({ path: join(OUT, 'compare.png') })
  } finally {
    await closeApp(app)
  }
})
