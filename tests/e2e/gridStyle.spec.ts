import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { APP_VERSION, closeApp, createSandbox, feedTerminal, launchApp } from './helpers'

const APPROVAL = [
  '  Bash command',
  '',
  '    npm run migrate -- --env dev',
  '    Apply the pending migration to the dev database',
  '',
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  "   2. Yes, and don't ask again for npm run commands in this folder",
  '   3. No, and tell Claude what to do differently (esc)',
  ''
].join('\r\n')

async function addPanes(page: Page, count: number): Promise<void> {
  const have = await page.locator('.pane').count()
  for (let index = have; index < count; index += 1) {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    await expect(page.locator('.pane')).toHaveCount(index + 1, { timeout: 20_000 })
  }
}

const boxes = async (page: Page) => Promise.all((await page.locator('.grid > .pane').all()).map((pane) => pane.boundingBox()))

async function chooseGridStyle(page: Page, label: 'Calm focus' | 'Mission control'): Promise<void> {
  await page.locator('#layouts-button').click()
  await page.locator('.layouts-grid-style').getByRole('button', { name: label, exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.layouts-popover')).toHaveCount(0)
}

test('the sessions grid switches between calm focus and mission control, and the choice persists', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await addPanes(page, 3)
    const focused = page.locator('.grid > .pane.focused')
    await expect(focused).toHaveCount(1)
    const focusedWidth = (await focused.boundingBox())!.width
    const siblings = (await boxes(page)).filter((box) => box && Math.abs(box.width - focusedWidth) > 2).map((box) => box!)
    expect(siblings.length).toBe(2)
    expect(focusedWidth).toBeGreaterThan(siblings[0].width * 1.2)
    expect(Math.abs(siblings[0].width - siblings[1].width)).toBeLessThan(2)

    await chooseGridStyle(page, 'Mission control')
    await expect(page.locator('.grid.tiles')).toHaveCount(1)
    const tiles = (await boxes(page)).map((box) => box!)
    expect(Math.abs(tiles[0].width - tiles[1].width)).toBeLessThan(2)
    expect(Math.abs(tiles[1].width - tiles[2].width)).toBeLessThan(2)
    expect(Math.abs(tiles[0].y - tiles[2].y)).toBeLessThan(2)
    await expect.poll(() => JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8')).gridStyle).toBe('tiles')

    await chooseGridStyle(page, 'Calm focus')
    await expect(page.locator('.grid.focus-style')).toHaveCount(1)
    await expect(page.locator('.grid > .pane.focused')).toHaveCount(1)
    const again = (await page.locator('.grid > .pane.focused').boundingBox())!
    expect(again.width).toBeGreaterThan(siblings[0].width * 1.2)
    await expect.poll(() => JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8')).gridStyle).toBe('focus')

    await page.locator('#settings-button').click()
    await page.locator('#settings-tab-appearance').click()
    const settingsGrid = page.locator('.settings-grid-style')
    await expect(settingsGrid.getByRole('button', { name: 'Calm focus' })).toHaveAttribute('aria-pressed', 'true')
    await settingsGrid.getByRole('button', { name: 'Mission control' }).click()
    await expect(page.locator('.grid.tiles')).toHaveCount(1)
    await expect.poll(() => JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8')).gridStyle).toBe('tiles')
  } finally {
    await closeApp(app)
  }
})

test('a session that needs you shows the command it wants to run, with Allow, Allow always and Deny', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await addPanes(page, 2)
    const first = page.locator('.pane').first()
    const termId = (await first.locator('.term-host').first().getAttribute('data-term-id')) ?? ''
    await expect(async () => {
      await feedTerminal(page, termId, `\r\n${APPROVAL}`)
      await expect(first).toHaveAttribute('data-state', 'needs', { timeout: 1500 })
    }).toPass({ timeout: 30_000 })
    const card = first.locator('.pane-permission')
    await expect(card).toBeVisible()
    await expect(card.locator('.pane-permission-tool')).toHaveText('Bash')
    await expect(card.locator('.pane-permission-command')).toContainText('npm run migrate -- --env dev')
    await expect(card.getByRole('button', { name: /^Allow Claude to continue$/ })).toBeVisible()
    await expect(card.getByRole('button', { name: 'Allow Claude always' })).toBeVisible()
    await expect(card.getByRole('button', { name: /^Deny Claude$/ })).toBeVisible()

  } finally {
    await closeApp(app)
  }
})

const SHOTS = process.env.DAWSHA_SHOTS ?? ''
const THEMES = [
  ['dark', undefined],
  ['light', 'dawsha-daylight']
] as const

for (const [mode, themeId] of THEMES) {
  for (const [style, label] of [
    ['focus', 'Calm focus'],
    ['tiles', 'Mission control']
  ] as const) {
    for (const count of [3, 5]) {
      test(`screenshot: ${style} with ${count} panes, ${mode}`, async () => {
        test.skip(SHOTS === '', 'set DAWSHA_SHOTS to write the grid screenshots')
        const sandbox = createSandbox()
        const settings = {
          version: 2,
          lastSeenVersion: APP_VERSION,
          dimOtherPanes: true,
          projects: [{ id: 'smoke', name: 'Smoke', folder: sandbox.projectFolder }],
          ...(themeId ? { theme: { id: themeId } } : {})
        }
        writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify(settings), 'utf8')
        const { app, page } = await launchApp(sandbox)
        try {
          await addPanes(page, count)
          const needy = page.locator('.pane').first()
          const termId = (await needy.locator('.term-host').first().getAttribute('data-term-id')) ?? ''
          await expect(async () => {
            await feedTerminal(page, termId, `\r\n${APPROVAL}`)
            await expect(needy).toHaveAttribute('data-state', 'needs', { timeout: 1500 })
          }).toPass({ timeout: 30_000 })
          await chooseGridStyle(page, label)
          await expect(page.locator(style === 'focus' ? '.grid.focus-style' : '.grid.tiles')).toHaveCount(1)
          mkdirSync(SHOTS, { recursive: true })
          await page.screenshot({ path: join(SHOTS, `grid-${style}-${count}-${mode}.png`) })
        } finally {
          await closeApp(app)
        }
      })
    }
  }
}
