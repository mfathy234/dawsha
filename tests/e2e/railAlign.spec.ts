import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator } from '@playwright/test'
import { closeApp, createSandbox, launchApp } from './helpers'

const DESKTOP = { panes: 'quiet', frame: 'sidebar', tone: 'warm' }
const readSettings = (userData: string): any => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))

async function iconCentre(button: Locator): Promise<number> {
  const box = await button.locator('svg').first().boundingBox()
  if (!box) throw new Error('icon not visible')
  return box.x + box.width / 2
}

// Every control in the collapsed rail sits on the same centre line as the project tiles.
test('the rail centres Search, Settings and the other controls on the tile column', async () => {
  const sandbox = createSandbox()
  writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify({ ...readSettings(sandbox.userData), appearance: DESKTOP, sidebarCollapsed: true }), 'utf8')
  const { app, page } = await launchApp(sandbox)
  try {
    const rail = page.locator('.sidebar.rail')
    await expect(rail).toBeVisible()
    const tile = (await rail.locator('.rail-tile').first().boundingBox())!
    const centre = tile.x + tile.width / 2
    const controls: [string, Locator][] = [
      ['Search', rail.locator('#search-button')],
      ['Settings', rail.locator('#settings-button')],
      ['Views', rail.locator('#rail-views')],
      ['Add project', rail.getByRole('button', { name: 'Add project' })],
      ['Expand', rail.locator('#sidebar-expand')]
    ]
    for (const [name, control] of controls) {
      await expect(control, name).toBeVisible()
      expect(Math.abs((await iconCentre(control)) - centre), `${name} is off the tile column`).toBeLessThanOrEqual(1)
    }
  } finally {
    await closeApp(app)
  }
})
