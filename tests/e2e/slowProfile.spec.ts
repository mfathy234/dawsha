import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp } from './helpers'

// A page task of over a second is written to the slow log with the functions that ran, and the full profile next to it.
test('a freeze longer than a second saves which functions ran', async () => {
  test.setTimeout(60_000)
  const { app, page } = await launchApp(createSandbox())
  try {
    const logs = await app.evaluate(({ app: electron }) => electron.getPath('logs'))
    await page.waitForTimeout(11_000)
    await page.evaluate(() => {
      function spinForTheSlowProfileTest(): number {
        let total = 0
        const end = performance.now() + 1600
        while (performance.now() < end) total += Math.sqrt(total + 1)
        return total
      }
      setTimeout(spinForTheSlowProfileTest, 0)
    })
    await expect.poll(() => (existsSync(logs) ? readdirSync(logs).filter((file) => /^dawsha-slow-.*\.json$/.test(file)).length : 0), { timeout: 20_000 }).toBeGreaterThan(0)
    const file = readdirSync(logs).find((name) => /^dawsha-slow-.*\.json$/.test(name)) ?? ''
    const saved = JSON.parse(readFileSync(join(logs, file), 'utf8'))
    expect(saved.profile.self[0].frame).toContain('spinForTheSlowProfileTest')
    expect(readFileSync(join(logs, 'dawsha-slow.log'), 'utf8')).toContain(`profile: ${file}`)
  } finally {
    await closeApp(app)
  }
})
