import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { APP_VERSION, closeApp, createSandbox, launchApp, openTerminalPicker, runCli, QUIT_BUDGET_MS } from './helpers'

const SCREENS = 'test-results/screens'
const readSettings = (userData: string): any => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))

const tab = (agent: string, extra: Record<string, unknown> = {}) => ({ agent, label: agent, ...extra })
const savedPane = (tabs: unknown[]) => ({ projectId: 'smoke', activeIndex: 0, fontSize: 18, tabs })

function seedLayouts(userData: string): void {
  const path = join(userData, 'settings.json')
  const stored = JSON.parse(readFileSync(path, 'utf8'))
  const layouts = [
    {
      id: 'l-morning',
      name: 'Morning',
      createdAt: 1,
      focusedIndex: 1,
      panes: [savedPane([tab('claude', { sessionId: 'abc-session' })]), savedPane([tab('codex'), tab('shell')])]
    },
    { id: 'l-docs', name: 'Docs day', createdAt: 2, focusedIndex: 0, panes: [savedPane([tab('gemini')])] },
    { id: 'l-lost', name: 'Lost', createdAt: 3, focusedIndex: 0, panes: [{ ...savedPane([tab('claude')]), projectId: 'removed' }] }
  ]
  writeFileSync(path, JSON.stringify({ ...stored, lastSeenVersion: APP_VERSION, layouts }), 'utf8')
}

test('saves, lists, renames and deletes layouts from the Layouts menu', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await page.locator('#view-button').click()
    await page.locator('#layouts-button').click()
    const popover = page.getByRole('dialog', { name: 'Saved layouts' })
    await expect(popover).toBeVisible()
    await expect(popover).toContainText('0 saved')
    await expect(popover.getByText('No layouts yet.')).toBeVisible()
    await expect(page.locator('#save-layout')).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(popover).toHaveCount(0)

    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    await expect(page.locator('.pane')).toHaveCount(1, { timeout: 20_000 })
    await openTerminalPicker(page.locator('.pane').first())
    await page.getByRole('menuitem', { name: 'Shell' }).click()
    await expect(page.locator('.tabs [role="tab"]')).toHaveText(['claude', 'shell'])

    await page.locator('#view-button').click()

    await page.locator('#layouts-button').click()
    await page.locator('#save-layout').click()
    const dialog = page.getByRole('dialog', { name: 'Save current layout' })
    await expect(dialog).toContainText('Saves 1 pane')
    await dialog.getByRole('button', { name: 'Save layout' }).click()
    await expect(dialog.getByRole('alert')).toHaveText('Enter a name.')
    await dialog.getByLabel('Layout name').fill('Morning')
    await page.screenshot({ path: join(SCREENS, '31-save-layout.png') })
    await dialog.getByRole('button', { name: 'Save layout' }).click()
    await expect(dialog).toHaveCount(0)
    await expect.poll(() => readSettings(sandbox.userData).layouts?.[0]?.name).toBe('Morning')
    const saved = readSettings(sandbox.userData).layouts[0]
    expect(saved.panes).toHaveLength(1)
    expect(saved.panes[0].tabs.map((t: any) => t.agent)).toEqual(['claude', 'shell'])
    expect(saved.panes[0].activeIndex).toBe(1)

    await page.locator('#view-button').click()

    await page.locator('#layouts-button').click()
    await expect(page.locator('.layout-row')).toHaveCount(1)
    await expect(page.locator('.layout-row')).toContainText('Morning')
    await expect(page.locator('.layout-row')).toContainText('1 pane')
    await expect(page.locator('.layouts-foot')).toContainText('dawsha open morning')
    await page.screenshot({ path: join(SCREENS, '32-layouts-menu.png') })

    await page.locator('#save-layout').click()
    await page.getByLabel('Layout name').fill('morning')
    await page.getByRole('button', { name: 'Save layout' }).click()
    await expect(page.getByRole('alert')).toHaveText("A layout named 'Morning' already exists.")
    await page.getByLabel('Layout name').fill('Docs day')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: 'Save current layout' })).toHaveCount(0)
    await expect.poll(() => readSettings(sandbox.userData).layouts.length).toBe(2)

    await page.locator('#view-button').click()

    await page.locator('#layouts-button').click()
    await page.getByRole('button', { name: 'Rename layout Docs day' }).click()
    const rename = page.getByRole('dialog', { name: 'Rename layout "Docs day"' })
    await expect(rename.getByLabel('New name')).toHaveValue('Docs day')
    await rename.getByLabel('New name').fill('Morning')
    await rename.getByRole('button', { name: 'Rename layout' }).click()
    await expect(rename.getByRole('alert')).toContainText('already exists')
    await rename.getByLabel('New name').fill('Docs')
    await rename.getByRole('button', { name: 'Rename layout' }).click()
    await expect.poll(() => readSettings(sandbox.userData).layouts.map((l: any) => l.name)).toEqual(['Morning', 'Docs'])

    await page.locator('#view-button').click()

    await page.locator('#layouts-button').click()
    await page.getByRole('button', { name: 'Delete layout Docs' }).click()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm.getByRole('heading')).toHaveText('Delete layout "Docs"?')
    await expect(confirm).toContainText('The layout with 1 pane will be removed. Your sessions and projects are not affected.')
    await page.screenshot({ path: join(SCREENS, '33-delete-layout.png') })
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    expect(readSettings(sandbox.userData).layouts).toHaveLength(2)
    await page.locator('#view-button').click()
    await page.locator('#layouts-button').click()
    await page.getByRole('button', { name: 'Delete layout Docs' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete "Docs"' }).click()
    await expect.poll(() => readSettings(sandbox.userData).layouts.map((l: any) => l.name)).toEqual(['Morning'])
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('opens a layout into an empty grid, asks before touching open panes and resumes stored sessions', async () => {
  const sandbox = createSandbox()
  seedLayouts(sandbox.userData)
  const { app, page } = await launchApp(sandbox)
  try {
    await page.locator('#view-button').click()
    await page.locator('#layouts-button').click()
    await expect(page.locator('.layout-row')).toHaveCount(3)
    await expect(page.locator('.layout-row').nth(2)).toContainText('removed project')
    await page.getByRole('button', { name: 'Open layout Morning' }).click()
    await expect(page.locator('.pane')).toHaveCount(2, { timeout: 20_000 })
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await expect(page.locator('.pane-header .agent-mark.claude')).toHaveCount(1)
    await expect(page.locator('.pane-header .agent-mark.codex')).toHaveCount(1)
    await expect(page.locator('.pane').first().locator('.chip-resumed')).toBeVisible()
    await expect(page.locator('.pane').nth(1).locator('.chip-resumed')).toBeHidden()
    await expect(page.locator('.pane').nth(1).locator('.tabs [role="tab"]')).toHaveText(['codex', 'shell'])
    await expect(page.locator('.pane').nth(1)).toHaveClass(/focused/)
    await expect.poll(() => readSettings(sandbox.userData).workspace?.panes?.length).toBe(2)
    expect(readSettings(sandbox.userData).workspace.panes[0].tabs[0].sessionId).toBe('abc-session')
    expect(readSettings(sandbox.userData).workspace.panes[0].fontSize).toBe(18)

    await page.keyboard.press('Control+k')
    await expect(page.locator('#palette-input')).toBeFocused()
    await page.keyboard.type('docs day')
    await expect(page.locator('.palette-group')).toHaveText(['Layouts'])
    await expect(page.locator('.palette-row .palette-hint')).toHaveText('dawsha open docs-day')
    await page.keyboard.press('Enter')
    const choice = page.getByRole('alertdialog')
    await expect(choice.getByRole('heading')).toHaveText('Replace the current panes?')
    await expect(choice).toContainText("Opening 'Docs day' while 2 panes are open.")
    await page.screenshot({ path: join(SCREENS, '34-replace-panes.png') })
    await choice.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.locator('.pane')).toHaveCount(2, { timeout: 20_000 })

    await page.locator('#view-button').click()

    await page.locator('#layouts-button').click()
    await page.getByRole('button', { name: 'Open layout Docs day' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Add alongside' }).click()
    await expect(page.locator('.pane')).toHaveCount(3, { timeout: 20_000 })
    await expect(page.locator('.pane-header .agent-mark.gemini')).toHaveCount(1)

    await page.locator('#view-button').click()

    await page.locator('#layouts-button').click()
    await page.getByRole('button', { name: 'Open layout Morning' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Replace with Morning' }).click()
    await expect(page.locator('.pane')).toHaveCount(2, { timeout: 20_000 })
    await expect(page.locator('.pane-header .agent-mark.gemini')).toHaveCount(0)
    await expect.poll(() => readSettings(sandbox.userData).workspace?.panes?.length).toBe(2)

    await page.locator('#view-button').click()

    await page.locator('#layouts-button').click()
    await page.getByRole('button', { name: 'Open layout Lost' }).click()
    await expect(page.locator('.toast')).toHaveText("Layout 'Lost' has no pane whose project still exists.")
    await expect(page.locator('.pane')).toHaveCount(2, { timeout: 20_000 })
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('the dawsha command lists and opens layouts', async () => {
  const sandbox = createSandbox()
  seedLayouts(sandbox.userData)
  const { app, page } = await launchApp(sandbox)
  try {
    const list = await runCli(sandbox, ['layouts'])
    expect(list.code).toBe(0)
    expect(list.out.split('\n')[0]).toMatch(/^NAME\s+PANES\s+PROJECTS$/)
    expect(list.out).toMatch(/Morning\s+2 panes\s+Smoke/)
    expect(list.out).toMatch(/Lost\s+1 pane\s+removed project/)

    const missing = await runCli(sandbox, ['open', 'evening'])
    expect(missing.code).toBe(1)
    expect(missing.err).toContain("No layout named 'evening'. Run dawsha layouts.")
    expect((await runCli(sandbox, ['open', 'morning', '--replace', '--alongside'])).code).toBe(2)
    expect((await runCli(sandbox, ['open', 'lost'])).err).toContain("Layout 'Lost' has no pane whose project still exists.")

    const opened = await runCli(sandbox, ['open', 'Morning'])
    expect(opened).toMatchObject({ code: 0, out: "Opened layout 'Morning' (2 panes)" })
    await expect(page.locator('.pane')).toHaveCount(2, { timeout: 20_000 })

    const pending = runCli(sandbox, ['open', 'docs-day'])
    const choice = page.getByRole('alertdialog')
    await expect(choice.getByRole('heading')).toHaveText('Replace the current panes?')
    await choice.getByRole('button', { name: 'Replace with Docs day' }).click()
    expect(await pending).toMatchObject({ code: 0, out: "Opened layout 'Docs day' (1 pane)" })
    await expect(page.locator('.pane')).toHaveCount(1, { timeout: 20_000 })
    await expect(page.locator('.pane-header .agent-mark.gemini')).toHaveCount(1)

    const alongside = await runCli(sandbox, ['open', 'morning', '--alongside'])
    expect(alongside.out).toBe("Opened layout 'Morning' (2 panes)")
    await expect(page.locator('.pane')).toHaveCount(3, { timeout: 20_000 })
    const replaced = await runCli(sandbox, ['open', 'morning', '--replace'])
    expect(replaced.code).toBe(0)
    await expect(page.locator('.pane')).toHaveCount(2, { timeout: 20_000 })

    const declined = runCli(sandbox, ['open', 'docs-day'])
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click()
    const result = await declined
    expect(result.code).toBe(1)
    expect(result.err).toContain("Did not open layout 'Docs day'.")
    await expect(page.locator('.pane')).toHaveCount(2, { timeout: 20_000 })
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})
