import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { bufferText, closeApp, closeSettings, createSandbox, launchApp, openSettings, type Sandbox } from './helpers'

const SLOW = 30_000

interface ReplayState { position: number; total: number; playing: boolean; applied: number; skipIdle: boolean }

interface ReplayHook {
  bufferText(): string
  selection(): string
  state(): ReplayState | null
}

const replayBuffer = (page: Page): Promise<string> =>
  page.evaluate(() => (window as unknown as { __replay: ReplayHook }).__replay.bufferText())

const replaySelection = (page: Page): Promise<string> =>
  page.evaluate(() => (window as unknown as { __replay: ReplayHook }).__replay.selection())

const replayState = (page: Page): Promise<ReplayState | null> =>
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

function recordingOn(sandbox: Sandbox): Sandbox {
  const file = join(sandbox.userData, 'settings.json')
  const settings = JSON.parse(readFileSync(file, 'utf8'))
  writeFileSync(file, JSON.stringify({ ...settings, recordings: { enabled: true, keepDays: 14, maxMegabytes: 1024 } }), 'utf8')
  return sandbox
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
  const sandbox = recordingOn(createSandbox())
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

    // Escape from the Skip idle checkbox still closes, and a reopened replay follows the box.
    await page.getByRole('button', { name: 'Pane actions' }).click()
    await page.getByRole('menuitem', { name: 'Replay session' }).click()
    await expect.poll(async () => (await replayState(page))?.skipIdle, { timeout: SLOW }).toBe(true)
    await page.locator('#replay-skip-idle').uncheck()
    await expect.poll(async () => (await replayState(page))?.skipIdle).toBe(false)
    await expect(page.locator('#replay-skip-idle')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.locator('.replay-view')).toBeHidden()
    await page.getByRole('button', { name: 'Pane actions' }).click()
    await page.getByRole('menuitem', { name: 'Replay session' }).click()
    await expect.poll(async () => (await replayState(page))?.total ?? 0, { timeout: SLOW }).toBeGreaterThan(1)
    await expect(page.locator('#replay-skip-idle')).not.toBeChecked()
    expect((await replayState(page))?.skipIdle).toBe(false)
  } finally {
    await closeApp(app)
  }
})

test('the palette lists recordings, filters them and opens one', async () => {
  const sandbox = recordingOn(createSandbox())
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

test('recording is off by default; turning it on records new sessions and turning it off stops them', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    const first = await startSession(page)
    await runCommand(page, first, 'echo FIRST-RUN', /^FIRST-RUN$/m)
    await new Promise((resolve) => setTimeout(resolve, 1000))
    expect(castFiles(sandbox)).toHaveLength(0)

    await openSettings(page, 'general')
    await expect(page.locator('#recordings-enabled')).toHaveAttribute('aria-checked', 'false')
    await expect(page.locator('#recordings-days')).toHaveValue('14')
    await expect(page.locator('#recordings-size')).toHaveValue('1024')
    await page.locator('#recordings-enabled').click()
    await expect
      .poll(() => JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8')).recordings?.enabled, { timeout: SLOW })
      .toBe(true)
    const days = page.locator('#recordings-days')
    // Type into the number box as a person does; fill() on a number input is not reliable across runners.
    await days.click()
    await days.press('Control+a')
    await days.pressSequentially('30')
    await expect(days).toHaveValue('30')
    await days.press('Tab')
    await expect
      .poll(() => JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8')).recordings?.keepDays, { timeout: SLOW })
      .toBe(30)
    // Clear the box the way a person does; fill('') on a number input can leave a transient 0 behind.
    await days.click()
    await days.press('Control+a')
    await days.press('Backspace')
    await expect(days).toHaveValue('')
    await days.press('Tab')
    await expect(days).toHaveValue('30')
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8')).recordings?.keepDays).toBe(30)
    await closeSettings(page)

    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    await expect(page.locator('.pane')).toHaveCount(2)
    const second = (await page.locator('.term-host.active').last().getAttribute('data-term-id'))!
    await expect.poll(() => bufferText(page, second), { timeout: SLOW }).toMatch(/>s*$/m)
    await page.locator('.term-host.active').last().click()
    await runCommand(page, second, 'echo SECOND-RUN', /^SECOND-RUN$/m)
    await expect.poll(() => castFiles(sandbox).length, { timeout: SLOW }).toBe(1)

    await openSettings(page, 'general')
    await page.locator('#recordings-enabled').click()
    await expect
      .poll(() => JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8')).recordings?.enabled, { timeout: SLOW })
      .toBe(false)
    await closeSettings(page)
    await page.locator('.term-host.active').last().click()
    await runCommand(page, second, 'echo THIRD-RUN', /^THIRD-RUN$/m)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(readFileSync(castFiles(sandbox)[0], 'utf8')).not.toContain('THIRD-RUN')
  } finally {
    await closeApp(app)
  }
})

test('with recording off, Replay shows what recording stores and a Turn on recording button', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await startSession(page)
    await page.getByRole('button', { name: 'Pane actions' }).click()
    await page.getByRole('menuitem', { name: 'Replay session' }).click()
    await expect(page.locator('.replay-picker')).toBeVisible()
    await expect(page.locator('.replay-empty')).toContainText('everything each terminal prints')
    await expect(page.locator('.replay-empty')).toContainText('14 days')
    await expect(page.locator('.replay-empty')).toContainText('on this PC')
    await page.locator('#replay-turn-on').click()
    await expect
      .poll(() => JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8')).recordings?.enabled, { timeout: SLOW })
      .toBe(true)
    await expect(page.locator('.replay-picker .palette-empty')).toContainText('No recordings yet')
  } finally {
    await closeApp(app)
  }
})

test('Pause recording stops capturing one terminal, marks it, and Resume continues', async () => {
  const sandbox = recordingOn(createSandbox())
  const { app, page } = await launchApp(sandbox)
  try {
    const id = await startSession(page)
    await runCommand(page, id, 'echo VISIBLE-ONE', /^VISIBLE-ONE$/m)
    await page.getByRole('button', { name: 'Pane actions' }).click()
    await page.getByRole('menuitem', { name: 'Pause recording' }).click()
    await expect(page.locator('.toast')).toContainText('Recording paused')
    await page.locator('.term-host.active').click()
    await runCommand(page, id, 'echo SECRET-HIDDEN', /^SECRET-HIDDEN$/m)
    await page.getByRole('button', { name: 'Pane actions' }).click()
    await page.getByRole('menuitem', { name: 'Resume recording' }).click()
    await page.locator('.term-host.active').click()
    await runCommand(page, id, 'echo VISIBLE-TWO', /^VISIBLE-TWO$/m)
    await expect.poll(() => castFiles(sandbox).length, { timeout: SLOW }).toBe(1)
    await expect.poll(() => readFileSync(castFiles(sandbox)[0], 'utf8'), { timeout: SLOW }).toContain('VISIBLE-TWO')
    const text = readFileSync(castFiles(sandbox)[0], 'utf8')
    expect(text).toContain('VISIBLE-ONE')
    expect(text).not.toContain('SECRET-HIDDEN')
    expect(text).toContain('"paused"')
    expect(text).toContain('"resumed"')
  } finally {
    await closeApp(app)
  }
})

test('Delete all recordings names the count and size, cancel keeps them, confirm removes them', async () => {
  const sandbox = recordingOn(createSandbox())
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
