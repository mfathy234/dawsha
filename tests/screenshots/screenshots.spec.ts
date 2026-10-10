import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { expect, test } from '@playwright/test'
import { createFakeTools } from '../support/fakeTools'
import { closeApp, createSandbox, launchApp, runCli } from '../e2e/helpers'
import { composeCliImage, writeHistory, type CliRun } from './resumeFixtures'
import {
  OUT,
  DEMO_ROOT,
  PROJECTS,
  folder,
  seed,
  demoEnv,
  resize,
  writeClaudeSession,
  writeOps,
  writeCodex,
  writeGemini,
  settle
} from './harness'

test.afterAll(() => rmSync(DEMO_ROOT, { recursive: true, force: true }))

test('generates the README screenshots from fake projects only', async () => {
  mkdirSync(OUT, { recursive: true })
  const sandbox = createSandbox()
  seed(sandbox, true)
  for (const [project, agent, name] of [
    ['acme-web', 'claude', 'Review'],
    ['billing-api', 'codex', 'Plan'],
    ['docs-site', 'gemini', 'Docs']
  ]) {
    const demoSkill = join(folder(project), `.${agent}`, 'skills', name)
    mkdirSync(demoSkill, { recursive: true })
    writeFileSync(join(demoSkill, 'SKILL.md'), `# ${name}\n`)
  }
  for (const [project, agent, file] of [
    ['acme-web', 'claude', 'reviewer.md'],
    ['billing-api', 'codex', 'architect.toml'],
    ['docs-site', 'gemini', 'writer.md']
  ]) {
    const demoAgent = join(folder(project), `.${agent}`, 'agents', file)
    mkdirSync(join(demoAgent, '..'), { recursive: true })
    writeFileSync(demoAgent, `# ${file}\n`)
  }
  writeHistory(sandbox, folder)
  const { app, page } = await launchApp(sandbox, { ...demoEnv(), DAWSHA_SHARED_HOME: join(sandbox.root, 'shared-home') })
  try {
    await resize(app)
    for (const project of PROJECTS) {
      const agent = project.defaultAgent[0].toUpperCase() + project.defaultAgent.slice(1)
      await page.getByRole('button', { name: `New ${agent} session in ${project.name}`, exact: true }).click()
    }
    await expect(page.locator('.pane')).toHaveCount(4)
    writeClaudeSession(sandbox, 'acme-web', 'Add dark mode toggle', 'busy')
    writeClaudeSession(sandbox, 'billing-api', 'Refactor invoice export', 'idle')
    writeOps(sandbox)
    writeCodex(sandbox)
    await writeGemini(sandbox, page)
    for (const title of ['Add dark mode toggle', 'Refactor invoice export', 'Fix flaky login test', 'Rewrite the getting started guide']) {
      await expect(page.locator('.pane-title', { hasText: title })).toHaveCount(1, { timeout: 20_000 })
    }
    await expect(page.locator('.info-plan')).toHaveText('▸ 3/6', { timeout: 20_000 })
    await settle(page, 2500)
    await page.screenshot({ path: join(OUT, 'grid.png') })

    const first = page.locator('.pane').first()
    await first.getByRole('button', { name: 'Maximize pane' }).click()
    await page.locator('.pane-info').first().click({ position: { x: 4, y: 10 } })
    await expect(page.locator('.pane-details:visible')).toHaveCount(1)
    await settle(page)
    await page.screenshot({ path: join(OUT, 'focus-details.png') })
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(page.locator('.pane.maximized')).toHaveCount(0)

    await page.locator('.agents-toggle').first().click()

    await page.getByRole('button', { name: 'Skills', exact: true }).click()
    await expect(page.locator('.skill-row')).toHaveCount(3)
    await settle(page, 800)
    await page.screenshot({ path: join(OUT, 'skills.png') })
    await page.getByRole('button', { name: 'Installed agents' }).click()
    await expect(page.locator('.skill-row')).toHaveCount(3)
    await settle(page, 400)
    await page.screenshot({ path: join(OUT, 'installed-agents.png') })
    await page.getByRole('button', { name: 'Skills', exact: true }).click()
    await expect(page.locator('.agents-drawer:visible')).toHaveCount(1)
    await settle(page)
    await page.screenshot({ path: join(OUT, 'agents-drawer.png') })
    await page.locator('.agents-toggle').first().click()

    await page.locator('#projects-button').click()
    await expect(page.locator('.projects-view')).toBeVisible()
    await settle(page, 800)
    await page.screenshot({ path: join(OUT, 'projects.png') })
    await page.locator('#projects-button').click()

    await page.keyboard.press('Control+Shift+R')
    await expect(page.locator('.rp-row')).toHaveCount(8, { timeout: 20_000 })
    await page.locator('.rp-row').first().hover()
    await settle(page, 800)
    await page.mouse.move(700, 300)
    await page.screenshot({ path: join(OUT, 'resume-picker.png') })
    await page.keyboard.press('Escape')
    await expect(page.locator('.resume-picker')).toHaveCount(0)

    await page.getByRole('button', { name: 'Theme' }).click()
    await page.locator('#theme-tokyo-night').click()
    await expect(page.locator('.theme-picker')).toBeVisible()
    await settle(page, 1200)
    await page.screenshot({ path: join(OUT, 'themes.png') })
    await page.locator('#theme-grid-dark').click()
    await page.keyboard.press('Escape')
    await expect(page.locator('.theme-picker')).toHaveCount(0)

    const runs: CliRun[] = []
    const demoCwd = folder('acme-web')
    for (const args of [['ls'], ['start', 'billing-api', '--agent', 'codex'], ['sessions', 'acme-web']]) {
      const result = await runCli(sandbox, args, demoCwd)
      expect(result.code).toBe(0)
      runs.push({ cwd: demoCwd, command: `dawsha ${args.join(' ')}`, out: result.out })
    }
    await expect(page.locator('.pane')).toHaveCount(5)
    await expect(page.locator('.pane-header .agent-mark.codex')).toHaveCount(2)
    await settle(page, 2000)
    await composeCliImage(page, await page.screenshot(), runs)
    await page.screenshot({ path: join(OUT, 'cli.png') })
  } finally {
    await closeApp(app)
  }

  const tools = createFakeTools(
    mkdtempSync(join(tmpdir(), 'dawsha-shots-tools-')),
    { claude: '2.1.294', codex: '0.156.1', gemini: null },
    { claude: '2.1.301', codex: '0.156.1', gemini: '0.9.1' }
  )
  const second = createSandbox()
  seed(second, false)
  const launched = await launchApp(second, {
    PATH: `${tools.pathEntry}${delimiter}${process.env.PATH ?? ''}`,
    DAWSHA_CLAUDE_COMMAND: tools.commands.claude,
    DAWSHA_CODEX_COMMAND: tools.commands.codex,
    DAWSHA_GEMINI_COMMAND: tools.commands.gemini
  })
  try {
    await resize(launched.app)
    await launched.page.locator('#agents-button').click()
    await expect(launched.page.locator('.tool-flag.update')).toBeVisible()
    await launched.page.locator('.tool-block[data-agent="gemini"]').getByRole('button', { name: 'Show command' }).click()
    await settle(launched.page, 800)
    await launched.page.screenshot({ path: join(OUT, 'agents.png') })
  } finally {
    await closeApp(launched.app)
  }

  const third = createSandbox({ empty: true })
  const first = await launchApp(third, {
    PATH: `${tools.pathEntry}${delimiter}${process.env.PATH ?? ''}`,
    DAWSHA_CLAUDE_COMMAND: tools.commands.claude,
    DAWSHA_CODEX_COMMAND: tools.commands.codex,
    DAWSHA_GEMINI_COMMAND: tools.commands.gemini
  })
  try {
    await resize(first.app)
    await expect(first.page.locator('.onboarding')).toBeVisible()
    await expect(first.page.locator('#ob-agents')).toContainText('installed')
    await settle(first.page, 800)
    await first.page.screenshot({ path: join(OUT, 'onboarding.png') })
  } finally {
    await closeApp(first.app)
  }
})

test('generates the update and what is new screenshots', async () => {
  mkdirSync(OUT, { recursive: true })
  const notes = [
    '### Added',
    '',
    '- A dark mode toggle in the acme-web settings page.',
    '- Faster project switching in billing-api.',
    '',
    '### Fixed',
    '',
    '- A pane no longer loses its title after a restart.'
  ].join('\n')
  const script = JSON.stringify({
    check: 'available',
    info: { version: '0.1.1', releaseDate: '2026-10-15T09:00:00.000Z', releaseNotes: notes }
  })
  const sandbox = createSandbox()
  seed(sandbox, true)
  const { app, page } = await launchApp(sandbox, {
    ...demoEnv(),
    DAWSHA_TEST_UPDATER: 'fake',
    DAWSHA_TEST_UPDATER_SCRIPT: script,
    DAWSHA_UPDATE_START_DELAY_MS: '200'
  })
  try {
    await resize(app)
    for (const project of PROJECTS.slice(0, 2)) {
      await page.getByRole('button', { name: `New Claude session in ${project.name}`, exact: true }).click()
    }
    await expect(page.locator('.pane')).toHaveCount(2)
    await expect(page.locator('#update-pill')).toHaveText('Update 0.1.1')
    await page.locator('#update-pill').click()
    await expect(page.locator('.update-popover')).toBeVisible()
    await settle(page, 1500)
    await page.screenshot({ path: join(OUT, 'update.png') })
  } finally {
    await closeApp(app)
  }

  const seen = createSandbox()
  seed(seen, true)
  const stored = JSON.parse(readFileSync(join(seen.userData, 'settings.json'), 'utf8'))
  writeFileSync(join(seen.userData, 'settings.json'), JSON.stringify({ ...stored, lastSeenVersion: '0.0.9' }), 'utf8')
  const launched = await launchApp(seen, demoEnv())
  try {
    await resize(launched.app)
    await expect(launched.page.locator('.whats-new')).toBeVisible()
    await settle(launched.page, 800)
    await launched.page.screenshot({ path: join(OUT, 'whats-new.png') })
  } finally {
    await closeApp(launched.app)
  }
})
