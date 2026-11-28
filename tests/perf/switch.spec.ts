import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp } from '../e2e/helpers'
import { PANES, seedLoad, writeChatLog } from './loadHarness'
import { readFileSync } from 'node:fs'

const BIG = resolve(__dirname, '../support/bigAgent.cjs')
const LABEL = process.env.PERF_LABEL ?? 'switch'
const OUT = process.env.PERF_OUT ?? resolve(__dirname, 'out')
const SKIP_RESIZE = process.env.PERF_NO_RESIZE === '1'
const ROUNDS = Number(process.env.PERF_ROUNDS ?? 2)
mkdirSync(OUT, { recursive: true })

test(`${LABEL}: tab switches with ${PANES} big panes`, async () => {
  const sandbox = createSandbox()
  const setup = seedLoad(sandbox, { chat: false, chatView: false })
  const logs = Number(process.env.PERF_LOGS ?? 0)
  if (logs > 0) {
    const file = join(sandbox.userData, 'settings.json')
    const settings = JSON.parse(readFileSync(file, 'utf8'))
    for (let i = 0; i < Math.min(logs, PANES); i += 1) {
      const sessionId = `11111111-2222-4333-8444-5555555555${String(i).padStart(2, '0')}`
      settings.workspace.panes[i].tabs[0].sessionId = sessionId
      if (process.env.PERF_CHAT_VIEW === '1') settings.workspace.panes[i].tabs[0].view = 'chat'
      writeChatLog(sandbox, setup.folders[i], sessionId, Number(process.env.PERF_LOG_MB ?? 20))
    }
    writeFileSync(file, JSON.stringify(settings), 'utf8')
  }
  const { app, page } = await launchApp(sandbox, {
    DAWSHA_CLAUDE_COMMAND: process.execPath,
    DAWSHA_CLAUDE_ARGS: JSON.stringify([BIG]),
    BIG_REDRAW: process.env.BIG_REDRAW ?? '0',
    BIG_STREAM: process.env.BIG_STREAM ?? '0',
    STREAM_KBPS: process.env.PERF_KBPS ?? '8',
    STREAM_AFTER_MS: '0',
    BIG_ROWS: process.env.BIG_ROWS ?? '10000',
    DAWSHA_OFFSCREEN: '0'
  })
  try {
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setContentSize(1600, 950); w.showInactive() })
    await expect(page.locator('.term-host')).toHaveCount(PANES, { timeout: 60_000 })
    await page.waitForTimeout(Number(process.env.PERF_WARM_MS ?? 20_000))
    const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.term-host')).map((el) => (window as any).__grid.bufferText(el.getAttribute('data-term-id')).split('\n').length))
    console.log('buffer rows', rows.join(','))
    console.log('webgl canvases', await page.evaluate(() => Array.from(document.querySelectorAll('.term-host')).map((el) => el.querySelectorAll('canvas').length).join(',')))
    await page.evaluate(() => {
      const w = window as unknown as { __long: { at: number; ms: number; tag: string }[]; __tag: string }
      w.__long = []
      w.__tag = 'warm'
      new PerformanceObserver((list) => { for (const e of list.getEntries()) w.__long.push({ at: e.startTime, ms: e.duration, tag: w.__tag }) }).observe({ type: 'longtask', buffered: false })
    })
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.setSamplingInterval', { interval: 500 })
    await cdp.send('Profiler.start')
    const step = async (tag: string, run: () => Promise<void>): Promise<void> => {
      await page.evaluate((t) => { (window as any).__tag = t }, tag)
      await run()
      await page.waitForTimeout(2500)
    }
    for (let round = 0; round < ROUNDS; round += 1) {
      await page.waitForTimeout(Number(process.env.PERF_COLD_MS ?? 70_000))
      for (let i = 0; i < PANES; i += 1) {
        await step(`tab ${round}.${i}`, () => page.locator('.pane-strip .strip-label').nth(i).click())
      }
      await step(`resize ${round}`, () => app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1300, 900) }))
      for (let i = 0; i < 3; i += 1) await step(`tab-after-resize ${round}.${i}`, () => page.locator('.pane-strip .strip-label').nth(i).click())
      await step(`resize-back ${round}`, () => app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1600, 950) }))
      for (let i = 0; i < 3; i += 1) await step(`tab-after-resize-back ${round}.${i}`, () => page.locator('.pane-strip .strip-label').nth((i + 1) % PANES).click())
      await step(`settings ${round}`, async () => { await page.getByRole('button', { name: /^Settings/ }).first().click() })
      await step(`back ${round}`, async () => { await page.keyboard.press('Escape') })
      await step(`restore ${round}`, async () => { await page.getByRole('button', { name: 'Restore pane to grid' }).first().click() })
      await step(`maximize ${round}`, async () => { await page.getByRole('button', { name: 'Maximize pane' }).first().click() })
    }
    const profile = (await cdp.send('Profiler.stop')).profile
    writeFileSync(join(OUT, `${LABEL}.cpuprofile`), JSON.stringify(profile))
    const long = await page.evaluate(() => (window as any).__long as { ms: number; tag: string }[])
    writeFileSync(join(OUT, `${LABEL}.json`), JSON.stringify(long, null, 2))
    console.log(long.filter((t) => t.ms > 100).map((t) => `${t.tag}: ${Math.round(t.ms)} ms`).join('\n'))
    console.log(`worst ${Math.round(Math.max(0, ...long.map((t) => t.ms)))} ms, tasks>100ms ${long.filter((t) => t.ms > 100).length}`)
  } finally {
    await closeApp(app)
  }
})
