import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { closeApp, createSandbox, launchApp } from '../e2e/helpers'
import { PANES, seedLoad } from './loadHarness'

const STREAM = resolve(__dirname, '../support/streamAgent.cjs')
const LABEL = process.env.PERF_LABEL ?? 'run'
const OUT = process.env.PERF_OUT ?? resolve(__dirname, 'out')
const MEASURE_MS = Number(process.env.PERF_SECONDS ?? 45) * 1000
const KBPS = process.env.PERF_KBPS ?? '30'
const KEYS = 24

mkdirSync(OUT, { recursive: true })

async function installProbes(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as Record<string, any>
    const probe = { longtasks: [] as { start: number; duration: number }[], drift: [] as number[], mutations: {} as Record<string, number>, typing: [] as number[] }
    w.__probe = probe
    new PerformanceObserver((list) => { for (const e of list.getEntries()) probe.longtasks.push({ start: e.startTime, duration: e.duration }) }).observe({ type: 'longtask', buffered: false })
    let last = performance.now()
    setInterval(() => { const now = performance.now(); probe.drift.push(now - last - 20); last = now }, 20)
    const bucket = (node: Node): string => {
      const el = node instanceof Element ? node : node.parentElement
      const region = el?.closest('.sidebar, .session-tabs, .tab-strip, .pane-head, .pane-header, .topbar, .frame-top, .term-host, .pane')
      const inner = el?.closest('.xterm-rows, .xterm-decoration-container, .term-arabic-layer, .term-marks, .term-sticky, .term-gutter-line, .xterm-screen, .xterm-viewport, .xterm-helpers')
      if (inner && region?.classList.contains('term-host')) return `term-host>${(inner.className || '').toString().split(' ')[0]}${inner.closest('.pane')?.hasAttribute('hidden') ? ' (hidden pane)' : ''}`
      return region ? `${region.tagName.toLowerCase()}.${(region.className || '').toString().split(' ').slice(0, 2).join('.')}` : `other:${el?.tagName.toLowerCase()}.${(el?.className || '').toString().split(' ')[0]}`
    }
    new MutationObserver((records) => {
      for (const record of records) {
        const key = bucket(record.target)
        const added = record.type === 'childList' ? record.addedNodes.length + record.removedNodes.length : 1
        probe.mutations[key] = (probe.mutations[key] ?? 0) + added
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: false, attributeFilter: ['class', 'style', 'hidden', 'aria-label', 'data-state'] })
    let expected = 0
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'z') return
      expected += 1
      const marker = `@@KEY${expected}@@`
      const id = document.querySelector('.pane:not([hidden]) .term-host.active')?.getAttribute('data-term-id') ?? ''
      const begin = performance.now()
      const poll = (): void => {
        if (w.__grid.viewportText(id, 80).includes(marker)) probe.typing.push(performance.now() - begin)
        else if (performance.now() - begin < 3000) requestAnimationFrame(poll)
        else probe.typing.push(3000)
      }
      requestAnimationFrame(poll)
    }, true)
  })
}

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

const cpuSnapshot = (app: Awaited<ReturnType<typeof launchApp>>['app']): Promise<{ type: string; cpu: number }[]> =>
  app.evaluate(({ app: electron }) => electron.getAppMetrics().map((m) => ({ type: m.type, cpu: m.cpu.cumulativeCPUUsage ?? 0 })))

test(`${LABEL}: ${PANES} streaming panes, maximized, Desktop style`, async () => {
  const sandbox = createSandbox()
  seedLoad(sandbox, { chat: process.env.PERF_CHAT !== '0', chatView: process.env.PERF_CHAT_VIEW === '1' })
  const idle = KBPS === '0'
  const { app, page } = await launchApp(sandbox, {
    DAWSHA_CLAUDE_COMMAND: process.execPath,
    DAWSHA_CLAUDE_ARGS: JSON.stringify([STREAM, 'claude']),
    STREAM_KBPS: KBPS,
    STREAM_AFTER_MS: process.env.PERF_QUIET_MS ?? '20000',
    DAWSHA_OFFSCREEN: '0'
  })
  try {
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setContentSize(1600, 950); w.showInactive() })
    await expect(page.locator('.term-host')).toHaveCount(PANES, { timeout: 60_000 })
    await page.waitForTimeout(Number(process.env.PERF_WARM_MS ?? 24_000))
    await installProbes(page)
    await app.evaluate(async () => {
      const g = globalThis as unknown as Record<string, any>
      const { monitorEventLoopDelay } = process.getBuiltinModule('node:perf_hooks')
      const { Session } = process.getBuiltinModule('node:inspector')
      g.__lag = monitorEventLoopDelay({ resolution: 10 })
      g.__lag.enable()
      g.__prof = new Session()
      g.__prof.connect()
      await new Promise<void>((done) => g.__prof.post('Profiler.enable', () => done()))
      await new Promise<void>((done) => g.__prof.post('Profiler.setSamplingInterval', { interval: 1000 }, () => done()))
      await new Promise<void>((done) => g.__prof.post('Profiler.start', () => done()))
    })
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.setSamplingInterval', { interval: 1000 })
    await cdp.send('Profiler.start')
    const grid = (): Promise<{ sets: number; flushes: number; listenerMs: number }> => page.evaluate(() => (window as any).__grid.storeStats())
    const metricsBefore = await cpuSnapshot(app)
    const statsBefore = await grid()
    const started = Date.now()
    if (!idle) {
      await page.locator('.pane:not([hidden]) .term-host.active').first().click()
      const step = Math.floor(MEASURE_MS / KEYS)
      for (let i = 0; i < KEYS; i += 1) {
        await page.keyboard.press('z')
        await page.waitForTimeout(step)
      }
    } else await page.waitForTimeout(MEASURE_MS)
    const seconds = (Date.now() - started) / 1000
    const statsAfter = await grid()
    const metricsAfter = await cpuSnapshot(app)
    const rendererProfile = (await cdp.send('Profiler.stop')).profile
    writeFileSync(join(OUT, `${LABEL}-renderer.cpuprofile`), JSON.stringify(rendererProfile))
    const main = await app.evaluate(async () => {
      const g = globalThis as unknown as Record<string, any>
      g.__lag.disable()
      const profile: unknown = await new Promise((done) => g.__prof.post('Profiler.stop', (_error: unknown, result: { profile: unknown }) => done(result.profile)))
      const lag = g.__lag
      return { profile, lag: { p50: lag.percentile(50) / 1e6, p99: lag.percentile(99) / 1e6, max: lag.max / 1e6 } }
    })
    writeFileSync(join(OUT, `${LABEL}-main.cpuprofile`), JSON.stringify(main.profile))
    const probe = await page.evaluate(() => (window as any).__probe)
    const cpuOf = (type: string): number => {
      const sum = (list: typeof metricsBefore): number => list.filter((m) => m.type === type).reduce((total, m) => total + m.cpu, 0)
      return ((sum(metricsAfter) - sum(metricsBefore)) / seconds) * 100
    }
    const tasks = probe.longtasks as { duration: number }[]
    const result = {
      label: LABEL,
      seconds,
      kbps: Number(KBPS),
      panes: PANES,
      renderer: {
        longTasks: tasks.length,
        longTaskMsPerMin: (tasks.reduce((sum, t) => sum + t.duration, 0) / seconds) * 60,
        worstTaskMs: Math.max(0, ...tasks.map((t) => t.duration)),
        driftP99Ms: percentile(probe.drift, 99),
        driftMaxMs: Math.max(0, ...(probe.drift as number[])),
        cpuPercentOfCore: cpuOf('Tab'),
        storeSetsPerSec: (statsAfter.sets - statsBefore.sets) / seconds,
        storeFlushesPerSec: (statsAfter.flushes - statsBefore.flushes) / seconds,
        listenerMsPerSec: (statsAfter.listenerMs - statsBefore.listenerMs) / seconds
      },
      main: { loopLagP50Ms: main.lag.p50, loopLagP99Ms: main.lag.p99, loopLagMaxMs: main.lag.max, cpuPercentOfCore: cpuOf('Browser') },
      typing: { samples: probe.typing.length, p50Ms: percentile(probe.typing, 50), p95Ms: percentile(probe.typing, 95), maxMs: Math.max(0, ...(probe.typing as number[])) },
      domChangesPerSec: Object.fromEntries(Object.entries(probe.mutations as Record<string, number>).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([key, value]) => [key, Math.round((value / seconds) * 10) / 10]))
    }
    writeFileSync(join(OUT, `${LABEL}.json`), JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result, null, 2))
  } finally {
    await closeApp(app)
  }
})
