import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { bufferText, closeApp, closeSettings, createSandbox, launchApp, openSettings, type Sandbox } from './helpers'

const SLOW = 30_000

interface ReplayHook {
  bufferText(): string
  selection(): string
  state(): { position: number; total: number; playing: boolean; applied: number } | null
}

const replayBuffer = (page: Page): Promise<string> =>
  page.evaluate(() => (window as unknown as { __replay: ReplayHook }).__replay.bufferText())

const replaySelection = (page: Page): Promise<string> =>
  page.evaluate(() => (window as unknown as { __replay: ReplayHook }).__replay.selection())

const replayState = (page: Page): Promise<{ position: number; total: number; playing: boolean; applied: number } | null> =>
  page.evaluate(() => (window as unknown as { __replay: ReplayHook }).__replay.state())

function castFiles(sandbox: Sandbox): string[] {
  const root = join(sandbox.userData, 'recordings')
  if (!existsSync(root)) return []
  return readdirSync(root).flatMap((day) =>
    readdirSync(join(root, day)).filter((name) => name.endsWith('.cast')).map((name) => join(root, day, name))
  )
}

function endedSidecars(sandbox: Sandbox): number {
  return castFiles(sandbox).filter((file) => {
    try {
      return typeof JSON.parse(readFileSync(file.replace(/\.cast$/, '.json'), 'utf8')).endedAt === 'number'
    } catch {
      return false
    }
  }).length
}

async function startSession(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
  const host = page.locator('.term-host.active')
  const id = (await host.getAttribute('data-term-id'))!
  await expect.poll(() => bufferText(page, id), { timeout: SLOW }).toMatch(/>\s*$/m)
  await host.click()
  return id
}

async function runCommand(page: Page, id: string, command: string, expected: RegExp): Promise<void> {
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
  await expect.poll(() => bufferText(page, id), { timeout: SLOW }).toMatch(expected)
}

async function recordKnownSession(page: Page, sandbox: Sandbox): Promise<string> {
  const id = await startSession(page)
  await runCommand(page, id, 'echo REPLAY-ALPHA-7', /^REPLAY-ALPHA-7$/m)
  await runCommand(page, id, 'ping -n 3 127.0.0.1 >nul', />\s*$/)
  await runCommand(page, id, 'echo REPLAY-OMEGA-9', /^REPLAY-OMEGA-9$/m)
  await page.keyboard.type('exit')
  await page.keyboard.press('Enter')
  await expect.poll(() => endedSidecars(sandbox), { timeout: SLOW }).toBe(1)
  return id
}

test('an exited session is replayed from its pane menu: seek, search and jump, play and go back', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await recordKnownSession(page, sandbox)
    expect(castFiles(sandbox)).toHaveLength(1)
    const cast = readFileSync(castFiles(sandbox)[0], 'utf8')
    expect(cast.split('\n')[0]).toContain('"version":2')
    expect(cast).toContain('REPLAY-OMEGA-9')

    await page.getByRole('button', { name: 'Pane actions' }).click()
    await page.getByRole('menuitem', { name: 'Replay session' }).click()
    await expect(page.locator('.replay-view')).toBeVisible()
    await expect(page.locator('.replay-readonly')).toContainText('Read only')
    await expect.poll(async () => (await replayState(page))?.total ?? 0, { timeout: SLOW }).toBeGreaterThan(1)

    const slider = page.getByRole('slider', { name: 'Playback position' })
    await slider.focus()
    await page.keyboard.press('End')
    await expect.poll(() => replayBuffer(page), { timeout: SLOW }).toContain('REPLAY-OMEGA-9')
    await page.keyboard.press('Home')
    await expect.poll(() => replayBuffer(page), { timeout: SLOW }).not.toContain('REPLAY-ALPHA-7')

    await page.locator('#replay-search').fill('REPLAY-ALPHA')
    const first = page.locator('.replay-result').first()
    await expect(first).toBeVisible({ timeout: SLOW })
    await first.click()
    await expect.poll(() => replayBuffer(page), { timeout: SLOW }).toContain('REPLAY-ALPHA')
    expect(await replayBuffer(page)).not.toContain('REPLAY-OMEGA')
    await expect.poll(() => replaySelection(page), { timeout: SLOW }).toBe('REPLAY-ALPHA')

    await page.locator('#replay-search').fill('REPLAY-OMEGA-9')
    await expect(page.locator('.replay-result').first()).toContainText('OMEGA')
    await page.locator('.replay-result').first().click()
    await expect.poll(() => replayBuffer(page), { timeout: SLOW }).toContain('REPLAY-OMEGA-9')

    await slider.focus()
    await page.keyboard.press('Home')
    await expect.poll(() => replayBuffer(page), { timeout: SLOW }).not.toContain('REPLAY-OMEGA')
    await page.locator('[data-speed="16"]').click()
    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await expect.poll(() => replayBuffer(page), { timeout: SLOW }).toContain('REPLAY-OMEGA-9')
    await expect.poll(async () => (await replayState(page))?.playing, { timeout: SLOW }).toBe(false)

    await page.locator('#replay-copy').click()
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toContain('REPLAY-OMEGA-9')

    await page.keyboard.press('Escape')
    await expect(page.locator('.replay-view')).toBeHidden()
    await expect(page.locator('.pane')).toHaveCount(1)
  } finally {
    await closeApp(app)
  }
})

test('the palette lists recordings, filters them and opens one', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await recordKnownSession(page, sandbox)
    await page.locator('body').click()
    await page.keyboard.press('Control+K')
    await page.locator('#palette-input').fill('Replay a session')
    await expect(page.locator('.palette-row[data-command="replay.open"]')).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page.locator('.replay-picker')).toBeVisible()
    await expect(page.locator('.replay-row')).toHaveCount(1)
    await expect(page.locator('.replay-row')).toContainText('Smoke')
    await page.locator('#replay-picker-input').fill('nothing like this')
    await expect(page.locator('.replay-picker .palette-empty')).toContainText('No recordings match')
    await page.locator('#replay-picker-input').fill('smoke claude')
    await expect(page.locator('.replay-row')).toHaveCount(1)
    await page.keyboard.press('Enter')
    await expect(page.locator('.replay-view')).toBeVisible()
    await expect.poll(async () => (await replayState(page))?.total ?? 0, { timeout: SLOW }).toBeGreaterThan(1)
    await page.locator('#replay-back').click()
    await expect(page.locator('.replay-view')).toBeHidden()
  } finally {
    await closeApp(app)
  }
})

test('turning Record sessions off stops new recordings and the choice persists', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    const first = await startSession(page)
    await runCommand(page, first, 'echo FIRST-RUN', /^FIRST-RUN$/m)
    await expect.poll(() => castFiles(sandbox).length, { timeout: SLOW }).toBe(1)

    await openSettings(page, 'general')
    await expect(page.locator('#recordings-enabled')).toBeChecked()
    await expect(page.locator('#recordings-days')).toHaveValue('14')
    await expect(page.locator('#recordings-size')).toHaveValue('1024')
    await page.locator('#recordings-enabled').uncheck()
    await expect
      .poll(() => JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8')).recordings?.enabled, { timeout: SLOW })
      .toBe(false)
    await closeSettings(page)

    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    await expect(page.locator('.pane')).toHaveCount(2)
    const second = (await page.locator('.term-host.active').last().getAttribute('data-term-id'))!
    await expect.poll(() => bufferText(page, second), { timeout: SLOW }).toMatch(/>\s*$/m)
    await page.locator('.term-host.active').last().click()
    await runCommand(page, second, 'echo SECOND-RUN', /^SECOND-RUN$/m)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(castFiles(sandbox)).toHaveLength(1)
    expect(readFileSync(castFiles(sandbox)[0], 'utf8')).not.toContain('SECOND-RUN')
  } finally {
    await closeApp(app)
  }
})

test('Delete all recordings names the count and size, cancel keeps them, confirm removes them', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await recordKnownSession(page, sandbox)
    await openSettings(page, 'general')
    await expect(page.locator('#recordings-usage')).toContainText('1 recording', { timeout: SLOW })
    await page.locator('#recordings-delete').click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('1 recording (')
    await expect(dialog.locator('[data-confirm]')).toContainText('Delete 1 recording (')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    expect(castFiles(sandbox)).toHaveLength(1)

    await page.locator('#recordings-delete').click()
    await page.getByRole('alertdialog').locator('[data-confirm]').click()
    await expect.poll(() => castFiles(sandbox).length, { timeout: SLOW }).toBe(0)
    await expect(page.locator('#recordings-usage')).toContainText('0 recordings', { timeout: SLOW })
  } finally {
    await closeApp(app)
  }
})
